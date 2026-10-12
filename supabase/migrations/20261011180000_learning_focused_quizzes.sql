-- Add a small, durable learning loop to quizzes. Existing attempts remain
-- readable and are treated as practice attempts with one recorded response.

create or replace function public.cali_valid_quiz_questions(value jsonb)
returns boolean language plpgsql immutable set search_path = '' as $$
declare item jsonb; choices jsonb;
begin
  if jsonb_typeof(value) <> 'array' or jsonb_array_length(value) > 200 or octet_length(value::text) > 1000000 then return false; end if;
  for item in select * from jsonb_array_elements(value) loop
    choices := item->'choices';
    if jsonb_typeof(item) <> 'object'
      or coalesce(item->>'id', '') !~ '^[0-9a-fA-F-]{36}$'
      or coalesce(item->>'type', '') not in ('multiple_choice', 'true_false')
      or char_length(coalesce(item->>'topic', '')) > 120
      or jsonb_typeof(item->'prompt') <> 'object'
      or char_length(coalesce(item->>'promptText', '')) > 20000
      or char_length(coalesce(item->>'explanationText', '')) > 20000
      or jsonb_typeof(choices) <> 'array'
      or jsonb_array_length(choices) > 6 then return false;
    end if;
  end loop;
  return true;
end;
$$;

alter table public.quiz_attempts
  add column mode text not null default 'practice',
  add column phase text not null default 'first_pass',
  add column first_answers jsonb not null default '{}'::jsonb,
  add column first_try_score integer;

-- Completed attempts are normally immutable. Suspend that user trigger only for
-- this one-time data backfill, then restore it before exposing the new RPCs.
alter table public.quiz_attempts disable trigger quiz_attempts_before_write;
update public.quiz_attempts
set first_answers = answers,
    first_try_score = case when status = 'completed' then score else null end;
alter table public.quiz_attempts enable trigger quiz_attempts_before_write;

alter table public.quiz_attempts
  add constraint quiz_attempts_mode_valid check (mode in ('practice', 'test')),
  add constraint quiz_attempts_phase_valid check (phase in ('first_pass', 'review')),
  add constraint quiz_attempts_first_answers_valid check (jsonb_typeof(first_answers) = 'object' and octet_length(first_answers::text) <= 250000),
  add constraint quiz_attempts_first_try_score_valid check (
    (status = 'completed' and first_try_score between 0 and total)
    or (status <> 'completed' and first_try_score is null)
  );

create or replace function public.cali_start_quiz_attempt(
  p_quiz_id uuid,
  p_mode text,
  p_snapshot jsonb
) returns public.quiz_attempts
language plpgsql security definer set search_path = ''
as $$
declare
  account_id uuid := (select auth.uid());
  created public.quiz_attempts;
begin
  if account_id is null or not public.cali_is_eligible_user() then
    raise exception 'A verified RTU Google account is required' using errcode = '42501';
  end if;
  if p_mode not in ('practice', 'test') then raise exception 'Invalid quiz mode' using errcode = '22023'; end if;
  if jsonb_typeof(p_snapshot) <> 'object'
    or not public.cali_valid_quiz_questions(coalesce(p_snapshot->'questions', 'null'::jsonb))
    or jsonb_array_length(p_snapshot->'questions') < 1 then
    raise exception 'The quiz has no ready questions' using errcode = '22023';
  end if;
  if not exists (select 1 from public.quizzes where id = p_quiz_id and user_id = account_id) then
    raise exception 'Quiz not found' using errcode = 'P0002';
  end if;

  update public.quiz_attempts set status = 'abandoned'
  where quiz_id = p_quiz_id and user_id = account_id and status = 'active';

  insert into public.quiz_attempts (quiz_id, user_id, mode, phase, snapshot)
  values (p_quiz_id, account_id, p_mode, 'first_pass', p_snapshot)
  returning * into created;
  return created;
end;
$$;

create or replace function public.cali_save_quiz_attempt(
  p_id uuid,
  p_answers jsonb,
  p_first_answers jsonb,
  p_current_index integer,
  p_phase text
) returns public.quiz_attempts
language plpgsql security definer set search_path = ''
as $$
declare
  account_id uuid := (select auth.uid());
  changed public.quiz_attempts;
  question_total integer;
begin
  if account_id is null then raise exception 'Authentication is required' using errcode = '42501'; end if;
  if jsonb_typeof(p_answers) <> 'object' or jsonb_typeof(p_first_answers) <> 'object'
    or octet_length(p_answers::text) > 250000 or octet_length(p_first_answers::text) > 250000 then
    raise exception 'Invalid quiz answers' using errcode = '22023';
  end if;
  if p_phase not in ('first_pass', 'review') then raise exception 'Invalid quiz phase' using errcode = '22023'; end if;

  select jsonb_array_length(snapshot->'questions') into question_total
  from public.quiz_attempts where id = p_id and user_id = account_id and status = 'active';
  if question_total is null then raise exception 'Active quiz attempt not found' using errcode = 'P0002'; end if;
  if p_current_index < 0 or p_current_index >= question_total then raise exception 'Invalid question position' using errcode = '22023'; end if;

  update public.quiz_attempts set answers = p_answers, first_answers = p_first_answers,
    current_index = p_current_index, phase = p_phase
  where id = p_id and user_id = account_id and status = 'active'
  returning * into changed;
  return changed;
end;
$$;

create or replace function public.cali_complete_quiz_attempt(
  p_id uuid,
  p_answers jsonb,
  p_first_answers jsonb,
  p_phase text
) returns public.quiz_attempts
language plpgsql security definer set search_path = ''
as $$
declare
  account_id uuid := (select auth.uid());
  existing public.quiz_attempts;
  changed public.quiz_attempts;
  question jsonb;
  final_score integer := 0;
  initial_score integer := 0;
  question_total integer := 0;
begin
  if account_id is null then raise exception 'Authentication is required' using errcode = '42501'; end if;
  if jsonb_typeof(p_answers) <> 'object' or jsonb_typeof(p_first_answers) <> 'object' then
    raise exception 'Invalid quiz answers' using errcode = '22023';
  end if;
  if p_phase not in ('first_pass', 'review') then raise exception 'Invalid quiz phase' using errcode = '22023'; end if;

  select * into existing from public.quiz_attempts
  where id = p_id and user_id = account_id and status = 'active' for update;
  if existing.id is null then raise exception 'Active quiz attempt not found' using errcode = 'P0002'; end if;

  for question in select * from jsonb_array_elements(existing.snapshot->'questions') loop
    question_total := question_total + 1;
    if p_answers->>(question->>'id') = question->>'correctChoiceId' then final_score := final_score + 1; end if;
    if p_first_answers->>(question->>'id') = question->>'correctChoiceId' then initial_score := initial_score + 1; end if;
  end loop;
  if question_total < 1 then raise exception 'The quiz has no questions' using errcode = '22023'; end if;

  update public.quiz_attempts set answers = p_answers, first_answers = p_first_answers,
    phase = p_phase, status = 'completed', score = final_score,
    first_try_score = initial_score, total = question_total, completed_at = current_timestamp
  where id = p_id returning * into changed;
  return changed;
end;
$$;

create or replace function public.cali_abandon_quiz_attempt(p_id uuid)
returns public.quiz_attempts
language plpgsql security definer set search_path = ''
as $$
declare changed public.quiz_attempts;
begin
  update public.quiz_attempts set status = 'abandoned'
  where id = p_id and user_id = (select auth.uid()) and status = 'active'
  returning * into changed;
  if changed.id is null then raise exception 'Active quiz attempt not found' using errcode = 'P0002'; end if;
  return changed;
end;
$$;

revoke all on table public.quiz_attempts from authenticated;
grant select on table public.quiz_attempts to authenticated;
revoke all on function public.cali_start_quiz_attempt(uuid, text, jsonb) from public, anon;
revoke all on function public.cali_save_quiz_attempt(uuid, jsonb, jsonb, integer, text) from public, anon;
revoke all on function public.cali_complete_quiz_attempt(uuid, jsonb, jsonb, text) from public, anon;
revoke all on function public.cali_abandon_quiz_attempt(uuid) from public, anon;
grant execute on function public.cali_start_quiz_attempt(uuid, text, jsonb) to authenticated;
grant execute on function public.cali_save_quiz_attempt(uuid, jsonb, jsonb, integer, text) to authenticated;
grant execute on function public.cali_complete_quiz_attempt(uuid, jsonb, jsonb, text) to authenticated;
grant execute on function public.cali_abandon_quiz_attempt(uuid) to authenticated;
