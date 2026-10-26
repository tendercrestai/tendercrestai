-- Additive customer continuity: private receipts, requests, bindings and health.
begin;
create table public.cc_deliveries(
 id uuid primary key default gen_random_uuid(),user_id uuid references auth.users(id) on delete set null,
 delivery_key text not null unique check(length(delivery_key) between 10 and 150),
 submission_id uuid references public.rfp_submissions(id) on delete set null,
 subject text not null check(length(subject) between 1 and 500),body text not null check(length(body)<=150000),
 status text not null check(status in ('Prepared','Sending','Accepted','Uncertain','Failed','Delivered','Bounced')),
 recipient_hash text check(recipient_hash is null or recipient_hash ~ '^[a-f0-9]{64}$'),provider_id text,attempts integer not null default 0 check(attempts between 0 and 3),
 lease_until timestamptz,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 expires_at timestamptz not null default now()+interval '90 days'
);
create unique index cc_delivery_provider on public.cc_deliveries(provider_id) where provider_id is not null;
create index cc_delivery_owner on public.cc_deliveries(user_id,created_at desc);
create table public.cc_delivery_events(
 provider_id text primary key,status text not null check(status in ('Delivered','Bounced')),event_id text not null,
 occurred_at timestamptz not null,observed_at timestamptz not null default now()
);
alter table public.cc_delivery_events enable row level security;
revoke all on public.cc_delivery_events from public,anon,authenticated;
grant all on public.cc_delivery_events to service_role;
create table public.cc_deletion_requests(
 id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id) on delete cascade,
 document_id uuid not null,kind text not null check(kind in ('rfp','knowledge')),
 state text not null check(state in ('Requested','Review required','Deleting','Completed','Failed','Canceled')),
 reason text not null check(length(reason) between 5 and 2000),created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 unique(user_id,document_id,kind)
);
create table public.cc_billing_bindings(
 user_id uuid primary key references auth.users(id) on delete cascade,company_id text not null check(company_id ~ '^rec[A-Za-z0-9]+$'),
 customer_id text not null unique check(customer_id ~ '^cus_[A-Za-z0-9]+$'),subscription_id text not null,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create table public.cc_checkouts(
 user_id uuid primary key references auth.users(id) on delete cascade,request_key uuid not null unique,plan text not null check(plan in ('pro','growth','enterprise')),
 state text not null check(state in ('Pending','Created','Uncertain','Failed')),provider_id text,url text,check(state<>'Created' or (url is not null and url like 'https://checkout.stripe.com/%')),expires_at timestamptz not null,updated_at timestamptz not null default now()
);
alter table public.cc_checkouts enable row level security;
revoke all on public.cc_checkouts from public,anon,authenticated;
grant all on public.cc_checkouts to service_role;
create function public.cc_begin_checkout(p_user uuid,p_key uuid,p_plan text) returns jsonb language plpgsql security invoker set search_path='' as $$
declare c public.cc_checkouts;
begin
 if p_plan not in ('pro','growth','enterprise') then raise exception 'Invalid checkout plan' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended('checkout:'||p_user::text,0));
 select * into c from public.cc_checkouts where user_id=p_user for update;
 if found and c.expires_at>now() and c.state<>'Failed' then
  if c.plan<>p_plan then raise exception 'An unfinished checkout exists for another plan. Return to it or wait until it expires.' using errcode='PT409';end if;
  return to_jsonb(c);
 end if;
 insert into public.cc_checkouts(user_id,request_key,plan,state,expires_at) values(p_user,p_key,p_plan,'Pending',now()+interval '31 minutes') on conflict(user_id) do update set request_key=excluded.request_key,plan=excluded.plan,state='Pending',url=null,expires_at=excluded.expires_at,updated_at=now() returning * into c;
 return to_jsonb(c);
end$$;
create function public.cc_finish_checkout(p_user uuid,p_key uuid,p_state text,p_url text default null,p_provider text default null) returns void language plpgsql security invoker set search_path='' as $$
begin
 if p_state not in ('Created','Uncertain','Failed') or p_state='Created' and (p_url is null or p_url not like 'https://checkout.stripe.com/%') then raise exception 'Invalid checkout outcome' using errcode='22023';end if;
 update public.cc_checkouts set state=p_state,url=p_url,provider_id=coalesce(p_provider,provider_id),updated_at=now() where user_id=p_user and request_key=p_key and state in ('Pending','Uncertain');if not found then raise exception 'Checkout state changed' using errcode='PT409';end if;
end$$;
create table public.cc_health(
 name text primary key check(name in ('public_pages','auth_config','billing_read','worker_config','backup_restore','smtp_config','hosting_credits')),
 status text not null check(status in ('passed','failed','unverified')),observed_at timestamptz not null default now(),
 detail text not null check(length(detail)<=500)
);
alter table public.cc_deliveries enable row level security;
alter table public.cc_deletion_requests enable row level security;
alter table public.cc_billing_bindings enable row level security;
alter table public.cc_health enable row level security;
revoke all on public.cc_deliveries,public.cc_deletion_requests,public.cc_billing_bindings,public.cc_health from public,anon,authenticated;
grant all on public.cc_deliveries,public.cc_deletion_requests,public.cc_billing_bindings,public.cc_health to service_role;
-- Auth table reads remain confined to explicit service-only functions.
create function public.cc_verified_email_user(p_email text) returns uuid language sql stable security definer set search_path='' as $$
 select case when count(*)=1 then (array_agg(id))[1] else null end from auth.users where lower(email)=lower(btrim(p_email)) and email_confirmed_at is not null
$$;
create function public.cc_bind_billing(p_user uuid,p_company text,p_customer text,p_subscription text) returns void language plpgsql security definer set search_path='' as $$
begin
 if not exists(select 1 from auth.users where id=p_user and email_confirmed_at is not null) or p_subscription !~ '^sub_[A-Za-z0-9]+$' then raise exception 'Verified identity required' using errcode='42501';end if;
 if exists(select 1 from public.cc_billing_bindings where (user_id=p_user and (company_id<>p_company or customer_id<>p_customer)) or (customer_id=p_customer and user_id<>p_user)) then raise exception 'Billing identity conflict' using errcode='PT409';end if;
 insert into public.cc_billing_bindings(user_id,company_id,customer_id,subscription_id) values(p_user,p_company,p_customer,p_subscription)
 on conflict(user_id) do update set subscription_id=excluded.subscription_id,updated_at=now();
end $$;
create function public.cc_claim_delivery(p_key text,p_user uuid,p_subject text,p_body text,p_submission uuid default null,p_recipient_hash text default null) returns jsonb language plpgsql security invoker set search_path='' as $$
declare d public.cc_deliveries;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_key,0));
 if p_submission is not null and not exists(select 1 from public.rfp_submissions where id=p_submission and user_id=p_user) then raise exception 'Owned submission required' using errcode='42501';end if;
 select * into d from public.cc_deliveries where delivery_key=p_key for update;
 if found then
  if d.user_id is distinct from p_user or d.recipient_hash is distinct from p_recipient_hash or d.subject<>p_subject or d.body<>p_body then raise exception 'Delivery key conflict' using errcode='PT409';end if;
  if d.status in ('Accepted','Delivered','Bounced') then return jsonb_build_object('send',false,'id',d.id,'status',d.status,'providerId',d.provider_id);end if;
  -- Never automatically retry an uncertain or currently leased send.
  if d.status in ('Sending','Uncertain') or d.attempts>=3 then raise exception 'Delivery outcome needs verification' using errcode='PT409';end if;
 else
  insert into public.cc_deliveries(user_id,delivery_key,submission_id,subject,body,status,recipient_hash) values(p_user,p_key,p_submission,p_subject,p_body,'Prepared',p_recipient_hash) returning * into d;
 end if;
 update public.cc_deliveries set status='Sending',attempts=attempts+1,lease_until=now()+interval '2 minutes',updated_at=now() where id=d.id;
 return jsonb_build_object('send',true,'id',d.id);
end $$;
create function public.cc_finish_delivery(p_id uuid,p_status text,p_provider text default null) returns void language plpgsql security invoker set search_path='' as $$
begin
 if p_provider is not null then perform pg_advisory_xact_lock(hashtextextended('delivery-provider:'||p_provider,0));end if;
 if exists(select 1 from public.cc_deliveries where id=p_id and status in ('Delivered','Bounced') and (p_provider is null or provider_id=p_provider)) then return;end if;
 if p_status not in ('Accepted','Failed','Uncertain') or p_status='Accepted' and nullif(p_provider,'') is null then raise exception 'Invalid receipt' using errcode='22023';end if;
 update public.cc_deliveries set status=p_status,provider_id=p_provider,lease_until=null,updated_at=now() where id=p_id and status='Sending';
 if not found then raise exception 'Delivery state changed' using errcode='PT409';end if;
 if p_provider is not null then update public.cc_deliveries d set status=e.status,lease_until=null from public.cc_delivery_events e where d.id=p_id and e.provider_id=p_provider and d.status in ('Accepted','Uncertain');end if;
end $$;
create function public.cc_record_delivery_event(p_provider text,p_status text,p_event text,p_at timestamptz,p_delivery uuid default null,p_recipient_hash text default null) returns void language plpgsql security invoker set search_path='' as $$
begin
 if p_status not in ('Delivered','Bounced') or p_provider !~ '^[A-Za-z0-9_-]{1,100}$' or p_at>now()+interval '5 minutes' then raise exception 'Invalid provider event' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended('delivery-provider:'||p_provider,0));
 insert into public.cc_delivery_events(provider_id,status,event_id,occurred_at) values(p_provider,p_status,p_event,p_at)
 on conflict(provider_id) do update set status=excluded.status,event_id=excluded.event_id,occurred_at=excluded.occurred_at,observed_at=now() where public.cc_delivery_events.occurred_at<=excluded.occurred_at;
 if p_delivery is not null and p_recipient_hash is not null then
  update public.cc_deliveries d set provider_id=p_provider,status=e.status,updated_at=now(),lease_until=null from public.cc_delivery_events e where d.id=p_delivery and d.recipient_hash=p_recipient_hash and (d.provider_id is null or d.provider_id=p_provider) and d.status in ('Sending','Accepted','Uncertain','Delivered','Bounced') and e.provider_id=p_provider;
 end if;
 update public.cc_deliveries d set status=e.status,updated_at=now(),lease_until=null from public.cc_delivery_events e where d.provider_id=p_provider and d.status in ('Sending','Accepted','Uncertain','Delivered','Bounced') and e.provider_id=p_provider;
end$$;
-- A deletion request row serializes new references against source removal.
create function public.cc_source_guard() returns trigger language plpgsql security definer set search_path='' as $$
declare item jsonb;state_value text;
begin
 if tg_table_name='rfp_submissions' then
  select state into state_value from public.cc_deletion_requests where user_id=new.user_id and document_id=new.document_id and kind='rfp' for share;
  if state_value in ('Deleting','Completed') then raise exception 'Source deletion is in progress' using errcode='PT409';end if;
 else
  for item in select value from jsonb_array_elements(new.documents) loop
   select state into state_value from public.cc_deletion_requests where user_id=new.user_id and document_id=(item->>'id')::uuid and kind='rfp' for share;
   if state_value in ('Deleting','Completed') then raise exception 'Source deletion is in progress' using errcode='PT409';end if;
  end loop;
 end if;return new;
end$$;
create trigger cc_submission_source_guard before insert or update on public.rfp_submissions for each row execute function public.cc_source_guard();
create trigger cc_analysis_source_guard before insert or update on public.rfp_compliance_analyses for each row execute function public.cc_source_guard();
create function public.cc_claim_source_deletion(p_user uuid,p_request uuid) returns jsonb language plpgsql security invoker set search_path='' as $$
declare r public.cc_deletion_requests;d public.rfp_uploads;
begin
 select * into r from public.cc_deletion_requests where id=p_request and user_id=p_user for update;
 if not found or r.kind<>'rfp' then raise exception 'Owned personal source request required' using errcode='42501';end if;
 if r.state='Completed' then return jsonb_build_object('completed',true);end if;
 if r.state not in ('Review required','Deleting') then raise exception 'Deletion request is not executable' using errcode='PT409';end if;
 select * into d from public.rfp_uploads where id=r.document_id and user_id=p_user for update;
 if not found then raise exception 'Owned source unavailable' using errcode='P0002';end if;
 if exists(select 1 from public.rfp_submissions where document_id=d.id) or exists(select 1 from public.rfp_compliance_analyses a,jsonb_array_elements(a.documents) item where item->>'id'=d.id::text) or exists(select 1 from public.pw_files where source_document_id=d.id) then raise exception 'Source has submission, analysis or project dependencies; manual review required' using errcode='PT409';end if;
 update public.cc_deletion_requests set state='Deleting',updated_at=now() where id=r.id;
 return jsonb_build_object('completed',false,'path',d.storage_path,'documentId',d.id);
end$$;
create function public.cc_finish_source_deletion(p_user uuid,p_request uuid) returns void language plpgsql security invoker set search_path='' as $$
declare r public.cc_deletion_requests;
begin
 select * into r from public.cc_deletion_requests where id=p_request and user_id=p_user and kind='rfp' for update;
 if r.state='Completed' then return;end if;
 if r.id is null or r.state<>'Deleting' then raise exception 'Source deletion has not been claimed' using errcode='PT409';end if;
 delete from public.rfp_uploads where id=r.document_id and user_id=p_user;
 update public.cc_deletion_requests set state='Completed',updated_at=now() where id=r.id;
end$$;
create view public.cc_operations_private with(security_invoker=true) as
 select name,status,observed_at,detail from public.cc_health;
revoke all on public.cc_operations_private from public,anon,authenticated;
grant select on public.cc_operations_private to service_role;
do $$declare r record;begin
 for r in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'cc\_%' escape '\' loop
 execute format('revoke all on function %s from public,anon,authenticated',r.signature);
 execute format('grant execute on function %s to service_role',r.signature);
 end loop;
end$$;
commit;
