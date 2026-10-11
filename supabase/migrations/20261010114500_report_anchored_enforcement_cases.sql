-- Build a durable enforcement trail between confirmed reviewer reports and an
-- account suspension. Reports alone never suspend an account: an administrator
-- confirms each violation by hiding the reviewer, then approves any suspension.

create table if not exists public.account_enforcement_cases (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.students(user_id) on delete cascade,
  status text not null default 'monitoring',
  confirmed_incident_count integer not null default 0,
  opened_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  suspended_at timestamptz,
  suspended_by uuid references public.students(user_id) on delete set null,
  closed_at timestamptz,
  closed_by uuid references public.students(user_id) on delete set null,
  decision_note text,
  constraint account_enforcement_cases_status_valid check (status in ('monitoring', 'warning', 'suspension_review', 'suspended', 'closed')),
  constraint account_enforcement_cases_count_valid check (confirmed_incident_count >= 0),
  constraint account_enforcement_cases_note_valid check (decision_note is null or char_length(btrim(decision_note)) between 3 and 500)
);

create unique index if not exists account_enforcement_cases_active_user_idx
  on public.account_enforcement_cases(user_id)
  where status <> 'closed';
create index if not exists account_enforcement_cases_queue_idx
  on public.account_enforcement_cases(status, updated_at desc);

create table if not exists public.account_enforcement_case_reports (
  case_id uuid not null references public.account_enforcement_cases(id) on delete cascade,
  report_id uuid not null references public.community_reports(id) on delete restrict,
  attached_at timestamptz not null default now(),
  primary key (case_id, report_id),
  unique (report_id)
);

alter table public.account_enforcement_cases enable row level security;
alter table public.account_enforcement_case_reports enable row level security;
revoke all on public.account_enforcement_cases, public.account_enforcement_case_reports from public, anon, authenticated;

create or replace function public.cali_refresh_enforcement_case(
  p_user_id uuid,
  p_notify boolean default true
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  case_row public.account_enforcement_cases;
  incident_count integer;
  next_status text;
  previous_status text;
  latest_reviewer_id uuid;
  notification_title text;
  notification_body text;
begin
  select count(distinct report.reviewer_id)::integer, max(report.reviewer_id::text)::uuid
  into incident_count, latest_reviewer_id
  from public.community_reports report
  join public.reviewers reviewer on reviewer.id = report.reviewer_id
  where reviewer.user_id = p_user_id
    and report.target_type = 'reviewer'
    and report.status = 'hidden'
    and report.resolved_at >= now() - interval '90 days';

  if incident_count = 0 then return null; end if;
  next_status := case when incident_count >= 3 then 'suspension_review' when incident_count = 2 then 'warning' else 'monitoring' end;

  select * into case_row
  from public.account_enforcement_cases
  where user_id = p_user_id and status <> 'closed'
  for update;

  if case_row.id is null then
    insert into public.account_enforcement_cases(user_id, status, confirmed_incident_count)
    values (p_user_id, next_status, incident_count)
    returning * into case_row;
    previous_status := null;
  else
    previous_status := case_row.status;
    if case_row.status not in ('suspended', 'closed') then
      update public.account_enforcement_cases
      set status = next_status, confirmed_incident_count = incident_count, updated_at = now()
      where id = case_row.id
      returning * into case_row;
    end if;
  end if;

  insert into public.account_enforcement_case_reports(case_id, report_id)
  select case_row.id, report.id
  from public.community_reports report
  join public.reviewers reviewer on reviewer.id = report.reviewer_id
  where reviewer.user_id = p_user_id
    and report.target_type = 'reviewer'
    and report.status = 'hidden'
    and report.resolved_at >= now() - interval '90 days'
  on conflict (report_id) do nothing;

  if p_notify and previous_status is distinct from next_status and case_row.status <> 'suspended' then
    notification_title := case next_status
      when 'monitoring' then 'Account monitoring started'
      when 'warning' then 'Formal Community warning'
      else 'Account suspension review opened'
    end;
    notification_body := case next_status
      when 'monitoring' then 'An administrator confirmed a reviewer violation. Future confirmed violations within 90 days may escalate account enforcement.'
      when 'warning' then 'Two distinct reviewer violations were confirmed within 90 days. Another confirmed violation may lead to account suspension review.'
      else 'Three or more distinct reviewer violations were confirmed within 90 days. Administrators will now review your account for suspension.'
    end;
    insert into public.community_notifications(user_id, actor_id, reviewer_id, kind, title, body, url)
    values (p_user_id, null, latest_reviewer_id, 'moderation', notification_title, notification_body, '/community?view=inbox');
  end if;

  return case_row.id;
end;
$$;

revoke all on function public.cali_refresh_enforcement_case(uuid, boolean) from public, anon, authenticated;

create or replace function public.cali_admin_resolve_report(p_report_id uuid, p_action text, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  report public.community_reports;
  reviewer public.reviewers;
  reason_text text := left(btrim(coalesce(p_reason, '')), 500);
  enforcement_case_id uuid;
begin
  if not public.cali_is_admin(actor) then raise exception 'Administrator access is required' using errcode = '42501'; end if;
  if p_action not in ('dismiss', 'hide') then raise exception 'Invalid report action' using errcode = '22023'; end if;
  if char_length(reason_text) < 3 then raise exception 'A resolution reason is required' using errcode = '22023'; end if;

  select * into report from public.community_reports where id = p_report_id and status = 'open' for update;
  if report.id is null then raise exception 'Open report not found' using errcode = 'P0002'; end if;
  if p_action = 'hide' and report.target_type <> 'reviewer' then raise exception 'Profiles are managed in Users and cannot be hidden from Community' using errcode = '22023'; end if;

  if p_action = 'hide' then
    select * into reviewer from public.reviewers where id = report.reviewer_id for update;
    if reviewer.id is not null then
      update public.reviewers set moderated_at = now(), moderation_reason = reason_text where id = reviewer.id;
      if reviewer.moderated_at is null then
        insert into public.community_notifications(user_id, actor_id, reviewer_id, kind, title, body, url)
        values (reviewer.user_id, actor, reviewer.id, 'moderation', 'Reviewer hidden from Community', format('"%s" was hidden from Community. Reason: %s', left(reviewer.title, 80), left(reason_text, 170)), '/community?view=inbox');
      end if;
    end if;
  end if;

  update public.community_reports
  set status = case when p_action = 'hide' then 'hidden' else 'dismissed' end,
      resolution_note = reason_text, resolved_by = actor, resolved_at = now()
  where id = report.id;

  if p_action = 'hide' and reviewer.user_id is not null then
    enforcement_case_id := public.cali_refresh_enforcement_case(reviewer.user_id, true);
  end if;

  insert into public.admin_audit_log(actor_id, action, target_type, target_id, details)
  values (actor, 'report.' || p_action, report.target_type, coalesce(report.reviewer_id, report.profile_user_id)::text,
    jsonb_build_object('reportId', report.id, 'reason', reason_text, 'enforcementCaseId', enforcement_case_id));
end;
$$;

create or replace function public.cali_admin_set_user_suspension(p_user_id uuid, p_suspended boolean, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  target public.students;
  case_row public.account_enforcement_cases;
  report_ids jsonb := '[]'::jsonb;
  reason_text text := left(btrim(coalesce(p_reason, '')), 500);
begin
  if not public.cali_is_admin(actor) then raise exception 'Administrator access is required' using errcode = '42501'; end if;
  select * into target from public.students where user_id = p_user_id for update;
  if target.user_id is null then raise exception 'User not found' using errcode = 'P0002'; end if;
  if target.user_id = actor then raise exception 'Administrators cannot suspend themselves' using errcode = '42501'; end if;
  if target.is_admin then raise exception 'Administrators cannot suspend another administrator' using errcode = '42501'; end if;
  if p_suspended and char_length(reason_text) < 3 then raise exception 'A suspension reason is required' using errcode = '22023'; end if;

  select * into case_row from public.account_enforcement_cases where user_id = p_user_id and status <> 'closed' for update;
  update public.students
  set suspended_at = case when p_suspended then now() else null end,
      suspended_by = case when p_suspended then actor else null end,
      suspension_reason = case when p_suspended then reason_text else null end
  where user_id = p_user_id;

  if case_row.id is not null then
    select coalesce(jsonb_agg(link.report_id order by link.attached_at), '[]'::jsonb) into report_ids
    from public.account_enforcement_case_reports link where link.case_id = case_row.id;
    update public.account_enforcement_cases
    set status = case when p_suspended then 'suspended' else 'closed' end,
        updated_at = now(),
        suspended_at = case when p_suspended then now() else suspended_at end,
        suspended_by = case when p_suspended then actor else suspended_by end,
        closed_at = case when p_suspended then null else now() end,
        closed_by = case when p_suspended then null else actor end,
        decision_note = reason_text
    where id = case_row.id;
  end if;

  update public.push_subscriptions set is_active = false where user_id = p_user_id and p_suspended;
  insert into public.admin_audit_log(actor_id, action, target_type, target_id, details)
  values (actor, case when p_suspended then 'user.suspended' else 'user.restored' end, 'user', p_user_id::text,
    jsonb_build_object('reason', reason_text, 'enforcementCaseId', case_row.id, 'evidenceReportIds', report_ids));
end;
$$;

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

  select jsonb_build_object(
    'id', enforcement.id,
    'userId', enforcement.user_id,
    'status', enforcement.status,
    'confirmedIncidentCount', enforcement.confirmed_incident_count,
    'openedAt', enforcement.opened_at,
    'updatedAt', enforcement.updated_at,
    'decisionNote', enforcement.decision_note,
    'reports', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', report.id,
        'reviewerId', reviewer.id,
        'reviewerTitle', reviewer.title,
        'reason', report.reason,
        'details', report.details,
        'resolutionNote', report.resolution_note,
        'reportedAt', report.created_at,
        'confirmedAt', report.resolved_at,
        'reporter', reporter.username,
        'confirmedBy', resolver.username
      ) order by report.resolved_at desc)
      from public.account_enforcement_case_reports link
      join public.community_reports report on report.id = link.report_id
      join public.reviewers reviewer on reviewer.id = report.reviewer_id
      join public.students reporter on reporter.user_id = report.reporter_id
      left join public.students resolver on resolver.user_id = report.resolved_by
      where link.case_id = enforcement.id
    ), '[]'::jsonb)
  ) into result
  from public.account_enforcement_cases enforcement
  where enforcement.user_id = p_user_id
  order by (enforcement.status <> 'closed') desc, enforcement.updated_at desc
  limit 1;

  return result;
end;
$$;

revoke all on function public.cali_admin_resolve_report(uuid, text, text), public.cali_admin_set_user_suspension(uuid, boolean, text), public.cali_admin_get_enforcement_case(uuid) from public, anon;
grant execute on function public.cali_admin_resolve_report(uuid, text, text), public.cali_admin_set_user_suspension(uuid, boolean, text), public.cali_admin_get_enforcement_case(uuid) to authenticated;

do $$
declare owner_row record;
begin
  for owner_row in
    select distinct reviewer.user_id
    from public.community_reports report
    join public.reviewers reviewer on reviewer.id = report.reviewer_id
    where report.target_type = 'reviewer' and report.status = 'hidden' and report.resolved_at >= now() - interval '90 days'
  loop
    perform public.cali_refresh_enforcement_case(owner_row.user_id, false);
  end loop;
end;
$$;
