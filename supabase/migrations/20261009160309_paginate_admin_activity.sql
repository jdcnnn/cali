-- Return readable audit targets with server-side pagination.
create or replace function public.cali_admin_audit_page(
  p_page integer default 1,
  p_page_size integer default 10
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  safe_page integer := greatest(coalesce(p_page, 1), 1);
  safe_page_size integer := least(greatest(coalesce(p_page_size, 10), 1), 50);
  total_count integer;
  items jsonb;
begin
  if not public.cali_is_admin(actor) then
    raise exception 'Administrator access is required' using errcode = '42501';
  end if;

  select count(*)::integer into total_count from public.admin_audit_log;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', activity.id,
    'actor', activity.actor_username,
    'action', activity.action,
    'targetType', activity.target_type,
    'targetId', activity.target_id,
    'targetLabel', activity.target_label,
    'details', activity.details,
    'createdAt', activity.created_at
  ) order by activity.created_at desc, activity.id desc), '[]'::jsonb)
  into items
  from (
    select
      audit.id,
      admin_user.username as actor_username,
      audit.action,
      audit.target_type,
      audit.target_id,
      audit.details,
      audit.created_at,
      case
        when audit.target_type = 'system' then 'Google account access'
        when audit.target_type = 'reviewer' then coalesce('“' || reviewer.title || '”', 'Unavailable reviewer')
        when audit.target_type in ('user', 'profile') then coalesce('@' || target_user.username, 'Unavailable ' || audit.target_type)
        else coalesce(initcap(audit.target_type), 'System')
      end as target_label
    from public.admin_audit_log audit
    join public.students admin_user on admin_user.user_id = audit.actor_id
    left join public.reviewers reviewer
      on audit.target_type = 'reviewer' and reviewer.id::text = audit.target_id
    left join public.students target_user
      on audit.target_type in ('user', 'profile') and target_user.user_id::text = audit.target_id
    order by audit.created_at desc, audit.id desc
    limit safe_page_size
    offset (safe_page - 1) * safe_page_size
  ) activity;

  return jsonb_build_object(
    'items', items,
    'total', total_count,
    'page', safe_page,
    'pageSize', safe_page_size
  );
end;
$$;

revoke all on function public.cali_admin_audit_page(integer, integer) from public, anon;
grant execute on function public.cali_admin_audit_page(integer, integer) to authenticated;
