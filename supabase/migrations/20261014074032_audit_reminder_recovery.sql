-- Recover leases and weekly successors without changing reminder times.
set local lock_timeout = '5s';
alter table public.community_notifications add column push_claim_token uuid;
CREATE OR REPLACE FUNCTION public.cali_claim_due_reminders(p_limit integer DEFAULT 50)
 RETURNS SETOF reminder_queue
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare claim uuid := gen_random_uuid(); expired record; meeting_id uuid;
begin
  update public.reminder_queue
  set status = 'pending', claim_token = null, claimed_at = null,
      next_attempt_at = least(next_attempt_at, current_timestamp)
  where status = 'processing' and claimed_at < current_timestamp - interval '5 minutes';

  for expired in
    update public.reminder_queue
    set status='missed',claim_token=null,claimed_at=null,last_error='Reminder expired or retries exhausted'
    where status='pending' and (scheduled_for < current_timestamp-interval '15 minutes' or attempts>=3)
    returning item_type,item_id
  loop
    if expired.item_type='class' then perform public.cali_queue_next_class_reminder(expired.item_id); end if;
  end loop;
  -- Repair missing successors, including meetings restored after suspension.
  for meeting_id in
    select m.id from public.schedule_meetings m join public.schedule_subjects s on s.id=m.subject_id
    join public.students owner on owner.user_id=s.user_id
    where m.reminder_minutes is not null and owner.suspended_at is null
      and not exists(select 1 from public.reminder_queue q where q.item_type='class' and q.item_id=m.id
        and q.status in ('pending','processing') and q.scheduled_for>=current_timestamp-interval '15 minutes')
  loop perform public.cali_queue_next_class_reminder(meeting_id); end loop;

  return query
  with due as (
    select id from public.reminder_queue
    where status = 'pending'
      and attempts < 3
      and scheduled_for between current_timestamp - interval '15 minutes' and current_timestamp
      and next_attempt_at <= current_timestamp
    order by scheduled_for
    limit greatest(1, least(coalesce(p_limit, 50), 200))
    for update skip locked
  )
  update public.reminder_queue queue
  set status = 'processing', attempts = queue.attempts + 1, claim_token = claim, claimed_at = current_timestamp
  from due where queue.id = due.id
  returning queue.*;
end;
$function$;

create or replace function public.cali_claim_community_notifications(p_limit integer default 50)
returns setof public.community_notifications language plpgsql security definer set search_path='' as $$
declare claim uuid := gen_random_uuid();
begin
  update public.community_notifications
  set push_status='pending',push_claimed_at=null,push_claim_token=null
  where push_status='processing' and push_claimed_at<now()-interval '5 minutes';
  update public.community_notifications
  set push_status='missed',push_claimed_at=null,push_claim_token=null,push_last_error='Notification expired or retries exhausted'
  where push_status='pending' and (push_attempts>=3 or created_at<now()-interval '24 hours');
  return query
  with due as (
    select q.id from public.community_notifications q join public.students s on s.user_id=q.user_id
    where q.push_status='pending' and q.push_next_attempt_at<=now() and s.suspended_at is null and q.push_attempts<3
    order by q.created_at limit least(greatest(coalesce(p_limit,50),1),100) for update of q skip locked
  )
  update public.community_notifications n set push_status='processing',push_claimed_at=now(),
    push_claim_token=claim,push_attempts=n.push_attempts+1
  from due where n.id=due.id returning n.*;
end $$;
revoke all on function public.cali_claim_community_notifications(integer) from public,anon,authenticated;
grant execute on function public.cali_claim_community_notifications(integer) to service_role;
create index if not exists community_notifications_push_lease_idx on public.community_notifications(push_claimed_at) where push_status='processing';
create index if not exists reminder_queue_claim_lease_idx on public.reminder_queue(claimed_at) where status='processing';

