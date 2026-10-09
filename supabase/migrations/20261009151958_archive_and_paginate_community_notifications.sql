alter table public.community_notifications
  add column if not exists archived_at timestamptz;

create index if not exists community_notifications_active_user_idx
  on public.community_notifications(user_id, created_at desc)
  where archived_at is null;

grant update (archived_at) on public.community_notifications to authenticated;

create or replace function public.cali_get_community_inbox()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare account_id uuid := (select auth.uid()); result jsonb;
begin
  if account_id is null or not public.cali_is_eligible_user() then raise exception 'Authentication is required' using errcode = '42501'; end if;
  select jsonb_build_object(
    'incoming', coalesce((select jsonb_agg(jsonb_build_object('id', q.id, 'type', q.access_type, 'status', q.status, 'createdAt', q.created_at,
      'reviewer', jsonb_build_object('id', r.id, 'title', r.title, 'visibility', r.visibility),
      'student', jsonb_build_object('userId', s.user_id, 'username', s.username, 'avatarUrl', s.avatar_url),
      'grantId', g.id) order by q.created_at desc)
      from public.reviewer_access_requests q join public.reviewers r on r.id = q.reviewer_id join public.students s on s.user_id = q.requester_id
      left join public.reviewer_access_grants g on g.request_id = q.id and g.status = 'active'
      where r.user_id = account_id), '[]'::jsonb),
    'outgoing', coalesce((select jsonb_agg(jsonb_build_object('id', q.id, 'type', q.access_type, 'status', q.status, 'createdAt', q.created_at,
      'reviewer', jsonb_build_object('id', r.id, 'title', r.title, 'visibility', r.visibility),
      'student', jsonb_build_object('userId', s.user_id, 'username', s.username, 'avatarUrl', s.avatar_url),
      'grantId', g.id) order by q.created_at desc)
      from public.reviewer_access_requests q join public.reviewers r on r.id = q.reviewer_id join public.students s on s.user_id = r.user_id
      left join public.reviewer_access_grants g on g.request_id = q.id
      where q.requester_id = account_id), '[]'::jsonb),
    'notifications', coalesce((select jsonb_agg(jsonb_build_object('id', n.id, 'kind', n.kind, 'title', n.title, 'body', n.body, 'url', n.url, 'readAt', n.read_at, 'archivedAt', n.archived_at, 'createdAt', n.created_at) order by n.created_at desc)
      from (select * from public.community_notifications where user_id = account_id and archived_at is null order by created_at desc limit 10) n), '[]'::jsonb),
    'unreadCount', (select count(*) from public.community_notifications where user_id = account_id and archived_at is null and read_at is null)
  ) into result;
  return result;
end;
$$;

create or replace function public.cali_mark_community_notifications_read()
returns void language sql security definer set search_path = '' as $$
  update public.community_notifications
  set read_at = now()
  where user_id = (select auth.uid()) and archived_at is null and read_at is null
$$;
