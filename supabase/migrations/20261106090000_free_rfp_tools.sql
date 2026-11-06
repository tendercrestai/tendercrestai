-- Additive, service-only anonymous tools. No existing customer/billing tables changed.
create table public.ft_jobs(id uuid primary key,created_at timestamptz not null default now(),expires_at timestamptz not null default now()+interval '24 hours',status text not null default 'Pending' check(status in ('Pending','Processing','Completed','Failed')),ip_hash text not null,documents jsonb not null,chunks jsonb not null,requirements jsonb not null default '[]',processed integer not null default 0,lease_until timestamptz,error text,title text not null,source text not null default '',warnings jsonb not null default '[]');
create table public.ft_rates(day date not null,kind text not null,key text not null,n integer not null default 0,primary key(day,kind,key));
create table public.ft_cache(key text primary key,body jsonb not null,expires_at timestamptz not null);
create table public.ft_leads(id uuid primary key,email text not null check(length(email)<=254),title text not null,source text not null,created_at timestamptz not null default now(),marketing_opt_in boolean not null default false,customer_state text not null default 'Pending',admin_state text not null default 'Pending');
create table public.ft_events(id uuid primary key,name text not null check(name in ('shred_started','shred_completed','shred_email_gate')),created_at timestamptz not null default now());
create index on public.ft_jobs(expires_at);create index on public.ft_leads(created_at);create index on public.ft_events(created_at);
alter table public.ft_jobs enable row level security;alter table public.ft_rates enable row level security;alter table public.ft_cache enable row level security;alter table public.ft_leads enable row level security;alter table public.ft_events enable row level security;
revoke all on public.ft_jobs,public.ft_rates,public.ft_cache,public.ft_leads,public.ft_events from public,anon,authenticated;
grant all on public.ft_jobs,public.ft_rates,public.ft_cache,public.ft_leads,public.ft_events to service_role;
create function public.ft_admit(p_ip text,p_kind text,p_limit integer,p_global integer) returns void language plpgsql security invoker set search_path='' as $$
declare d date:=(now() at time zone 'UTC')::date;a integer;b integer;
begin
 if p_kind not in ('shred','email','event','sam','ai') or p_limit<1 or p_global<1 then raise exception 'Invalid tool admission' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended('ft:'||d::text||':'||p_kind,0));
 select n into a from public.ft_rates where day=d and kind=p_kind and key=p_ip;
 select n into b from public.ft_rates where day=d and kind=p_kind and key='global';
 if coalesce(a,0)>=p_limit or coalesce(b,0)>=p_global then raise exception 'Free tool limit reached. Try again after the UTC daily reset or explore a trial.' using errcode='P0001';end if;
 insert into public.ft_rates values(d,p_kind,p_ip,1) on conflict(day,kind,key) do update set n=ft_rates.n+1;
 insert into public.ft_rates values(d,p_kind,'global',1) on conflict(day,kind,key) do update set n=ft_rates.n+1;
end $$;
create function public.ft_claim(p_id uuid) returns jsonb language plpgsql security invoker set search_path='' as $$
declare j public.ft_jobs;
begin
 update public.ft_jobs set status='Processing',lease_until=now()+interval '5 minutes' where id=p_id and expires_at>now() and (status='Pending' or (status='Processing' and lease_until<now())) returning * into j;
 return case when found then to_jsonb(j) else null end;
end $$;
create function public.ft_lead(p_id uuid,p_email text,p_marketing boolean) returns jsonb language plpgsql security invoker set search_path='' as $$
declare j public.ft_jobs;l public.ft_leads;
begin
 perform pg_advisory_xact_lock(hashtextextended('ft-lead:'||p_id::text,0));
 select * into j from public.ft_jobs where id=p_id and status='Completed' and expires_at>now();if not found then raise exception 'Result expired or incomplete' using errcode='P0002';end if;
 select * into l from public.ft_leads where id=p_id;
 if found then if l.email<>p_email then raise exception 'This result already has a recipient. Start a new shred for a different recipient.' using errcode='PT409';end if;return to_jsonb(l);end if;
 perform public.ft_admit(j.ip_hash,'email',3,10);
 insert into public.ft_leads(id,email,title,source,marketing_opt_in) values(j.id,p_email,j.title,j.source,p_marketing) returning * into l;return to_jsonb(l);
end $$;
create function public.ft_cleanup() returns void language sql security invoker set search_path='' as $$
 delete from public.ft_jobs where expires_at<now();delete from public.ft_rates where day<(now() at time zone 'UTC')::date-2;delete from public.ft_cache where expires_at<now();delete from public.ft_events where created_at<now()-interval '90 days';delete from public.ft_leads where created_at<now()-interval '90 days';
$$;
revoke all on function public.ft_admit(text,text,integer,integer),public.ft_claim(uuid),public.ft_lead(uuid,text,boolean),public.ft_cleanup() from public,anon,authenticated;
grant execute on function public.ft_admit(text,text,integer,integer),public.ft_claim(uuid),public.ft_lead(uuid,text,boolean),public.ft_cleanup() to service_role;
create function public.ft_cache_put(p_key text,p_body jsonb) returns void language sql security invoker set search_path='' as $$
 insert into public.ft_cache(key,body,expires_at) values(p_key,p_body,now()+interval '1 hour') on conflict(key) do update set body=excluded.body,expires_at=excluded.expires_at;
$$;
revoke all on function public.ft_cache_put(text,jsonb) from public,anon,authenticated;
grant execute on function public.ft_cache_put(text,jsonb) to service_role;
