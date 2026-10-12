-- Run in a TEST Supabase project after applying the migration. Rolls back all fixtures.
begin;
insert into auth.users (id,email) values
 ('a1111111-1111-4111-8111-111111111111','evidence-owner@example.invalid'),
 ('a2222222-2222-4222-8222-222222222222','evidence-other@example.invalid');
insert into public.proposal_evidence (id,user_id,title,kind,sector,content,source_label,rights_confirmed,approved) values
 ('a3333333-3333-4333-8333-333333333333','a1111111-1111-4111-8111-111111111111','Owner','company_evidence','All','Cloud delivery facts','Fixture',true,true),
 ('a4444444-4444-4444-8444-444444444444','a2222222-2222-4222-8222-222222222222','Other','past_bid','All','Other bidder text','Fixture',true,true);
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"a1111111-1111-4111-8111-111111111111","role":"authenticated"}',true);
do $$
declare changed integer;
begin
 if (select count(*) from public.proposal_evidence) <> 1 then raise exception 'Owner isolation failed'; end if;
 update public.proposal_evidence set approved=false where id='a4444444-4444-4444-8444-444444444444';
 get diagnostics changed = row_count;
 if changed <> 0 then raise exception 'Foreign approval changed'; end if;
 delete from public.proposal_evidence where id='a4444444-4444-4444-8444-444444444444';
 get diagnostics changed = row_count;
 if changed <> 0 then raise exception 'Foreign evidence deleted'; end if;
 begin
  update public.proposal_evidence set content='Changed after approval';
  raise exception 'Approved source content was mutable';
 exception when insufficient_privilege then null;
 end;
 begin
  insert into public.proposal_evidence(user_id,title,kind,sector,content,source_label,rights_confirmed)
  values ('a2222222-2222-4222-8222-222222222222','Forged','company_evidence','All','Forged','Fixture',true);
  raise exception 'Foreign owner insertion succeeded';
 exception when insufficient_privilege then null;
 end;
 update public.proposal_evidence set approved=false where id='a3333333-3333-4333-8333-333333333333';
 get diagnostics changed = row_count;
 if changed <> 1 then raise exception 'Owner could not withdraw approval'; end if;
end $$;
reset role;
set local role anon;
do $$ begin
 if has_table_privilege('anon','public.proposal_evidence','SELECT') then raise exception 'Anonymous SELECT allowed'; end if;
end $$;
reset role;
rollback;
