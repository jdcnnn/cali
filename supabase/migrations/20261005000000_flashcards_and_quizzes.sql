-- Flashcards and quizzes use compact JSON documents so a set loads and saves in
-- one request. Attempts are separate immutable snapshots for reliable history.

create function public.cali_valid_flashcards(value jsonb)
returns boolean language plpgsql immutable set search_path = '' as $$
declare item jsonb;
begin
  if jsonb_typeof(value) <> 'array' or jsonb_array_length(value) > 500 or octet_length(value::text) > 1000000 then return false; end if;
  for item in select * from jsonb_array_elements(value) loop
    if jsonb_typeof(item) <> 'object'
      or coalesce(item->>'id', '') !~ '^[0-9a-fA-F-]{36}$'
      or jsonb_typeof(item->'front') <> 'object'
      or jsonb_typeof(item->'back') <> 'object'
      or char_length(coalesce(item->>'frontText', '')) > 10000
      or char_length(coalesce(item->>'backText', '')) > 10000 then return false;
    end if;
  end loop;
  return true;
end;
$$;

create function public.cali_valid_quiz_questions(value jsonb)
returns boolean language plpgsql immutable set search_path = '' as $$
declare item jsonb; choices jsonb;
begin
  if jsonb_typeof(value) <> 'array' or jsonb_array_length(value) > 200 or octet_length(value::text) > 1000000 then return false; end if;
  for item in select * from jsonb_array_elements(value) loop
    choices := item->'choices';
    if jsonb_typeof(item) <> 'object'
      or coalesce(item->>'id', '') !~ '^[0-9a-fA-F-]{36}$'
      or coalesce(item->>'type', '') not in ('multiple_choice', 'true_false')
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

create table public.flashcard_sets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.students(user_id) on delete cascade,
  subject_id uuid references public.schedule_subjects(id) on delete set null,
  source_reviewer_id uuid references public.reviewers(id) on delete set null,
  source_reviewer_title text,
  title text not null,
  cards jsonb not null default '[]'::jsonb,
  progress jsonb not null default '{}'::jsonb,
  active_session jsonb,
  revision integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  card_count integer generated always as (jsonb_array_length(cards)) stored,
  constraint flashcard_sets_title_valid check (char_length(btrim(title)) between 1 and 160),
  constraint flashcard_sets_cards_valid check (public.cali_valid_flashcards(cards)),
  constraint flashcard_sets_progress_valid check (jsonb_typeof(progress) = 'object' and octet_length(progress::text) <= 250000),
  constraint flashcard_sets_session_valid check (active_session is null or (jsonb_typeof(active_session) = 'object' and octet_length(active_session::text) <= 500000)),
  constraint flashcard_sets_revision_valid check (revision >= 1)
);

create table public.quizzes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.students(user_id) on delete cascade,
  subject_id uuid references public.schedule_subjects(id) on delete set null,
  source_reviewer_id uuid references public.reviewers(id) on delete set null,
  source_reviewer_title text,
  title text not null,
  questions jsonb not null default '[]'::jsonb,
  active_attempt_id uuid,
  revision integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  question_count integer generated always as (jsonb_array_length(questions)) stored,
  constraint quizzes_title_valid check (char_length(btrim(title)) between 1 and 160),
  constraint quizzes_questions_valid check (public.cali_valid_quiz_questions(questions)),
  constraint quizzes_revision_valid check (revision >= 1)
);

create table public.quiz_attempts (
  id uuid primary key default gen_random_uuid(),
  quiz_id uuid not null references public.quizzes(id) on delete cascade,
  user_id uuid not null references public.students(user_id) on delete cascade,
  status text not null default 'active',
  snapshot jsonb not null,
  answers jsonb not null default '{}'::jsonb,
  current_index integer not null default 0,
  score integer,
  total integer,
  started_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint quiz_attempts_status_valid check (status in ('active', 'completed', 'abandoned')),
  constraint quiz_attempts_snapshot_valid check (jsonb_typeof(snapshot) = 'object' and octet_length(snapshot::text) <= 1000000),
  constraint quiz_attempts_answers_valid check (jsonb_typeof(answers) = 'object' and octet_length(answers::text) <= 250000),
  constraint quiz_attempts_score_valid check ((status <> 'completed' and score is null and total is null and completed_at is null) or (status = 'completed' and score between 0 and total and total >= 1 and completed_at is not null))
);

create index flashcard_sets_user_updated_idx on public.flashcard_sets(user_id, updated_at desc);
create index flashcard_sets_subject_idx on public.flashcard_sets(subject_id) where subject_id is not null;
create index quizzes_user_updated_idx on public.quizzes(user_id, updated_at desc);
create index quizzes_subject_idx on public.quizzes(subject_id) where subject_id is not null;
create index quiz_attempts_quiz_completed_idx on public.quiz_attempts(quiz_id, completed_at desc) where status = 'completed';
create unique index quiz_attempts_one_active_idx on public.quiz_attempts(quiz_id, user_id) where status = 'active';

create function public.cali_study_set_before_write()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.user_id <> (select auth.uid()) or not public.cali_is_eligible_user() then
    raise exception 'A verified RTU Google account is required' using errcode = '42501';
  end if;
  if new.subject_id is not null and not exists (select 1 from public.schedule_subjects where id = new.subject_id and user_id = new.user_id) then
    raise exception 'Subject not found' using errcode = 'P0002';
  end if;
  if new.source_reviewer_id is not null and not exists (select 1 from public.reviewers where id = new.source_reviewer_id and user_id = new.user_id) then
    raise exception 'Reviewer not found' using errcode = 'P0002';
  end if;
  if tg_op = 'UPDATE' then new.revision := old.revision + 1; end if;
  new.title := btrim(new.title);
  return new;
end;
$$;

create trigger flashcard_sets_before_write before insert or update on public.flashcard_sets for each row execute function public.cali_study_set_before_write();
create trigger quizzes_before_write before insert or update on public.quizzes for each row execute function public.cali_study_set_before_write();
create trigger flashcard_sets_updated_at before update on public.flashcard_sets for each row execute function public.set_cali_updated_at();
create trigger quizzes_updated_at before update on public.quizzes for each row execute function public.set_cali_updated_at();
create trigger quiz_attempts_updated_at before update on public.quiz_attempts for each row execute function public.set_cali_updated_at();

create function public.cali_quiz_attempt_before_write()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and old.status = 'completed' then raise exception 'Completed attempts are immutable' using errcode = 'P0001'; end if;
  if new.user_id <> (select auth.uid()) or not exists (select 1 from public.quizzes where id = new.quiz_id and user_id = new.user_id) then
    raise exception 'Quiz not found' using errcode = 'P0002';
  end if;
  return new;
end;
$$;
create trigger quiz_attempts_before_write before insert or update on public.quiz_attempts for each row execute function public.cali_quiz_attempt_before_write();

alter table public.flashcard_sets enable row level security;
alter table public.quizzes enable row level security;
alter table public.quiz_attempts enable row level security;
revoke all on public.flashcard_sets, public.quizzes, public.quiz_attempts from public, anon, authenticated;
grant select, insert, update, delete on public.flashcard_sets, public.quizzes to authenticated;
grant select, insert, update on public.quiz_attempts to authenticated;

create policy flashcard_sets_own on public.flashcard_sets for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy flashcard_sets_eligible on public.flashcard_sets as restrictive for all to authenticated using ((select public.cali_is_eligible_user())) with check ((select public.cali_is_eligible_user()));
create policy quizzes_own on public.quizzes for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy quizzes_eligible on public.quizzes as restrictive for all to authenticated using ((select public.cali_is_eligible_user())) with check ((select public.cali_is_eligible_user()));
create policy quiz_attempts_own on public.quiz_attempts for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy quiz_attempts_eligible on public.quiz_attempts as restrictive for all to authenticated using ((select public.cali_is_eligible_user())) with check ((select public.cali_is_eligible_user()));

create or replace function public.cali_delete_own_account()
returns void language plpgsql security definer set search_path = '' as $$
declare account_id uuid := (select auth.uid());
begin
  if account_id is null then raise exception 'Authentication is required' using errcode = '42501'; end if;
  delete from public.reminder_deliveries where reminder_id in (select id from public.reminder_queue where user_id = account_id) or subscription_id in (select id from public.push_subscriptions where user_id = account_id);
  delete from public.reminder_queue where user_id = account_id;
  delete from public.push_subscriptions where user_id = account_id;
  delete from public.task_steps where task_id in (select id from public.tasks where user_id = account_id);
  delete from public.tasks where user_id = account_id;
  delete from public.calendar_events where user_id = account_id;
  delete from public.quiz_attempts where user_id = account_id;
  delete from public.quizzes where user_id = account_id;
  delete from public.flashcard_sets where user_id = account_id;
  delete from public.reviewers where user_id = account_id;
  delete from public.schedule_meetings where subject_id in (select id from public.schedule_subjects where user_id = account_id);
  delete from public.schedule_subjects where user_id = account_id;
  delete from public.students where user_id = account_id;
  delete from auth.users where id = account_id;
  if not found then raise exception 'Account not found' using errcode = 'P0002'; end if;
end;
$$;

revoke all on function public.cali_delete_own_account() from public, anon;
grant execute on function public.cali_delete_own_account() to authenticated;
