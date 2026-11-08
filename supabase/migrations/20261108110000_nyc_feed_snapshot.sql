-- NYC-only durable snapshot and refresh lease. Existing cache/quotas are unchanged.
-- No visitor data. Retention is bounded to 24 hours by the existing cache cleanup.
create function public.ft_nyc_claim() returns boolean language plpgsql security invoker set search_path='' as $$
declare claimed boolean;
begin
 insert into public.ft_cache(key,body,expires_at) values('nyc:snapshot:lease:v1','{}',now()+interval '5 minutes')
 on conflict(key) do update set expires_at=excluded.expires_at where public.ft_cache.expires_at<=now()
 returning true into claimed;
 return coalesce(claimed,false);
end $$;
create function public.ft_nyc_store(p_body jsonb) returns void language plpgsql security invoker set search_path='' as $$
begin
 if jsonb_typeof(p_body->'records') is distinct from 'array' or jsonb_array_length(p_body->'records')>1000 or octet_length(p_body::text)>2097152 then raise exception 'Invalid NYC snapshot' using errcode='22023';end if;
 insert into public.ft_cache(key,body,expires_at) values('nyc:snapshot:v1',p_body,now()+interval '24 hours')
 on conflict(key) do update set body=excluded.body,expires_at=excluded.expires_at;
 insert into public.ft_cache(key,body,expires_at) values('nyc:snapshot:lease:v1','{}',now()+interval '1 hour')
 on conflict(key) do update set expires_at=excluded.expires_at;
end $$;
revoke all on function public.ft_nyc_claim() from public,anon,authenticated;
revoke all on function public.ft_nyc_store(jsonb) from public,anon,authenticated;
grant execute on function public.ft_nyc_claim(),public.ft_nyc_store(jsonb) to service_role;
