-- "Got it" is an immediate per-card mastery decision. Repair progress saved
-- under the earlier two-session rule so existing decks match the UI wording.

update public.flashcard_sets as deck
set progress = (
  select coalesce(
    jsonb_object_agg(
      entry.key,
      jsonb_set(entry.value, '{mastered}', to_jsonb((entry.value->>'lastRating') = 'good'), true)
    ),
    '{}'::jsonb
  )
  from jsonb_each(deck.progress) as entry
)
where exists (
  select 1
  from jsonb_each(deck.progress) as entry
  where entry.value->'mastered' is distinct from to_jsonb((entry.value->>'lastRating') = 'good')
);
