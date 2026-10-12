begin;

create table public.proposal_evidence (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (length(btrim(title)) between 1 and 200),
  kind text not null check (kind in ('company_evidence', 'past_bid', 'evaluator_feedback')),
  sector text not null check (sector in ('All', 'Public Sector / Gov (Section L&M)', 'Commercial / Enterprise RFP', 'SaaS / Tech Vendor Evaluation', 'Grant / Non-Profit Application')),
  content text not null check (length(btrim(content)) between 1 and 30000),
  source_label text not null check (length(btrim(source_label)) between 1 and 300),
  outcome text not null default 'unknown' check (outcome in ('unknown', 'won', 'lost', 'not_applicable')),
  approved boolean not null default false,
  rights_confirmed boolean not null check (rights_confirmed),
  created_at timestamptz not null default now()
);

alter table public.proposal_evidence enable row level security;
revoke all on public.proposal_evidence from public, anon, authenticated;
grant select, insert, delete on public.proposal_evidence to authenticated;
grant update (approved) on public.proposal_evidence to authenticated;
create policy evidence_owner_read on public.proposal_evidence for select to authenticated
  using (user_id = (select auth.uid()));
create policy evidence_owner_insert on public.proposal_evidence for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy evidence_owner_approve on public.proposal_evidence for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy evidence_owner_delete on public.proposal_evidence for delete to authenticated
  using (user_id = (select auth.uid()));
create index proposal_evidence_owner_approved on public.proposal_evidence (user_id, approved, created_at desc);

commit;
