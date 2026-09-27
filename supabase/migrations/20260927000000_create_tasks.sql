-- Private, student-owned Kanban tasks. Status and ordering are changed only
-- through trusted functions so cross-column moves stay atomic.
create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.students (user_id) on delete cascade,
  schedule_subject_id uuid references public.schedule_subjects (id) on delete set null,
  title text not null,
  notes text,
  due_date date not null,
  due_time time without time zone,
  priority text not null default 'medium',
  status text not null default 'todo',
  position integer not null,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tasks_title_valid check (char_length(btrim(title)) between 1 and 160),
  constraint tasks_notes_valid check (notes is null or char_length(notes) <= 4000),
  constraint tasks_priority_valid check (priority in ('low', 'medium', 'high')),
  constraint tasks_status_valid check (status in ('todo', 'in_progress', 'done')),
  constraint tasks_position_valid check (position >= 0),
  constraint tasks_completion_valid check (
    (status = 'done' and completed_at is not null)
    or (status <> 'done' and completed_at is null)
  )
);

create index tasks_user_status_position_idx on public.tasks (user_id, status, position);
create index tasks_user_due_idx on public.tasks (user_id, due_date, due_time);
create index tasks_schedule_subject_id_idx on public.tasks (schedule_subject_id);

create trigger tasks_set_updated_at
before update on public.tasks
for each row execute function public.set_cali_updated_at();

alter table public.tasks enable row level security;

revoke all privileges on public.tasks from public, anon, authenticated;
grant select on public.tasks to authenticated;
grant update (title, notes, schedule_subject_id, due_date, due_time, priority) on public.tasks to authenticated;
grant delete on public.tasks to authenticated;

create policy tasks_select_own on public.tasks
for select to authenticated
using ((select auth.uid()) = user_id);

create policy tasks_update_own on public.tasks
for update to authenticated
using ((select auth.uid()) = user_id)
with check (
  (select auth.uid()) = user_id
  and (
    schedule_subject_id is null
    or exists (
      select 1 from public.schedule_subjects as subject
      where subject.id = schedule_subject_id
        and subject.user_id = (select auth.uid())
    )
  )
);

create policy tasks_delete_own on public.tasks
for delete to authenticated
using ((select auth.uid()) = user_id);

create policy tasks_eligible on public.tasks as restrictive
for all to authenticated
using ((select public.cali_is_eligible_user()))
with check ((select public.cali_is_eligible_user()));

create function public.cali_create_own_task(
  p_title text,
  p_notes text,
  p_schedule_subject_id uuid,
  p_due_date date,
  p_due_time time without time zone,
  p_priority text
)
returns public.tasks
language plpgsql
security definer
set search_path = ''
as $$
declare
  account_id uuid := (select auth.uid());
  next_position integer;
  created_task public.tasks;
begin
  if account_id is null or not public.cali_is_eligible_user() then
    raise exception 'A verified RTU Google account is required' using errcode = '42501';
  end if;
  if p_title is null or char_length(btrim(p_title)) not between 1 and 160
     or p_due_date is null
     or p_priority is null or p_priority not in ('low', 'medium', 'high')
     or (p_notes is not null and char_length(p_notes) > 4000) then
    raise exception 'Invalid task details' using errcode = '22023';
  end if;
  if p_schedule_subject_id is not null and not exists (
    select 1 from public.schedule_subjects
    where id = p_schedule_subject_id and user_id = account_id
  ) then
    raise exception 'The selected subject is unavailable' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(account_id::text, 0));
  select coalesce(max(position) + 1, 0) into next_position
  from public.tasks where user_id = account_id and status = 'todo';

  insert into public.tasks (
    user_id, schedule_subject_id, title, notes, due_date, due_time,
    priority, status, position, completed_at
  ) values (
    account_id, p_schedule_subject_id, btrim(p_title), nullif(btrim(coalesce(p_notes, '')), ''),
    p_due_date, p_due_time, p_priority, 'todo', next_position, null
  ) returning * into created_task;

  return created_task;
end;
$$;

revoke all on function public.cali_create_own_task(text, text, uuid, date, time without time zone, text) from public, anon;
grant execute on function public.cali_create_own_task(text, text, uuid, date, time without time zone, text) to authenticated;

create function public.cali_move_own_task(
  p_task_id uuid,
  p_target_status text,
  p_target_index integer
)
returns public.tasks
language plpgsql
security definer
set search_path = ''
as $$
declare
  account_id uuid := (select auth.uid());
  source_status text;
  bounded_index integer;
  target_count integer;
  moved_task public.tasks;
begin
  if account_id is null or not public.cali_is_eligible_user() then
    raise exception 'A verified RTU Google account is required' using errcode = '42501';
  end if;
  if p_target_status is null or p_target_status not in ('todo', 'in_progress', 'done')
     or p_target_index is null or p_target_index < 0 then
    raise exception 'Invalid task destination' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(account_id::text, 0));
  select status into source_status from public.tasks
  where id = p_task_id and user_id = account_id for update;
  if source_status is null then
    raise exception 'Task not found' using errcode = 'P0002';
  end if;

  select count(*) into target_count from public.tasks
  where user_id = account_id and status = p_target_status and id <> p_task_id;
  bounded_index := least(p_target_index, target_count);

  if source_status = p_target_status then
    with ordered as (
      select id, (row_number() over (order by position, created_at, id) - 1)::integer as item_index
      from public.tasks
      where user_id = account_id and status = source_status and id <> p_task_id
    )
    update public.tasks as task
    set position = case
      when ordered.item_index < bounded_index then ordered.item_index
      else ordered.item_index + 1
    end
    from ordered where task.id = ordered.id;
  else
    with source_ordered as (
      select id, (row_number() over (order by position, created_at, id) - 1)::integer as item_index
      from public.tasks
      where user_id = account_id and status = source_status and id <> p_task_id
    )
    update public.tasks as task set position = source_ordered.item_index
    from source_ordered where task.id = source_ordered.id;

    with target_ordered as (
      select id, (row_number() over (order by position, created_at, id) - 1)::integer as item_index
      from public.tasks
      where user_id = account_id and status = p_target_status and id <> p_task_id
    )
    update public.tasks as task
    set position = case
      when target_ordered.item_index < bounded_index then target_ordered.item_index
      else target_ordered.item_index + 1
    end
    from target_ordered where task.id = target_ordered.id;
  end if;

  update public.tasks
  set status = p_target_status,
      position = bounded_index,
      completed_at = case
        when p_target_status = 'done' then coalesce(completed_at, now())
        else null
      end
  where id = p_task_id and user_id = account_id
  returning * into moved_task;

  return moved_task;
end;
$$;

revoke all on function public.cali_move_own_task(uuid, text, integer) from public, anon;
grant execute on function public.cali_move_own_task(uuid, text, integer) to authenticated;
