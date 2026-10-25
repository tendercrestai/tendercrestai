-- Additive private, consent-based telemetry. No business/billing data rewritten.
begin;
create table public.growth_visitors (
 id uuid primary key,user_id uuid references auth.users(id) on delete set null,
 channel text not null check(channel in ('direct','google','reddit','linkedin','other')),
 campaign text not null check(campaign in ('direct','us_gov_proposal_pilot','government_it_pilot','other')),
 environment text not null check(environment in ('production','test')),is_test boolean not null,
 consent_version text not null default 'usage-v1' check(consent_version='usage-v1'),
 created_at timestamptz not null default now(),expires_at timestamptz not null,
 check(expires_at>created_at and expires_at<=created_at+interval '31 days')
);
create index growth_user_visitor on public.growth_visitors(user_id,created_at);
create index growth_retention on public.growth_visitors(created_at);
create table public.growth_events (
 visitor_id uuid not null references public.growth_visitors(id) on delete cascade,
 name text not null check(name in ('page_view','demo_started','demo_completed','signup_started','pricing_viewed','trial_cta_clicked','signup_completed','account_connected','rfp_uploaded','bid_analysis_completed','proposal_generated','audit_completed','proposal_exported','trial_started','first_payment')),
 scenario text not null default 'none' check(scenario in ('none','it','marketing','consulting')),
 source text not null check(source in ('browser','verified_account','verified_workflow','verified_stripe')),
 event_key text not null unique check(length(event_key) between 1 and 150),occurred_at timestamptz not null default now(),
 primary key(visitor_id,name,scenario),
 check((source='browser' and name in ('page_view','demo_started','demo_completed','signup_started','pricing_viewed','trial_cta_clicked')) or (source='verified_account' and name in ('signup_completed','account_connected')) or (source='verified_workflow' and name in ('rfp_uploaded','bid_analysis_completed','proposal_generated','audit_completed','proposal_exported')) or (source='verified_stripe' and name in ('trial_started','first_payment')))
);
create index growth_event_time on public.growth_events(occurred_at);
create table public.growth_admissions (
 scope text not null,window_start timestamptz not null,used integer not null check(used>0),last_seen timestamptz not null default now(),primary key(scope,window_start)
);
alter table public.growth_visitors enable row level security;
alter table public.growth_events enable row level security;
alter table public.growth_admissions enable row level security;
revoke all on public.growth_visitors,public.growth_events,public.growth_admissions from public,anon,authenticated;
grant all on public.growth_visitors,public.growth_events,public.growth_admissions to service_role;

create function public.growth_purge() returns void language plpgsql security invoker set search_path='' as $$
begin
 delete from public.growth_visitors where created_at<now()-interval '90 days';
 delete from public.growth_admissions where window_start<now()-interval '2 days';
end $$;
create function public.growth_admit(p_ip text,p_action text) returns void language plpgsql security invoker set search_path='' as $$
declare scope_value text;window_value timestamptz;cap integer;n integer;
begin
 if p_ip !~ '^[a-f0-9]{64}$' or p_action not in ('start','event') then raise exception 'Invalid analytics admission' using errcode='22023';end if;
 for scope_value,window_value,cap in
 select 'ip:'||p_ip||':'||p_action,date_trunc('minute',now()),case p_action when 'start' then 10 else 60 end
 union all select 'global:'||p_action,date_trunc('day',now() at time zone 'UTC') at time zone 'UTC',case p_action when 'start' then 1000 else 10000 end
 loop
  insert into public.growth_admissions(scope,window_start,used) values(scope_value,window_value,1)
  on conflict(scope,window_start) do update set used=public.growth_admissions.used+1,last_seen=now() where public.growth_admissions.used<cap returning used into n;
  if n is null then raise exception 'Usage collection budget reached' using errcode='P0001';end if;
 end loop;
end $$;
create function public.growth_start(p_id uuid,p_ip text,p_channel text,p_campaign text,p_environment text,p_test boolean,p_expires timestamptz) returns void language plpgsql security invoker set search_path='' as $$
begin
 perform public.growth_purge();perform public.growth_admit(p_ip,'start');
 if p_environment='test' and not p_test then raise exception 'Test environment must be marked' using errcode='22023';end if;
 insert into public.growth_visitors(id,channel,campaign,environment,is_test,expires_at) values(p_id,p_channel,p_campaign,p_environment,p_test,p_expires);
end $$;
create function public.growth_collect(p_id uuid,p_ip text,p_name text,p_scenario text) returns void language plpgsql security invoker set search_path='' as $$
declare v public.growth_visitors;
begin
 perform public.growth_admit(p_ip,'event');select * into v from public.growth_visitors where id=p_id and expires_at>now() for update;
 if not found then raise exception 'Usage session unavailable' using errcode='P0002';end if;
 if p_name not in ('page_view','demo_started','demo_completed','signup_started','pricing_viewed','trial_cta_clicked') or p_scenario not in ('none','it','marketing','consulting') then raise exception 'Unsupported browser event' using errcode='22023';end if;
 if p_name='demo_completed' and not exists(select 1 from public.growth_events where visitor_id=p_id and name='demo_started' and scenario=p_scenario) then raise exception 'Demo start required' using errcode='22023';end if;
 insert into public.growth_events(visitor_id,name,scenario,source,event_key) values(p_id,p_name,p_scenario,'browser',p_id::text||':'||p_name||':'||p_scenario) on conflict do nothing;
end $$;
create function public.growth_record(p_user uuid,p_name text,p_at timestamptz default now(),p_key text default null) returns void language plpgsql security invoker set search_path='' as $$
declare v public.growth_visitors;src text;
begin
 if p_name not in ('signup_completed','account_connected','rfp_uploaded','bid_analysis_completed','proposal_generated','audit_completed','proposal_exported','trial_started','first_payment') or p_at>now()+interval '5 minutes' then raise exception 'Unsupported trusted event' using errcode='22023';end if;
 select * into v from public.growth_visitors where user_id=p_user and expires_at>now() and created_at<=p_at order by created_at desc limit 1;
 if not found then return;end if;
 src:=case when p_name in ('signup_completed','account_connected') then 'verified_account' when p_name in ('trial_started','first_payment') then 'verified_stripe' else 'verified_workflow' end;
 insert into public.growth_events(visitor_id,name,source,event_key,occurred_at) values(v.id,p_name,src,coalesce(p_key,v.id::text||':server:'||p_name),p_at) on conflict do nothing;
end $$;
create function public.growth_sync(p_user uuid,p_since timestamptz) returns void language plpgsql security invoker set search_path='' as $$
declare at_time timestamptz;
begin
 select min(o.created_at) into at_time from storage.objects o join public.rfp_uploads u on u.storage_path=o.name where o.bucket_id='rfp-documents' and u.user_id=p_user and o.created_at>=p_since;
 if at_time is not null then perform public.growth_record(p_user,'rfp_uploaded',at_time);end if;
 select min(created_at) into at_time from public.pw_events where actor_id=p_user and created_at>=p_since and details->>'enhancementAction'='strategy.completed';
 if at_time is not null then perform public.growth_record(p_user,'bid_analysis_completed',at_time);end if;
 select min(created_at) into at_time from public.pw_events where actor_id=p_user and created_at>=p_since and details->>'enhancementAction'='audit.completed';
 if at_time is not null then perform public.growth_record(p_user,'audit_completed',at_time);end if;
 select min(created_at) into at_time from public.pw_events where actor_id=p_user and created_at>=p_since and details->>'enhancementAction'='proposal.assembled';
 if at_time is not null then perform public.growth_record(p_user,'proposal_generated',at_time);end if;
 select min(updated_at) into at_time from public.pw_jobs where requested_by=p_user and kind='draft' and status='Completed' and updated_at>=p_since;
 if at_time is not null then perform public.growth_record(p_user,'proposal_generated',at_time);end if;
 select min(updated_at) into at_time from public.pw_jobs where requested_by=p_user and kind='export' and status='Completed' and updated_at>=p_since;
 if at_time is not null then perform public.growth_record(p_user,'proposal_exported',at_time);end if;
end $$;
create function public.growth_identify(p_id uuid,p_user uuid) returns void language plpgsql security invoker set search_path='' as $$
declare v public.growth_visitors;u auth.users;
begin
 select * into v from public.growth_visitors where id=p_id and expires_at>now() for update;
 if not found then raise exception 'Usage session unavailable' using errcode='P0002';end if;
 select * into u from auth.users where id=p_user and email_confirmed_at is not null;
 if not found then raise exception 'Verified account required' using errcode='42501';end if;
 if v.user_id is not null and v.user_id<>p_user then raise exception 'Usage session already linked' using errcode='PT409';end if;
 update public.growth_visitors set user_id=p_user where id=p_id;
 if u.created_at>=v.created_at and exists(select 1 from public.growth_events where visitor_id=v.id and name='signup_started' and occurred_at<=u.created_at) then
  perform public.growth_record(p_user,'signup_completed',greatest(u.email_confirmed_at,v.created_at));
 else perform public.growth_record(p_user,'account_connected');end if;
 perform public.growth_sync(p_user,v.created_at);
end $$;
create function public.growth_withdraw(p_id uuid) returns void language plpgsql security invoker set search_path='' as $$
begin delete from public.growth_visitors where id=p_id;end $$;
create function public.growth_billing(p_email text,p_key text,p_at timestamptz,p_kind text) returns void language plpgsql security invoker set search_path='' as $$
declare uid uuid;n integer;
begin
 if p_kind not in ('trial_started','first_payment') or p_key !~ '^[a-f0-9]{64}$' then raise exception 'Invalid billing metric' using errcode='22023';end if;
 select count(*) into n from auth.users where lower(email)=lower(btrim(p_email)) and email_confirmed_at is not null;
 if n<>1 then return;end if;
 select id into uid from auth.users where lower(email)=lower(btrim(p_email)) and email_confirmed_at is not null;
 perform public.growth_record(uid,p_kind,p_at,'stripe:'||p_key);
end $$;
create function public.growth_workflow_trigger() returns trigger language plpgsql security definer set search_path='' as $$
declare uid uuid;p public.pw_projects;kind text;
begin
 begin
  if tg_table_schema='storage' then
   if new.bucket_id='rfp-documents' then
    select user_id into uid from public.rfp_uploads where storage_path=new.name;
    if uid is not null then perform public.growth_record(uid,'rfp_uploaded');end if;
   end if;
  elsif tg_table_name='pw_events' then
   select * into p from public.pw_projects where id=new.project_id;
   if new.details->>'enhancementAction'='strategy.completed' or (new.action='bid.assessed' and p.state->'assessment' is not null and p.state->'assessment'<>'null'::jsonb and not coalesce((p.state->'assessment'->>'stale')::boolean,true)) then kind:='bid_analysis_completed';
   elsif new.details->>'enhancementAction'='audit.completed' then kind:='audit_completed';
   elsif new.details->>'enhancementAction'='proposal.assembled' then kind:='proposal_generated';end if;
   if kind is not null then perform public.growth_record(new.actor_id,kind);end if;
  elsif tg_table_name='pw_jobs' and new.status='Completed' and old.status is distinct from new.status then
   perform public.growth_record(new.requested_by,case when new.kind='export' then 'proposal_exported' else 'proposal_generated' end);
  end if;
 exception when others then null; -- Telemetry must not fail an upload, job or business write.
 end;return new;
end $$;
create trigger growth_uploaded after insert on storage.objects for each row execute function public.growth_workflow_trigger();
create trigger growth_workflow after insert on public.pw_events for each row execute function public.growth_workflow_trigger();
create trigger growth_job after update on public.pw_jobs for each row execute function public.growth_workflow_trigger();

create view public.growth_funnel_private with (security_invoker=true) as
with canonical as (
 select v.*,coalesce((select old.id from public.growth_visitors old where old.user_id=v.user_id and old.environment=v.environment and old.is_test=v.is_test order by old.created_at,old.id limit 1),v.id) as attribution_id
 from public.growth_visitors v where v.created_at>=now()-interval '90 days' and not v.is_test and v.environment='production'
), grouped as (
 select v.id,v.user_id,a.channel,a.campaign,(a.created_at at time zone 'UTC')::date as cohort_date,e.name
 from canonical v join public.growth_visitors a on a.id=v.attribution_id left join public.growth_events e on e.visitor_id=v.id
)
select cohort_date,channel,campaign,count(distinct id) as consenting_visitors,
 count(distinct coalesce(user_id::text,id::text)) filter(where name='demo_started') as demo_started,
 count(distinct coalesce(user_id::text,id::text)) filter(where name='demo_completed') as demo_completed,
 count(distinct coalesce(user_id::text,id::text)) filter(where name='signup_started') as signup_started,
 count(distinct user_id) filter(where name='signup_completed') as verified_signups,
 count(distinct user_id) filter(where name='account_connected') as existing_accounts_connected,
 count(distinct user_id) filter(where name='rfp_uploaded') as rfp_uploaded,
 count(distinct user_id) filter(where name='bid_analysis_completed') as bid_analysis_completed,
 count(distinct user_id) filter(where name='proposal_generated') as proposal_generated,
 count(distinct user_id) filter(where name='audit_completed') as audit_completed,
 count(distinct user_id) filter(where name='proposal_exported') as export_packages_created,
 count(distinct user_id) filter(where name='trial_started') as verified_trials,
 count(distinct user_id) filter(where name='first_payment') as verified_first_paying_customers
from grouped group by cohort_date,channel,campaign;
revoke all on public.growth_funnel_private from public,anon,authenticated;
grant select on public.growth_funnel_private to service_role;
do $$ declare f record;begin
 for f in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'growth\_%' escape '\' loop
  execute format('revoke all on function %s from public,anon,authenticated',f.signature);
  execute format('grant execute on function %s to service_role',f.signature);
 end loop;
end $$;
commit;
