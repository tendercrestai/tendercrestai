-- DISPOSABLE TEST PROJECT ONLY, after both upload and compliance migrations.
-- Fixtures and changes are rolled back. No customer data or production SQL.
begin;
insert into auth.users(id,email) values
 ('a1111111-1111-4111-8111-111111111111','compliance-owner@example.invalid'),
 ('a2222222-2222-4222-8222-222222222222','compliance-other@example.invalid');
insert into public.rfp_compliance_analyses(id,user_id,fingerprint,documents,chunks) values
 ('a3333333-3333-4333-8333-333333333333','a1111111-1111-4111-8111-111111111111',repeat('a',64),'[]','[[]]'),
 ('a4444444-4444-4444-8444-444444444444','a2222222-2222-4222-8222-222222222222',repeat('b',64),'[]','[[]]');
insert into public.rfp_compliance_requirements(id,analysis_id,user_id,fingerprint,original_requirement,requirement,category,mandatory,sources,recommendation)
 values('a5555555-5555-4555-8555-555555555555','a3333333-3333-4333-8333-333333333333',
 'a1111111-1111-4111-8111-111111111111',repeat('a',64),'Original fictional source','Original fictional source','Technical','Yes','[]','Verify evidence.');
set local role anon;
do $$ begin
  begin perform * from public.rfp_compliance_analyses; raise exception 'anon read allowed';
  exception when insufficient_privilege then null; end;
  begin perform public.rfp_compliance_claim('a3333333-3333-4333-8333-333333333333','a1111111-1111-4111-8111-111111111111',repeat('a',64),gen_random_uuid());
    raise exception 'anon claim allowed'; exception when insufficient_privilege then null; end;
end $$;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"a1111111-1111-4111-8111-111111111111","role":"authenticated"}',true);
do $$ begin
  if (select count(*) from public.rfp_compliance_analyses) <> 1 then raise exception 'analysis RLS failed'; end if;
  if (select count(*) from public.rfp_compliance_requirements) <> 1 then raise exception 'requirement RLS failed'; end if;
  begin update public.rfp_compliance_requirements set user_id='a2222222-2222-4222-8222-222222222222';
    raise exception 'owner mutation allowed'; exception when insufficient_privilege then null; end;
  begin update public.rfp_compliance_requirements set sources='[{"page":999}]';
    raise exception 'citation mutation allowed'; exception when insufficient_privilege then null; end;
  begin update public.rfp_compliance_requirements set status='Compliant';
    raise exception 'unsupported compliance allowed'; exception when check_violation then null; end;
  begin insert into public.rfp_compliance_analyses(user_id,fingerprint,documents,chunks)
    values('a1111111-1111-4111-8111-111111111111',repeat('c',64),'[]','[[]]');
    raise exception 'client analysis insert allowed'; exception when insufficient_privilege then null; end;
  begin perform public.rfp_compliance_claim('a3333333-3333-4333-8333-333333333333','a1111111-1111-4111-8111-111111111111',repeat('a',64),gen_random_uuid());
    raise exception 'client claim allowed'; exception when insufficient_privilege then null; end;
end $$;
update public.rfp_compliance_requirements set requirement='Human edited fictional requirement',
 evidence='Signed fictional report',evidence_reference='Report section 2',status='Compliant';
do $$ begin
  if (select revision from public.rfp_compliance_requirements) <> 1 then raise exception 'review version not incremented'; end if;
  if (select original_requirement from public.rfp_compliance_requirements) <> 'Original fictional source' then raise exception 'source changed'; end if;
end $$;
select set_config('request.jwt.claims','{"sub":"a2222222-2222-4222-8222-222222222222","role":"authenticated"}',true);
do $$ begin
  if (select count(*) from public.rfp_compliance_analyses) <> 1 then raise exception 'foreign analysis visible'; end if;
  if (select count(*) from public.rfp_compliance_requirements) <> 0 then raise exception 'foreign requirements visible'; end if;
end $$;
update public.rfp_compliance_requirements set comments='Foreign edit';
set local role postgres;
do $$ begin
  if (select comments from public.rfp_compliance_requirements where id='a5555555-5555-4555-8555-555555555555') <> '' then
    raise exception 'foreign row modified'; end if;
end $$;
-- Test the real transitions as the same privileged invoker as Netlify.
set local role service_role;
select public.rfp_compliance_claim('a3333333-3333-4333-8333-333333333333','a1111111-1111-4111-8111-111111111111',repeat('a',64),'a6666666-6666-4666-8666-666666666666');
do $$ begin
  begin perform public.rfp_compliance_claim('a3333333-3333-4333-8333-333333333333','a1111111-1111-4111-8111-111111111111',repeat('a',64),gen_random_uuid());
    raise exception 'overlapping claim allowed'; exception when lock_not_available then null; end;
  if public.rfp_compliance_finish('a3333333-3333-4333-8333-333333333333','a1111111-1111-4111-8111-111111111111',gen_random_uuid(),'[]','[]',null) then
    raise exception 'foreign lease saved output'; end if;
end $$;
select public.rfp_compliance_finish('a3333333-3333-4333-8333-333333333333','a1111111-1111-4111-8111-111111111111','a6666666-6666-4666-8666-666666666666','[]','[]',null);
do $$ begin
  if (select status from public.rfp_compliance_analyses where id='a3333333-3333-4333-8333-333333333333') <> 'Completed' then raise exception 'final status failed'; end if;
end $$;
rollback;
