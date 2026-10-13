-- Additive only. Apply to a disposable/preview project first.
-- CLI unavailable in implementation environment; timestamp generated in UTC.
begin;
create table public.rfp_compliance_analyses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  fingerprint text not null check (fingerprint ~ '^[0-9a-f]{64}$'),
  engine_version text not null default 'compliance-v1',
  status text not null default 'Pending' check (status in ('Pending','Processing','Completed','Partial','Failed')),
  documents jsonb not null check (jsonb_typeof(documents) = 'array'),
  chunks jsonb not null check (jsonb_typeof(chunks) = 'array' and jsonb_array_length(chunks) between 1 and 16),
  facts jsonb not null default '[]'::jsonb,
  warnings jsonb not null default '[]'::jsonb,
  reviewed_hash text,
  cursor integer not null default 0 check (cursor >= 0),
  attempts integer not null default 0 check (attempts between 0 and 3),
  lease_token uuid,
  lease_until timestamptz,
  error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id,fingerprint),
  unique(id,user_id)
);
create index rfp_compliance_owner_created on public.rfp_compliance_analyses(user_id,created_at);
alter table public.rfp_compliance_analyses enable row level security;
revoke all on public.rfp_compliance_analyses from public,anon,authenticated;
grant select on public.rfp_compliance_analyses to authenticated;
grant all on public.rfp_compliance_analyses to service_role;
create policy compliance_analysis_owner_read on public.rfp_compliance_analyses
  for select to authenticated using(user_id = (select auth.uid()));

create table public.rfp_compliance_requirements (
  id uuid primary key default gen_random_uuid(),
  analysis_id uuid not null,
  user_id uuid not null,
  fingerprint text not null,
  original_requirement text not null,
  requirement text not null check(length(btrim(requirement)) between 1 and 3000),
  category text not null check(category in ('Technical','Legal','Financial','Administrative','Eligibility','Submission','Attachment','Evaluation','Service Level','Other')),
  mandatory text not null check(mandatory in ('Yes','No','Unclear')),
  evaluation_weight text,
  sources jsonb not null,
  uncertain boolean not null default false,
  duplicate_count integer not null default 0,
  status text not null default 'Needs Review' check(status in ('Compliant','Partial','Non-Compliant','Needs Review')),
  evidence text not null default '' check(length(evidence) <= 10000),
  evidence_reference text not null default '' check(length(evidence_reference) <= 1000),
  response_owner text not null default '' check(length(response_owner) <= 200),
  comments text not null default '' check(length(comments) <= 5000),
  recommendation text not null,
  revision integer not null default 0,
  updated_at timestamptz not null default now(),
  foreign key(analysis_id,user_id) references public.rfp_compliance_analyses(id,user_id) on delete cascade,
  unique(analysis_id,fingerprint),
  check(status <> 'Compliant' or (length(btrim(evidence)) > 0 and length(btrim(evidence_reference)) > 0))
);
create index rfp_compliance_requirements_owner on public.rfp_compliance_requirements(user_id,analysis_id);
alter table public.rfp_compliance_requirements enable row level security;
revoke all on public.rfp_compliance_requirements from public,anon,authenticated;
grant select on public.rfp_compliance_requirements to authenticated;
grant update(requirement,category,mandatory,status,evidence,evidence_reference,response_owner,comments) on public.rfp_compliance_requirements to authenticated;
grant all on public.rfp_compliance_requirements to service_role;
create policy compliance_requirement_owner_read on public.rfp_compliance_requirements
  for select to authenticated using(user_id = (select auth.uid()));
create policy compliance_requirement_owner_update on public.rfp_compliance_requirements
  for update to authenticated using(user_id = (select auth.uid())) with check(user_id = (select auth.uid()));

create function public.rfp_compliance_review_version() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  new.revision := old.revision + 1;
  new.updated_at := now();
  return new;
end $$;
revoke all on function public.rfp_compliance_review_version() from public,anon,authenticated;
create trigger compliance_review_version before update on public.rfp_compliance_requirements
for each row execute function public.rfp_compliance_review_version();

-- Durable reservation for the maximum three attempts per chunk.
-- Global bound supplements provider-account billing limits.
create table public.rfp_compliance_daily_budget (
  day date primary key,
  reserved_calls integer not null check(reserved_calls between 0 and 500),
  attempted_calls integer not null default 0 check(attempted_calls between 0 and 500)
);
alter table public.rfp_compliance_daily_budget enable row level security;
revoke all on public.rfp_compliance_daily_budget from public,anon,authenticated;
grant all on public.rfp_compliance_daily_budget to service_role;
create table public.rfp_compliance_user_budget (
  day date not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  attempted_calls integer not null check(attempted_calls between 0 and 144),
  primary key(day,user_id)
);
alter table public.rfp_compliance_user_budget enable row level security;
revoke all on public.rfp_compliance_user_budget from public,anon,authenticated;
grant all on public.rfp_compliance_user_budget to service_role;

-- All RPCs are invoker functions granted ONLY to the server role.
-- No user-supplied identity can invoke a privileged transition directly.
create function public.rfp_compliance_start(
  p_user uuid, p_fingerprint text, p_documents jsonb, p_chunks jsonb, p_warnings jsonb
) returns uuid language plpgsql security invoker set search_path = '' as $$
declare saved uuid; calls integer; created integer;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user::text, 42));
  select id into saved from public.rfp_compliance_analyses where user_id=p_user and fingerprint=p_fingerprint;
  if saved is not null then return saved; end if;
  calls := jsonb_array_length(p_chunks) * 3;
  if calls < 3 or calls > 48 or jsonb_array_length(p_documents) not between 1 and 6 then
    raise exception 'invalid analysis size' using errcode='22023';
  end if;
  select count(*) into created from public.rfp_compliance_analyses
    where user_id=p_user and created_at >= (((now() at time zone 'UTC')::date)::timestamp at time zone 'UTC');
  if created >= 3 then raise exception 'daily analysis limit' using errcode='P0001'; end if;
  insert into public.rfp_compliance_daily_budget(day,reserved_calls)
    values((now() at time zone 'UTC')::date,calls)
    on conflict(day) do update set reserved_calls=public.rfp_compliance_daily_budget.reserved_calls + excluded.reserved_calls
      where public.rfp_compliance_daily_budget.reserved_calls + excluded.reserved_calls <= 500;
  if not found then raise exception 'daily AI budget limit' using errcode='P0001'; end if;
  insert into public.rfp_compliance_analyses(user_id,fingerprint,documents,chunks,warnings)
    values(p_user,p_fingerprint,p_documents,p_chunks,p_warnings) returning id into saved;
  return saved;
end $$;

create function public.rfp_compliance_claim(p_id uuid,p_user uuid,p_hash text,p_lease uuid)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare a public.rfp_compliance_analyses;
begin
  select * into a from public.rfp_compliance_analyses where id=p_id and user_id=p_user for update;
  if not found then raise exception 'not found' using errcode='P0002'; end if;
  if a.status in ('Completed','Partial') then return jsonb_build_object('done',true); end if;
  if p_hash <> a.fingerprint then raise exception 'review source changed' using errcode='22023'; end if;
  if a.lease_until > now() then raise exception 'already processing' using errcode='55P03'; end if;
  if a.attempts >= 3 then raise exception 'retry limit' using errcode='P0001'; end if;
  -- Enforce actual attempt budgets on the day of use, including resumed old analyses.
  insert into public.rfp_compliance_daily_budget(day,reserved_calls,attempted_calls)
    values((now() at time zone 'UTC')::date,0,1)
    on conflict(day) do update set attempted_calls=public.rfp_compliance_daily_budget.attempted_calls+1
      where public.rfp_compliance_daily_budget.attempted_calls < 500;
  if not found then raise exception 'daily AI attempt limit' using errcode='P0001'; end if;
  insert into public.rfp_compliance_user_budget(day,user_id,attempted_calls)
    values((now() at time zone 'UTC')::date,p_user,1)
    on conflict(day,user_id) do update set attempted_calls=public.rfp_compliance_user_budget.attempted_calls+1
      where public.rfp_compliance_user_budget.attempted_calls < 144;
  if not found then raise exception 'user AI attempt limit' using errcode='P0001'; end if;
  update public.rfp_compliance_analyses set status='Processing',attempts=attempts+1,
    reviewed_hash=p_hash,lease_token=p_lease,lease_until=now()+interval '90 seconds',error_code=null,updated_at=now()
    where id=p_id;
  return jsonb_build_object('chunk',a.chunks->a.cursor,'cursor',a.cursor,'documents',a.documents);
end $$;

create function public.rfp_compliance_finish(
  p_id uuid,p_user uuid,p_lease uuid,p_requirements jsonb,p_facts jsonb,p_error text
) returns boolean language plpgsql security invoker set search_path = '' as $$
declare a public.rfp_compliance_analyses; r jsonb;
begin
  select * into a from public.rfp_compliance_analyses where id=p_id and user_id=p_user for update;
  if not found or a.lease_token is distinct from p_lease or a.status <> 'Processing' then return false; end if;
  if p_error is not null then
    update public.rfp_compliance_analyses set status='Failed',error_code='chunk_failed',
      lease_token=null,lease_until=null,updated_at=now() where id=p_id;
    return true;
  end if;
  if jsonb_array_length(p_requirements)>80 or jsonb_array_length(p_facts)>40 then
    raise exception 'invalid output' using errcode='22023';
  end if;
  for r in select value from jsonb_array_elements(p_requirements) loop
    insert into public.rfp_compliance_requirements(
      analysis_id,user_id,fingerprint,original_requirement,requirement,category,mandatory,
      evaluation_weight,sources,uncertain,recommendation
    ) values(p_id,p_user,r->>'fingerprint',r->>'requirement',r->>'requirement',r->>'category',r->>'mandatory',
      r->>'evaluation_weight',r->'sources',(r->>'uncertain')::boolean,r->>'recommendation')
    on conflict(analysis_id,fingerprint) do update set
      sources=public.rfp_compliance_requirements.sources || excluded.sources,
      duplicate_count=public.rfp_compliance_requirements.duplicate_count+1,
      uncertain=public.rfp_compliance_requirements.uncertain or excluded.uncertain
        or public.rfp_compliance_requirements.mandatory <> excluded.mandatory
        or public.rfp_compliance_requirements.evaluation_weight is distinct from excluded.evaluation_weight;
  end loop;
  update public.rfp_compliance_analyses set
    cursor=cursor+1,attempts=0,facts=facts || p_facts,lease_token=null,lease_until=null,
    status=case when cursor+1=jsonb_array_length(chunks)
      then case when jsonb_array_length(warnings)>0 then 'Partial' else 'Completed' end else 'Pending' end,
    updated_at=now() where id=p_id;
  return true;
end $$;
revoke all on function public.rfp_compliance_start(uuid,text,jsonb,jsonb,jsonb) from public,anon,authenticated;
revoke all on function public.rfp_compliance_claim(uuid,uuid,text,uuid) from public,anon,authenticated;
revoke all on function public.rfp_compliance_finish(uuid,uuid,uuid,jsonb,jsonb,text) from public,anon,authenticated;
grant execute on function public.rfp_compliance_start(uuid,text,jsonb,jsonb,jsonb) to service_role;
grant execute on function public.rfp_compliance_claim(uuid,uuid,text,uuid) to service_role;
grant execute on function public.rfp_compliance_finish(uuid,uuid,uuid,jsonb,jsonb,text) to service_role;
commit;
