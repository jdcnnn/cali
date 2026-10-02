-- Named Cali colors for class schedules and private one-day calendar events.
alter table public.schedule_subjects
add column color_key text not null default 'ocean';

alter table public.schedule_subjects
add constraint schedule_subjects_color_key_valid check (
  color_key in ('ocean', 'sky', 'teal', 'mint', 'fern', 'sunflower', 'tangerine', 'coral', 'rose', 'violet')
);

grant update (color_key) on public.schedule_subjects to authenticated;

create table public.calendar_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.students (user_id) on delete cascade,
  title text not null,
  event_date date not null,
  starts_at time without time zone,
  ends_at time without time zone,
  location text,
  notes text,
  color_key text not null default 'violet',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint calendar_events_title_valid check (char_length(btrim(title)) between 1 and 160),
  constraint calendar_events_location_valid check (location is null or char_length(location) <= 160),
  constraint calendar_events_notes_valid check (notes is null or char_length(notes) <= 4000),
  constraint calendar_events_time_valid check (ends_at is null or (starts_at is not null and ends_at > starts_at)),
  constraint calendar_events_color_key_valid check (
    color_key in ('ocean', 'sky', 'teal', 'mint', 'fern', 'sunflower', 'tangerine', 'coral', 'rose', 'violet')
  )
);

create index calendar_events_user_date_idx on public.calendar_events (user_id, event_date, starts_at);

create trigger calendar_events_set_updated_at
before update on public.calendar_events
for each row execute function public.set_cali_updated_at();

alter table public.calendar_events enable row level security;

revoke all privileges on public.calendar_events from public, anon, authenticated;
grant select, insert, update, delete on public.calendar_events to authenticated;

create policy calendar_events_select_own on public.calendar_events
for select to authenticated
using ((select auth.uid()) = user_id);

create policy calendar_events_insert_own on public.calendar_events
for insert to authenticated
with check ((select auth.uid()) = user_id);

create policy calendar_events_update_own on public.calendar_events
for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy calendar_events_delete_own on public.calendar_events
for delete to authenticated
using ((select auth.uid()) = user_id);

create policy calendar_events_eligible on public.calendar_events as restrictive
for all to authenticated
using ((select public.cali_is_eligible_user()))
with check ((select public.cali_is_eligible_user()));
