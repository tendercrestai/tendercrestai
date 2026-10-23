-- Disposable fixtures only. All rows roll back. Never run against production.
begin;
create function pg_temp.assert_true(ok boolean,label text) returns void language plpgsql as $$ begin if ok is distinct from true then raise exception 'FAIL: %',label; end if; raise notice 'PASS: %',label; end $$;
insert into auth.users(id,email) values
 ('20000000-0000-4000-8000-000000000001','discovery-owner@example.invalid'),
 ('20000000-0000-4000-8000-000000000002','discovery-other@example.invalid'),
 ('20000000-0000-4000-8000-000000000003','discovery-viewer@example.invalid'),
 ('20000000-0000-4000-8000-000000000004','discovery-reviewer@example.invalid'),
 ('20000000-0000-4000-8000-000000000005','new-member@example.invalid'),
 ('20000000-0000-4000-8000-000000000006','another-member@example.invalid'),
 ('20000000-0000-4000-8000-000000000007','unverified@example.invalid');
update auth.users set email_confirmed_at=null where id='20000000-0000-4000-8000-000000000007';
revoke select on auth.users from service_role;
set local role service_role;
select set_config('discovery.a',public.kb_bootstrap('20000000-0000-4000-8000-000000000001','Discovery A')::text,true);
select set_config('discovery.b',public.kb_bootstrap('20000000-0000-4000-8000-000000000002','Discovery B')::text,true);
insert into public.kb_memberships values
 (current_setting('discovery.a')::uuid,'20000000-0000-4000-8000-000000000003','viewer',true),
 (current_setting('discovery.a')::uuid,'20000000-0000-4000-8000-000000000004','reviewer',true);
insert into public.kb_documents(id,org_id,uploaded_by,file_name,extension,mime_type,size_bytes,sha256,storage_path,status,created_at)
 select id,current_setting('discovery.a')::uuid,'20000000-0000-4000-8000-000000000001',case when n=1 then 'oldest-special-file.txt' else 'Security notes '||n||case when n%2=0 then '.pdf' else '.txt' end end,
 case when n%2=0 then 'pdf' else 'txt' end,case when n%2=0 then 'application/pdf' else 'text/plain' end,40,lpad(to_hex(n),64,'0'),
 current_setting('discovery.a')||'/'||id||'/source.'||case when n%2=0 then 'pdf' else 'txt' end,
 case n when 121 then 'Archived' when 120 then 'Failed' when 119 then 'Processing' else 'Ready' end,
 '2026-01-01 00:00:00+00'::timestamptz+n*interval '1 second' from (select n,gen_random_uuid() id from generate_series(1,121) n) t;
select set_config('discovery.doc',(select id::text from public.kb_documents where org_id=current_setting('discovery.a')::uuid and file_name='oldest-special-file.txt'),true);
insert into public.kb_documents(id,org_id,uploaded_by,file_name,extension,mime_type,size_bytes,sha256,storage_path,status)
 select id,current_setting('discovery.b')::uuid,'20000000-0000-4000-8000-000000000002','foreign-secret.txt','txt','text/plain',40,repeat('f',64),current_setting('discovery.b')||'/'||id||'/source.txt','Ready' from (select gen_random_uuid() id) t;
insert into public.kb_chunks(org_id,document_id,ordinal,content,segment_id,start_offset,embedding)
 select org_id,id,0,'Searchable evidence control phrase','segment',0,(case when id=current_setting('discovery.doc')::uuid then '[1,'||repeat('0,',1534)||'0]' else '[1,0.1,'||repeat('0,',1533)||'0]' end)::extensions.vector from public.kb_documents where org_id=current_setting('discovery.a')::uuid and status='Ready' order by created_at limit 26;
select set_config('discovery.chunk',(select id::text from public.kb_chunks where document_id=current_setting('discovery.doc')::uuid),true);
insert into public.kb_answers(org_id,question,answer,updated_by,updated_at)
 select current_setting('discovery.a')::uuid,'Question '||n,case n when 1 then 'Deep draft zebra wording absent from sources' else 'Answer text '||n end,'20000000-0000-4000-8000-000000000001','2026-01-01 00:00:00+00'::timestamptz+n*interval '1 second' from generate_series(1,121) n;
select set_config('discovery.answer',(select id::text from public.kb_answers where org_id=current_setting('discovery.a')::uuid and question='Question 1'),true);
insert into public.kb_answer_citations(answer_id,chunk_id,org_id) select id,current_setting('discovery.chunk')::uuid,org_id from public.kb_answers where org_id=current_setting('discovery.a')::uuid;
update public.kb_answers set approved_revision=revision,approved_by='20000000-0000-4000-8000-000000000001',approved_at=now() where question='Question 2' and org_id=current_setting('discovery.a')::uuid;
insert into public.kb_audit_events(org_id,actor_id,action,target_id,created_at)
 select current_setting('discovery.a')::uuid,'20000000-0000-4000-8000-000000000001','answer.approved',current_setting('discovery.answer')::uuid,'2026-01-01 00:00:00+00'::timestamptz+n*interval '1 second' from generate_series(1,121) n;
select pg_temp.assert_true((public.kb_browse(current_setting('discovery.a')::uuid,'20000000-0000-4000-8000-000000000003','documents')->>'total')::int=121,'document count includes more than 100 records');
select pg_temp.assert_true(jsonb_array_length(public.kb_browse(current_setting('discovery.a')::uuid,'20000000-0000-4000-8000-000000000003','documents','', '', '',null,null,4,25)->'items')=21,'document pagination reaches records beyond the old limit');
select pg_temp.assert_true((public.kb_browse(current_setting('discovery.a')::uuid,'20000000-0000-4000-8000-000000000003','documents','oldest-special')->>'total')::int=1,'filename search finds an older source');
select pg_temp.assert_true((public.kb_browse(current_setting('discovery.a')::uuid,'20000000-0000-4000-8000-000000000003','documents','%')->>'total')::int=0,'query percent is literal rather than a wildcard');
select pg_temp.assert_true((public.kb_browse(current_setting('discovery.a')::uuid,'20000000-0000-4000-8000-000000000003','documents','','Failed','pdf')->>'total')::int=1,'document status and file-type filters combine');
select pg_temp.assert_true((public.kb_browse(current_setting('discovery.a')::uuid,'20000000-0000-4000-8000-000000000003','documents','','','',date '2027-01-01')->>'total')::int=0,'date filter excludes older uploads');
select pg_temp.assert_true((public.kb_browse(current_setting('discovery.a')::uuid,'20000000-0000-4000-8000-000000000003','answers','zebra','draft')->>'total')::int=1,'draft answer text is independently searchable beyond 100 answers');
select pg_temp.assert_true((public.kb_browse(current_setting('discovery.a')::uuid,'20000000-0000-4000-8000-000000000003','answers','','approved')->>'total')::int=1,'approved-only filtering excludes drafts');
select pg_temp.assert_true((public.kb_browse(current_setting('discovery.a')::uuid,'20000000-0000-4000-8000-000000000003','excerpts','evidence')->>'total')::int=26,'literal source search includes all matching ready excerpts');
select pg_temp.assert_true(not (public.kb_find(current_setting('discovery.a')::uuid,'20000000-0000-4000-8000-000000000003','answer')->'groups' ? 'activity'),'unified viewer search does not expose audit counts or rows');
select pg_temp.assert_true((public.kb_find(current_setting('discovery.a')::uuid,'20000000-0000-4000-8000-000000000004','answer approved')->'groups'->'activity'->>'total')::int=121,'reviewer can search human-readable activity actions');
select pg_temp.assert_true((public.kb_overview(current_setting('discovery.a')::uuid,'20000000-0000-4000-8000-000000000003')->>'ready')::int=118,'onboarding summary uses all records rather than the current page');
select pg_temp.assert_true(jsonb_array_length(public.kb_search_filtered(current_setting('discovery.a')::uuid,'20000000-0000-4000-8000-000000000003',('[1,'||repeat('0,',1534)||'0]')::extensions.vector,'',null,null,1,25)->'chunks')=1,'semantic search paginates ranked hits beyond the first page');
select pg_temp.assert_true((public.kb_search_filtered(current_setting('discovery.a')::uuid,'20000000-0000-4000-8000-000000000003',('[1,'||repeat('0,',1534)||'0]')::extensions.vector,'pdf')->>'total')::int=13,'semantic file-type filter runs before ranking and limit');
select pg_temp.assert_true(jsonb_array_length(public.kb_search_filtered(current_setting('discovery.a')::uuid,'20000000-0000-4000-8000-000000000003',('[1,'||repeat('0,',1534)||'0]')::extensions.vector)->'answers')=1,'semantic approved-answer results exclude independent drafts');
-- Negative cases must fail, not return foreign metadata.
do $$ begin
 begin perform public.kb_browse(current_setting('discovery.b')::uuid,'20000000-0000-4000-8000-000000000003','documents');raise exception 'foreign browse allowed';exception when insufficient_privilege then null;end;
 begin perform public.kb_browse(current_setting('discovery.a')::uuid,'20000000-0000-4000-8000-000000000003','activity');raise exception 'viewer audit allowed';exception when insufficient_privilege then null;end;
 begin perform public.kb_team(current_setting('discovery.a')::uuid,'20000000-0000-4000-8000-000000000004');raise exception 'reviewer team allowed';exception when insufficient_privilege then null;end;
 begin perform public.kb_browse(current_setting('discovery.a')::uuid,'20000000-0000-4000-8000-000000000003','documents','','','',null,null,-1);raise exception 'negative page allowed';exception when invalid_parameter_value then null;end;
 begin perform public.kb_member_update(current_setting('discovery.a')::uuid,'20000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','viewer',false);raise exception 'owner removal allowed';exception when insufficient_privilege then null;end;
 begin perform public.kb_member_update(current_setting('discovery.a')::uuid,'20000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000002','viewer',false);raise exception 'foreign member altered';exception when no_data_found then null;end;
 perform pg_temp.assert_true(true,'foreign organization, audit, owner and page boundaries enforced');
end $$;
select set_config('discovery.invite',(public.kb_invite_create(current_setting('discovery.a')::uuid,'20000000-0000-4000-8000-000000000001','new-member@example.invalid','editor',repeat('1',64))->>'id'),true);
select pg_temp.assert_true((public.kb_invite_access('20000000-0000-4000-8000-000000000005',repeat('1',64),false)->>'accepted')::boolean=false,'invitation preview does not grant membership');
select pg_temp.assert_true(not exists(select 1 from public.kb_memberships where user_id='20000000-0000-4000-8000-000000000005'),'preview leaves nonmember unchanged');
do $$ begin
 begin perform public.kb_invite_access('20000000-0000-4000-8000-000000000002',repeat('1',64),true);raise exception 'wrong email accepted';exception when insufficient_privilege then null;end;
 perform pg_temp.assert_true(true,'invitation bound to verified email');
end $$;
select pg_temp.assert_true((public.kb_invite_access('20000000-0000-4000-8000-000000000005',repeat('1',64),true)->>'role')='editor','invited member accepts assigned role');
select public.kb_invite_access('20000000-0000-4000-8000-000000000005',repeat('1',64),true);
select pg_temp.assert_true((select count(*) from public.kb_audit_events where target_id=current_setting('discovery.invite')::uuid and action='invitation.accepted')=1,'invite replay is idempotent without duplicate acceptance events');
select pg_temp.assert_true(not (public.kb_team(current_setting('discovery.a')::uuid,'20000000-0000-4000-8000-000000000001')::text like '%token_hash%'),'owner team response never exposes token hashes');
select public.kb_member_update(current_setting('discovery.a')::uuid,'20000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000005','viewer',false);
do $$ begin
 begin perform public.kb_invite_access('20000000-0000-4000-8000-000000000005',repeat('1',64),true);raise exception 'old invite reactivated member';exception when no_data_found then null;end;
 begin perform public.kb_browse(current_setting('discovery.a')::uuid,'20000000-0000-4000-8000-000000000005','documents');raise exception 'revoked member read allowed';exception when insufficient_privilege then null;end;
 perform pg_temp.assert_true(true,'revocation immediately blocks browse and accepted-link replay');
end $$;
select public.kb_invite_create(current_setting('discovery.a')::uuid,'20000000-0000-4000-8000-000000000001','new-member@example.invalid','reviewer',repeat('2',64));
select pg_temp.assert_true((public.kb_invite_access('20000000-0000-4000-8000-000000000005',repeat('2',64),true)->>'role')='reviewer','fresh invitation can intentionally reactivate a revoked member');
select public.kb_invite_create(current_setting('discovery.a')::uuid,'20000000-0000-4000-8000-000000000001','another-member@example.invalid','viewer',repeat('3',64));
update public.kb_invitations set expires_at=now()-interval '1 second' where token_hash=repeat('3',64);
select public.kb_invite_create(current_setting('discovery.a')::uuid,'20000000-0000-4000-8000-000000000001','unverified@example.invalid','viewer',repeat('4',64));
do $$ begin
 begin perform public.kb_invite_access('20000000-0000-4000-8000-000000000006',repeat('3',64),true);raise exception 'expired invite accepted';exception when no_data_found then null;end;
 begin perform public.kb_invite_access('20000000-0000-4000-8000-000000000007',repeat('4',64),true);raise exception 'unverified invite accepted';exception when insufficient_privilege then null;end;
 perform pg_temp.assert_true(true,'expired invitations and unverified email accounts denied');
end $$;
select set_config('discovery.revoked',(public.kb_invite_create(current_setting('discovery.a')::uuid,'20000000-0000-4000-8000-000000000001','another-member@example.invalid','viewer',repeat('5',64))->>'id'),true);
select public.kb_invite_revoke(current_setting('discovery.a')::uuid,'20000000-0000-4000-8000-000000000001',current_setting('discovery.revoked')::uuid);
do $$ begin
 begin perform public.kb_invite_access('20000000-0000-4000-8000-000000000006',repeat('5',64),true);raise exception 'revoked invite accepted';exception when no_data_found then null;end;
 perform pg_temp.assert_true(true,'owner revocation disables unused invitation link');
end $$;
select public.kb_invite_create(current_setting('discovery.a')::uuid,'20000000-0000-4000-8000-000000000001','another-member@example.invalid','editor',repeat('6',64));
select public.kb_invite_create(current_setting('discovery.a')::uuid,'20000000-0000-4000-8000-000000000001','another-member@example.invalid','viewer',repeat('7',64));
select pg_temp.assert_true((select state from public.kb_invitations where token_hash=repeat('6',64))='Revoked','reissuing invitation rotates away the old pending link');
-- Authenticated clients cannot bypass the server with forged actor IDs or hashes.
set local role authenticated;
do $$ begin
 begin perform public.kb_invite_access('20000000-0000-4000-8000-000000000006',repeat('7',64),true);raise exception 'direct invite RPC allowed';exception when insufficient_privilege then null;end;
 begin perform 1 from public.kb_invitations;raise exception 'direct invite table read allowed';exception when insufficient_privilege then null;end;
 perform pg_temp.assert_true(true,'invitation records and RPCs are service-only');
end $$;
set local role service_role;
delete from public.kb_usage where action='discovery';
do $$ declare i integer; begin
 for i in 1..60 loop perform public.kb_discovery_admit(current_setting('discovery.a')::uuid,'20000000-0000-4000-8000-000000000003');end loop;
 begin perform public.kb_discovery_admit(current_setting('discovery.a')::uuid,'20000000-0000-4000-8000-000000000003');raise exception 'discovery limit exceeded';exception when raise_exception then if sqlerrm='discovery limit exceeded' then raise;end if;end;
 perform pg_temp.assert_true((select used from public.kb_usage where scope='user:20000000-0000-4000-8000-000000000003' and action='discovery')=60,'discovery read admission is bounded and excess rolls back atomically');
end $$;
select public.kb_archive(current_setting('discovery.a')::uuid,'20000000-0000-4000-8000-000000000001',current_setting('discovery.doc')::uuid);
select pg_temp.assert_true((public.kb_browse(current_setting('discovery.a')::uuid,'20000000-0000-4000-8000-000000000003','excerpts','evidence')->>'total')::int=25,'archived sources are excluded from text evidence search');
select pg_temp.assert_true((public.kb_browse(current_setting('discovery.a')::uuid,'20000000-0000-4000-8000-000000000003','answers','','approved')->>'total')::int=0,'archival still invalidates approval for discovery searches');
rollback;
