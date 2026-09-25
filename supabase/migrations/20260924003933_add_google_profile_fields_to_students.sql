-- Google-supplied profile fields are stored for display but remain read-only
-- to student clients. A trusted Auth/onboarding flow will populate and refresh
-- them; the existing authenticated INSERT/UPDATE column grants exclude them.

alter table public.students
  add column full_name text,
  add column avatar_url text,
  add constraint students_full_name_valid check (
    full_name is null or char_length(btrim(full_name)) between 1 and 200
  ),
  add constraint students_avatar_url_valid check (
    avatar_url is null or (
      char_length(avatar_url) <= 2048
      and avatar_url ~ '^https://'
    )
  );
