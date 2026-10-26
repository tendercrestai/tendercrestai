begin;
create function pg_temp.ok(value boolean,label text) returns void language plpgsql as $$begin if value is distinct from true then raise exception 'FAIL: %',label;end if;raise notice 'PASS: %',label;end$$;
insert into auth.users(id,email,email_confirmed_at) values('11111111-1111-4111-8111-111111111111','owner@fictional.invalid',now()),('22222222-2222-4222-8222-222222222222','other@fictional.invalid',now());
insert into rfp_submissions(id,user_id,status) values('33333333-3333-4333-8333-333333333333','11111111-1111-4111-8111-111111111111','queued');
select pg_temp.ok(not has_table_privilege('authenticated','public.cc_deliveries','select'),'customer receipt bodies cannot be read directly by a browser role');
select pg_temp.ok(not has_table_privilege('anon','public.cc_health','select'),'global operations are private');
select pg_temp.ok(not has_function_privilege('authenticated','public.cc_bind_billing(uuid,text,text,text)','execute'),'billing bindings are service-only');
select pg_temp.ok((select bool_and(relrowsecurity) from pg_class where relname in ('cc_deliveries','cc_deletion_requests','cc_billing_bindings','cc_health')),'every new continuity table enables RLS');
set local role service_role;
select pg_temp.ok(public.cc_verified_email_user('owner@fictional.invalid')='11111111-1111-4111-8111-111111111111'::uuid,'verified recipient resolution works without broad auth table grants');
select pg_temp.ok((public.cc_claim_delivery('relay:fictional-one','11111111-1111-4111-8111-111111111111','Fictional subject','Fictional draft','33333333-3333-4333-8333-333333333333')->>'send')::boolean,'first stable delivery is claimed');
do $$begin
 begin perform public.cc_claim_delivery('relay:fictional-one','11111111-1111-4111-8111-111111111111','Fictional subject','Fictional draft','33333333-3333-4333-8333-333333333333');raise exception 'FAIL duplicate in-flight send';exception when sqlstate 'PT409' then raise notice 'PASS in-flight delivery cannot be dispatched twice';end;
 begin perform public.cc_claim_delivery('relay:wrong-owner','22222222-2222-4222-8222-222222222222','Fictional subject','Fictional draft','33333333-3333-4333-8333-333333333333');raise exception 'FAIL other owner';exception when insufficient_privilege then raise notice 'PASS other user cannot attach a delivery to an owned submission';end;
end$$;
select public.cc_finish_delivery(id,'Accepted','fictional-provider-id') from cc_deliveries where delivery_key='relay:fictional-one';
select pg_temp.ok(not(public.cc_claim_delivery('relay:fictional-one','11111111-1111-4111-8111-111111111111','Fictional subject','Fictional draft','33333333-3333-4333-8333-333333333333')->>'send')::boolean,'accepted replay returns receipt rather than sending again');
do $$begin
 begin perform public.cc_claim_delivery('relay:fictional-one','11111111-1111-4111-8111-111111111111','Changed subject','Fictional draft',null);raise exception 'FAIL different body';exception when sqlstate 'PT409' then raise notice 'PASS changing a stable-key payload cannot bypass deduplication';end;
end$$;
select public.cc_claim_delivery('relay:uncertain','11111111-1111-4111-8111-111111111111','Fictional subject','Fictional draft',null);
select public.cc_finish_delivery(id,'Uncertain',null) from cc_deliveries where delivery_key='relay:uncertain';
do $$begin
 begin perform public.cc_claim_delivery('relay:uncertain','11111111-1111-4111-8111-111111111111','Fictional subject','Fictional draft',null);raise exception 'FAIL uncertainty retry';exception when sqlstate 'PT409' then raise notice 'PASS uncertain delivery requires verification before retry';end;
end$$;
select public.cc_bind_billing('11111111-1111-4111-8111-111111111111','recFictional','cus_fictional','sub_fictional');
do $$begin
 begin perform public.cc_bind_billing('22222222-2222-4222-8222-222222222222','recFictional','cus_fictional','sub_other');raise exception 'FAIL bind theft';exception when sqlstate 'PT409' then raise notice 'PASS existing Stripe customer cannot be rebound to another user';end;
end$$;
insert into public.rfp_uploads(user_id,storage_path,id,file_name) values('11111111-1111-4111-8111-111111111111','11111111-1111-4111-8111-111111111111/44444444-4444-4444-8444-444444444444/source.txt','44444444-4444-4444-8444-444444444444','Fictional unused.txt');
insert into public.cc_deletion_requests(id,user_id,document_id,kind,state,reason) values('55555555-5555-4555-8555-555555555555','11111111-1111-4111-8111-111111111111','44444444-4444-4444-8444-444444444444','rfp','Review required','Fictional unused source test');
select pg_temp.ok(not(public.cc_claim_source_deletion('11111111-1111-4111-8111-111111111111','55555555-5555-4555-8555-555555555555')->>'completed')::boolean,'only an owned unused source enters deletion state');
do $$begin
 begin insert into public.rfp_submissions(id,user_id,status,document_id) values(gen_random_uuid(),'11111111-1111-4111-8111-111111111111','queued','44444444-4444-4444-8444-444444444444');raise exception 'FAIL reference during deletion';exception when sqlstate 'PT409' then raise notice 'PASS new submission references are blocked during source deletion';end;
 begin perform public.cc_claim_source_deletion('22222222-2222-4222-8222-222222222222','55555555-5555-4555-8555-555555555555');raise exception 'FAIL delete other user';exception when insufficient_privilege then raise notice 'PASS another user cannot claim a deletion request';end;
end$$;
select public.cc_finish_source_deletion('11111111-1111-4111-8111-111111111111','55555555-5555-4555-8555-555555555555');
select pg_temp.ok((public.cc_claim_source_deletion('11111111-1111-4111-8111-111111111111','55555555-5555-4555-8555-555555555555')->>'completed')::boolean,'completed source removal is idempotent');
select pg_temp.ok((public.cc_begin_checkout('11111111-1111-4111-8111-111111111111','66666666-6666-4666-8666-666666666666','pro')->>'request_key')='66666666-6666-4666-8666-666666666666','first checkout reserves a stable user-bound request');
select pg_temp.ok((public.cc_begin_checkout('11111111-1111-4111-8111-111111111111','77777777-7777-4777-8777-777777777777','pro')->>'request_key')='66666666-6666-4666-8666-666666666666','repeated clicks reuse the protected checkout request');
do $$begin
 begin perform public.cc_begin_checkout('11111111-1111-4111-8111-111111111111',gen_random_uuid(),'growth');raise exception 'FAIL second checkout plan';exception when sqlstate 'PT409' then raise notice 'PASS concurrent different-plan checkout is rejected';end;
end$$;
select public.cc_finish_checkout('11111111-1111-4111-8111-111111111111','66666666-6666-4666-8666-666666666666','Created','https://checkout.stripe.com/c/test_fictional');
select pg_temp.ok((public.cc_begin_checkout('11111111-1111-4111-8111-111111111111',gen_random_uuid(),'pro')->>'url')='https://checkout.stripe.com/c/test_fictional','completed checkout URL is reused without creating another session');
select public.cc_claim_delivery('relay:event-race','11111111-1111-4111-8111-111111111111','Fictional subject','Fictional draft',null);
select public.cc_record_delivery_event('fictional-race-provider','Delivered','fictional-signed-event',now());
select public.cc_finish_delivery(id,'Accepted','fictional-race-provider') from public.cc_deliveries where delivery_key='relay:event-race';
select pg_temp.ok((select status='Delivered' from public.cc_deliveries where delivery_key='relay:event-race'),'a verified delivery event arriving before acceptance is reconciled');
select public.cc_record_delivery_event('fictional-race-provider','Bounced','fictional-later-bounce',now()+interval '1 second');
select public.cc_record_delivery_event('fictional-race-provider','Delivered','fictional-old-delivery',now()-interval '1 second');
select pg_temp.ok((select status='Bounced' from public.cc_deliveries where delivery_key='relay:event-race'),'out-of-order provider events cannot overwrite newer delivery evidence');
reset role;
rollback;
