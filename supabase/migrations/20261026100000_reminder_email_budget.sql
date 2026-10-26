-- Free-plan reminder admission; no content, email addresses or customer tables rewritten.
begin;
create table public.cc_reminder_budget(
 day date not null,notification_id uuid not null,primary key(day,notification_id)
);
alter table public.cc_reminder_budget enable row level security;
revoke all on public.cc_reminder_budget from public,anon,authenticated;
grant all on public.cc_reminder_budget to service_role;
create function public.cc_admit_reminder(p_notification uuid) returns boolean
language plpgsql security invoker set search_path='' as $$
declare today date:=(now() at time zone 'UTC')::date;
begin
 if not exists(select 1 from public.pw_notifications where id=p_notification and email_state='Sending') then return false;end if;
 perform pg_advisory_xact_lock(hashtextextended('reminder-budget:'||today::text,0));
 if exists(select 1 from public.cc_reminder_budget where day=today and notification_id=p_notification) then return true;end if;
 if (select count(*) from public.cc_reminder_budget where day=today)>=5 then return false;end if;
 insert into public.cc_reminder_budget(day,notification_id) values(today,p_notification);
 return true;
end$$;
revoke all on function public.cc_admit_reminder(uuid) from public,anon,authenticated;
grant execute on function public.cc_admit_reminder(uuid) to service_role;
commit;
