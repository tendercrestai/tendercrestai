-- Test project only. All fixtures and counters roll back; no AI requests.
begin;
insert into auth.users(id,email) values
 ('b1111111-1111-4111-8111-111111111111','processing-fixture@example.invalid');
set local role service_role;
do $$
declare
  owner_id uuid := 'b1111111-1111-4111-8111-111111111111';
  first_id uuid; partial_id uuid; pending_id uuid; lease uuid; old_lease uuid;
  current_day date := (now() at time zone 'UTC')::date;
  before_calls integer;
begin
  first_id := public.rfp_compliance_start(owner_id,repeat('a',64),'[{"id":"fictional"}]','[[]]','[]');
  if public.rfp_compliance_start(owner_id,repeat('a',64),'[{"id":"fictional"}]','[[]]','[]') <> first_id then
    raise exception 'duplicate analysis was not reused';
  end if;
  partial_id := public.rfp_compliance_start(owner_id,repeat('b',64),'[{"id":"fictional"}]','[[]]','["OCR required"]');
  pending_id := public.rfp_compliance_start(owner_id,repeat('c',64),'[{"id":"fictional"}]','[[]]','[]');
  begin
    perform public.rfp_compliance_start(owner_id,repeat('d',64),'[{"id":"fictional"}]','[[]]','[]');
    raise exception 'fourth daily analysis allowed';
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'daily analysis limit' then raise; end if;
  end;
  for n in 1..3 loop
    lease := gen_random_uuid();
    perform public.rfp_compliance_claim(first_id,owner_id,repeat('a',64),lease);
    perform public.rfp_compliance_finish(first_id,owner_id,lease,'[]','[]','test_failure');
  end loop;
  begin
    perform public.rfp_compliance_claim(first_id,owner_id,repeat('a',64),gen_random_uuid());
    raise exception 'fourth chunk attempt allowed';
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'retry limit' then raise; end if;
  end;
  old_lease := gen_random_uuid();
  perform public.rfp_compliance_claim(partial_id,owner_id,repeat('b',64),old_lease);
  update public.rfp_compliance_analyses set lease_until=now()-interval '1 second' where id=partial_id;
  lease := gen_random_uuid();
  perform public.rfp_compliance_claim(partial_id,owner_id,repeat('b',64),lease);
  if public.rfp_compliance_finish(partial_id,owner_id,old_lease,'[]','[]',null) then
    raise exception 'stale lease output saved';
  end if;
  perform public.rfp_compliance_finish(partial_id,owner_id,lease,'[]','[]',null);
  if (select status from public.rfp_compliance_analyses where id=partial_id) <> 'Partial' then
    raise exception 'extraction gaps became Completed';
  end if;
  update public.rfp_compliance_user_budget set attempted_calls=144 where day=current_day and user_id=owner_id;
  select attempted_calls into before_calls from public.rfp_compliance_daily_budget where day=current_day;
  begin
    perform public.rfp_compliance_claim(pending_id,owner_id,repeat('c',64),gen_random_uuid());
    raise exception 'user attempt budget bypassed';
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'user AI attempt limit' then raise; end if;
  end;
  if (select attempted_calls from public.rfp_compliance_daily_budget where day=current_day) <> before_calls then
    raise exception 'rejected claim consumed global budget';
  end if;
  update public.rfp_compliance_daily_budget set attempted_calls=500 where day=current_day;
  begin
    perform public.rfp_compliance_claim(pending_id,owner_id,repeat('c',64),gen_random_uuid());
    raise exception 'global attempt budget bypassed';
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'daily AI attempt limit' then raise; end if;
  end;
end $$;
rollback;
