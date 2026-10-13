-- Run only on the disposable test project. All fixtures are rolled back.
begin;
insert into auth.users(id) values ('99000000-0000-4000-8000-000000000001');
set local role service_role;
insert into public.rfp_submissions(id,user_id,fingerprint,status)
select ('99000000-0000-4000-8000-' || lpad(n::text,12,'0'))::uuid,
  '99000000-0000-4000-8000-000000000001',repeat('a',64),'processing'
from generate_series(10,19) n;

do $$
declare result jsonb; n integer; start_at timestamptz := now() - interval '1 day'; end_at timestamptz := now() + interval '29 days';
begin
  if has_function_privilege('anon','public.reserve_proposal_credit(uuid,uuid,text,timestamptz,timestamptz,integer,integer)','execute')
    or has_function_privilege('authenticated','public.claim_free_trial(uuid)','execute') then
    raise exception 'Customer role can grant credits';
  end if;
  if not (public.claim_free_trial('99000000-0000-4000-8000-000000000001')->>'create')::boolean then raise exception 'First trial denied'; end if;
  if (public.claim_free_trial('99000000-0000-4000-8000-000000000001')->>'create')::boolean then raise exception 'Second trial granted'; end if;
  for n in 10..14 loop
    result := public.reserve_proposal_credit(('99000000-0000-4000-8000-' || lpad(n::text,12,'0'))::uuid,
      '99000000-0000-4000-8000-000000000001','recCreditTest',start_at,end_at,5,0);
    if result->>'code' <> 'reserved' then raise exception 'Allowed credit denied'; end if;
  end loop;
  result := public.reserve_proposal_credit('99000000-0000-4000-8000-000000000015',
    '99000000-0000-4000-8000-000000000001','recCreditTest',start_at,end_at,5,0);
  if result->>'code' <> 'quota_exceeded' then raise exception 'Quota overrun'; end if;
  result := public.reserve_proposal_credit('99000000-0000-4000-8000-000000000010',
    '99000000-0000-4000-8000-000000000001','recCreditTest',start_at,end_at,5,0);
  if result->>'code' <> 'already_held' then raise exception 'Replay charged twice'; end if;
  perform public.finish_proposal_credit('99000000-0000-4000-8000-000000000010','queued','recFailedTest');
  perform public.release_failed_credit('99000000-0000-4000-8000-000000000010','recCreditTest','recOther');
  if (select status from public.proposal_credit_reservations where submission_id='99000000-0000-4000-8000-000000000010') <> 'queued' then raise exception 'Foreign record refunded'; end if;
  perform public.release_failed_credit('99000000-0000-4000-8000-000000000010','recCreditTest','recFailedTest');
  result := public.reserve_proposal_credit('99000000-0000-4000-8000-000000000015',
    '99000000-0000-4000-8000-000000000001','recCreditTest',start_at,end_at,5,0);
  if result->>'code' <> 'reserved' then raise exception 'Failed job not refunded'; end if;
  result := public.reserve_proposal_credit('99000000-0000-4000-8000-000000000016',
    '99000000-0000-4000-8000-000000000001','recCreditTest',start_at,end_at,20,0);
  if result->>'code' <> 'reserved' then raise exception 'Upgrade allowance not available'; end if;
  result := public.reserve_proposal_credit('99000000-0000-4000-8000-000000000017',
    '99000000-0000-4000-8000-000000000001','recCreditTest',start_at,end_at,5,0);
  if result->>'code' <> 'quota_exceeded' then raise exception 'Downgrade reset usage'; end if;
  result := public.reserve_proposal_credit('99000000-0000-4000-8000-000000000018',
    '99000000-0000-4000-8000-000000000001','recCreditTest',now()-interval '31 days',now()-interval '1 day',5,0);
  if result->>'code' <> 'period_expired' then raise exception 'Expired account granted credits'; end if;
  -- Simulate the old cycle finishing: old reservations remain in the ledger
  -- but do not consume the new paid billing period.
  update public.proposal_credit_reservations set reserved_at = now()-interval '32 days',
    period_start=now()-interval '33 days', period_end=now()-interval '3 days';
  result := public.reserve_proposal_credit('99000000-0000-4000-8000-000000000019',
    '99000000-0000-4000-8000-000000000001','recCreditTest',start_at,end_at,5,0);
  if result->>'code' <> 'reserved' then raise exception 'Renewal did not restore allowance'; end if;
end $$;
rollback;
