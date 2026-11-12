-- Checkout plan switching: an unfinished checkout for another plan is superseded
-- instead of blocking every other plan for 31 minutes.
-- Previously cc_begin_checkout raised PT409 ('An unfinished checkout exists for
-- another plan') whenever a customer who had started one plan clicked a
-- different plan, and the error was surfaced only as the generic 'The record
-- changed or is no longer available', with no way to resume or switch. A
-- customer who picked the wrong plan first could not buy any other plan.
-- The supersede keeps the same-plan reuse behaviour. Paid duplicates remain
-- blocked by the subscription check in the checkout function, which runs
-- before a Stripe session is created; the abandoned Stripe session simply
-- expires unused. The provider id is cleared on supersede so checkout status
-- never reports the abandoned session.
begin;
create or replace function public.cc_begin_checkout(p_user uuid,p_key uuid,p_plan text) returns jsonb language plpgsql security invoker set search_path='' as $$
declare c public.cc_checkouts;
begin
 if p_plan not in ('pro','growth','enterprise') then raise exception 'Invalid checkout plan' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended('checkout:'||p_user::text,0));
 select * into c from public.cc_checkouts where user_id=p_user for update;
 if found and c.expires_at>now() and c.state<>'Failed' and c.plan=p_plan then
  return to_jsonb(c);
 end if;
 insert into public.cc_checkouts(user_id,request_key,plan,state,expires_at) values(p_user,p_key,p_plan,'Pending',now()+interval '31 minutes') on conflict(user_id) do update set request_key=excluded.request_key,plan=excluded.plan,state='Pending',url=null,provider_id=null,expires_at=excluded.expires_at,updated_at=now() returning * into c;
 return to_jsonb(c);
end$$;
commit;
