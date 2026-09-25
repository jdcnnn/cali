-- Keep eligibility and Google profile data on the database side of the trust boundary.
-- An Auth hook can reject new signups; this check also covers existing users and
-- every request to student-owned tables.
create function public.cali_is_eligible_user()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from auth.users as u
    join auth.identities as i on i.user_id = u.id
    where u.id = (select auth.uid())
      and u.email_confirmed_at is not null
      and lower(u.email) ~ '^[^@]+@rtu\.edu\.ph$'
      and i.provider = 'google'
      and lower(i.identity_data ->> 'email') = lower(u.email)
      and i.identity_data ->> 'email_verified' = 'true'
  );
$$;

revoke all on function public.cali_is_eligible_user() from public, anon;
grant execute on function public.cali_is_eligible_user() to authenticated;

-- Restrictive policies add an eligibility condition to the existing ownership
-- policies without weakening any of them.
create policy students_eligible on public.students as restrictive
for all to authenticated
using ((select public.cali_is_eligible_user()))
with check ((select public.cali_is_eligible_user()));

create policy schedule_subjects_eligible on public.schedule_subjects as restrictive
for all to authenticated
using ((select public.cali_is_eligible_user()))
with check ((select public.cali_is_eligible_user()));

create policy schedule_meetings_eligible on public.schedule_meetings as restrictive
for all to authenticated
using ((select public.cali_is_eligible_user()))
with check ((select public.cali_is_eligible_user()));

-- Onboarding is the only client-callable way to create a student row. The
-- privileged function reads identity_data written by Google Auth, not client
-- input or user_metadata (which a signed-in user can change).
revoke insert (user_id, username, program, year_level) on public.students from authenticated;

create function public.cali_complete_onboarding(
  p_username text,
  p_program text,
  p_year_level smallint
)
returns public.students
language plpgsql
security definer
set search_path = ''
as $$
declare
  identity_data jsonb;
  google_name text;
  google_avatar text;
  student public.students;
begin
  if not public.cali_is_eligible_user() then
    raise exception 'A verified RTU Google account is required' using errcode = '42501';
  end if;

  if p_username is null or p_username !~ '^[a-z0-9_]{3,30}$'
     or p_program is null or char_length(btrim(p_program)) not between 1 and 120
     or p_year_level is null or p_year_level not between 1 and 5 then
    raise exception 'Invalid onboarding details' using errcode = '22023';
  end if;

  select i.identity_data into identity_data
  from auth.identities as i
  join auth.users as u on u.id = i.user_id
  where i.user_id = (select auth.uid())
    and i.provider = 'google'
    and lower(i.identity_data ->> 'email') = lower(u.email)
    and i.identity_data ->> 'email_verified' = 'true'
  limit 1;

  google_name := nullif(btrim(coalesce(identity_data ->> 'full_name', identity_data ->> 'name', '')), '');
  google_avatar := nullif(btrim(coalesce(identity_data ->> 'avatar_url', identity_data ->> 'picture', '')), '');
  if google_name is not null and char_length(google_name) > 200 then google_name := null; end if;
  if google_avatar is not null and (char_length(google_avatar) > 2048 or google_avatar !~ '^https://') then google_avatar := null; end if;

  insert into public.students (user_id, username, program, year_level, full_name, avatar_url)
  values ((select auth.uid()), p_username, btrim(p_program), p_year_level, google_name, google_avatar)
  on conflict (user_id) do nothing
  returning * into student;

  if student.user_id is null then
    select * into student from public.students where user_id = (select auth.uid());
  end if;
  return student;
end;
$$;

revoke all on function public.cali_complete_onboarding(text, text, smallint) from public, anon;
grant execute on function public.cali_complete_onboarding(text, text, smallint) to authenticated;

create function public.cali_refresh_google_profile()
returns public.students
language plpgsql
security definer
set search_path = ''
as $$
declare
  identity_data jsonb;
  google_name text;
  google_avatar text;
  student public.students;
begin
  if not public.cali_is_eligible_user() then
    raise exception 'A verified RTU Google account is required' using errcode = '42501';
  end if;

  select i.identity_data into identity_data
  from auth.identities as i
  join auth.users as u on u.id = i.user_id
  where i.user_id = (select auth.uid())
    and i.provider = 'google'
    and lower(i.identity_data ->> 'email') = lower(u.email)
    and i.identity_data ->> 'email_verified' = 'true'
  limit 1;

  google_name := nullif(btrim(coalesce(identity_data ->> 'full_name', identity_data ->> 'name', '')), '');
  google_avatar := nullif(btrim(coalesce(identity_data ->> 'avatar_url', identity_data ->> 'picture', '')), '');
  if google_name is not null and char_length(google_name) > 200 then google_name := null; end if;
  if google_avatar is not null and (char_length(google_avatar) > 2048 or google_avatar !~ '^https://') then google_avatar := null; end if;

  update public.students
  set full_name = google_name, avatar_url = google_avatar
  where user_id = (select auth.uid())
    and (full_name, avatar_url) is distinct from (google_name, google_avatar)
  returning * into student;

  if student.user_id is null then
    select * into student from public.students where user_id = (select auth.uid());
  end if;
  return student;
end;
$$;

revoke all on function public.cali_refresh_google_profile() from public, anon;
grant execute on function public.cali_refresh_google_profile() to authenticated;

-- The linked project's Before User Created hook is currently disabled. This
-- function is ready to select in Auth > Hooks after this migration is applied.
-- The eligibility function above still blocks access for pre-existing users.
create function public.cali_before_user_created(event jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if lower(event -> 'user' ->> 'email') ~ '^[^@]+@rtu\.edu\.ph$'
     and event -> 'user' -> 'app_metadata' ->> 'provider' = 'google' then
    return '{}'::jsonb;
  end if;

  return jsonb_build_object('error', jsonb_build_object(
    'http_code', 403,
    'message', 'Use a verified RTU Google account to sign in.'
  ));
end;
$$;

revoke all on function public.cali_before_user_created(jsonb) from public, anon, authenticated;
grant execute on function public.cali_before_user_created(jsonb) to supabase_auth_admin;
