-- Separate pending moderation work from confirmed reviewer violations in the
-- user directory and admin overview. Dismissed reports are intentionally not
-- used as enforcement signals, and no account is suspended automatically.

drop function if exists public.cali_admin_search_users(text, text, text, integer, integer);

create or replace function public.cali_admin_search_users(
  p_query text default '',
  p_status text default 'all',
  p_account_type text default 'all',
  p_page integer default 1,
  p_page_size integer default 25,
  p_report_status text default 'all'
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  account_id uuid := (select auth.uid());
  result jsonb;
  safe_page integer := greatest(coalesce(p_page, 1), 1);
  safe_size integer := least(greatest(coalesce(p_page_size, 25), 1), 100);
  safe_report_status text := lower(coalesce(p_report_status, 'all'));
begin
  if not public.cali_is_admin(account_id) then
    raise exception 'Administrator access is required' using errcode = '42501';
  end if;
  if safe_report_status not in ('all', 'pending', 'confirmed', 'reported', 'none') then
    raise exception 'Invalid reviewer report filter' using errcode = '22023';
  end if;

  with accounts as (
    select
      s.user_id,
      s.username,
      s.full_name,
      u.email,
      s.program,
      s.year_level,
      s.is_admin,
      s.suspended_at,
      s.suspension_reason,
      s.created_at,
      case when lower(u.email) ~ '@rtu\.edu\.ph$' then 'institutional' else 'personal' end as account_type,
      (select count(*) from public.reviewers reviewer where reviewer.user_id = s.user_id and reviewer.visibility in ('public', 'preview')) as shared_reviewer_count,
      (select count(*) from public.community_reports report join public.reviewers reviewer on reviewer.id = report.reviewer_id where report.target_type = 'reviewer' and reviewer.user_id = s.user_id) as reviewer_report_count,
      (select count(*) from public.community_reports report join public.reviewers reviewer on reviewer.id = report.reviewer_id where report.target_type = 'reviewer' and report.status = 'open' and reviewer.user_id = s.user_id) as pending_reviewer_report_count,
      (select count(*) from public.community_reports report join public.reviewers reviewer on reviewer.id = report.reviewer_id where report.target_type = 'reviewer' and report.status = 'hidden' and reviewer.user_id = s.user_id) as confirmed_reviewer_report_count
    from public.students s
    join auth.users u on u.id = s.user_id
    where (
      btrim(coalesce(p_query, '')) = ''
      or s.username ilike '%' || btrim(p_query) || '%'
      or coalesce(s.full_name, '') ilike '%' || btrim(p_query) || '%'
      or u.email ilike '%' || btrim(p_query) || '%'
    )
      and (
        p_status = 'all'
        or (p_status = 'active' and s.suspended_at is null)
        or (p_status = 'suspended' and s.suspended_at is not null)
        or (p_status = 'admin' and s.is_admin)
      )
      and (
        p_account_type = 'all'
        or (p_account_type = 'institutional' and lower(u.email) ~ '@rtu\.edu\.ph$')
        or (p_account_type = 'personal' and lower(u.email) !~ '@rtu\.edu\.ph$')
      )
  ), filtered as (
    select * from accounts
    where safe_report_status = 'all'
      or (safe_report_status = 'pending' and pending_reviewer_report_count > 0)
      or (safe_report_status = 'confirmed' and confirmed_reviewer_report_count > 0)
      or (safe_report_status = 'reported' and pending_reviewer_report_count + confirmed_reviewer_report_count > 0)
      or (safe_report_status = 'none' and pending_reviewer_report_count + confirmed_reviewer_report_count = 0)
  ), page_rows as (
    select * from filtered
    order by
      case when safe_report_status <> 'all' then pending_reviewer_report_count end desc,
      case when safe_report_status <> 'all' then confirmed_reviewer_report_count end desc,
      created_at desc,
      user_id
    offset (safe_page - 1) * safe_size
    limit safe_size
  )
  select jsonb_build_object(
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'userId', user_id,
        'username', username,
        'fullName', full_name,
        'email', email,
        'program', program,
        'yearLevel', year_level,
        'isAdmin', is_admin,
        'suspendedAt', suspended_at,
        'suspensionReason', suspension_reason,
        'createdAt', created_at,
        'accountType', account_type,
        'sharedReviewerCount', shared_reviewer_count,
        'reviewerReportCount', reviewer_report_count,
        'pendingReviewerReportCount', pending_reviewer_report_count,
        'confirmedReviewerReportCount', confirmed_reviewer_report_count
      ) order by
        case when safe_report_status <> 'all' then pending_reviewer_report_count end desc,
        case when safe_report_status <> 'all' then confirmed_reviewer_report_count end desc,
        created_at desc
      ) from page_rows
    ), '[]'::jsonb),
    'total', (select count(*) from filtered),
    'page', safe_page,
    'pageSize', safe_size
  ) into result;

  return result;
end;
$$;

revoke all on function public.cali_admin_search_users(text, text, text, integer, integer, text) from public, anon;
grant execute on function public.cali_admin_search_users(text, text, text, integer, integer, text) to authenticated;

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
      'type', 'reviewer', 'id', r.id, 'title', r.title,
      'description', coalesce(r.description, ''), 'category', r.category,
      'visibility', r.visibility, 'content', r.content, 'plainText', r.plain_text,
      'hidden', r.moderated_at is not null, 'moderationReason', r.moderation_reason,
      'updatedAt', r.updated_at,
      'creator', jsonb_build_object(
        'userId', owner.user_id, 'username', owner.username, 'fullName', owner.full_name,
        'avatarUrl', owner.avatar_url, 'program', owner.program,
        'yearLevel', owner.year_level, 'suspended', owner.suspended_at is not null
      )
    ) into result
    from public.reviewers r
    join public.students owner on owner.user_id = r.user_id
    where r.id = p_target_id and r.visibility in ('public', 'preview');
  elsif p_target_type = 'profile' then
    select jsonb_build_object(
      'type', 'profile', 'id', s.user_id, 'username', s.username,
      'fullName', s.full_name, 'avatarUrl', s.avatar_url, 'bio', coalesce(s.bio, ''),
      'program', s.program, 'yearLevel', s.year_level, 'joinedAt', s.created_at,
      'hidden', s.community_hidden_at is not null, 'suspended', s.suspended_at is not null,
      'sharedReviewerCount', (select count(*) from public.reviewers reviewer where reviewer.user_id = s.user_id and reviewer.visibility in ('public', 'preview')),
      'reviewerReportCount', (select count(*) from public.community_reports report join public.reviewers reviewer on reviewer.id = report.reviewer_id where report.target_type = 'reviewer' and reviewer.user_id = s.user_id),
      'pendingReviewerReportCount', (select count(*) from public.community_reports report join public.reviewers reviewer on reviewer.id = report.reviewer_id where report.target_type = 'reviewer' and report.status = 'open' and reviewer.user_id = s.user_id),
      'confirmedReviewerReportCount', (select count(*) from public.community_reports report join public.reviewers reviewer on reviewer.id = report.reviewer_id where report.target_type = 'reviewer' and report.status = 'hidden' and reviewer.user_id = s.user_id)
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

create or replace function public.cali_admin_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  account_id uuid := (select auth.uid());
  result jsonb;
begin
  if not public.cali_is_admin(account_id) then
    raise exception 'Administrator access is required' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'totalUsers', count(*),
    'activeUsers', count(*) filter (where s.suspended_at is null),
    'suspendedUsers', count(*) filter (where s.suspended_at is not null),
    'institutionalUsers', count(*) filter (where lower(u.email) ~ '@rtu\.edu\.ph$'),
    'personalUsers', count(*) filter (where lower(u.email) !~ '@rtu\.edu\.ph$'),
    'sharedReviewers', (select count(*) from public.reviewers r join public.students owner on owner.user_id = r.user_id where r.visibility in ('public', 'preview') and r.moderated_at is null and owner.suspended_at is null),
    'openReports', (select count(*) from public.community_reports where status = 'open'),
    'allowPersonalGoogleLogin', (select allow_personal_google_login from public.cali_system_settings where singleton),
    'reportedUsers', coalesce((
      select jsonb_agg(jsonb_build_object(
        'userId', signal.user_id,
        'username', signal.username,
        'fullName', signal.full_name,
        'pendingReportCount', signal.pending_report_count,
        'confirmedReportCount', signal.confirmed_report_count,
        'confirmedReviewerIncidentCount', signal.confirmed_reviewer_incident_count,
        'suspended', signal.suspended
      ) order by signal.pending_report_count desc, signal.confirmed_reviewer_incident_count desc, signal.confirmed_report_count desc, signal.latest_report_at desc)
      from (
        select
          owner.user_id,
          owner.username,
          owner.full_name,
          owner.suspended_at is not null as suspended,
          count(*) filter (where report.status = 'open') as pending_report_count,
          count(*) filter (where report.status = 'hidden') as confirmed_report_count,
          count(distinct report.reviewer_id) filter (where report.status = 'hidden') as confirmed_reviewer_incident_count,
          max(report.created_at) as latest_report_at
        from public.community_reports report
        join public.reviewers reviewer on reviewer.id = report.reviewer_id
        join public.students owner on owner.user_id = reviewer.user_id
        where report.target_type = 'reviewer' and report.status in ('open', 'hidden')
        group by owner.user_id, owner.username, owner.full_name, owner.suspended_at
        order by pending_report_count desc, confirmed_reviewer_incident_count desc, confirmed_report_count desc, latest_report_at desc
        limit 6
      ) signal
    ), '[]'::jsonb)
  ) into result
  from public.students s
  join auth.users u on u.id = s.user_id;

  return result;
end;
$$;

revoke all on function public.cali_admin_overview() from public, anon;
grant execute on function public.cali_admin_overview() to authenticated;
