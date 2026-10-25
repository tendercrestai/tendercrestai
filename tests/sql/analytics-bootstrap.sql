-- Disposable harness only; real auth.users and upload registry already exist.
alter table auth.users add column created_at timestamptz not null default now();
create table public.rfp_uploads(user_id uuid,storage_path text);
revoke all on auth.users from service_role;
