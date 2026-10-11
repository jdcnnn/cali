-- Include pending reviewer reports in an account enforcement record so admins
-- can move from a user directly into the exact moderation inspection.
create or replace function public.cali_admin_get_enforcement_case(p_user_id uuid)
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
  if not public.cali_is_admin(actor) then raise exception 'Administrator access is required' using errcode = '42501'; end if;
  if not exists (select 1 from public.students where user_id = p_user_id) then raise exception 'User not found' using errcode = 'P0002'; end if;

  select jsonb_build_object(
    'id', enforcement.id,
    'userId', p_user_id,
    'status', enforcement.status,
    'confirmedIncidentCount', coalesce(enforcement.confirmed_incident_count, 0),
    'openedAt', enforcement.opened_at,
    'updatedAt', enforcement.updated_at,
    'decisionNote', enforcement.decision_note,
    'reports', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', report.id, 'reviewerId', reviewer.id, 'reviewerTitle', reviewer.title,
        'reason', report.reason, 'details', report.details,
        'resolutionNote', report.resolution_note, 'reportedAt', report.created_at,
        'confirmedAt', report.resolved_at, 'reporter', reporter.username,
        'confirmedBy', resolver.username
      ) order by report.resolved_at desc)
      from public.account_enforcement_case_reports link
      join public.community_reports report on report.id = link.report_id
      join public.reviewers reviewer on reviewer.id = report.reviewer_id
      join public.students reporter on reporter.user_id = report.reporter_id
      left join public.students resolver on resolver.user_id = report.resolved_by
      where link.case_id = enforcement.id
    ), '[]'::jsonb),
    'pendingReports', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', report.id, 'reviewerId', reviewer.id, 'reviewerTitle', reviewer.title,
        'reason', report.reason, 'details', report.details,
        'reportedAt', report.created_at, 'reporter', reporter.username
      ) order by report.created_at desc)
      from public.community_reports report
      join public.reviewers reviewer on reviewer.id = report.reviewer_id
      join public.students reporter on reporter.user_id = report.reporter_id
      where reviewer.user_id = p_user_id and report.target_type = 'reviewer' and report.status = 'open'
    ), '[]'::jsonb)
  ) into result
  from (select 1) seed
  left join lateral (
    select candidate.*
    from public.account_enforcement_cases candidate
    where candidate.user_id = p_user_id
    order by (candidate.status <> 'closed') desc, candidate.updated_at desc
    limit 1
  ) enforcement on true;

  return result;
end;
$$;

revoke all on function public.cali_admin_get_enforcement_case(uuid) from public, anon;
grant execute on function public.cali_admin_get_enforcement_case(uuid) to authenticated;
