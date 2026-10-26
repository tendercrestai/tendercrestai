-- Disposable local fixture only; real production submissions already exist.
alter table public.rfp_uploads add column id uuid default gen_random_uuid(),add column file_name text;
create table public.rfp_submissions(id uuid primary key,user_id uuid references auth.users(id),status text,document_id uuid);
create table public.rfp_compliance_analyses(id uuid primary key,user_id uuid,documents jsonb);
grant all on public.rfp_uploads,public.rfp_compliance_analyses to service_role;
grant all on public.rfp_submissions to service_role;
