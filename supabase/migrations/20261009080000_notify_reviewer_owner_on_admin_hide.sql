-- Notify reviewer owners when an administrator removes their shared reviewer
-- from Community. Notifications use the existing inbox and push pipeline.

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
begin
  if not public.cali_is_admin(actor) then
    raise exception 'Administrator access is required' using errcode = '42501';
  end if;
  if p_action not in ('dismiss', 'hide') then
    raise exception 'Invalid report action' using errcode = '22023';
  end if;
  if char_length(reason_text) < 3 then
    raise exception 'A resolution reason is required' using errcode = '22023';
  end if;

  select * into report
  from public.community_reports
  where id = p_report_id and status = 'open'
  for update;
  if report.id is null then
    raise exception 'Open report not found' using errcode = 'P0002';
  end if;

  if p_action = 'hide' and report.target_type = 'reviewer' then
    select * into reviewer
    from public.reviewers
    where id = report.reviewer_id
    for update;

    if reviewer.id is not null then
      update public.reviewers
      set moderated_at = now(), moderation_reason = reason_text
      where id = reviewer.id;

      if reviewer.moderated_at is null then
        insert into public.community_notifications(user_id, actor_id, reviewer_id, kind, title, body, url)
        values (
          reviewer.user_id,
          actor,
          reviewer.id,
          'moderation',
          'Reviewer hidden from Community',
          format('"%s" was hidden from Community. Reason: %s', left(reviewer.title, 80), left(reason_text, 170)),
          '/community?view=inbox'
        );
      end if;
    end if;
  end if;

  if p_action = 'hide' and report.target_type = 'profile' then
    update public.students set community_hidden_at = now() where user_id = report.profile_user_id;
  end if;

  update public.community_reports
  set status = case when p_action = 'hide' then 'hidden' else 'dismissed' end,
      resolution_note = reason_text,
      resolved_by = actor,
      resolved_at = now()
  where id = report.id;

  insert into public.admin_audit_log(actor_id, action, target_type, target_id, details)
  values (actor, 'report.' || p_action, report.target_type, coalesce(report.reviewer_id, report.profile_user_id)::text,
    jsonb_build_object('reportId', report.id, 'reason', reason_text));
end;
$$;

create or replace function public.cali_admin_set_community_visibility(p_target_type text, p_target_id uuid, p_hidden boolean, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  reviewer public.reviewers;
  reason_text text := left(btrim(coalesce(p_reason, '')), 500);
begin
  if not public.cali_is_admin(actor) then
    raise exception 'Administrator access is required' using errcode = '42501';
  end if;
  if char_length(reason_text) < 3 then
    raise exception 'A moderation reason is required' using errcode = '22023';
  end if;

  if p_target_type = 'reviewer' then
    select * into reviewer
    from public.reviewers
    where id = p_target_id
    for update;
    if reviewer.id is null then
      raise exception 'Reviewer not found' using errcode = 'P0002';
    end if;

    update public.reviewers
    set moderated_at = case when p_hidden then now() else null end,
        moderation_reason = case when p_hidden then reason_text else null end
    where id = reviewer.id;

    if p_hidden and reviewer.moderated_at is null then
      insert into public.community_notifications(user_id, actor_id, reviewer_id, kind, title, body, url)
      values (
        reviewer.user_id,
        actor,
        reviewer.id,
        'moderation',
        'Reviewer hidden from Community',
        format('"%s" was hidden from Community. Reason: %s', left(reviewer.title, 80), left(reason_text, 170)),
        '/community?view=inbox'
      );
    end if;
  elsif p_target_type = 'profile' then
    update public.students
    set community_hidden_at = case when p_hidden then now() else null end
    where user_id = p_target_id;
    if not found then
      raise exception 'Profile not found' using errcode = 'P0002';
    end if;
  else
    raise exception 'Invalid moderation target' using errcode = '22023';
  end if;

  insert into public.admin_audit_log(actor_id, action, target_type, target_id, details)
  values (actor, 'community.' || case when p_hidden then 'hidden' else 'restored' end,
    p_target_type, p_target_id::text, jsonb_build_object('reason', reason_text));
end;
$$;
