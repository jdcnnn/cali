-- Revert the Study AI path while preserving private, manual reviewers.
drop function if exists public.cali_reserve_reviewer_generation(uuid, uuid, text, text);
drop function if exists public.cali_complete_reviewer_generation(uuid, uuid, text, text, jsonb, text);
drop function if exists public.cali_fail_reviewer_generation(uuid, uuid, text);
drop function if exists public.cali_save_own_generated_reviewer(uuid, uuid);
drop function if exists public.cali_discard_own_generated_reviewer(uuid);
drop function if exists public.cali_reviewer_ai_quota();

drop table if exists public.reviewer_ai_drafts;
drop table if exists public.reviewer_ai_requests;

create or replace function public.cali_duplicate_own_reviewer(p_id uuid)
returns public.reviewers
language plpgsql security definer set search_path = ''
as $$
declare
  account_id uuid := (select auth.uid());
  copied public.reviewers;
begin
  if account_id is null or not public.cali_is_eligible_user() then
    raise exception 'A verified RTU Google account is required' using errcode = '42501';
  end if;
  insert into public.reviewers (user_id, subject_id, title, content, plain_text)
  select account_id, subject_id, left(title || ' copy', 160), content, plain_text
  from public.reviewers where id = p_id and user_id = account_id
  returning * into copied;
  if copied.id is null then raise exception 'Reviewer not found' using errcode = 'P0002'; end if;
  return copied;
end;
$$;

revoke all on function public.cali_duplicate_own_reviewer(uuid) from public, anon;
grant execute on function public.cali_duplicate_own_reviewer(uuid) to authenticated;

alter table public.reviewers
  drop constraint if exists reviewers_origin_valid,
  drop column if exists origin,
  drop column if exists ai_model;

create or replace function public.cali_delete_own_account()
returns void language plpgsql security definer set search_path = ''
as $$
declare account_id uuid := (select auth.uid());
begin
  if account_id is null then raise exception 'Authentication is required' using errcode = '42501'; end if;
  delete from public.reminder_deliveries where reminder_id in (select id from public.reminder_queue where user_id = account_id) or subscription_id in (select id from public.push_subscriptions where user_id = account_id);
  delete from public.reminder_queue where user_id = account_id;
  delete from public.push_subscriptions where user_id = account_id;
  delete from public.task_steps where task_id in (select id from public.tasks where user_id = account_id);
  delete from public.tasks where user_id = account_id;
  delete from public.calendar_events where user_id = account_id;
  delete from public.reviewers where user_id = account_id;
  delete from public.schedule_meetings where subject_id in (select id from public.schedule_subjects where user_id = account_id);
  delete from public.schedule_subjects where user_id = account_id;
  delete from public.students where user_id = account_id;
  delete from auth.users where id = account_id;
  if not found then raise exception 'Account not found' using errcode = 'P0002'; end if;
end;
$$;

revoke all on function public.cali_delete_own_account() from public, anon;
grant execute on function public.cali_delete_own_account() to authenticated;
