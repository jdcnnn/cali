-- Delete every current category of user-owned Cali data explicitly, in one
-- transaction, before removing the Auth account. Foreign-key cascades remain
-- in place as a second layer of protection.
create or replace function public.cali_delete_own_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  account_id uuid := (select auth.uid());
begin
  if account_id is null then
    raise exception 'Authentication is required' using errcode = '42501';
  end if;

  delete from public.reminder_deliveries
  where reminder_id in (
    select id from public.reminder_queue where user_id = account_id
  ) or subscription_id in (
    select id from public.push_subscriptions where user_id = account_id
  );
  delete from public.reminder_queue where user_id = account_id;
  delete from public.push_subscriptions where user_id = account_id;

  delete from public.task_steps
  where task_id in (select id from public.tasks where user_id = account_id);
  delete from public.tasks where user_id = account_id;
  delete from public.calendar_events where user_id = account_id;

  delete from public.schedule_meetings
  where subject_id in (select id from public.schedule_subjects where user_id = account_id);
  delete from public.schedule_subjects where user_id = account_id;
  delete from public.students where user_id = account_id;

  delete from auth.users where id = account_id;
  if not found then
    raise exception 'Account not found' using errcode = 'P0002';
  end if;
end;
$$;

revoke all on function public.cali_delete_own_account() from public, anon;
grant execute on function public.cali_delete_own_account() to authenticated;
