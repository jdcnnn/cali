-- Keep flashcard authoring and study state consistent without coupling study
-- progress to the authored-content revision. Flashcards stay in one current row:
-- there is no per-autosave history or per-answer event table.

create or replace function public.cali_flashcard_set_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.title is distinct from old.title
    or new.subject_id is distinct from old.subject_id
    or new.source_reviewer_id is distinct from old.source_reviewer_id
    or new.source_reviewer_title is distinct from old.source_reviewer_title
    or new.cards is distinct from old.cards then
    new.updated_at := now();
  else
    -- Progress and active-session writes should not churn the indexed library
    -- timestamp. Keeping it stable also allows PostgreSQL HOT updates.
    new.updated_at := old.updated_at;
  end if;
  return new;
end;
$$;

drop trigger if exists flashcard_sets_updated_at on public.flashcard_sets;
create trigger flashcard_sets_updated_at before update on public.flashcard_sets
for each row execute function public.cali_flashcard_set_updated_at();

create or replace function public.cali_flashcard_content_changed(old_cards jsonb, new_cards jsonb)
returns boolean language sql immutable set search_path = '' as $$
  select jsonb_array_length(old_cards) <> jsonb_array_length(new_cards)
    or exists (
      select 1
      from jsonb_array_elements(old_cards) as old_item(card)
      full join jsonb_array_elements(new_cards) as new_item(card)
        on old_item.card->>'id' = new_item.card->>'id'
      where old_item.card is null
        or new_item.card is null
        or old_item.card->>'frontText' is distinct from new_item.card->>'frontText'
        or old_item.card->>'backText' is distinct from new_item.card->>'backText'
    );
$$;

create or replace function public.cali_reconcile_flashcard_progress(old_cards jsonb, new_cards jsonb, old_progress jsonb)
returns jsonb language sql immutable set search_path = '' as $$
  select coalesce(jsonb_object_agg(progress.key, progress.value), '{}'::jsonb)
  from jsonb_each(old_progress) as progress
  where exists (
    select 1
    from jsonb_array_elements(old_cards) as old_item(card)
    join jsonb_array_elements(new_cards) as new_item(card)
      on old_item.card->>'id' = new_item.card->>'id'
    where progress.key = old_item.card->>'id'
      and old_item.card->>'frontText' is not distinct from new_item.card->>'frontText'
      and old_item.card->>'backText' is not distinct from new_item.card->>'backText'
  );
$$;

create or replace function public.cali_valid_flashcard_session_for_cards(value jsonb, cards jsonb)
returns boolean language plpgsql immutable set search_path = '' as $$
declare
  card_ids jsonb;
  ratings jsonb;
begin
  if value is null then return true; end if;
  card_ids := value->'cardIds';
  ratings := value->'ratings';
  if jsonb_typeof(value) <> 'object'
    or coalesce(value->>'id', '') !~ '^[0-9a-fA-F-]{36}$'
    or jsonb_typeof(card_ids) <> 'array'
    or jsonb_array_length(card_ids) < 1
    or jsonb_array_length(card_ids) > 500
    or coalesce(value->>'index', '') !~ '^[0-9]+$'
    or (value->>'index')::integer >= jsonb_array_length(card_ids)
    or coalesce(value->>'mode', '') not in ('sequential', 'shuffle')
    or jsonb_typeof(value->'learningOnly') <> 'boolean'
    or jsonb_typeof(ratings) <> 'object'
    or coalesce(value->>'startedAt', '') = ''
    or octet_length(value::text) > 500000 then return false;
  end if;
  if exists (
    select 1 from jsonb_array_elements_text(card_ids) as session_card(id)
    where not exists (
      select 1 from jsonb_array_elements(cards) as deck_card(card)
      where deck_card.card->>'id' = session_card.id
        and btrim(coalesce(deck_card.card->>'frontText', '')) <> ''
        and btrim(coalesce(deck_card.card->>'backText', '')) <> ''
    )
  ) then return false; end if;
  if (select count(*) from jsonb_array_elements_text(card_ids))
    <> (select count(distinct id) from jsonb_array_elements_text(card_ids) as item(id)) then return false; end if;
  if exists (
    select 1 from jsonb_each_text(ratings) as rating(card_id, value)
    where rating.value not in ('again', 'hard', 'good')
      or not (card_ids ? rating.card_id)
  ) then return false; end if;
  return true;
exception when others then
  return false;
end;
$$;

create or replace function public.cali_update_own_flashcard_set(
  p_id uuid,
  p_expected_revision integer,
  p_title text,
  p_subject_id uuid,
  p_source_reviewer_id uuid,
  p_cards jsonb
) returns public.flashcard_sets
language plpgsql security definer set search_path = ''
as $$
declare
  account_id uuid := (select auth.uid());
  existing public.flashcard_sets;
  changed public.flashcard_sets;
  content_changed boolean;
begin
  if account_id is null or not public.cali_is_eligible_user() then
    raise exception 'A verified RTU Google account is required' using errcode = '42501';
  end if;
  select * into existing from public.flashcard_sets
  where id = p_id and user_id = account_id for update;
  if existing.id is null then raise exception 'Flashcard set not found' using errcode = 'P0002'; end if;
  if existing.revision <> p_expected_revision then
    raise exception 'This flashcard set changed in another tab' using errcode = 'P0001';
  end if;

  -- A retried or duplicated autosave should return the current row without
  -- producing another tuple, WAL entry, revision, or timestamp update.
  if existing.title is not distinct from btrim(p_title)
    and existing.subject_id is not distinct from p_subject_id
    and existing.source_reviewer_id is not distinct from p_source_reviewer_id
    and existing.cards is not distinct from p_cards then
    return existing;
  end if;

  content_changed := public.cali_flashcard_content_changed(existing.cards, p_cards);
  update public.flashcard_sets set
    title = p_title,
    subject_id = p_subject_id,
    source_reviewer_id = p_source_reviewer_id,
    source_reviewer_title = (
      select title from public.reviewers
      where id = p_source_reviewer_id and user_id = account_id
    ),
    cards = p_cards,
    progress = case when content_changed then public.cali_reconcile_flashcard_progress(existing.cards, p_cards, existing.progress) else existing.progress end,
    active_session = case when content_changed then null else existing.active_session end
  where id = p_id and user_id = account_id
  returning * into changed;
  return changed;
end;
$$;

create or replace function public.cali_save_own_flashcard_study(
  p_id uuid,
  p_expected_session_id uuid,
  p_expected_index integer,
  p_active_session jsonb,
  p_progress jsonb
) returns public.flashcard_sets
language plpgsql security definer set search_path = ''
as $$
declare
  account_id uuid := (select auth.uid());
  existing public.flashcard_sets;
  changed public.flashcard_sets;
begin
  if account_id is null or not public.cali_is_eligible_user() then
    raise exception 'A verified RTU Google account is required' using errcode = '42501';
  end if;
  select * into existing from public.flashcard_sets
  where id = p_id and user_id = account_id for update;
  if existing.id is null then raise exception 'Flashcard set not found' using errcode = 'P0002'; end if;

  if p_expected_session_id is null then
    if existing.active_session is not null then
      raise exception 'This flashcard session changed in another tab' using errcode = 'P0001';
    end if;
  elsif p_expected_index is null
    or existing.active_session is null
    or existing.active_session->>'id' <> p_expected_session_id::text
    or coalesce((existing.active_session->>'index')::integer, -1) <> p_expected_index then
    raise exception 'This flashcard session changed in another tab' using errcode = 'P0001';
  end if;

  if not public.cali_valid_flashcard_session_for_cards(p_active_session, existing.cards)
    or p_progress is null
    or jsonb_typeof(p_progress) <> 'object'
    or octet_length(p_progress::text) > 250000 then
    raise exception 'Flashcard study state is invalid' using errcode = '22023';
  end if;

  if existing.active_session is not distinct from p_active_session
    and existing.progress is not distinct from p_progress then
    return existing;
  end if;

  update public.flashcard_sets set active_session = p_active_session, progress = p_progress
  where id = p_id and user_id = account_id
  returning * into changed;
  return changed;
end;
$$;

revoke all on function public.cali_flashcard_content_changed(jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.cali_reconcile_flashcard_progress(jsonb, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.cali_valid_flashcard_session_for_cards(jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.cali_flashcard_set_updated_at() from public, anon, authenticated;
revoke all on function public.cali_update_own_flashcard_set(uuid, integer, text, uuid, uuid, jsonb) from public, anon;
revoke all on function public.cali_save_own_flashcard_study(uuid, uuid, integer, jsonb, jsonb) from public, anon;
grant execute on function public.cali_update_own_flashcard_set(uuid, integer, text, uuid, uuid, jsonb) to authenticated;
grant execute on function public.cali_save_own_flashcard_study(uuid, uuid, integer, jsonb, jsonb) to authenticated;
