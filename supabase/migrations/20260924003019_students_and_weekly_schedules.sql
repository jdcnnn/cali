-- CALI's first application tables. Supabase Auth remains the source of truth for
-- institutional email, Google full name, and Google avatar.

create table public.students (
  user_id uuid primary key references auth.users (id) on delete cascade,
  username text not null unique,
  program text not null,
  year_level smallint not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint students_username_format check (username ~ '^[a-z0-9_]{3,30}$'),
  constraint students_program_nonblank check (char_length(btrim(program)) between 1 and 120),
  constraint students_year_level_valid check (year_level between 1 and 5)
);

create table public.schedule_subjects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.students (user_id) on delete cascade,
  subject_code text not null,
  title text not null,
  units numeric(4, 1) not null,
  block_section text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint schedule_subjects_code_nonblank check (char_length(btrim(subject_code)) between 1 and 40),
  constraint schedule_subjects_title_nonblank check (char_length(btrim(title)) between 1 and 200),
  constraint schedule_subjects_units_valid check (units between 0 and 30),
  constraint schedule_subjects_block_nonblank check (char_length(btrim(block_section)) between 1 and 80)
);

create index schedule_subjects_user_id_idx on public.schedule_subjects (user_id);

create table public.schedule_meetings (
  id uuid primary key default gen_random_uuid(),
  subject_id uuid not null references public.schedule_subjects (id) on delete cascade,
  day_code char(1) not null,
  starts_at time without time zone not null,
  ends_at time without time zone not null,
  room text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint schedule_meetings_day_valid check (day_code in ('M', 'T', 'W', 'H', 'F', 'S', 'U')),
  constraint schedule_meetings_time_order check (starts_at < ends_at),
  constraint schedule_meetings_room_valid check (
    room is null or (
      char_length(btrim(room)) between 1 and 120
      and upper(btrim(room)) <> 'N/A'
    )
  )
);

create index schedule_meetings_subject_id_idx on public.schedule_meetings (subject_id);

create function public.set_cali_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger students_set_updated_at
before update on public.students
for each row execute function public.set_cali_updated_at();

create trigger schedule_subjects_set_updated_at
before update on public.schedule_subjects
for each row execute function public.set_cali_updated_at();

create trigger schedule_meetings_set_updated_at
before update on public.schedule_meetings
for each row execute function public.set_cali_updated_at();

alter table public.students enable row level security;
alter table public.schedule_subjects enable row level security;
alter table public.schedule_meetings enable row level security;

-- Supabase's default public-schema grants can be broader than CALI needs.
-- Students may edit only CALI-owned fields, never ownership or timestamps.
revoke all privileges on public.students from public, anon, authenticated;
revoke all privileges on public.schedule_subjects from public, anon, authenticated;
revoke all privileges on public.schedule_meetings from public, anon, authenticated;

grant select on public.students to authenticated;
grant insert (user_id, username, program, year_level) on public.students to authenticated;
grant update (username, program, year_level) on public.students to authenticated;

grant select on public.schedule_subjects to authenticated;
grant insert (user_id, subject_code, title, units, block_section) on public.schedule_subjects to authenticated;
grant update (subject_code, title, units, block_section) on public.schedule_subjects to authenticated;
grant delete on public.schedule_subjects to authenticated;

grant select on public.schedule_meetings to authenticated;
grant insert (subject_id, day_code, starts_at, ends_at, room) on public.schedule_meetings to authenticated;
grant update (day_code, starts_at, ends_at, room) on public.schedule_meetings to authenticated;
grant delete on public.schedule_meetings to authenticated;

create policy students_select_own on public.students
for select to authenticated
using ((select auth.uid()) = user_id);

create policy students_insert_own on public.students
for insert to authenticated
with check ((select auth.uid()) = user_id);

create policy students_update_own on public.students
for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy schedule_subjects_select_own on public.schedule_subjects
for select to authenticated
using ((select auth.uid()) = user_id);

create policy schedule_subjects_insert_own on public.schedule_subjects
for insert to authenticated
with check ((select auth.uid()) = user_id);

create policy schedule_subjects_update_own on public.schedule_subjects
for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy schedule_subjects_delete_own on public.schedule_subjects
for delete to authenticated
using ((select auth.uid()) = user_id);

create policy schedule_meetings_select_own on public.schedule_meetings
for select to authenticated
using (
  exists (
    select 1 from public.schedule_subjects as subject
    where subject.id = subject_id and subject.user_id = (select auth.uid())
  )
);

create policy schedule_meetings_insert_own on public.schedule_meetings
for insert to authenticated
with check (
  exists (
    select 1 from public.schedule_subjects as subject
    where subject.id = subject_id and subject.user_id = (select auth.uid())
  )
);

create policy schedule_meetings_update_own on public.schedule_meetings
for update to authenticated
using (
  exists (
    select 1 from public.schedule_subjects as subject
    where subject.id = subject_id and subject.user_id = (select auth.uid())
  )
)
with check (
  exists (
    select 1 from public.schedule_subjects as subject
    where subject.id = subject_id and subject.user_id = (select auth.uid())
  )
);

create policy schedule_meetings_delete_own on public.schedule_meetings
for delete to authenticated
using (
  exists (
    select 1 from public.schedule_subjects as subject
    where subject.id = subject_id and subject.user_id = (select auth.uid())
  )
);
