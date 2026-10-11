-- Expose a lifetime distinct-student count for clear reviewer trust metadata.
-- This is intentionally separate from usage7d/usage30d, which count active
-- student-days and are used for trend ranking.
create or replace function public.cali_community_card_json(
  p_reviewer public.reviewers,
  p_viewer uuid
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p_reviewer.id,
    'title', p_reviewer.title,
    'description', coalesce(p_reviewer.description, ''),
    'category', p_reviewer.category,
    'subject', case when subject.id is null then null else jsonb_build_object(
      'id', subject.id,
      'code', subject.subject_code,
      'title', subject.title,
      'colorKey', subject.color_key
    ) end,
    'visibility', p_reviewer.visibility,
    'updatedAt', p_reviewer.updated_at,
    'publishedAt', p_reviewer.published_at,
    'parentReviewerId', p_reviewer.parent_reviewer_id,
    'rootReviewerId', p_reviewer.root_reviewer_id,
    'isVersion', p_reviewer.parent_reviewer_id is not null,
    'isOwner', p_reviewer.user_id = p_viewer,
    'creator', jsonb_build_object(
      'userId', owner.user_id,
      'username', owner.username,
      'avatarUrl', owner.avatar_url,
      'program', owner.program,
      'yearLevel', owner.year_level
    ),
    'netVotes', coalesce(votes.net_votes, 0),
    'upvotes', coalesce(votes.upvotes, 0),
    'downvotes', coalesce(votes.downvotes, 0),
    'userVote', coalesce((select value from public.reviewer_votes where reviewer_id = p_reviewer.id and user_id = p_viewer), 0),
    'usage7d', coalesce(usage.usage_7d, 0),
    'usage30d', coalesce(usage.usage_30d, 0),
    'studentUseCount', coalesce(usage.student_use_count, 0),
    'excerpt', left(case when p_reviewer.visibility = 'public' then p_reviewer.plain_text else public.cali_reviewer_json_text(public.cali_preview_reviewer_content(p_reviewer.content)) end, 260)
  )
  from public.students owner
  left join public.schedule_subjects subject
    on subject.id = p_reviewer.subject_id
    and subject.user_id = p_reviewer.user_id
  left join lateral (
    select coalesce(sum(value), 0)::integer net_votes,
      count(*) filter (where value = 1)::integer upvotes,
      count(*) filter (where value = -1)::integer downvotes
    from public.reviewer_votes where reviewer_id = p_reviewer.id
  ) votes on true
  left join lateral (
    select count(*) filter (where used_on >= (now() at time zone 'UTC')::date - 6)::integer usage_7d,
      count(*) filter (where used_on >= (now() at time zone 'UTC')::date - 29)::integer usage_30d,
      count(distinct user_id)::integer student_use_count
    from public.reviewer_usage_daily where reviewer_id = p_reviewer.id
  ) usage on true
  where owner.user_id = p_reviewer.user_id
$$;

revoke all on function public.cali_community_card_json(public.reviewers,uuid) from public,anon,authenticated;
