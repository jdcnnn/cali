-- Mastery requires two consecutive successful recalls. Keep persisted mastery
-- aligned with goodStreak after the brief single-recall rule correction.

update public.flashcard_sets as deck
set progress = (
  select coalesce(
    jsonb_object_agg(
      entry.key,
      jsonb_set(entry.value, '{mastered}', to_jsonb(coalesce((entry.value->>'goodStreak')::integer, 0) >= 2), true)
    ),
    '{}'::jsonb
  )
  from jsonb_each(deck.progress) as entry
)
where exists (
  select 1
  from jsonb_each(deck.progress) as entry
  where entry.value->'mastered' is distinct from to_jsonb(coalesce((entry.value->>'goodStreak')::integer, 0) >= 2)
);
