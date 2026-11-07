-- New temporary tool detail only. Existing jobs and their expiry remain unchanged.
create table public.ft_bidchecks (
 id uuid primary key references public.ft_jobs(id) on delete cascade,
 answers jsonb not null check(jsonb_typeof(answers)='object' and octet_length(answers::text)<2000),
 as_of date not null default (now() at time zone 'UTC')::date,
 verdict jsonb check(verdict is null or (jsonb_typeof(verdict)='object' and octet_length(verdict::text)<40000))
);
alter table public.ft_bidchecks enable row level security;
revoke all on public.ft_bidchecks from public,anon,authenticated;
grant all on public.ft_bidchecks to service_role;
create function public.ft_bidcheck_start(p_id uuid,p_ip text,p_title text,p_source text,p_documents jsonb,p_chunks jsonb,p_warnings jsonb,p_answers jsonb)
returns void language plpgsql security invoker set search_path='' as $$
begin
 perform public.ft_admit(p_ip,'shred',3,10);
 insert into public.ft_jobs(id,ip_hash,title,source,documents,chunks,warnings)values(p_id,p_ip,p_title,p_source,p_documents,p_chunks,p_warnings);
 insert into public.ft_bidchecks(id,answers)values(p_id,p_answers);
end $$;
revoke all on function public.ft_bidcheck_start(uuid,text,text,text,jsonb,jsonb,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.ft_bidcheck_start(uuid,text,text,text,jsonb,jsonb,jsonb,jsonb) to service_role;
alter table public.ft_events drop constraint ft_events_name_check;
alter table public.ft_events add constraint ft_events_name_check check(name in('shred_started','shred_completed','shred_email_gate','bidcheck_completed'));
-- Owner-approved lead-interest extension. Preserve the original 3-argument RPC.
alter table public.ft_leads add column teardown_opt_in boolean not null default false;
create function public.ft_lead(p_id uuid,p_email text,p_marketing boolean,p_teardown boolean)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare l jsonb;
begin
 l:=public.ft_lead(p_id,p_email,p_marketing);
 update public.ft_leads set teardown_opt_in=p_teardown where id=p_id returning to_jsonb(ft_leads) into l;
 return l;
end $$;
revoke all on function public.ft_lead(uuid,text,boolean,boolean) from public,anon,authenticated;
grant execute on function public.ft_lead(uuid,text,boolean,boolean) to service_role;
