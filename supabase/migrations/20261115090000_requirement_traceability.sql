-- Requirement-to-evidence traceability (Capability 1). Additive only: two new
-- audit tables. No existing table, function, or policy is changed.
-- MANUAL APPLY: run this file in the Supabase dashboard SQL Editor against the
-- production project (vfdwaqgfepvoujprtuww). Migrations are not auto-applied.
-- SAFE DEGRADATION IF NOT APPLIED: the server keeps working on the JSONB mirror
-- in pw_projects.state (trace data is stored per requirement in state, and the
-- UI + compliance export read that mirror). The server writes these tables
-- best-effort only (proposal-service recordTrace): if the tables do not exist,
-- PostgREST answers 404 and the write is swallowed, so no user-visible save
-- ever fails because the migration is unapplied. After applying, the tables
-- become the queryable audit record; the state mirror remains the source of
-- truth for the UI. Rollback: revert the code merge; these tables simply stop
-- receiving rows. Dropping them is optional and loses only the audit copies
-- (the state mirror keeps every trace review).
begin;
create table public.pw_requirement_traces (
 id uuid primary key default gen_random_uuid(),
 project_id uuid not null references public.pw_projects(id) on delete cascade,
 org_id uuid not null references public.kb_organizations(id),
 stable_requirement_id text not null check(length(btrim(stable_requirement_id)) between 1 and 64),
 requirement_id uuid,
 coverage text not null check(coverage in ('not-assessed','supported','partially-supported','missing-evidence')),
 coverage_source text check(coverage_source in ('ai-suggested','human-confirmed')),
 explanation text not null default '' check(length(explanation)<=1000),
 reviewed_by uuid references auth.users(id),
 reviewed_at timestamptz,
 reviewed_requirement_revision integer,
 reviewed_evidence_epoch integer,
 reviewed_response_revision integer,
 response_approval_status text not null default 'not-approved' check(response_approval_status in ('not-approved','approved','needs-reconfirmation')),
 response_approval jsonb not null default '{}' check(jsonb_typeof(response_approval)='object'),
 history jsonb not null default '[]' check(jsonb_typeof(history)='array'),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(project_id,stable_requirement_id)
);
create index pw_requirement_traces_project on public.pw_requirement_traces(project_id,updated_at desc);
create table public.pw_trace_links (
 id uuid primary key default gen_random_uuid(),
 project_id uuid not null references public.pw_projects(id) on delete cascade,
 org_id uuid not null references public.kb_organizations(id),
 stable_requirement_id text not null check(length(btrim(stable_requirement_id)) between 1 and 64),
 answer_id uuid not null,
 answer_revision integer not null check(answer_revision>=0),
 excerpt text not null default '' check(length(excerpt)<=1000),
 decision text not null check(decision in ('suggested','accepted','rejected')),
 reviewed_by uuid references auth.users(id),
 created_at timestamptz not null default now(),
 unique(project_id,stable_requirement_id,answer_id,answer_revision)
);
create index pw_trace_links_project on public.pw_trace_links(project_id,stable_requirement_id);
-- RLS follows the pw_* pattern: authenticated users get SELECT only when they
-- hold a project role (pw_role); all writes are service-role only.
do $$ declare t text;begin
 foreach t in array array['pw_requirement_traces','pw_trace_links'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated',t);
  execute format('grant select on public.%I to authenticated',t);
  execute format('grant all on public.%I to service_role',t);
  execute format('create policy %I on public.%I for select to authenticated using(public.pw_role(project_id) is not null)',t||'_read',t);
 end loop;
end $$;
commit;
