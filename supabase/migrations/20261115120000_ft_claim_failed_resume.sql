-- Let a failed free shred be resumed instead of forcing the user to start over
-- (and burn another of the 3/day shred allowance). ft_claim now also claims a
-- Failed job that still has unprocessed chunks, while its 3-claim budget remains:
-- the new attempts counter is incremented on every claim and a Failed job is only
-- re-claimed while attempts < 3. Pending and lease-expired Processing claims keep
-- their existing behaviour, now also bounded by the same 3-claim budget.
-- The 3/day shred allowance (ft_admit p_kind 'shred') is unchanged, and resume
-- itself consumes no shred allowance. CREATE OR REPLACE preserves the existing
-- service_role-only grant on ft_claim.
-- Apply manually in the Supabase dashboard SQL Editor (migrations are not
-- auto-applied). Until this migration is applied, the code degrades safely: the
-- in-process transient retry (lib/free-tools.js) still works, and resume of a
-- Failed job is a harmless no-op because the old ft_claim ignores Failed jobs,
-- so the job simply stays Failed and the user must start a new shred as today.
-- Rollback: re-run the ft_claim definition from
-- supabase/migrations/20261106090000_free_rfp_tools.sql and drop the column with
-- `alter table public.ft_jobs drop column if exists attempts;`.
alter table public.ft_jobs add column if not exists attempts integer not null default 0;
create or replace function public.ft_claim(p_id uuid) returns jsonb language plpgsql security invoker set search_path='' as $$
declare j public.ft_jobs;
begin
 update public.ft_jobs set status='Processing',lease_until=now()+interval '5 minutes',attempts=attempts+1 where id=p_id and expires_at>now() and (status='Pending' or (status='Processing' and lease_until<now()) or (status='Failed' and attempts<3 and processed<jsonb_array_length(chunks))) returning * into j;
 return case when found then to_jsonb(j) else null end;
end $$;
