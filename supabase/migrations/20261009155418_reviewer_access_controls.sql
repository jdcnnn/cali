-- Keep pending requests separate from active reviewer access, and let owners
-- change active permission levels while both sides receive live state updates.

grant select on public.reviewer_access_requests, public.reviewer_access_grants to authenticated;

create policy reviewer_access_requests_participant_select
on public.reviewer_access_requests for select to authenticated
using (
  requester_id = (select auth.uid())
  or exists (
    select 1 from public.reviewers
    where reviewers.id = reviewer_access_requests.reviewer_id
      and reviewers.user_id = (select auth.uid())
  )
);

create policy reviewer_access_grants_participant_select
on public.reviewer_access_grants for select to authenticated
using (
  grantee_id = (select auth.uid())
  or exists (
    select 1 from public.reviewers
    where reviewers.id = reviewer_access_grants.reviewer_id
      and reviewers.user_id = (select auth.uid())
  )
);

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'reviewer_access_requests'
  ) then
    alter publication supabase_realtime add table public.reviewer_access_requests;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'reviewer_access_grants'
  ) then
    alter publication supabase_realtime add table public.reviewer_access_grants;
  end if;
end
$$;

create or replace function public.cali_resolve_reviewer_access(p_request_id uuid, p_approve boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  account_id uuid := (select auth.uid());
  request_row public.reviewer_access_requests;
  reviewer public.reviewers;
  grant_row public.reviewer_access_grants;
begin
  if account_id is null or not public.cali_is_eligible_user() then
    raise exception 'Authentication is required' using errcode = '42501';
  end if;
  select * into request_row from public.reviewer_access_requests
    where id = p_request_id and status = 'pending' for update;
  if request_row.id is null then
    raise exception 'Request is no longer pending' using errcode = 'P0002';
  end if;
  select * into reviewer from public.reviewers
    where id = request_row.reviewer_id and user_id = account_id;
  if reviewer.id is null then
    raise exception 'Request not found' using errcode = 'P0002';
  end if;

  update public.reviewer_access_requests
    set status = case when p_approve then 'approved' else 'denied' end,
        resolved_at = now()
    where id = request_row.id;

  if p_approve then
    update public.reviewer_access_grants
      set status = 'revoked', revoked_at = now()
      where reviewer_id = reviewer.id
        and grantee_id = request_row.requester_id
        and status = 'active';
    insert into public.reviewer_access_grants(request_id, reviewer_id, grantee_id, access_type)
      values (request_row.id, reviewer.id, request_row.requester_id, request_row.access_type)
      returning * into grant_row;
  end if;

  insert into public.community_notifications(user_id, actor_id, reviewer_id, kind, title, body, url)
  values (
    request_row.requester_id,
    account_id,
    reviewer.id,
    case when p_approve then 'access_approved' else 'access_denied' end,
    case when p_approve then 'Reviewer access approved' else 'Reviewer access request declined' end,
    format('@%s %s your %s request for “%s”.',
      (select username from public.students where user_id = account_id),
      case when p_approve then 'approved' else 'declined' end,
      case when request_row.access_type = 'copy' then 'copy' else 'read-only' end,
      reviewer.title),
    case when p_approve then '/community/reviewer/' || reviewer.id::text else '/community?view=inbox' end
  );
  return jsonb_build_object('requestId', request_row.id, 'status', case when p_approve then 'approved' else 'denied' end, 'grantId', grant_row.id);
end;
$$;

create or replace function public.cali_change_reviewer_access(p_grant_id uuid, p_access_type text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  account_id uuid := (select auth.uid());
  current_grant public.reviewer_access_grants;
  reviewer public.reviewers;
  changed_grant public.reviewer_access_grants;
begin
  if account_id is null or not public.cali_is_eligible_user() then
    raise exception 'Authentication is required' using errcode = '42501';
  end if;
  if p_access_type not in ('read', 'copy') then
    raise exception 'Invalid access type' using errcode = '22023';
  end if;
  select g.* into current_grant
    from public.reviewer_access_grants g
    join public.reviewers r on r.id = g.reviewer_id
    where g.id = p_grant_id and g.status = 'active' and r.user_id = account_id
    for update of g;
  if current_grant.id is null then
    raise exception 'Active grant not found' using errcode = 'P0002';
  end if;
  if current_grant.access_type = p_access_type and not exists (
    select 1 from public.reviewer_access_grants
    where reviewer_id = current_grant.reviewer_id
      and grantee_id = current_grant.grantee_id
      and status = 'active'
      and access_type <> p_access_type
  ) then
    raise exception 'That access level is already active' using errcode = 'P0001';
  end if;

  update public.reviewer_access_grants
    set status = 'revoked', revoked_at = now()
    where reviewer_id = current_grant.reviewer_id
      and grantee_id = current_grant.grantee_id
      and status = 'active';
  insert into public.reviewer_access_grants(request_id, reviewer_id, grantee_id, access_type)
    values (current_grant.request_id, current_grant.reviewer_id, current_grant.grantee_id, p_access_type)
    returning * into changed_grant;
  select * into reviewer from public.reviewers where id = current_grant.reviewer_id;

  insert into public.community_notifications(user_id, actor_id, reviewer_id, kind, title, body, url)
  values (
    current_grant.grantee_id,
    account_id,
    reviewer.id,
    'access_approved',
    'Reviewer access changed',
    format('@%s changed your access to %s for “%s”.',
      (select username from public.students where user_id = account_id),
      case when p_access_type = 'copy' then 'copy access' else 'full read access' end,
      reviewer.title),
    '/community/reviewer/' || reviewer.id::text
  );
  return jsonb_build_object('grantId', changed_grant.id, 'type', changed_grant.access_type);
end;
$$;

create or replace function public.cali_revoke_reviewer_access(p_grant_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  account_id uuid := (select auth.uid());
  grant_row public.reviewer_access_grants;
  reviewer public.reviewers;
begin
  select g.* into grant_row
    from public.reviewer_access_grants g
    join public.reviewers r on r.id = g.reviewer_id
    where g.id = p_grant_id and g.status = 'active' and r.user_id = account_id
    for update of g;
  if grant_row.id is null then
    raise exception 'Active grant not found' using errcode = 'P0002';
  end if;
  update public.reviewer_access_grants
    set status = 'revoked', revoked_at = now()
    where reviewer_id = grant_row.reviewer_id
      and grantee_id = grant_row.grantee_id
      and status = 'active';
  select * into reviewer from public.reviewers where id = grant_row.reviewer_id;
  insert into public.community_notifications(user_id, actor_id, reviewer_id, kind, title, body, url)
  values (
    grant_row.grantee_id,
    account_id,
    reviewer.id,
    'access_revoked',
    'Reviewer access ended',
    format('@%s revoked your access to “%s”.',
      (select username from public.students where user_id = account_id), reviewer.title),
    '/community?view=inbox'
  );
end;
$$;

create or replace function public.cali_get_community_inbox()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  account_id uuid := (select auth.uid());
  result jsonb;
begin
  if account_id is null or not public.cali_is_eligible_user() then
    raise exception 'Authentication is required' using errcode = '42501';
  end if;
  select jsonb_build_object(
    'incoming', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', q.id, 'type', q.access_type, 'status', q.status, 'createdAt', q.created_at,
        'reviewer', jsonb_build_object('id', r.id, 'title', r.title, 'visibility', r.visibility),
        'student', jsonb_build_object('userId', s.user_id, 'username', s.username, 'avatarUrl', s.avatar_url),
        'grantId', null
      ) order by q.created_at desc)
      from public.reviewer_access_requests q
      join public.reviewers r on r.id = q.reviewer_id
      join public.students s on s.user_id = q.requester_id
      where r.user_id = account_id and q.status = 'pending'
    ), '[]'::jsonb),
    'access', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', active.id, 'type', active.access_type, 'createdAt', active.created_at,
        'reviewer', jsonb_build_object('id', active.reviewer_id, 'title', active.title, 'visibility', active.visibility),
        'student', jsonb_build_object('userId', active.grantee_id, 'username', active.username, 'avatarUrl', active.avatar_url)
      ) order by active.created_at desc)
      from (
        select distinct on (g.reviewer_id, g.grantee_id)
          g.id, g.access_type, g.created_at, g.reviewer_id, g.grantee_id,
          r.title, r.visibility, s.username, s.avatar_url
        from public.reviewer_access_grants g
        join public.reviewers r on r.id = g.reviewer_id
        join public.students s on s.user_id = g.grantee_id
        where r.user_id = account_id and g.status = 'active'
        order by g.reviewer_id, g.grantee_id,
          case when g.access_type = 'copy' then 0 else 1 end,
          g.created_at desc
      ) active
    ), '[]'::jsonb),
    'outgoing', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', q.id, 'type', q.access_type, 'status', q.status, 'createdAt', q.created_at,
        'reviewer', jsonb_build_object('id', r.id, 'title', r.title, 'visibility', r.visibility),
        'student', jsonb_build_object('userId', s.user_id, 'username', s.username, 'avatarUrl', s.avatar_url),
        'grantId', g.id
      ) order by q.created_at desc)
      from public.reviewer_access_requests q
      join public.reviewers r on r.id = q.reviewer_id
      join public.students s on s.user_id = r.user_id
      left join public.reviewer_access_grants g on g.request_id = q.id and g.status = 'active'
      where q.requester_id = account_id
    ), '[]'::jsonb),
    'notifications', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', n.id, 'kind', n.kind, 'title', n.title, 'body', n.body, 'url', n.url,
        'readAt', n.read_at, 'archivedAt', n.archived_at, 'createdAt', n.created_at
      ) order by n.created_at desc)
      from (
        select * from public.community_notifications
        where user_id = account_id and archived_at is null
        order by created_at desc limit 10
      ) n
    ), '[]'::jsonb),
    'unreadCount', (
      select count(*) from public.community_notifications
      where user_id = account_id and archived_at is null and read_at is null
    )
  ) into result;
  return result;
end;
$$;

revoke all on function public.cali_change_reviewer_access(uuid, text) from public, anon;
grant execute on function public.cali_change_reviewer_access(uuid, text) to authenticated;
