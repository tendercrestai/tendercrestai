-- One additive integrated release. Legacy user-owned RFPs and billing are unchanged.
begin;
create table public.pw_projects (
 id uuid primary key default gen_random_uuid(),org_id uuid not null references public.kb_organizations(id),
 created_by uuid not null references auth.users(id),title text not null check(length(btrim(title)) between 1 and 200),
 revision integer not null default 0,evidence_epoch integer not null default 0,
 state jsonb not null check(jsonb_typeof(state)='object' and octet_length(state::text)<=3000000),
 archived_at timestamptz,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),unique(id,org_id)
);
create index pw_projects_org on public.pw_projects(org_id,updated_at desc,id);
create table public.pw_members (
 project_id uuid not null references public.pw_projects(id) on delete cascade,user_id uuid not null references auth.users(id),
 role text not null check(role in ('manager','author','reviewer','viewer')),email_opt_in boolean not null default false,
 primary key(project_id,user_id)
);
create table public.pw_revisions (
 project_id uuid not null references public.pw_projects(id) on delete cascade,revision integer not null,
 actor_id uuid not null references auth.users(id),operation text not null,state jsonb not null,
 evidence_epoch integer not null,created_at timestamptz not null default now(),primary key(project_id,revision)
);
create table public.pw_approvals (
 id uuid primary key default gen_random_uuid(),project_id uuid not null references public.pw_projects(id) on delete cascade,
 section_id uuid,revision integer not null,evidence_epoch integer not null,actor_id uuid not null references auth.users(id),
 snapshot jsonb not null,created_at timestamptz not null default now()
);
create table public.pw_assessments (
 id uuid primary key default gen_random_uuid(),project_id uuid not null references public.pw_projects(id) on delete cascade,
 revision integer not null,evidence_epoch integer not null,input_hash text not null check(input_hash~'^[a-f0-9]{64}$'),
 inputs jsonb not null,result jsonb not null,actor_id uuid not null references auth.users(id),created_at timestamptz not null default now()
);
create table public.pw_events (
 id bigint generated always as identity primary key,project_id uuid not null references public.pw_projects(id) on delete cascade,
 actor_id uuid references auth.users(id),action text not null,revision integer not null,details jsonb not null default '{}',created_at timestamptz not null default now()
);
create table public.pw_files (
 id uuid primary key,project_id uuid not null references public.pw_projects(id) on delete cascade,org_id uuid not null,
 kind text not null check(kind in ('source','attachment','export')),name text not null check(length(name) between 1 and 200),
 path text not null unique,mime text not null,size_bytes integer not null check(size_bytes between 1 and 52428800),
 sha256 text not null check(sha256~'^[a-f0-9]{64}$'),source_document_id uuid,
 revision integer not null,evidence_epoch integer not null,expires_at timestamptz,created_at timestamptz not null default now(),
 foreign key(project_id,org_id) references public.pw_projects(id,org_id) on delete cascade,
 check(path=org_id::text||'/'||project_id::text||'/'||id::text)
);
create table public.pw_jobs (
 id uuid primary key default gen_random_uuid(),project_id uuid not null references public.pw_projects(id) on delete cascade,
 requested_by uuid not null references auth.users(id),kind text not null check(kind in ('draft','export')),
 request_key uuid not null,revision integer not null,evidence_epoch integer not null,input jsonb not null,
 status text not null default 'Pending' check(status in ('Pending','Processing','Completed','Failed','Cancelled')),
 attempts integer not null default 0 check(attempts between 0 and 3),lease_token uuid,lease_until timestamptz,
 result jsonb,error_code text,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 unique(project_id,request_key)
);
create table public.pw_notifications (
 id uuid primary key default gen_random_uuid(),project_id uuid not null references public.pw_projects(id) on delete cascade,
 user_id uuid not null references auth.users(id),event_key text not null,kind text not null,read_at timestamptz,
 email_state text not null default 'Pending' check(email_state in ('Pending','Sending','Sent','Suppressed','Uncertain','Failed')),
 attempts integer not null default 0 check(attempts between 0 and 3),lease_until timestamptz,delivery_id text,
 created_at timestamptz not null default now(),unique(project_id,user_id,event_key)
);
create index pw_notifications_user on public.pw_notifications(user_id,created_at desc);
-- RLS helper has no caller-supplied identity. All mutations remain service-only.
create function public.pw_role(p_project uuid) returns text language sql stable security definer set search_path='' as $$
 select case when k.role='viewer' or (m.role='reviewer' and k.role not in ('owner','reviewer')) then 'viewer' else m.role end from public.pw_members m join public.pw_projects p on p.id=m.project_id
 join public.kb_memberships k on k.org_id=p.org_id and k.user_id=m.user_id and k.active
 where m.project_id=p_project and m.user_id=(select auth.uid()) and p.archived_at is null
$$;
revoke all on function public.pw_role(uuid) from public,anon;
grant execute on function public.pw_role(uuid) to authenticated,service_role;
do $$ declare t text;begin
 foreach t in array array['pw_projects','pw_members','pw_revisions','pw_approvals','pw_assessments','pw_events','pw_files','pw_jobs','pw_notifications'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated',t);
  execute format('grant select on public.%I to authenticated',t);
  execute format('grant all on public.%I to service_role',t);
  execute format('create policy %I on public.%I for select to authenticated using(public.pw_role(%I) is not null)',t||'_read',t,case when t='pw_projects' then 'id' else 'project_id' end);
 end loop;
end $$;
-- Only the recipient reads notification records; project membership is rechecked.
drop policy pw_notifications_read on public.pw_notifications;
create policy pw_notifications_read on public.pw_notifications for select to authenticated using(user_id=(select auth.uid()) and public.pw_role(project_id) is not null);
revoke update,delete on public.pw_revisions,public.pw_approvals,public.pw_assessments,public.pw_events from service_role;
grant usage,select on sequence public.pw_events_id_seq to service_role;

create function public.pw_require(p_project uuid,p_user uuid,p_roles text[] default array['manager','author','reviewer','viewer']) returns public.pw_projects language plpgsql security invoker set search_path='' as $$
declare p public.pw_projects;r text;k text;
begin
 select * into p from public.pw_projects where id=p_project and archived_at is null;
 if not found then raise exception 'Project unavailable' using errcode='P0002';end if;
 select public.kb_require(p.org_id,p_user,array['owner','reviewer','editor','viewer']) into k;
 select role into r from public.pw_members where project_id=p_project and user_id=p_user;
 if r is null then raise exception 'Explicit project membership required' using errcode='42501';end if;
 if k='viewer' or (r='reviewer' and k not in ('owner','reviewer')) then r:='viewer';end if;
 if r is null or not r=any(p_roles) then raise exception 'Project access denied' using errcode='42501';end if;
 return p;
end $$;
create function public.pw_admit(p_org uuid,p_user uuid,p_action text) returns void language plpgsql security invoker set search_path='' as $$
declare v_scope text;v_cap integer;v_window timestamptz;v_used integer;daily integer;
begin
 if p_action not in ('read','write','create','member','draft','export') then raise exception 'Invalid budget action' using errcode='22023';end if;
 daily:=case p_action when 'create' then 25 when 'member' then 200 when 'draft' then 100 when 'export' then 50 else 10000 end;
 for v_scope,v_cap,v_window in select 'user:'||p_user::text,case when p_action in ('read','write') then 120 else 30 end,date_trunc('minute',now())
 union all select 'org:'||p_org::text,daily,date_trunc('day',now() at time zone 'UTC') at time zone 'UTC' where p_org is not null
 union all select 'global',daily*100,date_trunc('day',now() at time zone 'UTC') at time zone 'UTC' loop
  insert into public.kb_usage(scope,action,window_start,used) values(v_scope,'proposal.'||p_action,v_window,1)
  on conflict(scope,action,window_start) do update set used=public.kb_usage.used+1 where public.kb_usage.used<v_cap returning kb_usage.used into v_used;
  if v_used is null then raise exception 'Workspace request budget reached' using errcode='P0001';end if;
 end loop;
end $$;
create function public.pw_create(p_org uuid,p_user uuid,p_title text,p_state jsonb) returns uuid language plpgsql security invoker set search_path='' as $$
declare id uuid;
begin
 perform public.kb_require(p_org,p_user,array['owner','editor']);perform public.pw_admit(p_org,p_user,'create');
 if (select count(*) from public.pw_projects where org_id=p_org and archived_at is null)>=200 then raise exception 'Project limit' using errcode='P0001';end if;
 insert into public.pw_projects(org_id,created_by,title,state) values(p_org,p_user,p_title,p_state) returning pw_projects.id into id;
 insert into public.pw_members values(id,p_user,'manager',false);
 insert into public.pw_revisions(project_id,revision,actor_id,operation,state,evidence_epoch) values(id,0,p_user,'created',p_state,0);
 insert into public.pw_events(project_id,actor_id,action,revision) values(id,p_user,'created',0);return id;
end $$;
create function public.pw_commit(p_project uuid,p_user uuid,p_revision integer,p_epoch integer,p_state jsonb,p_operation text,p_details jsonb default '{}') returns public.pw_projects language plpgsql security invoker set search_path='' as $$
declare p public.pw_projects;s jsonb;a public.kb_answers;v jsonb;targets jsonb:='[]';notice_key text;notice_kind text;
begin
 p:=public.pw_require(p_project,p_user,array['manager','author','reviewer']);
 perform pg_advisory_xact_lock(hashtextextended('pw:'||p_project::text,0));
 select * into p from public.pw_projects where id=p_project for update;
 if p.revision is distinct from p_revision or p.evidence_epoch is distinct from p_epoch then raise exception 'Project changed; reload' using errcode='PT409';end if;
 if p_operation not in ('import','amendment','evidence.suggested','evidence.reviewed','facts.updated','section.saved','draft.accepted','review.requested','review.changes','review.approved','project.approved','comment.added','assignment.updated','bid.assessed','bid.decided','settings.updated') then raise exception 'Invalid operation' using errcode='22023';end if;
 if p_operation in ('evidence.reviewed','facts.updated','review.changes','review.approved','project.approved') then
  perform public.pw_require(p_project,p_user,array['manager','reviewer']);perform public.kb_require(p.org_id,p_user,array['owner','reviewer']);
 end if;
 if p_state->>'schema' is distinct from '1' or jsonb_typeof(p_state->'requirements')<>'array' or jsonb_typeof(p_state->'sections')<>'array' or jsonb_array_length(p_state->'requirements')>500 or jsonb_array_length(p_state->'sections')>500 then raise exception 'Invalid workspace' using errcode='22023';end if;
 -- Live evidence snapshots must refer to the same org's exact approved revision.
 for v in select * from jsonb_array_elements(coalesce(p_state->'evidence','[]')) loop
  if not coalesce((v->>'stale')::boolean,false) and v->>'decision'<>'rejected' then
   select * into a from public.kb_answers where id=(v->>'answerId')::uuid and org_id=p.org_id and revision=(v->>'revision')::integer and approved_revision=revision;
   if not found or a.answer<>v->>'text' or exists(select 1 from public.kb_answer_citations ac join public.kb_chunks c on c.id=ac.chunk_id join public.kb_documents d on d.id=c.document_id where ac.answer_id=a.id and d.status<>'Ready') then raise exception 'Evidence changed; reload' using errcode='PT409';end if;
  end if;
 end loop;
 perform public.pw_admit(p.org_id,p_user,'write');
 update public.pw_projects set state=p_state,title=p_state->>'title',revision=revision+1,updated_at=now() where id=p_project returning * into p;
 insert into public.pw_revisions(project_id,revision,actor_id,operation,state,evidence_epoch) values(p.id,p.revision,p_user,p_operation,p.state,p.evidence_epoch);
 insert into public.pw_events(project_id,actor_id,action,revision,details) values(p.id,p_user,p_operation,p.revision,p_details);
 -- Notification outbox is committed atomically with the text/assignment revision.
 if p_operation='assignment.updated' then
  select item into s from jsonb_array_elements((p_state->'sections')||(p_state->'requirements')) x(item) where item->>'id'=coalesce(p_details->>'sectionId',p_details->>'requirementId') limit 1;
  targets:=jsonb_build_array(s->>'authorId',s->>'reviewerId');notice_key:='assignment:'||p.revision;notice_kind:='assignment';
 elsif p_operation='comment.added' then s:=(p_state->'comments')->-1;targets:=coalesce(s->'mentions','[]');notice_key:='comment:'||(s->>'id');notice_kind:='mention';
 elsif p_operation='review.requested' then
  select item into s from jsonb_array_elements(p_state->'sections') x(item) where item->>'id'=p_details->>'sectionId' limit 1;
  if s->>'reviewerId' is not null then targets:=jsonb_build_array(s->>'reviewerId');else select coalesce(jsonb_agg(m.user_id),'[]') into targets from public.pw_members m join public.kb_memberships k on k.org_id=p.org_id and k.user_id=m.user_id and k.active where m.project_id=p.id and m.role in ('manager','reviewer') and k.role in ('owner','reviewer');end if;
  notice_key:='review:'||p.revision;notice_kind:='review';
 end if;
 if notice_key is not null then
  insert into public.pw_notifications(project_id,user_id,event_key,kind)
  select distinct p.id,m.user_id,notice_key,notice_kind from jsonb_array_elements_text(targets) t(value)
  join public.pw_members m on m.project_id=p.id and m.user_id::text=t.value
  join public.kb_memberships k on k.org_id=p.org_id and k.user_id=m.user_id and k.active
  on conflict(project_id,user_id,event_key) do nothing;
 end if;
 if p_operation in ('review.approved','project.approved') then
  insert into public.pw_approvals(project_id,section_id,revision,evidence_epoch,actor_id,snapshot) values(p.id,nullif(p_details->>'sectionId','')::uuid,p.revision,p.evidence_epoch,p_user,p.state);
 end if;
 return p;
end $$;
create function public.pw_member(p_project uuid,p_user uuid,p_target uuid,p_role text,p_remove boolean default false) returns void language plpgsql security invoker set search_path='' as $$
declare p public.pw_projects;k text;
begin
 p:=public.pw_require(p_project,p_user,array['manager']);perform public.pw_admit(p.org_id,p_user,'member');
 if p_target=p.created_by then raise exception 'Project owner is protected' using errcode='42501';end if;
 if p_remove then delete from public.pw_members where project_id=p_project and user_id=p_target;
 else
  k:=public.kb_require(p.org_id,p_target,array['owner','reviewer','editor','viewer']);
  if p_role not in ('author','reviewer','viewer','manager') or (p_role='reviewer' and k not in ('owner','reviewer')) or (p_role in ('author','manager') and k not in ('owner','editor')) then raise exception 'Role exceeds organization permission' using errcode='42501';end if;
  insert into public.pw_members(project_id,user_id,role) values(p_project,p_target,p_role) on conflict(project_id,user_id) do update set role=excluded.role;
 end if;
 insert into public.pw_events(project_id,actor_id,action,revision,details) values(p_project,p_user,case when p_remove then 'member.removed' else 'member.updated' end,p.revision,jsonb_build_object('userId',p_target));
end $$;
create function public.pw_preferences(p_project uuid,p_user uuid,p_email boolean) returns void language plpgsql security invoker set search_path='' as $$
begin
 perform public.pw_require(p_project,p_user);if p_email is null then raise exception 'Invalid preference' using errcode='22023';end if;
 update public.pw_members set email_opt_in=p_email where project_id=p_project and user_id=p_user;
end $$;

create function public.pw_enqueue(p_project uuid,p_user uuid,p_revision integer,p_epoch integer,p_kind text,p_key uuid,p_input jsonb) returns public.pw_jobs language plpgsql security invoker set search_path='' as $$
declare p public.pw_projects;j public.pw_jobs;
begin
 p:=public.pw_require(p_project,p_user,case when p_kind='draft' then array['manager','author','reviewer'] else array['manager','author','reviewer','viewer'] end);
 perform pg_advisory_xact_lock(hashtextextended('pw:'||p_project::text,0));
 select * into j from public.pw_jobs where project_id=p_project and request_key=p_key;
 if found then if j.kind<>p_kind or j.input<>p_input then raise exception 'Idempotency key reused' using errcode='PT409';end if;return j;end if;
 select * into p from public.pw_projects where id=p_project for update;
 if p.revision is distinct from p_revision or p.evidence_epoch is distinct from p_epoch then raise exception 'Project changed' using errcode='PT409';end if;
 if (select count(*) from public.pw_jobs where project_id=p_project and status in ('Pending','Processing'))>=3 then raise exception 'Project jobs busy' using errcode='P0001';end if;
 perform public.pw_admit(p.org_id,p_user,p_kind);
 insert into public.pw_jobs(project_id,requested_by,kind,request_key,revision,evidence_epoch,input) values(p_project,p_user,p_kind,p_key,p_revision,p_epoch,p_input) returning * into j;return j;
end $$;
create function public.pw_claim(p_job uuid,p_lease uuid) returns jsonb language plpgsql security invoker set search_path='' as $$
declare j public.pw_jobs;p public.pw_projects;
begin
 select * into j from public.pw_jobs where id=p_job for update;
 if not found then raise exception 'Job unavailable' using errcode='P0002';end if;
 if j.status='Completed' then return jsonb_build_object('done',true);end if;
 begin p:=public.pw_require(j.project_id,j.requested_by,case when j.kind='draft' then array['manager','author','reviewer'] else array['manager','author','reviewer','viewer'] end);exception when insufficient_privilege or sqlstate 'P0002' then update public.pw_jobs set status='Cancelled',lease_until=null,error_code='access_revoked',updated_at=now() where id=j.id;return jsonb_build_object('done',true,'cancelled',true);end;
 if j.status='Cancelled' or j.attempts>=3 or j.lease_until>now() then raise exception 'Job lease/retry limit' using errcode='P0001';end if;
 if p.revision<>j.revision or p.evidence_epoch<>j.evidence_epoch then update public.pw_jobs set status='Cancelled',error_code='revision_changed',updated_at=now() where id=j.id;return jsonb_build_object('done',true,'cancelled',true);end if;
 update public.pw_jobs set status='Processing',attempts=attempts+1,lease_token=p_lease,lease_until=now()+interval '10 minutes',updated_at=now() where id=j.id returning * into j;
 return jsonb_build_object('done',false,'job',to_jsonb(j),'project',to_jsonb(p));
end $$;
create function public.pw_finish(p_job uuid,p_lease uuid,p_result jsonb,p_error text default null) returns boolean language plpgsql security invoker set search_path='' as $$
declare j public.pw_jobs;p public.pw_projects;
begin
 select * into j from public.pw_jobs where id=p_job for update;
 if not found or j.lease_token is distinct from p_lease or j.lease_until<=now() then return false;end if;
 begin p:=public.pw_require(j.project_id,j.requested_by,case when j.kind='draft' then array['manager','author','reviewer'] else array['manager','author','reviewer','viewer'] end);exception when others then update public.pw_jobs set status='Cancelled',lease_until=null,error_code='access_revoked' where id=j.id;return false;end;
 if p.revision<>j.revision or p.evidence_epoch<>j.evidence_epoch then update public.pw_jobs set status='Cancelled',lease_until=null,error_code='revision_changed' where id=j.id;return false;end if;
 update public.pw_jobs set status=case when p_error is null then 'Completed' else 'Failed' end,result=case when p_error is null then p_result else null end,error_code=p_error,lease_until=null,updated_at=now() where id=j.id;return true;
end $$;

-- Mark only projects that actually reference the changed KB answer/source.
create function public.pw_evidence_changed() returns trigger language plpgsql security definer set search_path='' as $$
declare key text;org uuid;begin
 if tg_table_name='kb_answers' then
  if new.answer is not distinct from old.answer and new.revision=old.revision and new.approved_revision is not distinct from old.approved_revision then return new;end if;
  key:=new.id::text;org:=new.org_id;
  update public.pw_projects set evidence_epoch=evidence_epoch+1,updated_at=now() where org_id=org and archived_at is null and jsonb_path_exists(state,'$.evidence[*] ? (@.answerId == $id)',jsonb_build_object('id',key));
 else
  if new.status is not distinct from old.status then return new;end if;key:=new.id::text;org:=new.org_id;
  update public.pw_projects set evidence_epoch=evidence_epoch+1,updated_at=now() where org_id=org and archived_at is null and (jsonb_path_exists(state,'$.evidence[*].citations[*] ? (@.documentId == $id)',jsonb_build_object('id',key)) or jsonb_path_exists(state,'$.attachments[*] ? (@.documentId == $id)',jsonb_build_object('id',key)));
 end if;return new;
end $$;
create trigger pw_answer_stale after update on public.kb_answers for each row execute function public.pw_evidence_changed();
create trigger pw_document_stale after update on public.kb_documents for each row execute function public.pw_evidence_changed();

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('proposal-artifacts','proposal-artifacts',false,52428800,array['application/zip','application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','text/csv','text/plain']);
-- A pre-existing broad policy must not expose generated proposals or shared inputs.
create policy pw_storage_guard on storage.objects as restrictive for all to anon,authenticated using(bucket_id<>'proposal-artifacts') with check(bucket_id<>'proposal-artifacts');
create function public.pw_candidates(p_project uuid,p_user uuid,p_query text) returns jsonb language plpgsql security invoker set search_path='' as $$
declare p public.pw_projects;result jsonb;
begin
 p:=public.pw_require(p_project,p_user);if length(p_query) not between 1 and 2000 then raise exception 'Invalid query' using errcode='22023';end if;
 perform public.kb_discovery_admit(p.org_id,p_user);
 select coalesce(jsonb_agg(to_jsonb(t)),'[]') into result from (
  select a.id as "answerId",a.question,a.answer as text,a.revision,
   (select jsonb_agg(jsonb_build_object('id',c.id,'documentId',d.id,'fileName',d.file_name,'page',c.page,'section',c.section,'quote',c.content,'sha256',d.sha256) order by c.id)
    from public.kb_answer_citations ac join public.kb_chunks c on c.id=ac.chunk_id and c.org_id=ac.org_id join public.kb_documents d on d.id=c.document_id and d.org_id=c.org_id where ac.answer_id=a.id and ac.org_id=p.org_id) as citations,
   ts_rank(to_tsvector('english',a.question||' '||a.answer),websearch_to_tsquery('english',regexp_replace(p_query,'\s+',' OR ','g'))) as relevance
  from public.kb_answers a where a.org_id=p.org_id and a.approved_revision=a.revision
   and exists(select 1 from public.kb_answer_citations ac where ac.answer_id=a.id)
   and not exists(select 1 from public.kb_answer_citations ac join public.kb_chunks c on c.id=ac.chunk_id join public.kb_documents d on d.id=c.document_id where ac.answer_id=a.id and (d.status<>'Ready' or d.org_id<>p.org_id))
   and to_tsvector('english',a.question||' '||a.answer)@@websearch_to_tsquery('english',regexp_replace(p_query,'\s+',' OR ','g'))
  order by relevance desc,a.updated_at desc,a.id limit 10
 ) t;return result;
end $$;

create function public.pw_notification_targets(p_id uuid,p_claim boolean default false) returns jsonb language plpgsql security definer set search_path='' as $$
declare n public.pw_notifications;p public.pw_projects;email text;
begin
 select * into n from public.pw_notifications where id=p_id for update;
 if not found or n.email_state in ('Sent','Suppressed','Uncertain') then return null;end if;
 begin p:=public.pw_require(n.project_id,n.user_id);exception when others then update public.pw_notifications set email_state='Suppressed' where id=p_id;return null;end;
 if not exists(select 1 from public.pw_members where project_id=n.project_id and user_id=n.user_id and email_opt_in) then update public.pw_notifications set email_state='Suppressed' where id=p_id;return null;end if;
 if n.created_at<now()-interval '23 hours' or n.attempts>=3 then update public.pw_notifications set email_state='Uncertain' where id=p_id;return null;end if;
 if n.lease_until>now() then return null;end if;
 select u.email into email from auth.users u where u.id=n.user_id and u.email_confirmed_at is not null;
 if email is null then update public.pw_notifications set email_state='Suppressed' where id=p_id;return null;end if;
 if p_claim then update public.pw_notifications set email_state='Sending',attempts=attempts+1,lease_until=now()+interval '5 minutes' where id=p_id;end if;
 return jsonb_build_object('id',n.id,'projectId',n.project_id,'email',email,'kind',n.kind);
end $$;

create function public.pw_notify(p_project uuid,p_actor uuid,p_user uuid,p_key text,p_kind text) returns void language plpgsql security invoker set search_path='' as $$
begin
 perform public.pw_require(p_project,p_actor,array['manager','author','reviewer']);perform public.pw_require(p_project,p_user);
 if length(p_key)>200 or p_kind not in ('assignment','mention','review','reminder') then raise exception 'Invalid notification' using errcode='22023';end if;
 insert into public.pw_notifications(project_id,user_id,event_key,kind) values(p_project,p_user,p_key,p_kind) on conflict(project_id,user_id,event_key) do nothing;
end $$;

-- Explicit creator-only data deletion is the only path that removes snapshots.
create function public.pw_delete(p_project uuid,p_user uuid) returns void language plpgsql security definer set search_path='' as $$
declare p public.pw_projects;
begin
 p:=public.pw_require(p_project,p_user,array['manager']);if p.created_by<>p_user then raise exception 'Only project creator may delete' using errcode='42501';end if;
 if exists(select 1 from public.pw_files where project_id=p_project) then raise exception 'Delete private objects first' using errcode='22023';end if;
 delete from public.pw_projects where id=p_project;
end $$;

create function public.pw_orphan_files() returns table(path text) language sql stable security definer set search_path='' as $$
 select o.name from storage.objects o left join public.pw_files f on f.path=o.name
 where o.bucket_id='proposal-artifacts' and f.id is null and o.created_at<now()-interval '24 hours' order by o.created_at,o.name limit 50
$$;

create function public.pw_reminders() returns integer language plpgsql security invoker set search_path='' as $$
declare affected integer;day text:=to_char(now() at time zone 'UTC','YYYY-MM-DD');
begin
 insert into public.pw_notifications(project_id,user_id,event_key,kind)
 select p.id,m.user_id,'due:'||(x.item->>'id')||':'||day,'reminder'
 from public.pw_projects p cross join lateral jsonb_array_elements(coalesce(p.state->'sections','[]')||coalesce(p.state->'requirements','[]')) x(item)
 join public.pw_members m on m.project_id=p.id and m.user_id::text in (x.item->>'authorId',x.item->>'reviewerId')
 join public.kb_memberships k on k.org_id=p.org_id and k.user_id=m.user_id and k.active
 where p.archived_at is null and x.item->>'dueAt'<=day and x.item->>'status' not in ('approved','Compliant')
 and not exists(select 1 from public.pw_notifications n where n.project_id=p.id and n.user_id=m.user_id and n.event_key='due:'||(x.item->>'id')||':'||day)
 order by p.id,x.item->>'id',m.user_id limit 500 on conflict(project_id,user_id,event_key) do nothing;
 get diagnostics affected=row_count;return affected;
end $$;

create function public.pw_people(p_project uuid,p_user uuid,p_directory boolean default false) returns jsonb language plpgsql security definer set search_path='' as $$
declare p public.pw_projects;result jsonb;
begin
 p:=public.pw_require(p_project,p_user);
 if p_directory then perform public.pw_require(p_project,p_user,array['manager']);perform public.kb_require(p.org_id,p_user,array['owner']);end if;
 select coalesce(jsonb_agg(jsonb_build_object('user_id',k.user_id,'label',u.email,'orgRole',k.role) order by u.email),'[]') into result
 from public.kb_memberships k join auth.users u on u.id=k.user_id where k.org_id=p.org_id and k.active
 and (p_directory or exists(select 1 from public.pw_members m where m.project_id=p.id and m.user_id=k.user_id));return result;
end $$;

do $$ declare f record;begin
 for f in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'pw\_%' escape '\' and p.proname<>'pw_role' loop
  execute format('revoke all on function %s from public,anon,authenticated',f.signature);
  execute format('grant execute on function %s to service_role',f.signature);
 end loop;
end $$;
commit;
