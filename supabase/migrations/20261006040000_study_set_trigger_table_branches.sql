-- NEW has the row type of the table that fired the trigger. Keep references to
-- table-specific JSON columns inside their own branch so progress-only writes
-- on flashcard_sets never evaluate the quizzes.questions field (and vice versa).

create or replace function public.cali_study_set_before_write()
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

  new.title := btrim(new.title);
  if tg_op = 'UPDATE' then
    if tg_table_name = 'flashcard_sets' then
      if new.title is distinct from old.title
        or new.subject_id is distinct from old.subject_id
        or new.source_reviewer_id is distinct from old.source_reviewer_id
        or new.source_reviewer_title is distinct from old.source_reviewer_title
        or new.cards is distinct from old.cards then
        new.revision := old.revision + 1;
      else
        new.revision := old.revision;
      end if;
    elsif tg_table_name = 'quizzes' then
      if new.title is distinct from old.title
        or new.subject_id is distinct from old.subject_id
        or new.source_reviewer_id is distinct from old.source_reviewer_id
        or new.source_reviewer_title is distinct from old.source_reviewer_title
        or new.questions is distinct from old.questions then
        new.revision := old.revision + 1;
      else
        new.revision := old.revision;
      end if;
    end if;
  end if;
  return new;
end;
$$;
