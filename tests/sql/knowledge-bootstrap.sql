-- Local disposable PostgreSQL harness only. Never run in Supabase/production.
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create schema auth;
create table auth.users(id uuid primary key,email text);
create function auth.uid() returns uuid language sql stable as $$
 select coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid
$$;
grant usage on schema auth to anon,authenticated,service_role;
grant execute on function auth.uid() to anon,authenticated,service_role;
create schema storage;
create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text references storage.buckets(id),name text,unique(bucket_id,name));
alter table storage.objects enable row level security;
grant usage on schema public,storage to anon,authenticated,service_role;
grant select,insert,update,delete on storage.objects to anon,authenticated;
grant all on all tables in schema auth,storage to service_role;
-- Deliberately unsafe existing policy: the migration must bound KB access while
-- preserving this pre-existing behavior for unrelated buckets.
create policy unrelated_broad_policy on storage.objects for all to public using(true) with check(true);
