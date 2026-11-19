-- Raise the database-side RFP analysis chunk bound from 16 to 32 chunks so
-- it matches the JavaScript cap (MAX_CHUNKS = 32 in
-- netlify/functions/lib/compliance-document.js, raised by PR #105). Without
-- this, rfp_compliance_start rejects any analysis over 16 chunks with
-- 'invalid analysis size' (errcode 22023), which the server reports as
-- "Invalid analysis request or changed source review" — a 171,304-character
-- document (~18 chunks) failed five times live on Nov 19, 2026 before this
-- migration existed. This replaces the rfp_compliance_start body-identically
-- except for the calls bound (48 -> 96, i.e. 32 chunks x 3 calls) and re-adds
-- the chunks column CHECK at 1-32. Apply manually in the Supabase dashboard
-- SQL Editor on production; until it is applied, imports over 16 chunks
-- still fail even after the code deploys.
do $$
declare
  cname text;
begin
  select conname into cname
    from pg_constraint
   where conrelid = 'public.rfp_compliance_analyses'::regclass
     and contype = 'c'
     and pg_get_constraintdef(oid) like '%jsonb_array_length(chunks)%';
  if cname is not null then
    execute 'alter table public.rfp_compliance_analyses drop constraint ' || quote_ident(cname);
  end if;
end $$;
alter table public.rfp_compliance_analyses
  add constraint rfp_compliance_analyses_chunks_check
  check (jsonb_typeof(chunks) = 'array' and jsonb_array_length(chunks) between 1 and 32);
create or replace function public.rfp_compliance_start(
  p_user uuid, p_fingerprint text, p_documents jsonb, p_chunks jsonb, p_warnings jsonb
) returns uuid language plpgsql security invoker set search_path = '' as $$
declare saved uuid; calls integer; created integer;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user::text, 42));
  select id into saved from public.rfp_compliance_analyses where user_id=p_user and fingerprint=p_fingerprint;
  if saved is not null then return saved; end if;
  calls := jsonb_array_length(p_chunks) * 3;
  if calls < 3 or calls > 96 or jsonb_array_length(p_documents) not between 1 and 6 then
    raise exception 'invalid analysis size' using errcode='22023';
  end if;
  select count(*) into created from public.rfp_compliance_analyses
    where user_id=p_user and created_at >= (((now() at time zone 'UTC')::date)::timestamp at time zone 'UTC');
  if created >= 3 then raise exception 'daily analysis limit' using errcode='P0001'; end if;
  insert into public.rfp_compliance_daily_budget(day,reserved_calls)
    values((now() at time zone 'UTC')::date,calls)
    on conflict(day) do update set reserved_calls=public.rfp_compliance_daily_budget.reserved_calls + excluded.reserved_calls
      where public.rfp_compliance_daily_budget.reserved_calls + excluded.reserved_calls <= 500;
  if not found then raise exception 'daily AI budget limit' using errcode='P0001'; end if;
  insert into public.rfp_compliance_analyses(user_id,fingerprint,documents,chunks,warnings)
    values(p_user,p_fingerprint,p_documents,p_chunks,p_warnings) returning id into saved;
  return saved;
end $$;
