-- One revision per student's weekly schedule. All manual edits and imports bump it.
create table public.schedule_revisions (
  user_id uuid primary key references public.students (user_id) on delete cascade,
  revision bigint not null default 0
);
alter table public.schedule_revisions enable row level security;
revoke all on public.schedule_revisions from public, anon, authenticated;

create function public.cali_bump_schedule_revision()
returns trigger language plpgsql security definer set search_path = '' as $$
declare owner_id uuid;
begin
  if TG_TABLE_NAME = 'schedule_subjects' then
    owner_id := case when TG_OP = 'DELETE' then OLD.user_id else NEW.user_id end;
  else
    select s.user_id into owner_id from public.schedule_subjects s
    where s.id = case when TG_OP = 'DELETE' then OLD.subject_id else NEW.subject_id end;
  end if;
  if owner_id is not null then
    insert into public.schedule_revisions (user_id, revision) values (owner_id, 1)
    on conflict (user_id) do update set revision = public.schedule_revisions.revision + 1;
  end if;
  return case when TG_OP = 'DELETE' then OLD else NEW end;
end;
$$;

create trigger schedule_subjects_revision before insert or update or delete on public.schedule_subjects
for each row execute function public.cali_bump_schedule_revision();
create trigger schedule_meetings_revision before insert or update or delete on public.schedule_meetings
for each row execute function public.cali_bump_schedule_revision();

create function public.cali_schedule_revision()
returns bigint language plpgsql stable security definer set search_path = '' as $$
declare result bigint;
begin
  if auth.uid() is null or not public.cali_is_eligible_user() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  select coalesce(r.revision, 0) into result from public.schedule_revisions r where r.user_id = auth.uid();
  return coalesce(result, 0);
end;
$$;
revoke all on function public.cali_schedule_revision() from public, anon;
grant execute on function public.cali_schedule_revision() to authenticated;

create function public.cali_replace_weekly_schedule(p_subjects jsonb, p_expected_revision bigint)
returns bigint language plpgsql security definer set search_path = '' as $$
declare
  owner_id uuid := auth.uid();
  actual_revision bigint;
  subject_item jsonb;
  meeting_item jsonb;
  subject_id uuid;
  subject_count integer;
  meeting_count integer := 0;
  day text;
  start_time text;
  end_time text;
  room_text text;
  code_text text;
  title_text text;
  block_text text;
  units_text text;
  meeting_key text;
  seen_meetings text[] := array[]::text[];
begin
  if owner_id is null or not public.cali_is_eligible_user()
     or not exists (select 1 from public.students where user_id = owner_id) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  if jsonb_typeof(p_subjects) <> 'array' then raise exception 'Invalid subjects'; end if;
  subject_count := jsonb_array_length(p_subjects);
  if subject_count < 1 or subject_count > 40 then raise exception 'Choose 1 to 40 subjects'; end if;

  insert into public.schedule_revisions (user_id) values (owner_id) on conflict do nothing;
  select revision into actual_revision from public.schedule_revisions where user_id = owner_id for update;
  if p_expected_revision is distinct from actual_revision then
    raise exception 'Your schedule changed in another tab. Review it again before replacing.' using errcode = '40001';
  end if;

  -- Validate the entire proposal before deleting existing rows.
  for subject_item in select value from jsonb_array_elements(p_subjects) loop
    if jsonb_typeof(subject_item) <> 'object' then raise exception 'Invalid subject'; end if;
    code_text := btrim(subject_item->>'subject_code');
    title_text := btrim(subject_item->>'title');
    block_text := btrim(subject_item->>'block_section');
    units_text := subject_item->>'units';
    if code_text is null or char_length(code_text) not between 1 and 40
       or title_text is null or char_length(title_text) not between 1 and 200
       or block_text is null or char_length(block_text) not between 1 and 80
       or units_text is null or units_text !~ '^\d{1,2}(\.\d)?$'
       or units_text::numeric > 30 then raise exception 'Invalid subject fields'; end if;
    if jsonb_typeof(subject_item->'meetings') <> 'array' then raise exception 'Invalid meetings'; end if;
    meeting_count := meeting_count + jsonb_array_length(subject_item->'meetings');
    if meeting_count > 100 then raise exception 'Too many meetings'; end if;
    for meeting_item in select value from jsonb_array_elements(subject_item->'meetings') loop
      if jsonb_typeof(meeting_item) <> 'object' then raise exception 'Invalid meeting'; end if;
      day := meeting_item->>'day_code';
      start_time := meeting_item->>'starts_at';
      end_time := meeting_item->>'ends_at';
      room_text := nullif(btrim(meeting_item->>'room'), '');
      if day not in ('M','T','W','H','F','S','U') or day is null
         or start_time is null or start_time !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
         or end_time is null or end_time !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
         or start_time >= end_time or (room_text is not null and
         (char_length(room_text) > 120 or upper(room_text) = 'N/A')) then
        raise exception 'Invalid meeting fields';
      end if;
      meeting_key := upper(code_text) || '|' || day || '|' || start_time || '|' || end_time;
      if meeting_key = any(seen_meetings) then raise exception 'Duplicate meeting'; end if;
      seen_meetings := array_append(seen_meetings, meeting_key);
    end loop;
  end loop;

  delete from public.schedule_subjects where user_id = owner_id;
  for subject_item in select value from jsonb_array_elements(p_subjects) loop
    insert into public.schedule_subjects (user_id, subject_code, title, units, block_section)
    values (owner_id, btrim(subject_item->>'subject_code'), btrim(subject_item->>'title'),
      (subject_item->>'units')::numeric, btrim(subject_item->>'block_section')) returning id into subject_id;
    for meeting_item in select value from jsonb_array_elements(subject_item->'meetings') loop
      insert into public.schedule_meetings (subject_id, day_code, starts_at, ends_at, room)
      values (subject_id, meeting_item->>'day_code', (meeting_item->>'starts_at')::time,
        (meeting_item->>'ends_at')::time, nullif(btrim(meeting_item->>'room'), ''));
    end loop;
  end loop;
  select revision into actual_revision from public.schedule_revisions where user_id = owner_id;
  return actual_revision;
end;
$$;
revoke all on function public.cali_replace_weekly_schedule(jsonb, bigint) from public, anon;
grant execute on function public.cali_replace_weekly_schedule(jsonb, bigint) to authenticated;

create table public.schedule_parse_limits (
  user_id uuid primary key references public.students (user_id) on delete cascade,
  window_start timestamptz not null,
  attempts smallint not null
);
alter table public.schedule_parse_limits enable row level security;
revoke all on public.schedule_parse_limits from public, anon, authenticated;

create function public.cali_claim_schedule_parse()
returns void language plpgsql security definer set search_path = '' as $$
declare current_attempts smallint;
begin
  if auth.uid() is null or not public.cali_is_eligible_user()
     or not exists (select 1 from public.students where user_id = auth.uid()) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  insert into public.schedule_parse_limits (user_id, window_start, attempts)
  values (auth.uid(), now(), 1)
  on conflict (user_id) do update set
    window_start = case when public.schedule_parse_limits.window_start < now() - interval '10 minutes' then now() else public.schedule_parse_limits.window_start end,
    attempts = case when public.schedule_parse_limits.window_start < now() - interval '10 minutes' then 1 else public.schedule_parse_limits.attempts + 1 end
  returning attempts into current_attempts;
  if current_attempts > 5 then raise exception 'Too many schedule parsing attempts'; end if;
end;
$$;
revoke all on function public.cali_claim_schedule_parse() from public, anon;
grant execute on function public.cali_claim_schedule_parse() to authenticated;
