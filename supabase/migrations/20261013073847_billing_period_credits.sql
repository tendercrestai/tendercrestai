begin;

create table public.free_trial_claims (
  user_id uuid primary key references auth.users(id),
  company_id text unique,
  started_at timestamptz not null default clock_timestamp()
);
alter table public.free_trial_claims enable row level security;
revoke all on public.free_trial_claims from public,anon,authenticated;
grant all on public.free_trial_claims to service_role;

create function public.claim_free_trial(p_user_id uuid)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare trial public.free_trial_claims;
begin
  insert into public.free_trial_claims(user_id) values(p_user_id)
    on conflict(user_id) do nothing returning * into trial;
  if not found then return jsonb_build_object('create',false); end if;
  return jsonb_build_object('create',true,'start',trial.started_at,'end',trial.started_at + interval '30 days');
end $$;

create function public.bind_free_trial(p_user_id uuid,p_company_id text)
returns jsonb language plpgsql security invoker set search_path = '' as $$
begin
  if p_company_id is null or p_company_id !~ '^rec[A-Za-z0-9]+$' then raise exception 'Invalid company'; end if;
  update public.free_trial_claims set company_id = p_company_id
    where user_id = p_user_id and (company_id is null or company_id = p_company_id);
  if not found then raise exception 'Trial account requires review'; end if;
  return jsonb_build_object('ok',true);
end $$;
revoke execute on function public.claim_free_trial(uuid) from public,anon,authenticated;
revoke execute on function public.bind_free_trial(uuid,text) from public,anon,authenticated;
grant execute on function public.claim_free_trial(uuid) to service_role;
grant execute on function public.bind_free_trial(uuid,text) to service_role;

create table public.proposal_credit_reservations (
  submission_id uuid primary key references public.rfp_submissions(id),
  user_id uuid not null references auth.users(id),
  company_id text not null,
  period_start timestamptz not null,
  period_end timestamptz not null check (period_end > period_start),
  reserved_at timestamptz not null default clock_timestamp(),
  status text not null check (status in ('reserved', 'queued', 'uncertain', 'released')),
  record_id text unique,
  check ((status = 'queued' and record_id is not null) or status <> 'queued')
);
create index proposal_credit_usage_idx on public.proposal_credit_reservations(company_id, reserved_at)
where status <> 'released';
alter table public.proposal_credit_reservations enable row level security;
revoke all on public.proposal_credit_reservations from public, anon, authenticated;
grant all on public.proposal_credit_reservations to service_role;

create function public.reserve_proposal_credit(
  p_submission_id uuid, p_user_id uuid, p_company_id text,
  p_period_start timestamptz, p_period_end timestamptz,
  p_quota integer, p_legacy_used integer
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  held public.proposal_credit_reservations;
  used integer;
  reserved_time timestamptz;
begin
  if p_submission_id is null or p_user_id is null or p_company_id is null
    or p_period_start is null or p_period_end is null
    or p_quota is null or p_legacy_used is null
    or p_company_id !~ '^rec[A-Za-z0-9]+$' or p_quota not in (5,20,60)
    or p_legacy_used < 0 or p_period_end <= p_period_start then
    raise exception 'Invalid credit reservation';
  end if;
  -- Serialize all submissions for this company, including different UUIDs.
  perform pg_advisory_xact_lock(hashtextextended(p_company_id, 0));
  reserved_time := clock_timestamp();
  if reserved_time < p_period_start or reserved_time >= p_period_end then
    return jsonb_build_object('code', 'period_expired');
  end if;
  if not exists (select 1 from public.rfp_submissions
      where id = p_submission_id and user_id = p_user_id and status = 'processing') then
    raise exception 'Submission must be owned and claimed before reserving';
  end if;
  select * into held from public.proposal_credit_reservations where submission_id = p_submission_id for update;
  if found then
    if held.company_id <> p_company_id or held.user_id <> p_user_id then
      raise exception 'Credit ownership conflict';
    end if;
    if held.status <> 'released' then
      return jsonb_build_object('code', 'already_held');
    end if;
  end if;
  select count(*) into used from public.proposal_credit_reservations
    where company_id = p_company_id and status <> 'released'
      and reserved_at >= p_period_start and reserved_at < p_period_end;
  if used + p_legacy_used >= p_quota then
    return jsonb_build_object('code', 'quota_exceeded');
  end if;
  insert into public.proposal_credit_reservations
    (submission_id, user_id, company_id, period_start, period_end, reserved_at, status)
    values (p_submission_id, p_user_id, p_company_id, p_period_start, p_period_end, reserved_time, 'reserved')
  on conflict (submission_id) do update set
    period_start = excluded.period_start, period_end = excluded.period_end,
    reserved_at = excluded.reserved_at, status = 'reserved', record_id = null;
  return jsonb_build_object('code', 'reserved');
end $$;

create function public.finish_proposal_credit(p_submission_id uuid, p_status text, p_record_id text)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare held public.proposal_credit_reservations;
begin
  select * into held from public.proposal_credit_reservations where submission_id = p_submission_id;
  if not found then raise exception 'Reservation not found'; end if;
  perform pg_advisory_xact_lock(hashtextextended(held.company_id, 0));
  select * into held from public.proposal_credit_reservations where submission_id = p_submission_id for update;
  if p_status is null or p_status not in ('queued','uncertain','released') then
    raise exception 'Invalid credit status';
  end if;
  if p_status = 'queued' and (p_record_id is null or p_record_id !~ '^rec[A-Za-z0-9]+$') then
    raise exception 'Queued credit requires its Airtable record';
  end if;
  if held.status = p_status and held.record_id is not distinct from p_record_id then
    return jsonb_build_object('ok',true);
  end if;
  if held.status <> 'reserved' then raise exception 'Credit already finalized'; end if;
  update public.proposal_credit_reservations set status = p_status, record_id = p_record_id
    where submission_id = p_submission_id;
  return jsonb_build_object('ok',true);
end $$;

-- Only the server can call this after reading a terminal failure from Airtable.
-- A mismatching marker or record cannot release another job's credit.
create function public.release_failed_credit(p_submission_id uuid, p_company_id text, p_record_id text)
returns jsonb language plpgsql security invoker set search_path = '' as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(p_company_id, 0));
  update public.proposal_credit_reservations set status = 'released'
    where submission_id = p_submission_id and company_id = p_company_id
      and record_id = p_record_id and status = 'queued';
  return jsonb_build_object('ok', true);
end $$;

revoke execute on function public.reserve_proposal_credit(uuid,uuid,text,timestamptz,timestamptz,integer,integer) from public,anon,authenticated;
revoke execute on function public.finish_proposal_credit(uuid,text,text) from public,anon,authenticated;
revoke execute on function public.release_failed_credit(uuid,text,text) from public,anon,authenticated;
grant execute on function public.reserve_proposal_credit(uuid,uuid,text,timestamptz,timestamptz,integer,integer) to service_role;
grant execute on function public.finish_proposal_credit(uuid,text,text) to service_role;
grant execute on function public.release_failed_credit(uuid,text,text) to service_role;

commit;
