-- Disposable local database only; rolls back all fixtures.
begin;
create function pg_temp.ok(value boolean,label text) returns void language plpgsql as $$begin if value is distinct from true then raise exception 'FAIL: %',label;end if;raise notice 'PASS: %',label;end$$;
insert into auth.users(id,email) values
 ('11111111-1111-4111-8111-111111111111','owner@fictional.invalid'),
 ('22222222-2222-4222-8222-222222222222','author@fictional.invalid'),
 ('33333333-3333-4333-8333-333333333333','reviewer@fictional.invalid'),
 ('44444444-4444-4444-8444-444444444444','viewer@fictional.invalid'),
 ('55555555-5555-4555-8555-555555555555','other@fictional.invalid');
insert into public.kb_organizations(id,name,created_by) values('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Fictional Cedar','11111111-1111-4111-8111-111111111111'),('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','Fictional Other','55555555-5555-4555-8555-555555555555');
insert into public.kb_memberships(org_id,user_id,role) values
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','11111111-1111-4111-8111-111111111111','owner'),
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','22222222-2222-4222-8222-222222222222','editor'),
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','33333333-3333-4333-8333-333333333333','reviewer'),
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','44444444-4444-4444-8444-444444444444','viewer'),
 ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','55555555-5555-4555-8555-555555555555','owner');
create temp table fixture(project uuid);
insert into fixture select public.pw_create('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','11111111-1111-4111-8111-111111111111','Fictional project','{"schema":1,"title":"Fictional project","requirements":[],"sections":[],"evidence":[]}');
select set_config('test.project',(select project::text from fixture),true);
select public.pw_member(project,'11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','author') from fixture;
select public.pw_member(project,'11111111-1111-4111-8111-111111111111','33333333-3333-4333-8333-333333333333','reviewer') from fixture;
do $$begin begin perform public.pw_require(current_setting('test.project')::uuid,'44444444-4444-4444-8444-444444444444');raise exception 'FAIL uninvited viewer';exception when insufficient_privilege then raise notice 'PASS uninvited organization viewer denied';end;end$$;
select public.pw_member(project,'11111111-1111-4111-8111-111111111111','44444444-4444-4444-8444-444444444444','viewer') from fixture;
select pg_temp.ok(not has_function_privilege('authenticated','public.pw_commit(uuid,uuid,integer,integer,jsonb,text,jsonb)','EXECUTE'),'client cannot invoke privileged commit');
select pg_temp.ok(not has_table_privilege('authenticated','public.pw_projects','UPDATE'),'client cannot bypass revision checks');
select pg_temp.ok(not has_table_privilege('service_role','public.pw_approvals','UPDATE'),'approval snapshots immutable for service role');
select pg_temp.ok(not has_table_privilege('service_role','public.pw_revisions','DELETE'),'revision snapshots immutable for service role');
do $$declare p uuid:=current_setting('test.project')::uuid;begin
 begin perform public.pw_require(p,'55555555-5555-4555-8555-555555555555');raise exception 'FAIL cross tenant';exception when insufficient_privilege then raise notice 'PASS cross-tenant denied';end;
 begin perform public.pw_commit(p,'44444444-4444-4444-8444-444444444444',0,0,'{}','section.saved');raise exception 'FAIL viewer';exception when insufficient_privilege then raise notice 'PASS viewer cannot edit';end;
 begin perform public.pw_member(p,'22222222-2222-4222-8222-222222222222','44444444-4444-4444-8444-444444444444','manager');raise exception 'FAIL author grants';exception when insufficient_privilege then raise notice 'PASS author cannot grant access';end;
 begin perform public.pw_member(p,'11111111-1111-4111-8111-111111111111','44444444-4444-4444-8444-444444444444','manager');raise exception 'FAIL viewer elevate';exception when insufficient_privilege then raise notice 'PASS project role bounded by organization';end;
end$$;
select public.pw_commit(project,'22222222-2222-4222-8222-222222222222',0,0,'{"schema":1,"title":"Fictional project","requirements":[],"sections":[],"evidence":[]}','section.saved') from fixture;
do $$declare p uuid:=current_setting('test.project')::uuid;begin
 begin perform public.pw_commit(p,'22222222-2222-4222-8222-222222222222',0,0,'{}','section.saved');raise exception 'FAIL concurrent';exception when sqlstate 'PT409' then raise notice 'PASS concurrent write rejected';end;
 begin perform public.pw_commit(p,'22222222-2222-4222-8222-222222222222',1,0,'{}','review.approved');raise exception 'FAIL author approve';exception when insufficient_privilege then raise notice 'PASS author cannot approve';end;
end$$;
set local role authenticated;
select set_config('request.jwt.claim.sub','55555555-5555-4555-8555-555555555555',true);
select pg_temp.ok((select count(*)=0 from public.pw_projects),'RLS hides other tenant project');
select pg_temp.ok((select count(*)=0 from public.pw_revisions),'RLS hides other tenant history');
select pg_temp.ok((select count(*)=0 from public.pw_files),'RLS hides other tenant files');
select set_config('request.jwt.claim.sub','44444444-4444-4444-8444-444444444444',true);
select pg_temp.ok((select count(*)=1 from public.pw_projects),'explicit viewer can read own project');
reset role;
create temp table job(id uuid);
insert into job select (public.pw_enqueue(project,'22222222-2222-4222-8222-222222222222',1,0,'draft','66666666-6666-4666-8666-666666666666','{"sectionId":"x"}')).id from fixture;
select pg_temp.ok((public.pw_enqueue(project,'22222222-2222-4222-8222-222222222222',1,0,'draft','66666666-6666-4666-8666-666666666666','{"sectionId":"x"}')).id=(select id from job),'enqueue retry returns same job') from fixture;
select public.pw_claim(id,'77777777-7777-4777-8777-777777777777') from job;
do $$begin begin perform public.pw_claim((select id from job),'88888888-8888-4888-8888-888888888888');raise exception 'FAIL duplicate lease';exception when sqlstate 'P0001' then if sqlerrm='FAIL duplicate lease' then raise;end if;raise notice 'PASS duplicate worker lease denied';end;end$$;
select pg_temp.ok(not public.pw_finish(id,'88888888-8888-4888-8888-888888888888','{}'),'wrong worker cannot finish') from job;
select pg_temp.ok(public.pw_finish(id,'77777777-7777-4777-8777-777777777777','{"text":"fictional"}'),'leased worker finishes') from job;
select pg_temp.ok((public.pw_claim(id,'88888888-8888-4888-8888-888888888888')->>'done')::boolean,'completed retry does not consume another attempt') from job;
select public.pw_notify(project,'11111111-1111-4111-8111-111111111111','44444444-4444-4444-8444-444444444444','same-event','mention') from fixture;
select public.pw_notify(project,'11111111-1111-4111-8111-111111111111','44444444-4444-4444-8444-444444444444','same-event','mention') from fixture;
select pg_temp.ok((select count(*)=1 from public.pw_notifications),'notification retries idempotent');
select pg_temp.ok(public.pw_notification_targets(id,true) is null,'email requires explicit opt in') from public.pw_notifications;
select public.pw_member(project,'11111111-1111-4111-8111-111111111111','44444444-4444-4444-8444-444444444444','viewer',true) from fixture;
set local role authenticated;
select pg_temp.ok((select count(*)=0 from public.pw_projects),'removed viewer loses project access');
select pg_temp.ok((select count(*)=0 from public.pw_notifications),'removed viewer loses notifications');
reset role;
insert into storage.objects(bucket_id,name) select 'proposal-artifacts','private-test' from fixture;
set local role authenticated;
select pg_temp.ok((select count(*)=0 from storage.objects where bucket_id='proposal-artifacts'),'broad existing storage policy cannot expose project artifacts');
reset role;

insert into public.kb_documents(id,org_id,uploaded_by,file_name,extension,mime_type,size_bytes,sha256,storage_path,status) values
 ('cccccccc-cccc-4ccc-8ccc-cccccccccccc','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','11111111-1111-4111-8111-111111111111','fictional.txt','txt','text/plain',50,repeat('a',64),'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/cccccccc-cccc-4ccc-8ccc-cccccccccccc/source.txt','Ready');
insert into public.kb_chunks(id,org_id,document_id,ordinal,content,section,segment_id,start_offset,embedding) values
 ('dddddddd-dddd-4ddd-8ddd-dddddddddddd','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','cccccccc-cccc-4ccc-8ccc-cccccccccccc',0,'Fictional archive certification','1','seg-1',0,array_fill(0.1::real,array[1536])::extensions.vector);
insert into public.kb_answers(id,org_id,question,answer,revision,approved_revision,approved_by,approved_at,updated_by) values
 ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Certification','Fictional archive certification',1,1,'11111111-1111-4111-8111-111111111111',now(),'11111111-1111-4111-8111-111111111111'),
 ('ffffffff-ffff-4fff-8fff-ffffffffffff','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Certification draft','Unapproved certification claim',1,null,null,null,'11111111-1111-4111-8111-111111111111');
insert into public.kb_answer_citations(answer_id,chunk_id,org_id) values ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','dddddddd-dddd-4ddd-8ddd-dddddddddddd','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),('ffffffff-ffff-4fff-8fff-ffffffffffff','dddddddd-dddd-4ddd-8ddd-dddddddddddd','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
select pg_temp.ok(jsonb_array_length(public.pw_candidates(project,'11111111-1111-4111-8111-111111111111','certification'))=1,'only approved exact revisions retrieved') from fixture;
select pg_temp.ok(public.pw_candidates(project,'11111111-1111-4111-8111-111111111111','certification')->0->'citations'->0->'page'='null'::jsonb,'unavailable page remains null') from fixture;
select public.pw_commit(project,'11111111-1111-4111-8111-111111111111',1,0,jsonb_build_object('schema',1,'title','Fictional project','requirements','[]'::jsonb,'sections','[]'::jsonb,'evidence',jsonb_build_array(jsonb_build_object('answerId','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','revision',1,'decision','accepted','text','Fictional archive certification','citations',jsonb_build_array(jsonb_build_object('documentId','cccccccc-cccc-4ccc-8ccc-cccccccccccc'))))),'evidence.suggested') from fixture;
update public.kb_answers set answer='Changed fictional certification',revision=2,approved_revision=null,approved_by=null,approved_at=null where id='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
select pg_temp.ok((select evidence_epoch=1 from public.pw_projects where id=fixture.project),'answer changes invalidate dependent project evidence epoch') from fixture;
select pg_temp.ok(jsonb_array_length(public.pw_candidates(project,'11111111-1111-4111-8111-111111111111','certification'))=0,'edited unapproved answer excluded immediately') from fixture;
update public.kb_documents set status='Archived' where id='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
select pg_temp.ok((select evidence_epoch=2 from public.pw_projects where id=fixture.project),'archived source invalidates dependent project') from fixture;

select pg_temp.ok(not has_function_privilege('authenticated','public.pw_people(uuid,uuid,boolean)','EXECUTE'),'directory RPC is service only');
select pg_temp.ok(not has_function_privilege('authenticated','public.pw_reminders()','EXECUTE'),'scheduled reminder RPC is service only');
select pg_temp.ok(jsonb_array_length(public.pw_people(project,'33333333-3333-4333-8333-333333333333',false))=3,'project member labels exclude removed member') from fixture;
do $$begin begin perform public.pw_people(current_setting('test.project')::uuid,'33333333-3333-4333-8333-333333333333',true);raise exception 'FAIL reviewer directory';exception when insufficient_privilege then raise notice 'PASS reviewer cannot enumerate organization directory';end;end$$;
-- Queue one due task, retry the scheduled sweep, and confirm no duplicate.
update public.pw_projects set state=jsonb_set(state,'{sections}',jsonb_build_array(jsonb_build_object('id','due-task','authorId','22222222-2222-4222-8222-222222222222','dueAt','2020-01-01','status','draft'))) where id=(select project from fixture);
select pg_temp.ok(public.pw_reminders()=1,'scheduled due reminder admitted');
select pg_temp.ok(public.pw_reminders()=0,'scheduled reminder retry deduplicated');
-- A new job is failed three times; a fourth lease must be refused.
insert into job select (public.pw_enqueue(project,'11111111-1111-4111-8111-111111111111',2,2,'draft','99999999-9999-4999-8999-999999999999','{"sectionId":"retry"}')).id from fixture;
do $$declare target uuid;lease uuid;begin
 select id into target from public.pw_jobs where request_key='99999999-9999-4999-8999-999999999999';
 for attempt in 1..3 loop lease:=gen_random_uuid();perform public.pw_claim(target,lease);perform public.pw_finish(target,lease,null,'fictional_failure');end loop;
 begin perform public.pw_claim(target,gen_random_uuid());raise exception 'FAIL retry ceiling';exception when sqlstate 'P0001' then if sqlerrm='FAIL retry ceiling' then raise;end if;raise notice 'PASS three-attempt ceiling enforced';end;
end$$;
insert into storage.objects(bucket_id,name,created_at) values('proposal-artifacts','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222',now()-interval '2 days');
select pg_temp.ok((select count(*)=1 from public.pw_orphan_files()),'aged orphan artifacts eligible for bounded cleanup');

select public.pw_commit(p.id,'11111111-1111-4111-8111-111111111111',p.revision,p.evidence_epoch,jsonb_set(p.state,'{evidence,0,stale}','true'),'assignment.updated','{"sectionId":"due-task"}') from public.pw_projects p where p.id=(select project from fixture);
select pg_temp.ok((select count(*)=1 from public.pw_notifications where event_key='assignment:3'),'assignment notification committed atomically with revision');
select public.pw_commit(p.id,'11111111-1111-4111-8111-111111111111',p.revision,p.evidence_epoch,jsonb_set(p.state,'{comments}','[{"id":"atomic-comment","mentions":["33333333-3333-4333-8333-333333333333"],"text":"fictional"}]'),'comment.added') from public.pw_projects p where p.id=(select project from fixture);
select pg_temp.ok((select count(*)=1 from public.pw_notifications where event_key='comment:atomic-comment'),'mention notification committed atomically with comment');
insert into job select (public.pw_enqueue(project,'22222222-2222-4222-8222-222222222222',4,2,'draft','aaaa7777-7777-4777-8777-777777777777','{"sectionId":"due-task"}')).id from fixture;
select public.pw_member(project,'11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','author',true) from fixture;
select pg_temp.ok((public.pw_claim(id,gen_random_uuid())->>'cancelled')::boolean,'removed author queued job is cancelled') from public.pw_jobs where request_key='aaaa7777-7777-4777-8777-777777777777';
rollback;
