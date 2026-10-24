# Run on your Windows computer. Production is read ONLY by pg_dump.
# Restore targets a newly created local Docker container with no networking.
[CmdletBinding()]
param([string]$PostgresBin = 'C:\Program Files\PostgreSQL\18\bin')
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
function Find-PgTool([string]$Name) {
    $candidate = Join-Path $PostgresBin ($Name + '.exe')
    if (Test-Path -LiteralPath $candidate) { return $candidate }
    $found = Get-Command $Name -ErrorAction SilentlyContinue
    if ($found) { return $found.Source }
    throw "Cannot find $Name. Set -PostgresBin to your PostgreSQL 18 bin folder."
}
$pgDump = Find-PgTool 'pg_dump'
$pgRestore = Find-PgTool 'pg_restore'
& $pgDump --version
& $pgRestore --version
$docker = (Get-Command docker -ErrorAction Stop).Source
$dockerContext = 'desktop-linux'
$endpoint = & $docker context inspect $dockerContext --format '{{.Endpoints.docker.Host}}'
if ($LASTEXITCODE -ne 0 -or -not ([string]$endpoint).Trim().StartsWith('npipe://', [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Restore requires the desktop-linux Docker Desktop context with a local npipe:// endpoint.'
}
# Pin every Docker command, including cleanup, to the verified local context.
function Invoke-LocalDocker {
    & $script:docker --context $script:dockerContext @args
}
Invoke-LocalDocker version --format '{{.Server.Version}}'
if ($LASTEXITCODE -ne 0) { throw 'Start Docker Desktop with Linux containers, then run again.' }
$image = 'supabase/postgres:17.6.1.136'
Invoke-LocalDocker pull $image
if ($LASTEXITCODE -ne 0) { throw 'Database image download failed. No backup or restore was attempted.' }
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$suffix = [guid]::NewGuid().ToString('N').Substring(0, 8)
$container = "tendercrest-restore-$stamp-$suffix"
$volume = "$container-data"
$folder = Join-Path $env:USERPROFILE "TenderCrestReleaseBackup-$stamp-$suffix"
New-Item -ItemType Directory -Path $folder | Out-Null
# Restrict private backup and logs to this Windows user and SYSTEM.
$identity = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
& icacls.exe $folder /inheritance:r /grant:r "${identity}:(OI)(CI)F" '*S-1-5-18:(OI)(CI)F' | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Could not restrict backup folder permissions. Stop here.' }
$archive = Join-Path $folder 'tendercrest-before-integrated-release.dump'
$restoreSql = Join-Path $folder 'restore-private.sql'
$log = Join-Path $folder 'restore-private.log'
$oldPassword = $env:PGPASSWORD
$oldSslMode = $env:PGSSLMODE
$created = $false
$volumeCreated = $false
$dumpCode = $null
$listCode = $null
$restoreCode = $null
$verified = $false
$createdUtc = [DateTime]::UtcNow.ToString('o')
try {
    $secure = Read-Host 'Enter the CURRENT production DATABASE password (hidden)' -AsSecureString
    $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    try { $env:PGPASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer); $secure.Dispose() }
    $env:PGSSLMODE = 'require'
    & $pgDump --host=aws-1-us-west-2.pooler.supabase.com --port=5432 --username=postgres.vfdwaqgfepvoujprtuww --dbname=postgres --no-password --format=custom --file=$archive 2> (Join-Path $folder 'dump-private.log')
    $dumpCode = $LASTEXITCODE
    $env:PGPASSWORD = $oldPassword
    $env:PGSSLMODE = $oldSslMode
    if ($dumpCode -ne 0) { throw "Backup failed (exit $dumpCode). Do not use the resulting archive. Private details: $folder" }
    & $pgRestore --list $archive > (Join-Path $folder 'archive-private.list')
    $listCode = $LASTEXITCODE
    if ($listCode -ne 0) { throw 'Archive inspection failed. Keep the files private.' }
    # PG18 reads its archive and emits SQL for the PostgreSQL 17 restore target.
    # Ownership/grants remain in the original archive; omit them only for this data/schema test.
    & $pgRestore --no-owner --no-privileges --file=$restoreSql $archive 2> (Join-Path $folder 'conversion-private.log')
    if ($LASTEXITCODE -ne 0) { throw 'Archive-to-SQL conversion failed.' }
    Invoke-LocalDocker volume create $volume | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Could not create a disposable Docker volume.' }
    $volumeCreated = $true
    # This is a generated LOCAL password, never the production password.
    $localPassword = [guid]::NewGuid().ToString('N')
    Invoke-LocalDocker run -d --name $container --network none --mount "type=volume,source=$volume,target=/var/lib/postgresql/data" -e "POSTGRES_PASSWORD=$localPassword" -e POSTGRES_DB=postgres $image postgres -c config_file=/etc/postgresql/postgresql.conf -c cron.launch_active_jobs=off -c listen_addresses= | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Disposable database failed to start.' }
    $created = $true
    $ready = $false
    for ($i = 0; $i -lt 90; $i++) {
        $processName = Invoke-LocalDocker exec $container cat /proc/1/comm 2>$null
        if ($LASTEXITCODE -eq 0 -and ([string]$processName).Trim() -in @('postgres', '.postgres-wrapp')) {
            Invoke-LocalDocker exec $container pg_isready -h /var/run/postgresql -U supabase_admin -d postgres *> $null
            if ($LASTEXITCODE -eq 0) { $ready = $true; break }
        }
        Start-Sleep -Seconds 2
    }
    if (-not $ready) { throw 'Disposable database did not become ready.' }
    # These DROP/CREATE commands can only reach the unique local container, never Supabase.
    Invoke-LocalDocker exec $container psql -X -v ON_ERROR_STOP=1 -h /var/run/postgresql -U supabase_admin -d template1 -c 'DROP DATABASE postgres WITH (FORCE);' > $log 2>&1
    if ($LASTEXITCODE -ne 0) { throw 'Could not empty the disposable database.' }
    Invoke-LocalDocker exec $container psql -X -v ON_ERROR_STOP=1 -h /var/run/postgresql -U supabase_admin -d template1 -c 'CREATE DATABASE postgres TEMPLATE template0;' >> $log 2>&1
    if ($LASTEXITCODE -ne 0) { throw 'Could not create the disposable restore database.' }
    Invoke-LocalDocker cp $restoreSql "${container}:/tmp/restore-private.sql"
    if ($LASTEXITCODE -ne 0) { throw 'Could not copy SQL into the disposable database.' }
    Invoke-LocalDocker exec -e 'PGOPTIONS=-c session_replication_role=replica' $container psql -X --single-transaction -v ON_ERROR_STOP=1 -h /var/run/postgresql -U supabase_admin -d postgres -f /tmp/restore-private.sql >> $log 2>&1
    $restoreCode = $LASTEXITCODE
    if ($restoreCode -ne 0) { throw "Restore failed (exit $restoreCode). Keep the archive and log private; report only the error category, not document data." }
    Invoke-LocalDocker exec $container psql -X -v ON_ERROR_STOP=1 -h /var/run/postgresql -U supabase_admin -d postgres -c "SELECT count(*) AS public_tables FROM information_schema.tables WHERE table_schema='public'; SELECT count(*) AS knowledge_documents FROM public.kb_documents; SELECT count(*) AS auth_users FROM auth.users; SELECT version FROM supabase_migrations.schema_migrations ORDER BY version;" >> $log 2>&1
    if ($LASTEXITCODE -ne 0) { throw 'Restored database verification failed.' }
    $verified = $true
}
finally {
    $env:PGPASSWORD = $oldPassword
    $env:PGSSLMODE = $oldSslMode
    if ($created) { Invoke-LocalDocker rm -f -v $container | Out-Null; if ($LASTEXITCODE -ne 0) { Write-Warning "Remove local test container manually: $container"; $verified = $false } }
    if ($volumeCreated) { Invoke-LocalDocker volume rm $volume | Out-Null; if ($LASTEXITCODE -ne 0) { Write-Warning "Remove local test volume manually: $volume"; $verified = $false } }
    if (Test-Path -LiteralPath $restoreSql) { Remove-Item -LiteralPath $restoreSql -Force }
}
if (-not $verified) { throw 'Backup verification or temporary-data cleanup is incomplete.' }
$result = [ordered]@{
    project = 'vfdwaqgfepvoujprtuww'
    created_utc = $createdUtc
    bytes = (Get-Item -LiteralPath $archive).Length
    sha256 = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash
    pg_dump_exit_code = $dumpCode
    archive_inspection_exit_code = $listCode
    restore_exit_code = $restoreCode
    full_data_schema_restore_test_performed = $true
    ownership_and_grants_restore_tested = $false
    storage_object_files_included = $false
    temporary_database_removed = $true
}
$result | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $folder 'verification.json') -Encoding UTF8
Write-Host "Private backup saved in: $folder"
Write-Host 'Share only the following JSON. Keep the dump, SQL, passwords, and logs private.'
$result | ConvertTo-Json
