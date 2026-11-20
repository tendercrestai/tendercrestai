-- Add independent admission kinds for the Socrata open-data feeds
-- (Los Angeles RAMP, Delaware Open Bids, Montgomery County MD) and the
-- District of Columbia PASS ArcGIS feed.
-- Same shape as 20261120000000_ft_admit_webs.sql: only the allowlist changes.
-- The three Socrata lanes share one 'socrata' budget and the DC lane gets its
-- own 'dc-pass' budget (10 per IP, 50 shared per UTC day) instead of consuming
-- the SAM.gov budget. No table, cache key or credential is changed.
-- NOT APPLIED by this PR: apply manually via the Supabase dashboard SQL Editor
-- before the new lanes can serve traffic; until then ft_admit rejects the new
-- kinds and the lanes return the limit error. The 'bonfire' kind is left in
-- the allowlist (harmless, unused after the Bonfire removal).
create or replace function public.ft_admit(p_ip text,p_kind text,p_limit integer,p_global integer) returns void language plpgsql security invoker set search_path='' as $$
declare d date:=(now() at time zone 'UTC')::date;a integer;b integer;
begin
 if p_kind not in ('shred','email','event','sam','ai','nyc','grants','bonfire','webs','socrata','dc-pass') or p_limit<1 or p_global<1 then raise exception 'Invalid tool admission' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended('ft:'||d::text||':'||p_kind,0));
 select n into a from public.ft_rates where day=d and kind=p_kind and key=p_ip;
 select n into b from public.ft_rates where day=d and kind=p_kind and key='global';
 if coalesce(a,0)>=p_limit or coalesce(b,0)>=p_global then raise exception 'Free tool limit reached. Try again after the UTC daily reset or explore a trial.' using errcode='P0001';end if;
 insert into public.ft_rates values(d,p_kind,p_ip,1) on conflict(day,kind,key) do update set n=ft_rates.n+1;
 insert into public.ft_rates values(d,p_kind,'global',1) on conflict(day,kind,key) do update set n=ft_rates.n+1;
end $$;

revoke all on function public.ft_admit(text,text,integer,integer) from public,anon,authenticated;
grant execute on function public.ft_admit(text,text,integer,integer) to service_role;
