-- Focused student planner additions. Existing Kanban tasks remain valid.
alter table public.tasks
  add column planned_date date,
  add column estimate_minutes integer,
  add constraint tasks_planned_date_valid check (planned_date is null or planned_date <= due_date),
  add constraint tasks_estimate_minutes_valid check (estimate_minutes is null or estimate_minutes between 5 and 10080);

grant update (planned_date, estimate_minutes) on public.tasks to authenticated;

create table public.task_steps (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks (id) on delete cascade,
  title text not null,
  position integer not null,
  is_completed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint task_steps_title_valid check (char_length(btrim(title)) between 1 and 240),
  constraint task_steps_position_valid check (position >= 0)
);

create index task_steps_task_position_idx on public.task_steps (task_id, position);

create trigger task_steps_set_updated_at
before update on public.task_steps
for each row execute function public.set_cali_updated_at();

alter table public.task_steps enable row level security;
revoke all privileges on public.task_steps from public, anon, authenticated;
grant select on public.task_steps to authenticated;

create policy task_steps_select_own on public.task_steps
for select to authenticated
using (exists (
  select 1 from public.tasks
  where tasks.id = task_steps.task_id
    and tasks.user_id = (select auth.uid())
));

create policy task_steps_eligible on public.task_steps as restrictive
for select to authenticated
using ((select public.cali_is_eligible_user()));

create function public.cali_replace_own_task_steps(p_task_id uuid, p_steps jsonb)
returns setof public.task_steps
language plpgsql
security definer
set search_path = ''
as $$
declare
  account_id uuid := (select auth.uid());
  step_item jsonb;
  step_position integer := 0;
  step_title text;
begin
  if account_id is null or not public.cali_is_eligible_user() then
    raise exception 'A verified RTU Google account is required' using errcode = '42501';
  end if;
  if not exists (select 1 from public.tasks where id = p_task_id and user_id = account_id) then
    raise exception 'Task not found' using errcode = 'P0002';
  end if;
  if p_steps is null or jsonb_typeof(p_steps) <> 'array' or jsonb_array_length(p_steps) > 50 then
    raise exception 'Invalid task checklist' using errcode = '22023';
  end if;

  delete from public.task_steps where task_id = p_task_id;
  for step_item in select value from jsonb_array_elements(p_steps)
  loop
    step_title := btrim(coalesce(step_item ->> 'title', ''));
    if char_length(step_title) not between 1 and 240 then
      raise exception 'Invalid checklist step' using errcode = '22023';
    end if;
    insert into public.task_steps (task_id, title, position, is_completed)
    values (p_task_id, step_title, step_position, coalesce((step_item ->> 'is_completed')::boolean, false));
    step_position := step_position + 1;
  end loop;

  return query select * from public.task_steps where task_id = p_task_id order by position;
end;
$$;

revoke all on function public.cali_replace_own_task_steps(uuid, jsonb) from public, anon;
grant execute on function public.cali_replace_own_task_steps(uuid, jsonb) to authenticated;

create function public.cali_set_own_task_step_complete(p_step_id uuid, p_completed boolean)
returns public.task_steps
language plpgsql
security definer
set search_path = ''
as $$
declare
  account_id uuid := (select auth.uid());
  parent_task_id uuid;
  parent_status text;
  changed_step public.task_steps;
begin
  if account_id is null or not public.cali_is_eligible_user() then
    raise exception 'A verified RTU Google account is required' using errcode = '42501';
  end if;
  select tasks.id, tasks.status into parent_task_id, parent_status
  from public.task_steps
  join public.tasks on tasks.id = task_steps.task_id
  where task_steps.id = p_step_id and tasks.user_id = account_id;
  if parent_task_id is null then
    raise exception 'Checklist step not found' using errcode = 'P0002';
  end if;
  if parent_status = 'done' then
    raise exception 'Reopen the task before changing its checklist' using errcode = '22023';
  end if;

  update public.task_steps set is_completed = p_completed
  where id = p_step_id returning * into changed_step;
  if p_completed and parent_status = 'todo' then
    perform public.cali_move_own_task(parent_task_id, 'in_progress', 2147483647);
  end if;
  return changed_step;
end;
$$;

revoke all on function public.cali_set_own_task_step_complete(uuid, boolean) from public, anon;
grant execute on function public.cali_set_own_task_step_complete(uuid, boolean) to authenticated;
