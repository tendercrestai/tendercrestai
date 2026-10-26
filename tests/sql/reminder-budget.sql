begin;
create function pg_temp.ok(v boolean,label text) returns void language plpgsql as $$begin if v is distinct from true then raise exception 'FAIL %',label;end if;raise notice 'PASS %',label;end$$;
insert into auth.users(id,email) values('11111111-1111-4111-8111-111111111111','budget@fictional.invalid');
insert into public.kb_organizations(id,name,created_by) values('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Fictional budget test','11111111-1111-4111-8111-111111111111');
insert into public.kb_memberships(org_id,user_id,role) values('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','11111111-1111-4111-8111-111111111111','owner');
create temp table reminder_project as select public.pw_create('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','11111111-1111-4111-8111-111111111111','Fictional reminder project','{"schema":1,"title":"Fictional reminder project","requirements":[],"sections":[],"evidence":[]}') as id;
insert into public.pw_notifications(id,project_id,user_id,event_key,kind,email_state)
 select gen_random_uuid(),p.id,'11111111-1111-4111-8111-111111111111','budget:'||n,'reminder','Sending' from reminder_project p,generate_series(1,6) n;
select pg_temp.ok((select count(*)=5 from (select public.cc_admit_reminder(id) admitted from public.pw_notifications order by event_key) r where admitted),'six distinct notifications admit only five provider attempts per UTC day');
select pg_temp.ok(public.cc_admit_reminder((select notification_id from public.cc_reminder_budget limit 1)),'same admitted notification retries without consuming another slot');
select pg_temp.ok(not public.cc_admit_reminder(gen_random_uuid()),'unknown notifications cannot consume or bypass admission');
select pg_temp.ok(not has_function_privilege('authenticated','public.cc_admit_reminder(uuid)','execute') and not has_table_privilege('anon','public.cc_reminder_budget','select'),'email budget and admission are private to trusted workers');
rollback;
