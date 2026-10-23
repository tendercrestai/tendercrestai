-- Additive Feature 1 discovery and owner-managed membership. Existing KB APIs remain valid.
begin;
create index kb_documents_browse on public.kb_documents(org_id,created_at desc,id);
create index kb_answers_browse on public.kb_answers(org_id,updated_at desc,id);
create index kb_activity_browse on public.kb_audit_events(org_id,created_at desc,id);
create table public.kb_invitations (
 id uuid primary key default gen_random_uuid(), org_id uuid not null references public.kb_organizations(id),
 email text not null check(email=lower(btrim(email)) and length(email) between 3 and 254),
 role text not null check(role in ('editor','reviewer','viewer')),
 token_hash text not null unique check(token_hash ~ '^[a-f0-9]{64}$'),
 created_by uuid not null references auth.users(id), created_at timestamptz not null default now(),
 expires_at timestamptz not null default now()+interval '7 days',
 state text not null default 'Pending' check(state in ('Pending','Accepted','Revoked')),
 accepted_by uuid references auth.users(id), accepted_at timestamptz,
 check((state='Accepted' and accepted_by is not null and accepted_at is not null) or (state<>'Accepted' and accepted_by is null and accepted_at is null))
);
create index kb_invitations_org on public.kb_invitations(org_id,created_at desc,id);
alter table public.kb_invitations enable row level security;
revoke all on public.kb_invitations from public,anon,authenticated;
grant all on public.kb_invitations to service_role;

-- One atomic admission per request, including invite lookups before joining an org.
create function public.kb_discovery_admit(p_org uuid,p_user uuid) returns void language plpgsql security invoker set search_path='' as $$
declare k text; lim integer; w timestamptz; n integer;
begin
 if p_org is not null then perform public.kb_require(p_org,p_user,array['owner','reviewer','editor','viewer']); end if;
 for k,lim,w in
  select 'user:'||p_user::text,60,date_trunc('minute',now())
  union all select 'global',50000,date_trunc('day',now() at time zone 'UTC') at time zone 'UTC'
  union all select 'org:'||p_org::text,10000,date_trunc('day',now() at time zone 'UTC') at time zone 'UTC' where p_org is not null
 loop
  insert into public.kb_usage(scope,action,window_start,used) values(k,'discovery',w,1)
   on conflict(scope,action,window_start) do update set used=public.kb_usage.used+1 where public.kb_usage.used<lim returning used into n;
  if n is null then raise exception 'Discovery rate limit' using errcode='P0001'; end if;
 end loop;
end $$;

create function public.kb_overview(p_org uuid,p_user uuid) returns jsonb language plpgsql security invoker set search_path='' as $$
declare r text;
begin
 r:=public.kb_require(p_org,p_user,array['owner','reviewer','editor','viewer']);
 return jsonb_build_object('role',r,
  'documents',(select count(*) from public.kb_documents where org_id=p_org and status<>'Archived'),
  'ready',(select count(*) from public.kb_documents where org_id=p_org and status='Ready'),
  'processing',(select count(*) from public.kb_documents where org_id=p_org and status in ('Uploaded','Processing')),
  'answers',(select count(*) from public.kb_answers where org_id=p_org),
  'approved',(select count(*) from public.kb_answers where org_id=p_org and approved_revision=revision));
end $$;

create function public.kb_browse(p_org uuid,p_user uuid,p_kind text,p_query text default '',p_status text default '',p_type text default '',p_from date default null,p_to date default null,p_page integer default 0,p_size integer default 25) returns jsonb language plpgsql security invoker set search_path='' as $$
declare r text; result jsonb; n bigint; q text:=lower(btrim(coalesce(p_query,''))); off integer;
begin
 r:=public.kb_require(p_org,p_user,array['owner','reviewer','editor','viewer']);
 if p_kind not in ('documents','answers','activity','excerpts') or p_page is null or p_page not between 0 and 40000 or p_size is null or p_size not between 1 and 50 or length(q)>2000 or (p_from is not null and p_to is not null and p_from>p_to) then raise exception 'Invalid browse options' using errcode='22023'; end if;
 if p_type not in ('','pdf','docx','txt') then raise exception 'Invalid file type' using errcode='22023'; end if;
 off:=p_page*p_size;
 if p_kind='documents' then
  if p_status not in ('','Uploaded','Processing','Ready','Failed','Archived') then raise exception 'Invalid document status' using errcode='22023'; end if;
  with matched as (
   select d.id,d.file_name,d.extension,d.status,d.warnings,d.error_code,d.created_at from public.kb_documents d
   where d.org_id=p_org and (q='' or strpos(lower(d.file_name),q)>0) and (p_status='' or d.status=p_status) and (p_type='' or d.extension=p_type)
    and (p_from is null or d.created_at>=p_from::timestamp at time zone 'UTC') and (p_to is null or d.created_at<(p_to+1)::timestamp at time zone 'UTC')
  ) select (select count(*) from matched),coalesce((select jsonb_agg(to_jsonb(t) order by t.created_at desc,t.id) from (select * from matched order by created_at desc,id limit p_size offset off) t),'[]') into n,result;
 elsif p_kind='answers' then
  if p_status not in ('','draft','approved') then raise exception 'Invalid answer status' using errcode='22023'; end if;
  with matched as (
   select a.id,a.question,a.answer,a.revision,a.approved_revision,a.approved_by,a.approved_at,a.updated_at,
    (select coalesce(jsonb_agg(jsonb_build_object('chunk_id',c.chunk_id) order by c.chunk_id),'[]') from public.kb_answer_citations c where c.answer_id=a.id and c.org_id=p_org) as kb_answer_citations,
    not exists(select 1 from public.kb_answer_citations ac join public.kb_chunks c on c.id=ac.chunk_id join public.kb_documents d on d.id=c.document_id where ac.answer_id=a.id and d.status<>'Ready') as sources_ready
   from public.kb_answers a where a.org_id=p_org and (q='' or strpos(lower(a.question||' '||a.answer),q)>0)
    and (p_status='' or (p_status='approved' and a.approved_revision=a.revision) or (p_status='draft' and a.approved_revision is distinct from a.revision))
    and (p_from is null or a.updated_at>=p_from::timestamp at time zone 'UTC') and (p_to is null or a.updated_at<(p_to+1)::timestamp at time zone 'UTC')
  ) select (select count(*) from matched),coalesce((select jsonb_agg(to_jsonb(t) order by t.updated_at desc,t.id) from (select * from matched order by updated_at desc,id limit p_size offset off) t),'[]') into n,result;
 elsif p_kind='excerpts' then
  if p_status not in ('','Uploaded','Processing','Ready','Failed','Archived') then raise exception 'Invalid document status' using errcode='22023'; end if;
  with matched as (
   select c.id,c.document_id,c.content,c.page,c.section,c.segment_id,c.start_offset,d.file_name,d.created_at,c.ordinal
   from public.kb_chunks c join public.kb_documents d on d.id=c.document_id and d.org_id=c.org_id
   where c.org_id=p_org and d.status='Ready' and p_status in ('','Ready') and (q='' or strpos(lower(c.content),q)>0)
    and (p_type='' or d.extension=p_type) and (p_from is null or d.created_at>=p_from::timestamp at time zone 'UTC') and (p_to is null or d.created_at<(p_to+1)::timestamp at time zone 'UTC')
  ) select (select count(*) from matched),coalesce((select jsonb_agg(to_jsonb(t) order by t.created_at desc,t.document_id,t.ordinal) from (select * from matched order by created_at desc,document_id,ordinal limit p_size offset off) t),'[]') into n,result;
 else
  perform public.kb_require(p_org,p_user,array['owner','reviewer']);
  if length(p_status)>100 then raise exception 'Invalid activity action' using errcode='22023'; end if;
  with matched as (
   select e.id::text as id,e.action,e.target_id,e.revision,e.created_at,e.actor_id from public.kb_audit_events e where e.org_id=p_org
    and (q='' or strpos(lower(replace(e.action,'.',' ')||' '||e.action||' '||coalesce(e.target_id::text,'')||' '||coalesce(e.actor_id::text,'')),q)>0)
    and (p_status='' or e.action=p_status) and (p_from is null or e.created_at>=p_from::timestamp at time zone 'UTC') and (p_to is null or e.created_at<(p_to+1)::timestamp at time zone 'UTC')
  ) select (select count(*) from matched),coalesce((select jsonb_agg(to_jsonb(t) order by t.created_at desc,t.id::bigint desc) from (select * from matched order by created_at desc,id::bigint desc limit p_size offset off) t),'[]') into n,result;
 end if;
 return jsonb_build_object('items',result,'total',n,'page',p_page,'pageSize',p_size,'hasMore',(off+p_size)<n);
end $$;

create function public.kb_find(p_org uuid,p_user uuid,p_query text,p_scope text default 'all',p_document_status text default '',p_type text default '',p_answer_status text default '',p_action text default '',p_from date default null,p_to date default null,p_page integer default 0,p_size integer default 25) returns jsonb language plpgsql security invoker set search_path='' as $$
declare r text; groups jsonb:='{}'; more boolean:=false; value jsonb; kind text;
begin
 r:=public.kb_require(p_org,p_user,array['owner','reviewer','editor','viewer']);
 if p_scope not in ('all','documents','answers','excerpts','activity') then raise exception 'Invalid search scope' using errcode='22023'; end if;
 if p_scope='activity' then perform public.kb_require(p_org,p_user,array['owner','reviewer']); end if;
 foreach kind in array array['documents','answers','excerpts','activity'] loop
  if (p_scope='all' or p_scope=kind) and (kind<>'activity' or r in ('owner','reviewer')) then
   value:=public.kb_browse(p_org,p_user,kind,p_query,case kind when 'answers' then p_answer_status when 'activity' then p_action else p_document_status end,p_type,p_from,p_to,p_page,p_size);
   groups:=groups||jsonb_build_object(kind,value);more:=more or (value->>'hasMore')::boolean;
  end if;
 end loop;
 return jsonb_build_object('groups',groups,'page',p_page,'pageSize',p_size,'hasMore',more,'activityAvailable',r in ('owner','reviewer'));
end $$;

-- Semantic filters are applied before ranking/paging, not to an already truncated hit list.
create function public.kb_search_filtered(p_org uuid,p_user uuid,p_embedding extensions.vector(1536),p_type text default '',p_from date default null,p_to date default null,p_page integer default 0,p_size integer default 10) returns jsonb language plpgsql security invoker set search_path='' as $$
declare hits jsonb; answers jsonb; n bigint;
begin
 perform public.kb_require(p_org,p_user,array['owner','reviewer','editor','viewer']);
 if p_type not in ('','pdf','docx','txt') or p_page is null or p_page not between 0 and 40000 or p_size is null or p_size not between 1 and 25 or (p_from is not null and p_to is not null and p_from>p_to) then raise exception 'Invalid semantic options' using errcode='22023'; end if;
 with matched as (
  select c.id,c.document_id,c.content,c.page,c.section,c.segment_id,c.start_offset,d.file_name,1-(c.embedding OPERATOR(extensions.<=>) p_embedding) as score
  from public.kb_chunks c join public.kb_documents d on d.id=c.document_id and d.org_id=c.org_id
  where c.org_id=p_org and d.status='Ready' and (p_type='' or d.extension=p_type)
   and (p_from is null or d.created_at>=p_from::timestamp at time zone 'UTC') and (p_to is null or d.created_at<(p_to+1)::timestamp at time zone 'UTC')
   and (c.embedding OPERATOR(extensions.<=>) p_embedding)<0.8
 ) select (select count(*) from matched),coalesce((select jsonb_agg(to_jsonb(t) order by t.score desc,t.id) from (select * from matched order by score desc,id limit p_size offset p_page*p_size) t),'[]') into n,hits;
 select coalesce(jsonb_agg(to_jsonb(a)),'[]') into answers from (
  select ans.id,ans.question,ans.answer,ans.revision,ans.approved_by,ans.approved_at,
   (select jsonb_agg(jsonb_build_object('chunk_id',c.id,'document_id',c.document_id,'quote',c.content,'page',c.page,'section',c.section,'file_name',d.file_name))
    from public.kb_answer_citations ac join public.kb_chunks c on c.id=ac.chunk_id join public.kb_documents d on d.id=c.document_id where ac.answer_id=ans.id) as citations
  from public.kb_answers ans where ans.org_id=p_org and ans.approved_revision=ans.revision
   and exists(select 1 from public.kb_answer_citations ac where ac.answer_id=ans.id and ac.chunk_id in (select (x->>'id')::uuid from jsonb_array_elements(hits) x))
   and not exists(select 1 from public.kb_answer_citations ac join public.kb_chunks c on c.id=ac.chunk_id join public.kb_documents d on d.id=c.document_id where ac.answer_id=ans.id and d.status<>'Ready')
  order by ans.updated_at desc,ans.id limit 25
 ) a;
 insert into public.kb_audit_events(org_id,actor_id,action) values(p_org,p_user,'knowledge.searched');
 return jsonb_build_object('chunks',hits,'answers',answers,'page',p_page,'pageSize',p_size,'total',n,'hasMore',(p_page*p_size+p_size)<n);
end $$;

create function public.kb_team(p_org uuid,p_user uuid,p_query text default '',p_page integer default 0,p_size integer default 25) returns jsonb language plpgsql security definer set search_path='' as $$
declare members jsonb; invites jsonb; n bigint; q text:=lower(btrim(p_query));
begin
 perform public.kb_require(p_org,p_user,array['owner']);
 if p_page is null or p_page not between 0 and 40000 or p_size is null or p_size not between 1 and 50 or length(q)>254 then raise exception 'Invalid team options' using errcode='22023'; end if;
 with matched as (
  select m.user_id,u.email,m.role,m.active from public.kb_memberships m join auth.users u on u.id=m.user_id
  where m.org_id=p_org and (q='' or strpos(lower(coalesce(u.email,'')||' '||m.role),q)>0)
 ) select (select count(*) from matched),coalesce((select jsonb_agg(to_jsonb(t) order by t.email,t.user_id) from (select * from matched order by email,user_id limit p_size offset p_page*p_size) t),'[]') into n,members;
 -- Invitations are separately paged and never expose token hashes.
 select coalesce(jsonb_agg(to_jsonb(t) order by t.created_at desc,t.id),'[]') into invites from (
  select id,email,role,created_at,expires_at,case when state='Pending' and expires_at<=now() then 'Expired' else state end as state
  from public.kb_invitations where org_id=p_org and (q='' or strpos(lower(email||' '||role),q)>0) order by created_at desc,id limit p_size offset p_page*p_size
 ) t;
 return jsonb_build_object('members',members,'invitations',invites,'page',p_page,'pageSize',p_size,'total',n,
  'hasMore',(p_page*p_size+p_size)<greatest(n,(select count(*) from public.kb_invitations where org_id=p_org and (q='' or strpos(lower(email||' '||role),q)>0))));
end $$;

create function public.kb_member_update(p_org uuid,p_user uuid,p_target uuid,p_role text,p_active boolean) returns void language plpgsql security invoker set search_path='' as $$
declare m public.kb_memberships;
begin
 perform public.kb_require(p_org,p_user,array['owner']);
 if p_role not in ('reviewer','editor','viewer') or p_active is null then raise exception 'Invalid member role' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(hashtextextended('kb-org:'||p_org::text,0));perform public.kb_charge(p_org,p_user,'team');
 select * into m from public.kb_memberships where org_id=p_org and user_id=p_target for update;
 if not found then raise exception 'Member not found' using errcode='P0002'; end if;
 if m.role='owner' or p_target=(select created_by from public.kb_organizations where id=p_org) then raise exception 'Owner cannot be changed' using errcode='42501'; end if;
 update public.kb_memberships set role=p_role,active=p_active where org_id=p_org and user_id=p_target;
 if m.role<>p_role then insert into public.kb_audit_events(org_id,actor_id,action,target_id) values(p_org,p_user,'member.role.'||p_role,p_target); end if;
 if m.active<>p_active then insert into public.kb_audit_events(org_id,actor_id,action,target_id) values(p_org,p_user,case when p_active then 'member.reactivated' else 'member.deactivated' end,p_target); end if;
end $$;

create function public.kb_invite_create(p_org uuid,p_user uuid,p_email text,p_role text,p_hash text) returns jsonb language plpgsql security definer set search_path='' as $$
declare invitation public.kb_invitations;
begin
 perform public.kb_require(p_org,p_user,array['owner']);
 if p_role not in ('reviewer','editor','viewer') or p_email is null or p_email<>lower(btrim(p_email)) or length(p_email) not between 3 and 254 or p_hash is null or p_hash !~ '^[a-f0-9]{64}$' then raise exception 'Invalid invitation' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(hashtextextended('kb-org:'||p_org::text,0));perform public.kb_charge(p_org,p_user,'team');
 if exists(select 1 from public.kb_memberships m join auth.users u on u.id=m.user_id where m.org_id=p_org and lower(u.email)=p_email and m.active) then raise exception 'Already an active member' using errcode='PT409'; end if;
 update public.kb_invitations set state='Revoked' where org_id=p_org and email=p_email and state='Pending';
 if (select count(*) from public.kb_invitations where org_id=p_org and state='Pending' and expires_at>now())>=50 then raise exception 'Pending invitation limit' using errcode='P0001'; end if;
 insert into public.kb_invitations(org_id,email,role,token_hash,created_by) values(p_org,p_email,p_role,p_hash,p_user) returning * into invitation;
 insert into public.kb_audit_events(org_id,actor_id,action,target_id) values(p_org,p_user,'invitation.created',invitation.id);
 return jsonb_build_object('id',invitation.id,'expires_at',invitation.expires_at);
end $$;

create function public.kb_invite_revoke(p_org uuid,p_user uuid,p_id uuid) returns void language plpgsql security invoker set search_path='' as $$
begin
 perform public.kb_require(p_org,p_user,array['owner']);perform pg_advisory_xact_lock(hashtextextended('kb-org:'||p_org::text,0));perform public.kb_charge(p_org,p_user,'team');
 update public.kb_invitations set state='Revoked' where id=p_id and org_id=p_org and state='Pending';
 if not found then raise exception 'Pending invitation not found' using errcode='P0002'; end if;
 insert into public.kb_audit_events(org_id,actor_id,action,target_id) values(p_org,p_user,'invitation.revoked',p_id);
end $$;

create function public.kb_invite_access(p_user uuid,p_hash text,p_accept boolean default false) returns jsonb language plpgsql security definer set search_path='' as $$
declare invitation public.kb_invitations; email text; orgname text;
begin
 if p_hash is null or p_hash !~ '^[a-f0-9]{64}$' or p_accept is null then raise exception 'Invalid invitation' using errcode='22023'; end if;
 select * into invitation from public.kb_invitations where token_hash=p_hash;
 if not found then raise exception 'Invitation unavailable' using errcode='P0002'; end if;
 perform pg_advisory_xact_lock(hashtextextended('kb-org:'||invitation.org_id::text,0));
 select * into invitation from public.kb_invitations where token_hash=p_hash for update;
 select lower(u.email) into email from auth.users u where u.id=p_user and u.email_confirmed_at is not null;
 if email is null or email<>invitation.email then raise exception 'Invitation belongs to another verified email' using errcode='42501'; end if;
 if invitation.state='Accepted' and invitation.accepted_by=p_user and exists(select 1 from public.kb_memberships where org_id=invitation.org_id and user_id=p_user and active) then
  return jsonb_build_object('org_id',invitation.org_id,'name',(select name from public.kb_organizations where id=invitation.org_id),'role',(select role from public.kb_memberships where org_id=invitation.org_id and user_id=p_user),'accepted',true);
 end if;
 if invitation.state<>'Pending' or invitation.expires_at<=now() then raise exception 'Invitation unavailable' using errcode='P0002'; end if;
 select name into orgname from public.kb_organizations where id=invitation.org_id;
 if p_accept then
  -- Never overwrite the role of an already active member, or alter the owner.
  insert into public.kb_memberships(org_id,user_id,role,active) values(invitation.org_id,p_user,invitation.role,true)
   on conflict(org_id,user_id) do update set role=excluded.role,active=true where not public.kb_memberships.active and public.kb_memberships.role<>'owner';
  update public.kb_invitations set state='Accepted',accepted_by=p_user,accepted_at=now() where id=invitation.id;
  insert into public.kb_audit_events(org_id,actor_id,action,target_id) values(invitation.org_id,p_user,'invitation.accepted',invitation.id);
 end if;
 return jsonb_build_object('org_id',invitation.org_id,'name',orgname,'role',case when p_accept then (select role from public.kb_memberships where org_id=invitation.org_id and user_id=p_user) else invitation.role end,'expires_at',invitation.expires_at,'accepted',p_accept);
end $$;

-- The three Auth-email readers are security definer with an empty search_path:
-- they validate the explicit actor/organization before reading only relevant emails.
-- This avoids granting service_role direct SELECT on auth.users.
-- New endpoints are callable only through verified server-side actors.
do $$ declare f record; begin
 for f in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('kb_discovery_admit','kb_overview','kb_browse','kb_find','kb_search_filtered','kb_team','kb_member_update','kb_invite_create','kb_invite_revoke','kb_invite_access') loop
  execute format('revoke all on function %s from public,anon,authenticated',f.signature);
  execute format('grant execute on function %s to service_role',f.signature);
 end loop;
end $$;
commit;
