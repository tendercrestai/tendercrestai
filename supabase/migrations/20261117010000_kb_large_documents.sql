-- Raise the knowledge-base chunk bound so long source documents can finish
-- processing. The JavaScript cap in kb.citationChunks and the extraction cap
-- in the knowledge worker were raised to 500 chunks / 700,000 characters in
-- the same change; this migration raises the matching database bound from 80
-- to 500. Without it, kb_finish_job rejects any document over 80 chunks
-- with 'Invalid extraction' even after the code deploys.
-- Apply manually in the Supabase dashboard SQL Editor on production.
create or replace function public.kb_finish_job(p_job uuid,p_lease uuid,p_chunks jsonb,p_warnings jsonb) returns boolean language plpgsql security invoker set search_path='' as $$
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
 if jsonb_typeof(p_chunks)<>'array' or jsonb_array_length(p_chunks) not between 1 and 500 or jsonb_typeof(p_warnings)<>'array' or jsonb_array_length(p_warnings)>30 then raise exception 'Invalid extraction' using errcode='22023'; end if;
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
