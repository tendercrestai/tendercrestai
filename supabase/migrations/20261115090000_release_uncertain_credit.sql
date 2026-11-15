-- Release an 'uncertain' credit reservation after a dispatch whose Airtable
-- response was never confirmed (finding F2). Until this migration is applied,
-- an uncertain credit counts against the customer's 5/20/60 quota until the
-- billing period ends and the submission cannot be retried without support.
--
-- Apply manually in the Supabase dashboard (migrations are not auto-applied):
--   1. Open the Supabase dashboard for production project vfdwaqgfepvoujprtuww.
--   2. SQL Editor -> New query, paste this whole file, Run.
--   3. Verify: select proname from pg_proc where proname = 'release_uncertain_credit';
--      must return one row, and the function must be executable by service_role only.
--
-- Safe degradation if unapplied: the code calls release_uncertain_credit only
-- on the uncertain-retry path, catches the missing-function error, logs it,
-- and leaves the credit held (current behavior). The user gets a retry-later
-- 503 instead of a 409, and no reservation is ever released on a guess. The
-- uncertain -> queued adoption in finish_proposal_credit likewise falls back
-- to retry-later until this migration is applied.
--
-- Rollback: dropping release_uncertain_credit restores the old behavior
-- (uncertain credits stay held until period end). Rows already released by
-- it stay released; that is the intended correction, not data loss, and
-- cannot be undone row-by-row without a manual status update. The
-- finish_proposal_credit replacement below only ADDS the uncertain -> queued
-- transition; re-running the 20261013073847 definition restores the old
-- version if ever needed.

begin;

-- Only the server can release an uncertain credit, and only after it has
-- verified in Airtable that no queue row carries this submission's marker.
-- The record_id IS NULL guard means a reservation whose Airtable record
-- exists can never be released by this function, even if the caller checks
-- wrong. A mismatching company cannot release another company's credit.
create function public.release_uncertain_credit(p_submission_id uuid, p_company_id text)
returns jsonb language plpgsql security invoker set search_path = '' as $$
begin
  if p_submission_id is null or p_company_id is null or p_company_id !~ '^rec[A-Za-z0-9]+$' then
    raise exception 'Invalid credit release';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_company_id, 0));
  update public.proposal_credit_reservations set status = 'released'
    where submission_id = p_submission_id and company_id = p_company_id
      and status = 'uncertain' and record_id is null;
  return jsonb_build_object('ok', true, 'released', found);
end $$;

revoke execute on function public.release_uncertain_credit(uuid, text) from public, anon, authenticated;
grant execute on function public.release_uncertain_credit(uuid, text) to service_role;

-- Adopt a dispatched-but-unconfirmed submission whose Airtable row is later
-- found: an uncertain reservation may now finalize as queued with its real
-- record id, instead of staying held while the proposal is already queued.
-- All other transitions are unchanged from 20261013073847.
create or replace function public.finish_proposal_credit(p_submission_id uuid, p_status text, p_record_id text)
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
  if held.status = 'uncertain' and p_status = 'queued' then
    update public.proposal_credit_reservations set status = 'queued', record_id = p_record_id
      where submission_id = p_submission_id;
    return jsonb_build_object('ok',true);
  end if;
  if held.status <> 'reserved' then raise exception 'Credit already finalized'; end if;
  update public.proposal_credit_reservations set status = p_status, record_id = p_record_id
    where submission_id = p_submission_id;
  return jsonb_build_object('ok',true);
end $$;

revoke execute on function public.finish_proposal_credit(uuid, text, text) from public, anon, authenticated;
grant execute on function public.finish_proposal_credit(uuid, text, text) to service_role;

commit;
