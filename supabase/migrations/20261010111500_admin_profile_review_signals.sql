-- Keep public-profile inspection counts fresh and independent from the paged
-- user-directory payload. Only aggregate reviewer/report totals are exposed.
create or replace function public.cali_admin_get_community_item(
  p_target_type text,
  p_target_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  result jsonb;
begin
  if not public.cali_is_admin(actor) then
    raise exception 'Administrator access is required' using errcode = '42501';
  end if;

  if p_target_type = 'reviewer' then
    select jsonb_build_object(
      'type', 'reviewer',
      'id', r.id,
      'title', r.title,
      'description', coalesce(r.description, ''),
      'category', r.category,
      'visibility', r.visibility,
      'content', r.content,
      'plainText', r.plain_text,
      'hidden', r.moderated_at is not null,
      'moderationReason', r.moderation_reason,
      'updatedAt', r.updated_at,
      'creator', jsonb_build_object(
        'userId', owner.user_id,
        'username', owner.username,
        'fullName', owner.full_name,
        'avatarUrl', owner.avatar_url,
        'program', owner.program,
        'yearLevel', owner.year_level,
        'suspended', owner.suspended_at is not null
      )
    ) into result
    from public.reviewers r
    join public.students owner on owner.user_id = r.user_id
    where r.id = p_target_id and r.visibility in ('public', 'preview');
  elsif p_target_type = 'profile' then
    select jsonb_build_object(
      'type', 'profile',
      'id', s.user_id,
      'username', s.username,
      'fullName', s.full_name,
      'avatarUrl', s.avatar_url,
      'bio', coalesce(s.bio, ''),
      'program', s.program,
      'yearLevel', s.year_level,
      'joinedAt', s.created_at,
      'hidden', s.community_hidden_at is not null,
      'suspended', s.suspended_at is not null,
      'sharedReviewerCount', (
        select count(*)
        from public.reviewers reviewer
        where reviewer.user_id = s.user_id
          and reviewer.visibility in ('public', 'preview')
      ),
      'reviewerReportCount', (
        select count(*)
        from public.community_reports report
        join public.reviewers reviewer on reviewer.id = report.reviewer_id
        where report.target_type = 'reviewer'
          and reviewer.user_id = s.user_id
      ),
      'openReviewerReportCount', (
        select count(*)
        from public.community_reports report
        join public.reviewers reviewer on reviewer.id = report.reviewer_id
        where report.target_type = 'reviewer'
          and report.status = 'open'
          and reviewer.user_id = s.user_id
      )
    ) into result
    from public.students s
    where s.user_id = p_target_id;
  else
    raise exception 'Invalid moderation target' using errcode = '22023';
  end if;

  if result is null then
    raise exception 'Shared Community item not found' using errcode = 'P0002';
  end if;
  return result;
end;
$$;

revoke all on function public.cali_admin_get_community_item(text, uuid) from public, anon;
grant execute on function public.cali_admin_get_community_item(text, uuid) to authenticated;
