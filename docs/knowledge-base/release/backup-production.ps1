# Run locally in PowerShell. The database password is entered only at pg_dump's prompt.
# This reads the production database; it does not apply migrations or alter data.
$ErrorActionPreference = 'Stop'
$pgDump = (Get-Command pg_dump -ErrorAction Stop).Source
$pgRestore = (Get-Command pg_restore -ErrorAction Stop).Source
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$profileDir = [Environment]::GetFolderPath('UserProfile')
$backupDir = Join-Path $profileDir ('TenderCrestKBBackup-' + $stamp)
New-Item -ItemType Directory -Path $backupDir -ErrorAction Stop | Out-Null
$partial = Join-Path $backupDir 'tendercrest-before-knowledge-base.dump.partial'
$archive = Join-Path $backupDir 'tendercrest-before-knowledge-base.dump'

Write-Host 'Enter the current Supabase DATABASE password when pg_dump asks.'
Write-Host 'The host, port, database and pooler user are already specified.'
$connection = 'host=aws-1-us-west-2.pooler.supabase.com port=5432 user=postgres.vfdwaqgfepvoujprtuww dbname=postgres sslmode=require connect_timeout=20'
& $pgDump --dbname=$connection --format=custom --file=$partial --password
$dumpExit = $LASTEXITCODE
if ($dumpExit -ne 0 -or -not (Test-Path -LiteralPath $partial)) {
    throw 'Backup failed. Do not use any resulting partial file. No migration was run.'
}
if ((Get-Item -LiteralPath $partial).Length -eq 0) {
    throw 'Backup is empty. Do not use it. No migration was run.'
}
$entries = & $pgRestore --list $partial
$inspectExit = $LASTEXITCODE
if ($inspectExit -ne 0 -or -not $entries) {
    throw 'Archive inspection failed. Do not use the partial file. No migration was run.'
}
$entries | Out-File -FilePath (Join-Path $backupDir 'archive-list.txt') -Encoding utf8
Move-Item -LiteralPath $partial -Destination $archive -ErrorAction Stop
$file = Get-Item -LiteralPath $archive
$hash = Get-FileHash -LiteralPath $archive -Algorithm SHA256
$evidence = [ordered]@{
    project = 'vfdwaqgfepvoujprtuww'
    created_utc = (Get-Date).ToUniversalTime().ToString('o')
    archive = $file.FullName
    bytes = $file.Length
    sha256 = $hash.Hash
    pg_dump_exit_code = $dumpExit
    archive_inspection_exit_code = $inspectExit
    full_restore_test_performed = $false
    storage_object_files_included = $false
}
$evidenceJson = $evidence | ConvertTo-Json
$evidenceJson | Set-Content -LiteralPath (Join-Path $backupDir 'backup-evidence.json') -Encoding utf8
Write-Host 'Backup and archive inspection succeeded. Keep the dump private.'
$evidenceJson
