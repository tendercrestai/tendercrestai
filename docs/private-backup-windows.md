# Windows: private backup and local restore verification

This procedure reads production using `pg_dump`. It restores only into a uniquely named local Docker container with networking disabled, no published ports, scheduled cron jobs disabled, and triggers suppressed during restore. It does not restore to either Supabase project or change production.

## Prerequisites

1. Use your Windows computer, not your phone. Keep the current Supabase **database password** available privately. This is not the service-role key or your Supabase website password. Do not paste it into chat.
2. PostgreSQL 18 client tools must be installed. The default folder is `C:\Program Files\PostgreSQL\18\bin`. The script also searches PATH. If installed elsewhere, pass `-PostgresBin 'your bin folder'`.
3. Start an existing Docker Desktop installation using **Linux containers**. Run `docker version` in PowerShell and confirm that it reports a Server version. If Docker is not installed, use the official Docker Desktop Windows installer and its WSL 2 prerequisites, then restart if prompted. Check your organization's Docker licensing eligibility; do not purchase a subscription for this test. Stop and report if Docker is unavailable.
4. Allow several GB of free disk space for the Supabase image and local restore. The image download may take several minutes. Do not use a shared or publicly synced location for the dump.

## Run

1. Download `scripts/verify-private-backup.ps1` from this release branch using GitHub's **Raw / Download raw file**, saving it to Downloads with its `.ps1` extension. This is a script, not a backup. Inspect the file if required by your workstation policy.
2. Open PowerShell as your usual Windows user. Run:

   ```powershell
   powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$env:USERPROFILE\Downloads\verify-private-backup.ps1"
   ```

   The execution-policy option applies only to this child process; it does not permanently change your Windows policy. Organization-enforced policies still apply. If your PostgreSQL folder differs:

   ```powershell
   powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$env:USERPROFILE\Downloads\verify-private-backup.ps1" -PostgresBin 'D:\PostgreSQL\18\bin'
   ```

3. Wait for the image download, then type the current production **database password** at the hidden prompt and press Enter. The script already specifies the verified session-pooler host, port, user and database:
   - Host: `aws-1-us-west-2.pooler.supabase.com`
   - Port: `5432`
   - User: `postgres.vfdwaqgfepvoujprtuww`
   - Database: `postgres`
4. Wait for the dump, archive inspection, local restore and cleanup. On success, copy **only the final JSON** into the release conversation. All three exit codes must be `0`; the restore-test and cleanup fields must be `true`.
5. Keep the private folder shown by the script. It contains the original custom-format archive, SHA-256 metadata and private logs. Retain a separate encrypted copy on your own backup drive. Do not attach the archive or logs to GitHub/chat or commit them to the repository.

If a step fails, stop and share the short error category or exit code. Do not share document text, SQL INSERT/COPY contents, passwords or full logs. A failed restore is not success even when archive inspection passed. The script removes its temporary local database and plaintext SQL; it retains the archive for diagnosis. If cleanup warns about a named test container/volume, remove only that exact test resource in Docker Desktop. Never run a broad Docker prune.

## Scope and observed validation

The restore test verifies database data and schema, with ownership/grants omitted **only in the disposable test**. The original archive retains its database metadata. It does not verify a complete hosted Supabase recovery, platform role recreation, vault decryption, application configuration or storage-object recovery. PostgreSQL dumps do not contain uploaded file bytes. The production migration is additive; existing storage objects must still have a separate recovery plan.

The script passed PowerShell syntax validation. The custom-format dump → archive inspection → SQL restore command sequence, including a fictional Unicode data row, passed a local Linux dry run with the integrated fictional SQL fixture in the official `supabase/postgres:17.6.1.136` filesystem (flattened locally to fit the execution environment's disk driver). Vector 0.8.2 and vault 0.3.1 were available. This is not a restore of the owner's production archive. Windows-specific ACL/path/prompt behavior must be confirmed by the actual Windows run.
