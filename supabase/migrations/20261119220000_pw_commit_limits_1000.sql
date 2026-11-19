-- pw_commit requirement/section limits 500 -> 1000 (Nov 19, 2026): the
-- JavaScript share ceiling rose to 1000 (AMENDMENT_MAX_REQUIREMENTS), but
-- pw_commit still rejected any workspace with more than 500 requirements
-- or sections with 22023 'Invalid workspace', which the API surfaces as
-- 400 'Invalid analysis request or changed source review.' The share flow
-- (S.commit with operation 'import') builds one section per requirement,
-- so both bounds must rise together. This migration redefines pw_commit
-- with the same signature, body and 24-operation allowlist; only the two
-- bounds change. Apply in the Supabase dashboard SQL Editor; the code
-- change ships with it, but a share above 500 requirements fails until
-- this migration is applied.
create or replace function public.pw_commit(p_project uuid,p_user uuid,p_revision integer,p_epoch integer,p_state jsonb,p_operation text,p_details jsonb default '{}') returns public.pw_projects language plpgsql security invoker set search_path='' as $$
declare p public.pw_projects;s jsonb;a public.kb_answers;v jsonb;targets jsonb:='[]';notice_key text;notice_kind text;
begin
 p:=public.pw_require(p_project,p_user,array['manager','author','reviewer']);
 perform pg_advisory_xact_lock(hashtextextended('pw:'||p_project::text,0));
 select * into p from public.pw_projects where id=p_project for update;
 if p.revision is distinct from p_revision or p.evidence_epoch is distinct from p_epoch then raise exception 'Project changed; reload' using errcode='PT409';end if;
 if p_operation not in ('import','amendment','amendment.proposed','amendment.confirmed','amendment.corrected','amendment.rejected','evidence.suggested','evidence.reviewed','facts.updated','section.saved','draft.accepted','review.requested','review.changes','review.approved','project.approved','comment.added','assignment.updated','bid.assessed','bid.decided','settings.updated','readiness.updated','readiness.manual-added','readiness.corrected','readiness.manual-removed') then raise exception 'Invalid operation' using errcode='22023';end if;
 if p_operation in ('evidence.reviewed','facts.updated','review.changes','review.approved','project.approved') then
  perform public.pw_require(p_project,p_user,array['manager','reviewer']);perform public.kb_require(p.org_id,p_user,array['owner','reviewer']);
 end if;
 if p_state->>'schema' is distinct from '1' or jsonb_typeof(p_state->'requirements')<>'array' or jsonb_typeof(p_state->'sections')<>'array' or jsonb_array_length(p_state->'requirements')>1000 or jsonb_array_length(p_state->'sections')>1000 then raise exception 'Invalid workspace' using errcode='22023';end if;
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
