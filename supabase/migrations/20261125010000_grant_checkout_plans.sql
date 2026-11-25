-- Grant plans in the in-app trial checkout (PR #119 added them to the JS
-- plans map in netlify/functions/lib/customer-care.js, but the SQL side was
-- never widened): cc_begin_checkout still rejects every plan except
-- pro/growth/enterprise with 22023 'Invalid checkout plan', and the
-- cc_checkouts plan check rejects the same rows on insert (23514). Either
-- failure surfaces in the hub only as the generic 400 'Invalid knowledge
-- request.', and no Stripe session is ever created — that is the Nov 25,
-- 2026 checkout failure (11 attempts: dialog closes, Stripe never opens).
-- Widen both to the six plans the hub offers. The plan-switch supersede
-- semantics from 20261112094500 are unchanged.
begin;
alter table public.cc_checkouts drop constraint if exists cc_checkouts_plan_check;
alter table public.cc_checkouts add constraint cc_checkouts_plan_check check(plan in ('pro','growth','enterprise','grant-starter','grant-plus','grant-pro'));
create or replace function public.cc_begin_checkout(p_user uuid,p_key uuid,p_plan text) returns jsonb language plpgsql security invoker set search_path='' as $$
declare c public.cc_checkouts;
begin
 if p_plan not in ('pro','growth','enterprise','grant-starter','grant-plus','grant-pro') then raise exception 'Invalid checkout plan' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended('checkout:'||p_user::text,0));
 select * into c from public.cc_checkouts where user_id=p_user for update;
 if found and c.expires_at>now() and c.state<>'Failed' and c.plan=p_plan then
  return to_jsonb(c);
 end if;
 insert into public.cc_checkouts(user_id,request_key,plan,state,expires_at) values(p_user,p_key,p_plan,'Pending',now()+interval '31 minutes') on conflict(user_id) do update set request_key=excluded.request_key,plan=excluded.plan,state='Pending',url=null,provider_id=null,expires_at=excluded.expires_at,updated_at=now() returning * into c;
 return to_jsonb(c);
end$$;
commit;
