-- Add an independent upstream budget for NYC. All prior admission logic is unchanged.
create or replace function public.ft_admit(p_ip text,p_kind text,p_limit integer,p_global integer) returns void language plpgsql security invoker set search_path='' as $$
declare d date:=(now() at time zone 'UTC')::date;a integer;b integer;
begin
 if p_kind not in ('shred','email','event','sam','ai','nyc') or p_limit<1 or p_global<1 then raise exception 'Invalid tool admission' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended('ft:'||d::text||':'||p_kind,0));
 select n into a from public.ft_rates where day=d and kind=p_kind and key=p_ip;
 select n into b from public.ft_rates where day=d and kind=p_kind and key='global';
 if coalesce(a,0)>=p_limit or coalesce(b,0)>=p_global then raise exception 'Free tool limit reached. Try again after the UTC daily reset or explore a trial.' using errcode='P0001';end if;
 insert into public.ft_rates values(d,p_kind,p_ip,1) on conflict(day,kind,key) do update set n=ft_rates.n+1;
 insert into public.ft_rates values(d,p_kind,'global',1) on conflict(day,kind,key) do update set n=ft_rates.n+1;
end $$;

revoke all on function public.ft_admit(text,text,integer,integer) from public,anon,authenticated;
grant execute on function public.ft_admit(text,text,integer,integer) to service_role;
