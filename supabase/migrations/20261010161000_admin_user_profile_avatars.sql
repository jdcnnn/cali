-- Include public profile avatars in the administrator user directory. The
-- client renders initials when an avatar is absent or cannot be loaded.

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
      s.avatar_url,
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
        'avatarUrl', avatar_url,
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
