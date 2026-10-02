-- Private Web Push subscriptions and a small, indexed reminder queue.
-- All academic times are interpreted in Asia/Manila and stored as UTC instants.

alter table public.schedule_meetings
  add column reminder_minutes integer,
  add constraint schedule_meetings_reminder_valid check (reminder_minutes is null or reminder_minutes between 1 and 10080);

alter table public.tasks
  add column reminder_minutes integer,
  add constraint tasks_reminder_valid check (
    reminder_minutes is null or (reminder_minutes between 1 and 10080 and due_time is not null)
  );

alter table public.calendar_events
  add column reminder_minutes integer,
  add constraint calendar_events_reminder_valid check (
    reminder_minutes is null or (reminder_minutes between 1 and 10080 and starts_at is not null)
  );

grant update (reminder_minutes) on public.schedule_meetings to authenticated;
grant insert (reminder_minutes) on public.schedule_meetings to authenticated;
grant update (reminder_minutes) on public.tasks to authenticated;
grant update (reminder_minutes) on public.calendar_events to authenticated;

create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.students (user_id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint push_subscriptions_endpoint_valid check (char_length(endpoint) between 20 and 2048),
  constraint push_subscriptions_keys_valid check (char_length(p256dh) between 20 and 512 and char_length(auth) between 8 and 256),
  constraint push_subscriptions_user_agent_valid check (user_agent is null or char_length(user_agent) <= 1000)
);

create index push_subscriptions_user_active_idx on public.push_subscriptions (user_id, is_active);
create trigger push_subscriptions_set_updated_at before update on public.push_subscriptions
for each row execute function public.set_cali_updated_at();

alter table public.push_subscriptions enable row level security;
revoke all privileges on public.push_subscriptions from public, anon, authenticated;
grant select, insert, update, delete on public.push_subscriptions to authenticated;

create policy push_subscriptions_select_own on public.push_subscriptions for select to authenticated
using ((select auth.uid()) = user_id);
create policy push_subscriptions_insert_own on public.push_subscriptions for insert to authenticated
with check ((select auth.uid()) = user_id);
create policy push_subscriptions_update_own on public.push_subscriptions for update to authenticated
using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy push_subscriptions_delete_own on public.push_subscriptions for delete to authenticated
using ((select auth.uid()) = user_id);
create policy push_subscriptions_eligible on public.push_subscriptions as restrictive for all to authenticated
using ((select public.cali_is_eligible_user())) with check ((select public.cali_is_eligible_user()));

create function public.cali_save_own_push_subscription(
  p_endpoint text, p_p256dh text, p_auth text, p_user_agent text
)
returns public.push_subscriptions
language plpgsql security definer set search_path = ''
as $$
declare
  account_id uuid := (select auth.uid());
  saved public.push_subscriptions;
begin
  if account_id is null or not public.cali_is_eligible_user() then
    raise exception 'A verified RTU Google account is required' using errcode = '42501';
  end if;
  if char_length(p_endpoint) not between 20 and 2048
     or char_length(p_p256dh) not between 20 and 512
     or char_length(p_auth) not between 8 and 256
     or char_length(coalesce(p_user_agent, '')) > 1000 then
    raise exception 'Invalid push subscription' using errcode = '22023';
  end if;
  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth, user_agent, is_active)
  values (account_id, p_endpoint, p_p256dh, p_auth, nullif(p_user_agent, ''), true)
  on conflict (endpoint) do update set
    user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth,
    user_agent = excluded.user_agent, is_active = true
  returning * into saved;
  return saved;
end;
$$;

create function public.cali_remove_own_push_subscription(p_endpoint text)
returns void
language sql security definer set search_path = ''
as $$ delete from public.push_subscriptions where user_id = (select auth.uid()) and endpoint = p_endpoint $$;

revoke all on function public.cali_save_own_push_subscription(text, text, text, text) from public, anon;
revoke all on function public.cali_remove_own_push_subscription(text) from public, anon;
grant execute on function public.cali_save_own_push_subscription(text, text, text, text) to authenticated;
grant execute on function public.cali_remove_own_push_subscription(text) to authenticated;

create table public.reminder_queue (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.students (user_id) on delete cascade,
  item_type text not null,
  item_id uuid not null,
  occurrence_at timestamptz not null,
  scheduled_for timestamptz not null,
  status text not null default 'pending',
  attempts smallint not null default 0,
  next_attempt_at timestamptz not null default now(),
  claim_token uuid,
  claimed_at timestamptz,
  last_error text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint reminder_queue_item_type_valid check (item_type in ('class', 'task', 'event')),
  constraint reminder_queue_status_valid check (status in ('pending', 'processing', 'sent', 'missed')),
  constraint reminder_queue_attempts_valid check (attempts between 0 and 3),
  constraint reminder_queue_item_occurrence_unique unique (item_type, item_id, occurrence_at)
);

create index reminder_queue_due_idx on public.reminder_queue (scheduled_for, next_attempt_at)
where status = 'pending';
create index reminder_queue_item_pending_idx on public.reminder_queue (item_type, item_id)
where status in ('pending', 'processing');
create trigger reminder_queue_set_updated_at before update on public.reminder_queue
for each row execute function public.set_cali_updated_at();

alter table public.reminder_queue enable row level security;
revoke all privileges on public.reminder_queue from public, anon, authenticated;

create table public.reminder_deliveries (
  id uuid primary key default gen_random_uuid(),
  reminder_id uuid not null references public.reminder_queue (id) on delete cascade,
  subscription_id uuid not null references public.push_subscriptions (id) on delete cascade,
  delivered_at timestamptz not null default now(),
  unique (reminder_id, subscription_id)
);

create index reminder_deliveries_reminder_idx on public.reminder_deliveries (reminder_id);
alter table public.reminder_deliveries enable row level security;
revoke all privileges on public.reminder_deliveries from public, anon, authenticated;

create or replace function public.cali_manila_instant(p_date date, p_time time without time zone)
returns timestamptz language sql immutable set search_path = ''
as $$ select (p_date + p_time) at time zone 'Asia/Manila' $$;

create or replace function public.cali_next_class_occurrence(p_day_code char, p_starts_at time without time zone, p_reminder_minutes integer)
returns timestamptz
language plpgsql stable set search_path = ''
as $$
declare
  local_now timestamp := current_timestamp at time zone 'Asia/Manila';
  target_day integer := case p_day_code when 'M' then 1 when 'T' then 2 when 'W' then 3 when 'H' then 4 when 'F' then 5 when 'S' then 6 else 7 end;
  occurrence_local timestamp;
  occurrence timestamptz;
begin
  occurrence_local := local_now::date + ((target_day - extract(isodow from local_now)::integer + 7) % 7) + p_starts_at;
  occurrence := occurrence_local at time zone 'Asia/Manila';
  while occurrence - make_interval(mins => p_reminder_minutes) <= current_timestamp loop
    occurrence := occurrence + interval '7 days';
  end loop;
  return occurrence;
end;
$$;

create or replace function public.cali_rebuild_reminder_queue()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  owner_id uuid;
  occurrence timestamptz;
  reminder integer;
  entity_id uuid;
  entity_type text;
begin
  if tg_table_name = 'schedule_meetings' then
    entity_type := 'class';
    entity_id := case when tg_op = 'DELETE' then old.id else new.id end;
    delete from public.reminder_queue where item_type = entity_type and item_id = entity_id and status in ('pending', 'processing');
    if tg_op = 'DELETE' then return old; end if;
    if new.reminder_minutes is null then return new; end if;
    select user_id into owner_id from public.schedule_subjects where id = new.subject_id;
    occurrence := public.cali_next_class_occurrence(new.day_code, new.starts_at, new.reminder_minutes);
    reminder := new.reminder_minutes;
  elsif tg_table_name = 'tasks' then
    entity_type := 'task';
    entity_id := case when tg_op = 'DELETE' then old.id else new.id end;
    delete from public.reminder_queue where item_type = entity_type and item_id = entity_id and status in ('pending', 'processing');
    if tg_op = 'DELETE' then return old; end if;
    if new.reminder_minutes is null or new.due_time is null or new.status = 'done' then return new; end if;
    owner_id := new.user_id;
    occurrence := public.cali_manila_instant(new.due_date, new.due_time);
    reminder := new.reminder_minutes;
  else
    entity_type := 'event';
    entity_id := case when tg_op = 'DELETE' then old.id else new.id end;
    delete from public.reminder_queue where item_type = entity_type and item_id = entity_id and status in ('pending', 'processing');
    if tg_op = 'DELETE' then return old; end if;
    if new.reminder_minutes is null or new.starts_at is null then return new; end if;
    owner_id := new.user_id;
    occurrence := public.cali_manila_instant(new.event_date, new.starts_at);
    reminder := new.reminder_minutes;
  end if;

  if owner_id is not null and occurrence - make_interval(mins => reminder) > current_timestamp then
    insert into public.reminder_queue (user_id, item_type, item_id, occurrence_at, scheduled_for)
    values (owner_id, entity_type, entity_id, occurrence, occurrence - make_interval(mins => reminder))
    on conflict (item_type, item_id, occurrence_at) do nothing;
  end if;
  return new;
end;
$$;

create trigger schedule_meetings_rebuild_reminder after insert or update or delete on public.schedule_meetings
for each row execute function public.cali_rebuild_reminder_queue();
create trigger tasks_rebuild_reminder after insert or update or delete on public.tasks
for each row execute function public.cali_rebuild_reminder_queue();
create trigger calendar_events_rebuild_reminder after insert or update or delete on public.calendar_events
for each row execute function public.cali_rebuild_reminder_queue();

create or replace function public.cali_claim_due_reminders(p_limit integer default 50)
returns setof public.reminder_queue
language plpgsql security definer set search_path = ''
as $$
declare claim uuid := gen_random_uuid();
begin
  update public.reminder_queue
  set status = 'pending', claim_token = null, claimed_at = null,
      next_attempt_at = least(next_attempt_at, current_timestamp)
  where status = 'processing' and claimed_at < current_timestamp - interval '5 minutes';

  update public.reminder_queue
  set status = 'missed', last_error = 'Reminder expired before delivery'
  where status = 'pending' and scheduled_for < current_timestamp - interval '15 minutes';

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
$$;

create or replace function public.cali_queue_next_class_reminder(p_meeting_id uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare meeting public.schedule_meetings%rowtype;
declare owner_id uuid;
declare occurrence timestamptz;
begin
  select * into meeting from public.schedule_meetings where id = p_meeting_id;
  if meeting.id is null or meeting.reminder_minutes is null then return; end if;
  select user_id into owner_id from public.schedule_subjects where id = meeting.subject_id;
  occurrence := public.cali_next_class_occurrence(meeting.day_code, meeting.starts_at, meeting.reminder_minutes);
  insert into public.reminder_queue (user_id, item_type, item_id, occurrence_at, scheduled_for)
  values (owner_id, 'class', meeting.id, occurrence, occurrence - make_interval(mins => meeting.reminder_minutes))
  on conflict (item_type, item_id, occurrence_at) do nothing;
end;
$$;

revoke all on function public.cali_claim_due_reminders(integer) from public, anon, authenticated;
revoke all on function public.cali_queue_next_class_reminder(uuid) from public, anon, authenticated;
grant execute on function public.cali_claim_due_reminders(integer) to service_role;
grant execute on function public.cali_queue_next_class_reminder(uuid) to service_role;

-- Replace task creation so the reminder is saved atomically with the task.
drop function public.cali_create_own_task(text, text, uuid, date, time without time zone, text);
create function public.cali_create_own_task(
  p_title text, p_notes text, p_schedule_subject_id uuid, p_due_date date,
  p_due_time time without time zone, p_priority text, p_reminder_minutes integer
)
returns public.tasks
language plpgsql security definer set search_path = ''
as $$
declare
  account_id uuid := (select auth.uid());
  next_position integer;
  created_task public.tasks;
begin
  if account_id is null or not public.cali_is_eligible_user() then raise exception 'A verified RTU Google account is required' using errcode = '42501'; end if;
  if p_title is null or char_length(btrim(p_title)) not between 1 and 160 or p_due_date is null
     or p_priority is null or p_priority not in ('low', 'medium', 'high')
     or (p_notes is not null and char_length(p_notes) > 4000)
     or (p_reminder_minutes is not null and (p_due_time is null or p_reminder_minutes not between 1 and 10080))
  then raise exception 'Invalid task details' using errcode = '22023'; end if;
  if p_schedule_subject_id is not null and not exists (
    select 1 from public.schedule_subjects where id = p_schedule_subject_id and user_id = account_id
  ) then raise exception 'The selected subject is unavailable' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended(account_id::text, 0));
  select coalesce(max(position) + 1, 0) into next_position from public.tasks where user_id = account_id and status = 'todo';
  insert into public.tasks (user_id, schedule_subject_id, title, notes, due_date, due_time, priority, status, position, completed_at, reminder_minutes)
  values (account_id, p_schedule_subject_id, btrim(p_title), nullif(btrim(coalesce(p_notes, '')), ''), p_due_date, p_due_time,
          p_priority, 'todo', next_position, null, p_reminder_minutes)
  returning * into created_task;
  return created_task;
end;
$$;
revoke all on function public.cali_create_own_task(text, text, uuid, date, time without time zone, text, integer) from public, anon;
grant execute on function public.cali_create_own_task(text, text, uuid, date, time without time zone, text, integer) to authenticated;
