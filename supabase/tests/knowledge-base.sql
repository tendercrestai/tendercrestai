-- DISPOSABLE DATABASE ONLY. Requires KB migration; all fixture changes roll back.
begin;
create function pg_temp.assert_true(ok boolean,label text) returns void language plpgsql as $$ begin if ok is distinct from true then raise exception 'FAIL: %',label; end if; raise notice 'PASS: %',label; end $$;
insert into auth.users(id,email) values
 ('10000000-0000-4000-8000-000000000001','kb-owner-a@example.invalid'),
 ('10000000-0000-4000-8000-000000000002','kb-owner-b@example.invalid'),
 ('10000000-0000-4000-8000-000000000003','kb-editor@example.invalid'),
 ('10000000-0000-4000-8000-000000000004','kb-viewer@example.invalid'),
 ('10000000-0000-4000-8000-000000000005','kb-reviewer@example.invalid');
set local role service_role;
select set_config('kb.org_a',public.kb_bootstrap('10000000-0000-4000-8000-000000000001','Organization A')::text,true);
select set_config('kb.org_b',public.kb_bootstrap('10000000-0000-4000-8000-000000000002','Organization B')::text,true);
insert into public.kb_memberships values
 (current_setting('kb.org_a')::uuid,'10000000-0000-4000-8000-000000000003','editor',true),
 (current_setting('kb.org_a')::uuid,'10000000-0000-4000-8000-000000000004','viewer',true),
 (current_setting('kb.org_a')::uuid,'10000000-0000-4000-8000-000000000005','reviewer',true);
select pg_temp.assert_true(public.kb_bootstrap('10000000-0000-4000-8000-000000000001','Duplicate')::text=current_setting('kb.org_a'),'bootstrap is idempotent');
select set_config('kb.doc_a',(public.kb_register(current_setting('kb.org_a')::uuid,'10000000-0000-4000-8000-000000000001','a.txt','txt','text/plain',40,repeat('a',64))->>'id'),true);
select set_config('kb.doc_b',(public.kb_register(current_setting('kb.org_b')::uuid,'10000000-0000-4000-8000-000000000002','b.txt','txt','text/plain',40,repeat('b',64))->>'id'),true);
select pg_temp.assert_true((public.kb_register(current_setting('kb.org_a')::uuid,'10000000-0000-4000-8000-000000000001','renamed.txt','txt','text/plain',40,repeat('a',64))->>'id')=current_setting('kb.doc_a'),'duplicate content reuses immutable metadata');
insert into storage.objects(bucket_id,name) select 'kb-documents',storage_path from public.kb_documents;
-- Preserve unrelated existing Storage behavior, including a deliberately broad policy.
reset role;
insert into storage.buckets(id,name,public) values('unrelated','unrelated',true);
insert into storage.objects(bucket_id,name) values('unrelated','public.txt');
set local role anon;
select pg_temp.assert_true(public.kb_role(current_setting('kb.org_a')::uuid) is null,'anonymous membership helper reveals no membership');
do $$ begin
 begin perform * from public.kb_documents; raise exception 'anon read allowed'; exception when insufficient_privilege then null; end;
 begin perform public.kb_bootstrap('10000000-0000-4000-8000-000000000001','Impersonate'); raise exception 'anon RPC allowed'; exception when insufficient_privilege then null; end;
 perform pg_temp.assert_true((select count(*) from storage.objects where bucket_id='kb-documents')=0,'restrictive policies block anonymous access despite broad existing policy');
 perform pg_temp.assert_true((select count(*) from storage.objects where bucket_id='unrelated')=1,'unrelated anonymous bucket behavior unchanged');
end $$;
set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',true);
select pg_temp.assert_true((select count(*) from public.kb_documents)=1,'document RLS isolates organizations');
select pg_temp.assert_true((select count(*) from public.kb_organizations)=1,'organization RLS isolates membership');
select pg_temp.assert_true((select count(*) from storage.objects where bucket_id='kb-documents')=1,'private storage isolates organizations even with broad policy');
do $$ declare n integer; begin
 begin update public.kb_documents set org_id=current_setting('kb.org_b')::uuid; raise exception 'metadata mutation allowed'; exception when insufficient_privilege then null; end;
 begin insert into public.kb_memberships values(current_setting('kb.org_b')::uuid,auth.uid(),'owner',true);raise exception 'self elevation allowed';exception when insufficient_privilege then null;end;
 begin perform public.kb_enqueue(current_setting('kb.org_a')::uuid,auth.uid(),current_setting('kb.doc_a')::uuid);raise exception 'client processing RPC allowed';exception when insufficient_privilege then null;end;
 update storage.objects set name='tampered' where bucket_id='kb-documents';get diagnostics n=row_count;perform pg_temp.assert_true(n=0,'original objects cannot be overwritten despite broad update policy');
 delete from storage.objects where bucket_id='kb-documents';get diagnostics n=row_count;perform pg_temp.assert_true(n=0,'original objects cannot be deleted despite broad delete policy');
 begin insert into storage.objects(bucket_id,name) values('kb-documents',current_setting('kb.org_b')||'/'||current_setting('kb.doc_b')||'/unregistered.txt');raise exception 'foreign upload allowed';exception when insufficient_privilege then null;end;
 insert into storage.objects(bucket_id,name) values('unrelated','still-writable.txt');perform pg_temp.assert_true(found,'unrelated authenticated uploads unchanged');
end $$;
set local role service_role;
select set_config('kb.job_a',(public.kb_enqueue(current_setting('kb.org_a')::uuid,'10000000-0000-4000-8000-000000000001',current_setting('kb.doc_a')::uuid)->>'job_id'),true);
select set_config('kb.job_b',(public.kb_enqueue(current_setting('kb.org_b')::uuid,'10000000-0000-4000-8000-000000000002',current_setting('kb.doc_b')::uuid)->>'job_id'),true);
select pg_temp.assert_true(public.kb_claim_job(current_setting('kb.job_a')::uuid,'30000000-0000-4000-8000-000000000001') is not null,'admitted job acquires lease');
select pg_temp.assert_true(public.kb_claim_job(current_setting('kb.job_a')::uuid,'30000000-0000-4000-8000-000000000002') is null,'concurrent duplicate dispatch has no lease');
select set_config('kb.vector',array_prepend(1::real,array_fill(0::real,array[1535]))::text,true);
select set_config('kb.chunks_a',jsonb_build_array(jsonb_build_object('content','Organization A verified security policy.','page',1,'section','Security','segment_id',current_setting('kb.doc_a')||':0','start_offset',0,'embedding',to_jsonb(current_setting('kb.vector')::real[])))::text,true);
select pg_temp.assert_true(not public.kb_finish_job(current_setting('kb.job_a')::uuid,'30000000-0000-4000-8000-000000000002',current_setting('kb.chunks_a')::jsonb,'[]'),'wrong lease cannot write chunks');
select pg_temp.assert_true(public.kb_finish_job(current_setting('kb.job_a')::uuid,'30000000-0000-4000-8000-000000000001',current_setting('kb.chunks_a')::jsonb,'[]'),'valid lease atomically indexes original chunks');
select pg_temp.assert_true(public.kb_claim_job(current_setting('kb.job_a')::uuid,gen_random_uuid()) is null,'completed replay does not acquire another paid attempt');
select public.kb_claim_job(current_setting('kb.job_b')::uuid,'30000000-0000-4000-8000-000000000003');
select public.kb_finish_job(current_setting('kb.job_b')::uuid,'30000000-0000-4000-8000-000000000003',jsonb_build_array(jsonb_build_object('content','Organization B secret source.','page',2,'section','Private','segment_id',current_setting('kb.doc_b')||':0','start_offset',0,'embedding',to_jsonb(current_setting('kb.vector')::real[]))),'[]');
select set_config('kb.chunk_a',(select id::text from public.kb_chunks where document_id=current_setting('kb.doc_a')::uuid),true);
select set_config('kb.chunk_b',(select id::text from public.kb_chunks where document_id=current_setting('kb.doc_b')::uuid),true);
select pg_temp.assert_true(jsonb_array_length(public.kb_search(current_setting('kb.org_a')::uuid,'10000000-0000-4000-8000-000000000004',to_jsonb(current_setting('kb.vector')::real[])::text::extensions.vector)->'chunks')=1,'vector retrieval filters organization before returning results');
do $$ begin
 begin perform public.kb_search(current_setting('kb.org_b')::uuid,'10000000-0000-4000-8000-000000000001',to_jsonb(current_setting('kb.vector')::real[])::text::extensions.vector);raise exception 'foreign vector query allowed';exception when insufficient_privilege then null;end;
 begin perform public.kb_save_answer(current_setting('kb.org_a')::uuid,'10000000-0000-4000-8000-000000000001',null,0,'Q','A',array[current_setting('kb.chunk_b')::uuid]);raise exception 'cross-org citation accepted';exception when invalid_parameter_value then null;end;
 begin perform public.kb_register(current_setting('kb.org_a')::uuid,'10000000-0000-4000-8000-000000000004','viewer.txt','txt','text/plain',1,repeat('c',64));raise exception 'viewer wrote source';exception when insufficient_privilege then null;end;
end $$;
select set_config('kb.answer',(public.kb_save_answer(current_setting('kb.org_a')::uuid,'10000000-0000-4000-8000-000000000003',null,0,'What is our security policy?','Human-authored verified answer.',array[current_setting('kb.chunk_a')::uuid])->>'id'),true);
select pg_temp.assert_true(jsonb_array_length(public.kb_search(current_setting('kb.org_a')::uuid,'10000000-0000-4000-8000-000000000004',to_jsonb(current_setting('kb.vector')::real[])::text::extensions.vector)->'answers')=0,'draft answers excluded from retrieval');
do $$ begin
 begin perform public.kb_approve_answer(current_setting('kb.org_a')::uuid,'10000000-0000-4000-8000-000000000003',current_setting('kb.answer')::uuid,0);raise exception 'editor self-approved';exception when insufficient_privilege then null;end;
end $$;
select public.kb_approve_answer(current_setting('kb.org_a')::uuid,'10000000-0000-4000-8000-000000000005',current_setting('kb.answer')::uuid,0);
select pg_temp.assert_true(jsonb_array_length(public.kb_search(current_setting('kb.org_a')::uuid,'10000000-0000-4000-8000-000000000004',to_jsonb(current_setting('kb.vector')::real[])::text::extensions.vector)->'answers')=1,'reviewer-approved answer returned with trusted citations');
select public.kb_save_answer(current_setting('kb.org_a')::uuid,'10000000-0000-4000-8000-000000000003',current_setting('kb.answer')::uuid,0,'What is our security policy?','Revised human answer.',array[current_setting('kb.chunk_a')::uuid]);
select pg_temp.assert_true((select revision=1 and approved_revision is null from public.kb_answers where id=current_setting('kb.answer')::uuid),'edit increments revision and invalidates approval');
do $$ begin
 begin perform public.kb_approve_answer(current_setting('kb.org_a')::uuid,'10000000-0000-4000-8000-000000000005',current_setting('kb.answer')::uuid,0);raise exception 'stale approval accepted';exception when serialization_failure then null;end;
end $$;
select public.kb_approve_answer(current_setting('kb.org_a')::uuid,'10000000-0000-4000-8000-000000000001',current_setting('kb.answer')::uuid,1);
select public.kb_archive(current_setting('kb.org_a')::uuid,'10000000-0000-4000-8000-000000000001',current_setting('kb.doc_a')::uuid);
select pg_temp.assert_true(jsonb_array_length(public.kb_search(current_setting('kb.org_a')::uuid,'10000000-0000-4000-8000-000000000004',to_jsonb(current_setting('kb.vector')::real[])::text::extensions.vector)->'chunks')=0,'archived documents excluded from vector retrieval');
select pg_temp.assert_true((select approved_revision is null from public.kb_answers where id=current_setting('kb.answer')::uuid),'archiving invalidates dependent approval');
set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',true);
select pg_temp.assert_true((select count(*) from storage.objects where bucket_id='kb-documents')=0,'archived original inaccessible through storage policy');
set local role service_role;
-- Retry takeover after the original actor is revoked, preserving durable attempts.
select set_config('kb.doc_retry',(public.kb_register(current_setting('kb.org_a')::uuid,'10000000-0000-4000-8000-000000000003','retry.txt','txt','text/plain',1,repeat('d',64))->>'id'),true);
select set_config('kb.job_retry',(public.kb_enqueue(current_setting('kb.org_a')::uuid,'10000000-0000-4000-8000-000000000003',current_setting('kb.doc_retry')::uuid)->>'job_id'),true);
select public.kb_claim_job(current_setting('kb.job_retry')::uuid,'30000000-0000-4000-8000-000000000004');
update public.kb_memberships set active=false where user_id='10000000-0000-4000-8000-000000000003';
do $$ begin
 begin perform public.kb_finish_job(current_setting('kb.job_retry')::uuid,'30000000-0000-4000-8000-000000000004',current_setting('kb.chunks_a')::jsonb,'[]');raise exception 'revoked actor finalized';exception when insufficient_privilege then null;end;
end $$;
update public.kb_jobs set lease_until=now()-interval '1 second' where id=current_setting('kb.job_retry')::uuid;
select public.kb_enqueue(current_setting('kb.org_a')::uuid,'10000000-0000-4000-8000-000000000001',current_setting('kb.doc_retry')::uuid);
select pg_temp.assert_true(public.kb_claim_job(current_setting('kb.job_retry')::uuid,'30000000-0000-4000-8000-000000000005') is not null,'active owner can recover expired job after actor revocation');
select pg_temp.assert_true(not public.kb_finish_job(current_setting('kb.job_retry')::uuid,'30000000-0000-4000-8000-000000000004',current_setting('kb.chunks_a')::jsonb,'[]'),'stale worker cannot finalize recovered lease');
select public.kb_fail_job(current_setting('kb.job_retry')::uuid,'30000000-0000-4000-8000-000000000005','embedding_failed');
select public.kb_claim_job(current_setting('kb.job_retry')::uuid,'30000000-0000-4000-8000-000000000006');
select public.kb_fail_job(current_setting('kb.job_retry')::uuid,'30000000-0000-4000-8000-000000000006','embedding_failed');
select pg_temp.assert_true(public.kb_claim_job(current_setting('kb.job_retry')::uuid,gen_random_uuid()) is null,'three-attempt ceiling is durable');
set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000003',true);
select pg_temp.assert_true((select count(*) from public.kb_documents)=0,'revocation immediately removes document access');
select pg_temp.assert_true((select count(*) from public.kb_chunks)=0,'revocation immediately removes source-chunk access');
set local role service_role;
delete from public.kb_usage;
do $$ declare i integer; begin
 for i in 1..10 loop perform public.kb_search_admit(current_setting('kb.org_a')::uuid,'10000000-0000-4000-8000-000000000004');end loop;
 begin perform public.kb_search_admit(current_setting('kb.org_a')::uuid,'10000000-0000-4000-8000-000000000004');raise exception 'search rate cap exceeded';exception when raise_exception then if sqlerrm='search rate cap exceeded' then raise; end if;end;
 perform pg_temp.assert_true((select used from public.kb_usage where scope='user:10000000-0000-4000-8000-000000000004' and action='search')=10,'search admission rate cap rolls back excess reservations');
end $$;
select pg_temp.assert_true(exists(select 1 from public.kb_audit_events where action='answer.approved') and exists(select 1 from public.kb_audit_events where action='document.archived'),'audit trail records approvals and archival');
rollback;
