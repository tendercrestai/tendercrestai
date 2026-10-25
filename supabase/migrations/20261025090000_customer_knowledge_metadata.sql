-- Additive metadata on existing sources; apply only after review. Never to production automatically.
begin;
alter table public.kb_documents add column metadata jsonb not null default '{}' check(jsonb_typeof(metadata)='object' and octet_length(metadata::text)<=8000);
create function public.kb_metadata_save(p_org uuid,p_user uuid,p_document uuid,p_revision integer,p_metadata jsonb) returns void language plpgsql security invoker set search_path='' as $$
declare d public.kb_documents;v text;
begin
 perform public.kb_require(p_org,p_user,array['owner','reviewer','editor']);perform public.kb_discovery_admit(p_org,p_user);
 if p_metadata->>'status'='approved' then perform public.kb_require(p_org,p_user,array['owner','reviewer']);end if;
 select * into d from public.kb_documents where id=p_document and org_id=p_org for update;
 if not found then raise exception 'Source unavailable' using errcode='P0002';end if;
 if coalesce((d.metadata->>'revision')::integer,0)<>p_revision then raise exception 'Source metadata changed' using errcode='PT409';end if;
 if jsonb_typeof(p_metadata)<>'object' or not (p_metadata ?& array['type','status','reviewedAt','expiresAt','tags','owner']) or (select count(*) from jsonb_object_keys(p_metadata))<>6 or p_metadata->>'status' not in ('draft','approved','archived','expired') or p_metadata->>'type' not in ('company-profile','capability','certification','case-study','proposal','service','biography','policy','pricing','template','other') or jsonb_typeof(p_metadata->'tags')<>'array' or jsonb_array_length(p_metadata->'tags')>10 then raise exception 'Invalid metadata' using errcode='22023';end if;
 if exists(select 1 from jsonb_array_elements(p_metadata->'tags') t where jsonb_typeof(t)<>'string' or length(t#>>'{}')>50) then raise exception 'Invalid tags' using errcode='22023';end if;
 foreach v in array array['reviewedAt','expiresAt'] loop
  if nullif(p_metadata->>v,'') is not null and (p_metadata->>v !~ '^\d{4}-\d{2}-\d{2}$' or to_char((p_metadata->>v)::date,'YYYY-MM-DD')<>p_metadata->>v) then raise exception 'Invalid date' using errcode='22023';end if;
 end loop;
 if p_metadata->>'status'='approved' and (nullif(p_metadata->>'reviewedAt','') is null or (p_metadata->>'reviewedAt')::date>current_date or nullif(p_metadata->>'expiresAt','')::date<current_date) then raise exception 'Approval needs current review and nonexpired evidence' using errcode='22023';end if;
 if p_metadata->>'owner' is not null then perform public.kb_require(p_org,(p_metadata->>'owner')::uuid,array['owner','reviewer','editor','viewer']);end if;
 update public.kb_documents set metadata=p_metadata||jsonb_build_object('revision',p_revision+1,'updatedBy',p_user,'updatedAt',now()),updated_at=now() where id=p_document;
 insert into public.kb_audit_events(org_id,actor_id,action,target_id,revision) values(p_org,p_user,'document.metadata',p_document,p_revision+1);
 -- Conservative organization-wide invalidation, including attachments and prior exported states.
 update public.pw_projects set evidence_epoch=evidence_epoch+1,updated_at=now() where org_id=p_org and archived_at is null;
end $$;
revoke all on function public.kb_metadata_save(uuid,uuid,uuid,integer,jsonb) from public,anon,authenticated;
grant execute on function public.kb_metadata_save(uuid,uuid,uuid,integer,jsonb) to service_role;
create or replace function public.pw_candidates(p_project uuid,p_user uuid,p_query text) returns jsonb language plpgsql security invoker set search_path='' as $$
declare p public.pw_projects;result jsonb;
begin
 p:=public.pw_require(p_project,p_user);if length(p_query) not between 1 and 2000 then raise exception 'Invalid query' using errcode='22023';end if;
 perform public.kb_discovery_admit(p.org_id,p_user);
 select coalesce(jsonb_agg(to_jsonb(t)),'[]') into result from (
  select a.id as "answerId",a.question,a.answer as text,a.revision,
   (select jsonb_agg(jsonb_build_object('id',c.id,'documentId',d.id,'fileName',d.file_name,'page',c.page,'section',c.section,'quote',c.content,'sha256',d.sha256,'metadata',d.metadata) order by c.id)
    from public.kb_answer_citations ac join public.kb_chunks c on c.id=ac.chunk_id and c.org_id=ac.org_id join public.kb_documents d on d.id=c.document_id and d.org_id=c.org_id where ac.answer_id=a.id and ac.org_id=p.org_id) as citations,
   ts_rank(to_tsvector('english',a.question||' '||a.answer),websearch_to_tsquery('english',regexp_replace(p_query,'\s+',' OR ','g'))) as relevance
  from public.kb_answers a where a.org_id=p.org_id and a.approved_revision=a.revision
   and exists(select 1 from public.kb_answer_citations ac where ac.answer_id=a.id)
   and not exists(select 1 from public.kb_answer_citations ac join public.kb_chunks c on c.id=ac.chunk_id join public.kb_documents d on d.id=c.document_id where ac.answer_id=a.id and (d.status<>'Ready' or d.org_id<>p.org_id or (d.metadata<>'{}'::jsonb and (d.metadata->>'status'<>'approved' or nullif(d.metadata->>'expiresAt','')::date<current_date))))
   and to_tsvector('english',a.question||' '||a.answer)@@websearch_to_tsquery('english',regexp_replace(p_query,'\s+',' OR ','g'))
  order by relevance desc,a.updated_at desc,a.id limit 10
 ) t;return result;
end $$;


create function public.pw_reuse_section(p_project uuid,p_user uuid,p_revision integer,p_epoch integer,p_section uuid) returns jsonb language plpgsql security invoker set search_path='' as $$
declare p public.pw_projects;sec jsonb;ids uuid[];a jsonb;k text;state jsonb;
begin
 p:=public.pw_require(p_project,p_user,array['manager','reviewer']);perform public.kb_require(p.org_id,p_user,array['owner','reviewer']);
 perform pg_advisory_xact_lock(hashtextextended('pw:'||p_project::text,0));select * into p from public.pw_projects where id=p_project for update;
 if p.revision<>p_revision or p.evidence_epoch<>p_epoch then raise exception 'Project changed' using errcode='PT409';end if;
 select item into sec from jsonb_array_elements(p.state->'sections') x(item) where item->>'id'=p_section::text;
 if sec is null or sec->>'status'<>'approved' or coalesce((sec->>'unverified')::boolean,true) or sec->>'reviewedRevision' is distinct from sec->>'revision' or length(sec->>'text') not between 1 and 12000 then raise exception 'Current approved section required' using errcode='22023';end if;
 k:=p_section::text||':'||(sec->>'revision');
 if p.state->'reusedSections'->>k is not null then return jsonb_build_object('answerId',p.state->'reusedSections'->>k,'existing',true);end if;
 select array_agg(distinct (c->>'id')::uuid) into ids from jsonb_array_elements(p.state->'evidence') e cross join lateral jsonb_array_elements(e->'citations') c
 where (sec->'requirementIds') ? (e->>'requirementId') and e->>'decision'='accepted' and not coalesce((e->>'stale')::boolean,true) and not coalesce((e->>'expired')::boolean,false);
 a:=public.kb_save_answer(p.org_id,p_user,null,0,left(sec->>'title',1000),sec->>'text',ids);
 state:=jsonb_set(p.state,'{reusedSections}',coalesce(p.state->'reusedSections','{}')||jsonb_build_object(k,a->>'id'));
 perform public.pw_commit(p.id,p_user,p_revision,p_epoch,state,'section.saved',jsonb_build_object('enhancementAction','knowledge.reused','sectionId',p_section));
 return jsonb_build_object('answerId',a->>'id','existing',false);
end $$;
revoke all on function public.pw_reuse_section(uuid,uuid,integer,integer,uuid) from public,anon,authenticated;
grant execute on function public.pw_reuse_section(uuid,uuid,integer,integer,uuid) to service_role;
commit;
