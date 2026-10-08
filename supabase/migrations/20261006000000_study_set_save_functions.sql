-- Keep each manual flashcard/quiz save atomic and return the new revision in
-- the same database request. The existing table triggers continue to validate
-- ownership, subjects, JSON payloads, and increment revision exactly once.

create function public.cali_update_own_flashcard_set(
  p_id uuid,
  p_expected_revision integer,
  p_title text,
  p_subject_id uuid,
  p_cards jsonb
) returns public.flashcard_sets
language plpgsql security definer set search_path = ''
as $$
declare
  account_id uuid := (select auth.uid());
  changed public.flashcard_sets;
begin
  if account_id is null or not public.cali_is_eligible_user() then
    raise exception 'A verified RTU Google account is required' using errcode = '42501';
  end if;

  update public.flashcard_sets set
    title = p_title,
    subject_id = p_subject_id,
    cards = p_cards
  where id = p_id and user_id = account_id and revision = p_expected_revision
  returning * into changed;

  if changed.id is null then
    if exists (select 1 from public.flashcard_sets where id = p_id and user_id = account_id) then
      raise exception 'This flashcard set changed in another tab' using errcode = 'P0001';
    end if;
    raise exception 'Flashcard set not found' using errcode = 'P0002';
  end if;

  return changed;
end;
$$;

create function public.cali_update_own_quiz(
  p_id uuid,
  p_expected_revision integer,
  p_title text,
  p_subject_id uuid,
  p_questions jsonb
) returns public.quizzes
language plpgsql security definer set search_path = ''
as $$
declare
  account_id uuid := (select auth.uid());
  changed public.quizzes;
begin
  if account_id is null or not public.cali_is_eligible_user() then
    raise exception 'A verified RTU Google account is required' using errcode = '42501';
  end if;

  update public.quizzes set
    title = p_title,
    subject_id = p_subject_id,
    questions = p_questions
  where id = p_id and user_id = account_id and revision = p_expected_revision
  returning * into changed;

  if changed.id is null then
    if exists (select 1 from public.quizzes where id = p_id and user_id = account_id) then
      raise exception 'This quiz changed in another tab' using errcode = 'P0001';
    end if;
    raise exception 'Quiz not found' using errcode = 'P0002';
  end if;

  return changed;
end;
$$;

revoke all on function public.cali_update_own_flashcard_set(uuid, integer, text, uuid, jsonb) from public, anon;
revoke all on function public.cali_update_own_quiz(uuid, integer, text, uuid, jsonb) from public, anon;
grant execute on function public.cali_update_own_flashcard_set(uuid, integer, text, uuid, jsonb) to authenticated;
grant execute on function public.cali_update_own_quiz(uuid, integer, text, uuid, jsonb) to authenticated;
