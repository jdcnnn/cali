-- Give administrators owner-level reviewer report signals and notify reviewer
-- owners when a new report enters the queue. Reports never suspend accounts
-- automatically; an administrator must review the evidence first.

create or replace function public.cali_admin_search_users(
  p_query text default '',
  p_status text default 'all',
  p_account_type text default 'all',
  p_page integer default 1,
  p_page_size integer default 25
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
begin
  if not public.cali_is_admin(account_id) then
    raise exception 'Administrator access is required' using errcode = '42501';
  end if;

  with filtered as (
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
      (
        select count(*)
        from public.reviewers reviewer
        where reviewer.user_id = s.user_id
          and reviewer.visibility in ('public', 'preview')
      ) as shared_reviewer_count,
      (
        select count(*)
        from public.community_reports report
        join public.reviewers reviewer on reviewer.id = report.reviewer_id
        where report.target_type = 'reviewer' and reviewer.user_id = s.user_id
      ) as reviewer_report_count,
      (
        select count(*)
        from public.community_reports report
        join public.reviewers reviewer on reviewer.id = report.reviewer_id
        where report.target_type = 'reviewer' and report.status = 'open' and reviewer.user_id = s.user_id
      ) as open_reviewer_report_count
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
  ), page_rows as (
    select * from filtered
    order by created_at desc, user_id
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
        'openReviewerReportCount', open_reviewer_report_count
      ) order by created_at desc)
      from page_rows
    ), '[]'::jsonb),
    'total', (select count(*) from filtered),
    'page', safe_page,
    'pageSize', safe_size
  ) into result;

  return result;
end;
$$;

create or replace function public.cali_report_community_target(
  p_target_type text,
  p_target_id uuid,
  p_reason text,
  p_details text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  account_id uuid := (select auth.uid());
  report_id uuid;
  target_reviewer public.reviewers;
  open_report_count bigint;
begin
  if account_id is null or not public.cali_is_eligible_user() then
    raise exception 'Authentication is required' using errcode = '42501';
  end if;

  if p_target_type = 'reviewer' then
    select * into target_reviewer
    from public.reviewers
    where id = p_target_id
      and user_id <> account_id
      and visibility in ('public', 'preview')
      and moderated_at is null;

    if target_reviewer.id is null then
      raise exception 'Reviewer cannot be reported' using errcode = 'P0002';
    end if;

    insert into public.community_reports(reporter_id, target_type, reviewer_id, reason, details)
    values (account_id, 'reviewer', p_target_id, p_reason, nullif(btrim(p_details), ''))
    returning id into report_id;

    select count(*) into open_report_count
    from public.community_reports report
    join public.reviewers reviewer on reviewer.id = report.reviewer_id
    where reviewer.user_id = target_reviewer.user_id
      and report.target_type = 'reviewer'
      and report.status = 'open';

    insert into public.community_notifications(user_id, actor_id, reviewer_id, kind, title, body, url)
    values (
      target_reviewer.user_id,
      null,
      target_reviewer.id,
      'moderation',
      'Your reviewer received a report',
      format(
        '“%s” is awaiting administrator review. You now have %s open reviewer %s. Repeated confirmed violations may lead to account suspension.',
        target_reviewer.title,
        open_report_count,
        case when open_report_count = 1 then 'report' else 'reports' end
      ),
      '/community?view=inbox'
    );
  elsif p_target_type = 'profile' then
    if p_target_id = account_id or not exists (select 1 from public.students where user_id = p_target_id) then
      raise exception 'Profile cannot be reported' using errcode = 'P0002';
    end if;

    insert into public.community_reports(reporter_id, target_type, profile_user_id, reason, details)
    values (account_id, 'profile', p_target_id, p_reason, nullif(btrim(p_details), ''))
    returning id into report_id;
  else
    raise exception 'Invalid report target' using errcode = '22023';
  end if;

  return report_id;
exception
  when unique_violation then
    raise exception 'You already have an open report for this item' using errcode = 'P0001';
end;
$$;

revoke all on function public.cali_admin_search_users(text, text, text, integer, integer) from public, anon;
grant execute on function public.cali_admin_search_users(text, text, text, integer, integer) to authenticated;
revoke all on function public.cali_report_community_target(text, uuid, text, text) from public, anon;
grant execute on function public.cali_report_community_target(text, uuid, text, text) to authenticated;
