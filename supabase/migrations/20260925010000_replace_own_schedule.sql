-- Replaces the signed-in student's weekly schedule in one transaction after
-- the student has reviewed a local OCR import.

create or replace function public.replace_own_schedule(p_subjects jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_subject jsonb;
  v_meeting jsonb;
  v_meetings jsonb;
  v_subject_id uuid;
  v_subject_count integer := 0;
  v_meeting_count integer := 0;
  v_subject_code text;
  v_title text;
  v_block_section text;
  v_units numeric(4, 1);
  v_day_code text;
  v_starts_at time without time zone;
  v_ends_at time without time zone;
  v_room text;
  v_subject_key text;
  v_meeting_key text;
  v_subject_keys text[] := array[]::text[];
  v_meeting_keys text[];
begin
  if v_user_id is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;

  if jsonb_typeof(p_subjects) <> 'array' then
    raise exception 'Subjects must be an array.' using errcode = '22023';
  end if;

  v_subject_count := jsonb_array_length(p_subjects);
  if v_subject_count < 1 or v_subject_count > 50 then
    raise exception 'A replacement must contain between 1 and 50 subjects.' using errcode = '22023';
  end if;

  if not exists (select 1 from public.students where user_id = v_user_id) then
    raise exception 'Complete onboarding before saving a schedule.' using errcode = '42501';
  end if;

  -- Validate the complete payload before deleting the current schedule.
  for v_subject in select value from jsonb_array_elements(p_subjects)
  loop
    if jsonb_typeof(v_subject) <> 'object' then
      raise exception 'Each subject must be an object.' using errcode = '22023';
    end if;

    v_subject_code := btrim(coalesce(v_subject ->> 'subject_code', ''));
    v_title := btrim(coalesce(v_subject ->> 'title', ''));
    v_block_section := btrim(coalesce(v_subject ->> 'block_section', ''));

    if char_length(v_subject_code) not between 1 and 40 then
      raise exception 'Each subject needs a code of up to 40 characters.' using errcode = '22023';
    end if;
    if char_length(v_title) not between 1 and 200 then
      raise exception 'Each subject needs a title of up to 200 characters.' using errcode = '22023';
    end if;
    if char_length(v_block_section) not between 1 and 80 then
      raise exception 'Each subject needs a section of up to 80 characters.' using errcode = '22023';
    end if;
    if coalesce(v_subject ->> 'units', '') !~ '^\d{1,2}(\.\d)?$' then
      raise exception 'Each subject needs valid units with at most one decimal place.' using errcode = '22023';
    end if;
    v_units := (v_subject ->> 'units')::numeric(4, 1);
    if v_units < 0 or v_units > 30 then
      raise exception 'Subject units must be between 0 and 30.' using errcode = '22023';
    end if;

    v_subject_key := lower(v_subject_code) || chr(31) || lower(v_block_section);
    if v_subject_key = any(v_subject_keys) then
      raise exception 'The replacement contains a duplicate subject and section.' using errcode = '22023';
    end if;
    v_subject_keys := array_append(v_subject_keys, v_subject_key);

    v_meetings := coalesce(v_subject -> 'meetings', '[]'::jsonb);
    if jsonb_typeof(v_meetings) <> 'array' or jsonb_array_length(v_meetings) > 20 then
      raise exception 'Each subject may contain up to 20 meetings.' using errcode = '22023';
    end if;
    v_meeting_keys := array[]::text[];

    for v_meeting in select value from jsonb_array_elements(v_meetings)
    loop
      if jsonb_typeof(v_meeting) <> 'object' then
        raise exception 'Each meeting must be an object.' using errcode = '22023';
      end if;
      v_day_code := btrim(coalesce(v_meeting ->> 'day_code', ''));
      if v_day_code not in ('M', 'T', 'W', 'H', 'F', 'S', 'U') then
        raise exception 'Each meeting needs a valid RTU day code.' using errcode = '22023';
      end if;
      if coalesce(v_meeting ->> 'starts_at', '') !~ '^([01]\d|2[0-3]):[0-5]\d$'
        or coalesce(v_meeting ->> 'ends_at', '') !~ '^([01]\d|2[0-3]):[0-5]\d$' then
        raise exception 'Each meeting needs valid start and end times.' using errcode = '22023';
      end if;
      v_starts_at := (v_meeting ->> 'starts_at')::time;
      v_ends_at := (v_meeting ->> 'ends_at')::time;
      if v_starts_at >= v_ends_at then
        raise exception 'Each meeting must end after it starts.' using errcode = '22023';
      end if;

      v_room := nullif(btrim(coalesce(v_meeting ->> 'room', '')), '');
      if v_room is not null and (char_length(v_room) > 120 or upper(v_room) = 'N/A') then
        raise exception 'Meeting rooms must be blank or contain up to 120 characters.' using errcode = '22023';
      end if;

      v_meeting_key := v_day_code || chr(31) || v_starts_at::text || chr(31) || v_ends_at::text;
      if v_meeting_key = any(v_meeting_keys) then
        raise exception 'A subject contains a duplicate meeting time.' using errcode = '22023';
      end if;
      v_meeting_keys := array_append(v_meeting_keys, v_meeting_key);
    end loop;
  end loop;

  delete from public.schedule_subjects where user_id = v_user_id;
  v_subject_count := 0;

  for v_subject in select value from jsonb_array_elements(p_subjects)
  loop
    insert into public.schedule_subjects (user_id, subject_code, title, units, block_section)
    values (
      v_user_id,
      btrim(v_subject ->> 'subject_code'),
      btrim(v_subject ->> 'title'),
      (v_subject ->> 'units')::numeric(4, 1),
      btrim(v_subject ->> 'block_section')
    )
    returning id into v_subject_id;
    v_subject_count := v_subject_count + 1;

    for v_meeting in select value from jsonb_array_elements(coalesce(v_subject -> 'meetings', '[]'::jsonb))
    loop
      insert into public.schedule_meetings (subject_id, day_code, starts_at, ends_at, room)
      values (
        v_subject_id,
        btrim(v_meeting ->> 'day_code'),
        (v_meeting ->> 'starts_at')::time,
        (v_meeting ->> 'ends_at')::time,
        nullif(btrim(coalesce(v_meeting ->> 'room', '')), '')
      );
      v_meeting_count := v_meeting_count + 1;
    end loop;
  end loop;

  return jsonb_build_object('subjects', v_subject_count, 'meetings', v_meeting_count);
end;
$$;

revoke all on function public.replace_own_schedule(jsonb) from public, anon;
grant execute on function public.replace_own_schedule(jsonb) to authenticated;
