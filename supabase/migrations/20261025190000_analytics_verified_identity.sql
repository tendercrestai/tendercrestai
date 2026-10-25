-- auth.users is deliberately not readable by service_role on hosted Supabase.
-- Limit privileged auth reads to two strictly service-only RPCs; grant no table access.
begin;
alter function public.growth_identify(uuid,uuid) security definer;
alter function public.growth_billing(text,text,timestamptz,text) security definer;
revoke all on function public.growth_identify(uuid,uuid),public.growth_billing(text,text,timestamptz,text) from public,anon,authenticated;
grant execute on function public.growth_identify(uuid,uuid),public.growth_billing(text,text,timestamptz,text) to service_role;
commit;
