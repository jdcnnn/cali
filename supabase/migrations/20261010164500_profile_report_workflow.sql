-- Separate account/profile safety concerns from reviewer-content reports.
-- Profile reports require context and remain review signals only: they never
-- hide or suspend an account automatically.

alter table public.community_reports
  drop constraint if exists community_reports_reason_valid;

alter table public.community_reports
  add constraint community_reports_reason_valid check (
    reason in (
      'spam', 'inappropriate', 'copyright', 'misleading', 'other',
      'impersonation', 'harassment', 'privacy'
    )
  );

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
  normalized_reason text := lower(btrim(coalesce(p_reason, '')));
  normalized_details text := nullif(btrim(coalesce(p_details, '')), '');
begin
  if account_id is null or not public.cali_is_eligible_user() then
    raise exception 'Authentication is required' using errcode = '42501';
  end if;

  if char_length(coalesce(normalized_details, '')) > 1000 then
    raise exception 'Report details must be 1000 characters or fewer' using errcode = '22023';
  end if;

  if p_target_type = 'reviewer' then
    if normalized_reason not in ('misleading', 'spam', 'inappropriate', 'copyright', 'other') then
      raise exception 'Invalid reviewer report reason' using errcode = '22023';
    end if;
    if normalized_reason = 'other' and char_length(coalesce(normalized_details, '')) < 10 then
      raise exception 'Add at least 10 characters of context' using errcode = '22023';
    end if;

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
    values (account_id, 'reviewer', p_target_id, normalized_reason, normalized_details)
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
    if normalized_reason not in ('impersonation', 'harassment', 'inappropriate', 'spam', 'privacy', 'other') then
      raise exception 'Invalid profile report reason' using errcode = '22023';
    end if;
    if char_length(coalesce(normalized_details, '')) < 10 then
      raise exception 'Add at least 10 characters so moderators can review the profile concern' using errcode = '22023';
    end if;
    if p_target_id = account_id or not exists (
      select 1 from public.students
      where user_id = p_target_id and suspended_at is null
    ) then
      raise exception 'Profile cannot be reported' using errcode = 'P0002';
    end if;

    insert into public.community_reports(reporter_id, target_type, profile_user_id, reason, details)
    values (account_id, 'profile', p_target_id, normalized_reason, normalized_details)
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

revoke all on function public.cali_report_community_target(text, uuid, text, text) from public, anon;
grant execute on function public.cali_report_community_target(text, uuid, text, text) to authenticated;
