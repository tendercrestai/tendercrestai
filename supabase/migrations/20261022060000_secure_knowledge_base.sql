-- Feature 1 only. Review/apply to a disposable database before approved rollout.
begin;
create schema if not exists extensions;
create extension if not exists vector with schema extensions;
grant usage on schema extensions to service_role;
do $$ begin
 if not exists(select 1 from pg_extension e join pg_namespace n on n.oid=e.extnamespace where e.extname='vector' and n.nspname='extensions') then
  raise exception 'vector must be installed in extensions; review existing extension location';
 end if;
end $$;

create table public.kb_organizations (
 id uuid primary key default gen_random_uuid(), name text not null check(length(btrim(name)) between 1 and 200),
 created_by uuid not null unique references auth.users(id), created_at timestamptz not null default now()
);
create table public.kb_memberships (
 org_id uuid not null references public.kb_organizations(id), user_id uuid not null references auth.users(id),
 role text not null check(role in ('owner','reviewer','editor','viewer')), active boolean not null default true,
 primary key(org_id,user_id)
);
-- Authenticated policy helper checks only the current JWT subject. No arbitrary-user probe.
create function public.kb_role(p_org uuid) returns text language sql stable security definer set search_path='' as $$
 select role from public.kb_memberships where org_id=p_org and user_id=(select auth.uid()) and active
$$;
revoke all on function public.kb_role(uuid) from public,anon;
grant execute on function public.kb_role(uuid) to anon,authenticated,service_role;

create table public.kb_documents (
 id uuid primary key default gen_random_uuid(), org_id uuid not null references public.kb_organizations(id),
 uploaded_by uuid not null references auth.users(id), file_name text not null check(length(file_name) between 1 and 200),
 extension text not null check(extension in ('pdf','docx','txt')), mime_type text not null,
 size_bytes integer not null check(size_bytes between 1 and 10485760), sha256 text not null check(sha256 ~ '^[a-f0-9]{64}$'),
 storage_path text not null unique, status text not null default 'Uploaded' check(status in ('Uploaded','Processing','Ready','Failed','Archived')),
 warnings jsonb not null default '[]' check(jsonb_typeof(warnings)='array'), error_code text,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(id,org_id), unique(org_id,sha256),
 check(storage_path=org_id::text||'/'||id::text||'/source.'||extension),
 check(mime_type=case extension when 'pdf' then 'application/pdf' when 'docx' then 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' else 'text/plain' end)
);
create table public.kb_chunks (
 id uuid primary key default gen_random_uuid(), org_id uuid not null, document_id uuid not null,
 ordinal integer not null check(ordinal between 0 and 79), content text not null check(length(btrim(content)) between 1 and 1500),
 page integer check(page>0), section text check(length(section)<=300), segment_id text not null check(length(segment_id)<=100),
 start_offset integer not null check(start_offset>=0), embedding extensions.vector(1536) not null,
 foreign key(document_id,org_id) references public.kb_documents(id,org_id), unique(document_id,ordinal), unique(id,org_id)
);
create index kb_chunks_org_document on public.kb_chunks(org_id,document_id);
create index kb_chunks_embedding on public.kb_chunks using hnsw(embedding extensions.vector_cosine_ops);
create table public.kb_jobs (
 id uuid primary key default gen_random_uuid(), org_id uuid not null, document_id uuid not null unique,
 requested_by uuid not null references auth.users(id), consented_at timestamptz not null default now(),
 status text not null default 'Pending' check(status in ('Pending','Processing','Completed','Failed','Cancelled')),
 attempts integer not null default 0 check(attempts between 0 and 3), lease_token uuid, lease_until timestamptz, error_code text,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 foreign key(document_id,org_id) references public.kb_documents(id,org_id)
);
create table public.kb_answers (
 id uuid primary key default gen_random_uuid(), org_id uuid not null references public.kb_organizations(id),
 question text not null check(length(btrim(question)) between 1 and 1000), answer text not null check(length(btrim(answer)) between 1 and 12000),
 revision integer not null default 0, approved_revision integer, approved_by uuid references auth.users(id), approved_at timestamptz,
 updated_by uuid not null references auth.users(id), updated_at timestamptz not null default now(), unique(id,org_id),
 check((approved_revision is null and approved_by is null and approved_at is null) or (approved_revision=revision and approved_by is not null and approved_at is not null))
);
create table public.kb_answer_citations (
 answer_id uuid not null, chunk_id uuid not null, org_id uuid not null,
 primary key(answer_id,chunk_id), foreign key(answer_id,org_id) references public.kb_answers(id,org_id),
 foreign key(chunk_id,org_id) references public.kb_chunks(id,org_id)
);
create table public.kb_audit_events (
 id bigint generated always as identity primary key, org_id uuid not null references public.kb_organizations(id),
 actor_id uuid references auth.users(id), action text not null, target_id uuid, revision integer,
 created_at timestamptz not null default now()
);
create table public.kb_usage (
 scope text not null, action text not null, window_start timestamptz not null, used integer not null check(used>0),
 primary key(scope,action,window_start)
);
-- No direct client writes. Read policies always consult live membership.
alter table public.kb_organizations enable row level security;
alter table public.kb_memberships enable row level security;
alter table public.kb_documents enable row level security;
alter table public.kb_chunks enable row level security;
alter table public.kb_jobs enable row level security;
alter table public.kb_answers enable row level security;
alter table public.kb_answer_citations enable row level security;
alter table public.kb_audit_events enable row level security;
alter table public.kb_usage enable row level security;
revoke all on public.kb_organizations,public.kb_memberships,public.kb_documents,public.kb_chunks,public.kb_jobs,public.kb_answers,public.kb_answer_citations,public.kb_audit_events,public.kb_usage from public,anon,authenticated;
grant select on public.kb_organizations,public.kb_memberships,public.kb_documents,public.kb_chunks,public.kb_jobs,public.kb_answers,public.kb_answer_citations,public.kb_audit_events to authenticated;
grant all on public.kb_organizations,public.kb_memberships,public.kb_documents,public.kb_chunks,public.kb_jobs,public.kb_answers,public.kb_answer_citations,public.kb_audit_events,public.kb_usage to service_role;
grant usage,select on sequence public.kb_audit_events_id_seq to service_role;
create policy kb_org_read on public.kb_organizations for select to authenticated using(public.kb_role(id) is not null);
create policy kb_members_read on public.kb_memberships for select to authenticated using(public.kb_role(org_id) is not null);
create policy kb_docs_read on public.kb_documents for select to authenticated using(public.kb_role(org_id) is not null);
create policy kb_chunks_read on public.kb_chunks for select to authenticated using(public.kb_role(org_id) is not null);
create policy kb_jobs_read on public.kb_jobs for select to authenticated using(public.kb_role(org_id) is not null);
create policy kb_answers_read on public.kb_answers for select to authenticated using(public.kb_role(org_id) is not null);
create policy kb_citations_read on public.kb_answer_citations for select to authenticated using(public.kb_role(org_id) is not null);
create policy kb_audit_read on public.kb_audit_events for select to authenticated using(public.kb_role(org_id) in ('owner','reviewer'));

-- Security-definer boolean helpers prevent Storage policies from requiring
-- anonymous SELECT grants on the private metadata table. The subject is always
-- auth.uid(), never an argument controlled by a caller.
create function public.kb_storage_readable(p_path text) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.kb_documents d join public.kb_memberships m on m.org_id=d.org_id
  where d.storage_path=p_path and d.status<>'Archived' and m.user_id=(select auth.uid()) and m.active)
$$;
create function public.kb_storage_writable(p_path text) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.kb_documents d join public.kb_memberships m on m.org_id=d.org_id
  where d.storage_path=p_path and d.status='Uploaded' and d.uploaded_by=(select auth.uid())
  and m.user_id=(select auth.uid()) and m.active and m.role in ('owner','editor'))
$$;
revoke all on function public.kb_storage_readable(text),public.kb_storage_writable(text) from public;
grant execute on function public.kb_storage_readable(text),public.kb_storage_writable(text) to anon,authenticated,service_role;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values
 ('kb-documents','kb-documents',false,10485760,array['application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document','text/plain']);
create policy kb_storage_read on storage.objects for select to authenticated using (
 bucket_id='kb-documents' and public.kb_storage_readable(objects.name)
);
create policy kb_storage_insert on storage.objects for insert to authenticated with check (
 bucket_id='kb-documents' and public.kb_storage_writable(objects.name)
);
-- Restrictive policies AND with every permissive policy, including unrelated
-- broad policies already present. Other buckets evaluate true and are unchanged.
create policy kb_storage_read_boundary on storage.objects as restrictive for select to public using (
 bucket_id<>'kb-documents' or public.kb_storage_readable(objects.name)
);
create policy kb_storage_insert_boundary on storage.objects as restrictive for insert to public with check (
 bucket_id<>'kb-documents' or public.kb_storage_writable(objects.name)
);
create policy kb_storage_no_update on storage.objects as restrictive for update to public using(bucket_id<>'kb-documents') with check(bucket_id<>'kb-documents');
create policy kb_storage_no_delete on storage.objects as restrictive for delete to public using(bucket_id<>'kb-documents');

create function public.kb_require(p_org uuid,p_user uuid,p_roles text[]) returns text language plpgsql security invoker set search_path='' as $$
declare r text;
begin
 select role into r from public.kb_memberships where org_id=p_org and user_id=p_user and active;
 if r is null or not(r=any(p_roles)) then raise exception 'Organization access denied' using errcode='42501'; end if;
 return r;
end $$;
create function public.kb_charge(p_org uuid,p_user uuid,p_action text) returns void language plpgsql security invoker set search_path='' as $$
declare org_limit integer; global_limit integer; minute_limit integer; n integer; k text; lim integer; w timestamptz;
begin
 org_limit:=case p_action when 'ingest' then 20 when 'search' then 100 when 'register' then 50 else 200 end;
 global_limit:=case p_action when 'ingest' then 100 when 'search' then 2000 else 5000 end;
 minute_limit:=case p_action when 'search' then 10 else 30 end;
 for k,lim,w in select 'org:'||p_org::text,org_limit,date_trunc('day',now() at time zone 'UTC') at time zone 'UTC'
  union all select 'global',global_limit,date_trunc('day',now() at time zone 'UTC') at time zone 'UTC'
  union all select 'user:'||p_user::text,minute_limit,date_trunc('minute',now()) loop
  insert into public.kb_usage(scope,action,window_start,used) values(k,p_action,w,1)
   on conflict(scope,action,window_start) do update set used=public.kb_usage.used+1 where public.kb_usage.used<lim returning used into n;
  if n is null then raise exception 'Knowledge usage limit reached' using errcode='P0001'; end if;
 end loop;
end $$;
create function public.kb_bootstrap(p_user uuid,p_name text) returns uuid language plpgsql security invoker set search_path='' as $$
declare org uuid;
begin
 if length(btrim(p_name)) not between 1 and 200 then raise exception 'Invalid name' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(hashtextextended('kb-owner:'||p_user::text,0));
 select id into org from public.kb_organizations where created_by=p_user;
 if org is not null then return org; end if;
 insert into public.kb_organizations(name,created_by) values(p_name,p_user) returning id into org;
 insert into public.kb_memberships values(org,p_user,'owner',true);
 insert into public.kb_audit_events(org_id,actor_id,action,target_id) values(org,p_user,'organization.created',org);
 return org;
end $$;
create function public.kb_register(p_org uuid,p_user uuid,p_name text,p_extension text,p_mime text,p_size integer,p_hash text) returns jsonb language plpgsql security invoker set search_path='' as $$
declare d public.kb_documents; newid uuid:=gen_random_uuid();
begin
 perform public.kb_require(p_org,p_user,array['owner','editor']); perform public.kb_charge(p_org,p_user,'register');
 insert into public.kb_documents(id,org_id,uploaded_by,file_name,extension,mime_type,size_bytes,sha256,storage_path)
 values(newid,p_org,p_user,p_name,p_extension,p_mime,p_size,p_hash,p_org::text||'/'||newid::text||'/source.'||p_extension)
 on conflict(org_id,sha256) do nothing;
 select * into d from public.kb_documents where org_id=p_org and sha256=p_hash;
 if d.status='Archived' then raise exception 'Source archived' using errcode='40001'; end if;
 if d.size_bytes<>p_size or d.extension<>p_extension or d.mime_type<>p_mime then raise exception 'Source metadata conflict' using errcode='40001'; end if;
 insert into public.kb_audit_events(org_id,actor_id,action,target_id) values(p_org,p_user,'document.registered',d.id);
 return to_jsonb(d);
end $$;
create function public.kb_enqueue(p_org uuid,p_user uuid,p_document uuid) returns jsonb language plpgsql security invoker set search_path='' as $$
declare d public.kb_documents; j public.kb_jobs;
begin
 perform public.kb_require(p_org,p_user,array['owner','editor']);
 perform pg_advisory_xact_lock(hashtextextended('kb-org:'||p_org::text,0));
 select * into d from public.kb_documents where id=p_document and org_id=p_org for update;
 if not found or d.status='Archived' then raise exception 'Document unavailable' using errcode='P0002'; end if;
 if d.status='Ready' then return jsonb_build_object('done',true); end if;
 perform public.kb_charge(p_org,p_user,'enqueue');
 insert into public.kb_jobs(org_id,document_id,requested_by) values(p_org,p_document,p_user) on conflict(document_id) do nothing;
 update public.kb_jobs set requested_by=p_user,consented_at=now() where document_id=p_document and (status in ('Pending','Failed') or (status='Processing' and lease_until<=now()));
 select * into j from public.kb_jobs where document_id=p_document;
 if j.attempts>=3 then raise exception 'Retry limit reached' using errcode='P0001'; end if;
 return jsonb_build_object('job_id',j.id,'done',false);
end $$;
create function public.kb_claim_job(p_job uuid,p_lease uuid) returns jsonb language plpgsql security invoker set search_path='' as $$
declare j public.kb_jobs; d public.kb_documents;
begin
 select * into j from public.kb_jobs where id=p_job;
 if not found then return null; end if;
 perform pg_advisory_xact_lock(hashtextextended('kb-org:'||j.org_id::text,0));
 select * into j from public.kb_jobs where id=p_job for update;
 if not found or j.status in ('Completed','Cancelled') or j.attempts>=3 or (j.status='Processing' and j.lease_until>now()) then return null; end if;
 perform public.kb_require(j.org_id,j.requested_by,array['owner','editor']);
 select * into d from public.kb_documents where id=j.document_id for update;
 if d.status='Archived' then return null; end if;
 perform public.kb_charge(j.org_id,j.requested_by,'ingest');
 update public.kb_jobs set status='Processing',attempts=attempts+1,lease_token=p_lease,lease_until=now()+interval '10 minutes',updated_at=now() where id=p_job;
 update public.kb_documents set status='Processing',error_code=null,updated_at=now() where id=d.id;
 insert into public.kb_audit_events(org_id,actor_id,action,target_id) values(j.org_id,j.requested_by,'document.processing',d.id);
 return to_jsonb(d);
end $$;
create function public.kb_finish_job(p_job uuid,p_lease uuid,p_chunks jsonb,p_warnings jsonb) returns boolean language plpgsql security invoker set search_path='' as $$
declare j public.kb_jobs; d public.kb_documents; c jsonb; n integer:=0;
begin
 select * into j from public.kb_jobs where id=p_job;
 if not found then return false; end if;
 perform pg_advisory_xact_lock(hashtextextended('kb-org:'||j.org_id::text,0));
 select * into j from public.kb_jobs where id=p_job for update;
 if not found or j.status<>'Processing' or j.lease_token is distinct from p_lease or j.lease_until<=now() then return false; end if;
 perform public.kb_require(j.org_id,j.requested_by,array['owner','editor']);
 select * into d from public.kb_documents where id=j.document_id for update;
 if d.status<>'Processing' then return false; end if;
 if jsonb_typeof(p_chunks)<>'array' or jsonb_array_length(p_chunks) not between 1 and 80 or jsonb_typeof(p_warnings)<>'array' or jsonb_array_length(p_warnings)>30 then raise exception 'Invalid extraction' using errcode='22023'; end if;
 delete from public.kb_chunks where document_id=d.id;
 for c in select value from jsonb_array_elements(p_chunks) loop
  if jsonb_typeof(c->'embedding')<>'array' or jsonb_array_length(c->'embedding')<>1536 then raise exception 'Invalid vector' using errcode='22023'; end if;
  insert into public.kb_chunks(org_id,document_id,ordinal,content,page,section,segment_id,start_offset,embedding)
   values(j.org_id,d.id,n,c->>'content',(c->>'page')::integer,c->>'section',c->>'segment_id',(c->>'start_offset')::integer,(c->'embedding')::text::extensions.vector);
  n:=n+1;
 end loop;
 update public.kb_documents set status='Ready',warnings=p_warnings,error_code=null,updated_at=now() where id=d.id;
 update public.kb_jobs set status='Completed',lease_token=null,lease_until=null,error_code=null,updated_at=now() where id=p_job;
 insert into public.kb_audit_events(org_id,actor_id,action,target_id) values(j.org_id,j.requested_by,'document.ready',d.id);
 return true;
end $$;
create function public.kb_fail_job(p_job uuid,p_lease uuid,p_error text) returns boolean language plpgsql security invoker set search_path='' as $$
declare j public.kb_jobs;
begin
 if p_error not in ('source_invalid','extraction_failed','embedding_failed') then raise exception 'Invalid error' using errcode='22023'; end if;
 select * into j from public.kb_jobs where id=p_job;
 if not found then return false; end if;
 perform pg_advisory_xact_lock(hashtextextended('kb-org:'||j.org_id::text,0));
 select * into j from public.kb_jobs where id=p_job for update;
 if not found or j.status<>'Processing' or j.lease_token is distinct from p_lease or j.lease_until<=now() then return false; end if;
 update public.kb_jobs set status='Failed',error_code=p_error,lease_token=null,lease_until=null,updated_at=now() where id=p_job;
 update public.kb_documents set status='Failed',error_code=p_error,updated_at=now() where id=j.document_id and status='Processing';
 insert into public.kb_audit_events(org_id,actor_id,action,target_id) values(j.org_id,j.requested_by,'document.failed',j.document_id);
 return true;
end $$;
create function public.kb_search_admit(p_org uuid,p_user uuid) returns void language plpgsql security invoker set search_path='' as $$
begin perform public.kb_require(p_org,p_user,array['owner','reviewer','editor','viewer']); perform public.kb_charge(p_org,p_user,'search'); end $$;
create function public.kb_search(p_org uuid,p_user uuid,p_embedding extensions.vector(1536)) returns jsonb language plpgsql security invoker set search_path='' as $$
declare hits jsonb; answers jsonb;
begin
 perform public.kb_require(p_org,p_user,array['owner','reviewer','editor','viewer']);
 select coalesce(jsonb_agg(to_jsonb(t)),'[]') into hits from (
  select c.id,c.document_id,c.content,c.page,c.section,c.segment_id,c.start_offset,d.file_name,1-(c.embedding OPERATOR(extensions.<=>) p_embedding) as score
  from public.kb_chunks c join public.kb_documents d on d.id=c.document_id and d.org_id=c.org_id
  where c.org_id=p_org and d.status='Ready' and (c.embedding OPERATOR(extensions.<=>) p_embedding)<0.8
  order by c.embedding OPERATOR(extensions.<=>) p_embedding,c.id limit 10
 ) t;
 select coalesce(jsonb_agg(to_jsonb(a)),'[]') into answers from (
  select ans.id,ans.question,ans.answer,ans.revision,ans.approved_by,ans.approved_at,
   (select jsonb_agg(jsonb_build_object('chunk_id',c.id,'document_id',c.document_id,'quote',c.content,'page',c.page,'section',c.section,'file_name',d.file_name))
    from public.kb_answer_citations ac join public.kb_chunks c on c.id=ac.chunk_id join public.kb_documents d on d.id=c.document_id where ac.answer_id=ans.id) as citations
  from public.kb_answers ans where ans.org_id=p_org and ans.approved_revision=ans.revision
   and exists(select 1 from public.kb_answer_citations ac where ac.answer_id=ans.id and ac.chunk_id in (select (x->>'id')::uuid from jsonb_array_elements(hits) x))
   and not exists(select 1 from public.kb_answer_citations ac join public.kb_chunks c on c.id=ac.chunk_id join public.kb_documents d on d.id=c.document_id where ac.answer_id=ans.id and d.status<>'Ready')
  order by ans.updated_at desc,ans.id limit 10
 ) a;
 insert into public.kb_audit_events(org_id,actor_id,action) values(p_org,p_user,'knowledge.searched');
 return jsonb_build_object('chunks',hits,'answers',answers);
end $$;
create function public.kb_save_answer(p_org uuid,p_user uuid,p_id uuid,p_revision integer,p_question text,p_answer text,p_chunks uuid[]) returns jsonb language plpgsql security invoker set search_path='' as $$
declare a public.kb_answers; n integer;
begin
 perform public.kb_require(p_org,p_user,array['owner','editor','reviewer']); perform pg_advisory_xact_lock(hashtextextended('kb-org:'||p_org::text,0));
 perform public.kb_charge(p_org,p_user,'answer');
 if coalesce(array_length(p_chunks,1),0) not between 1 and 10 then raise exception 'Citations required' using errcode='22023'; end if;
 select count(*) into n from public.kb_chunks c join public.kb_documents d on d.id=c.document_id where c.id=any(p_chunks) and c.org_id=p_org and d.status='Ready';
 if n<>array_length(p_chunks,1) then raise exception 'Invalid citations' using errcode='22023'; end if;
 -- Serialize source archival against answer approval/edit and retrieval visibility.
 perform 1 from public.kb_documents where id in (select document_id from public.kb_chunks where id=any(p_chunks)) order by id for share;
 if p_id is null then
  insert into public.kb_answers(org_id,question,answer,updated_by) values(p_org,p_question,p_answer,p_user) returning * into a;
 else
  select * into a from public.kb_answers where id=p_id and org_id=p_org for update;
  if not found then raise exception 'Answer not found' using errcode='P0002'; end if;
  if a.revision<>p_revision then raise exception 'Answer changed' using errcode='40001'; end if;
  update public.kb_answers set question=p_question,answer=p_answer,revision=revision+1,approved_revision=null,approved_by=null,approved_at=null,updated_by=p_user,updated_at=now() where id=a.id returning * into a;
  delete from public.kb_answer_citations where answer_id=a.id;
 end if;
 insert into public.kb_answer_citations(answer_id,chunk_id,org_id) select a.id,x,p_org from unnest(p_chunks) x;
 insert into public.kb_audit_events(org_id,actor_id,action,target_id,revision) values(p_org,p_user,'answer.saved',a.id,a.revision);
 return to_jsonb(a);
end $$;
create function public.kb_approve_answer(p_org uuid,p_user uuid,p_id uuid,p_revision integer) returns jsonb language plpgsql security invoker set search_path='' as $$
declare a public.kb_answers;
begin
 perform public.kb_require(p_org,p_user,array['owner','reviewer']); perform pg_advisory_xact_lock(hashtextextended('kb-org:'||p_org::text,0));
 perform public.kb_charge(p_org,p_user,'approval');
 select * into a from public.kb_answers where id=p_id and org_id=p_org for update;
 if not found then raise exception 'Answer not found' using errcode='P0002'; end if;
 if a.revision<>p_revision then raise exception 'Answer changed' using errcode='40001'; end if;
 if not exists(select 1 from public.kb_answer_citations where answer_id=a.id) or exists(select 1 from public.kb_answer_citations ac join public.kb_chunks c on c.id=ac.chunk_id join public.kb_documents d on d.id=c.document_id where ac.answer_id=a.id and d.status<>'Ready') then raise exception 'Source unavailable' using errcode='22023'; end if;
 update public.kb_answers set approved_revision=revision,approved_by=p_user,approved_at=now() where id=a.id returning * into a;
 insert into public.kb_audit_events(org_id,actor_id,action,target_id,revision) values(p_org,p_user,'answer.approved',a.id,a.revision);
 return to_jsonb(a);
end $$;
create function public.kb_archive(p_org uuid,p_user uuid,p_document uuid) returns void language plpgsql security invoker set search_path='' as $$
begin
 perform public.kb_require(p_org,p_user,array['owner','editor']); perform pg_advisory_xact_lock(hashtextextended('kb-org:'||p_org::text,0));
 perform public.kb_charge(p_org,p_user,'archive');
 perform 1 from public.kb_jobs where document_id=p_document for update;
 update public.kb_documents set status='Archived',updated_at=now() where id=p_document and org_id=p_org;
 if not found then raise exception 'Document not found' using errcode='P0002'; end if;
 update public.kb_jobs set status='Cancelled',lease_token=null,lease_until=null,updated_at=now() where document_id=p_document;
 update public.kb_answers set approved_revision=null,approved_by=null,approved_at=null where id in (select ac.answer_id from public.kb_answer_citations ac join public.kb_chunks c on c.id=ac.chunk_id where c.document_id=p_document);
 insert into public.kb_audit_events(org_id,actor_id,action,target_id) values(p_org,p_user,'document.archived',p_document);
end $$;
-- Every mutation, budget and vector-query RPC is service-only. JWT roles cannot
-- pass another actor ID. The API supplies actor IDs only after real Auth verification.
do $$ declare f record; begin
 for f in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'kb_%' and p.proname not in ('kb_role','kb_storage_readable','kb_storage_writable') loop
  execute format('revoke all on function %s from public,anon,authenticated',f.signature);
  execute format('grant execute on function %s to service_role',f.signature);
 end loop;
end $$;
commit;
