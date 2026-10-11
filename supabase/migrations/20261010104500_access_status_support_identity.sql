-- Include the signed-in student's username in their own access-status response
-- so a suspended account can prepare an identifiable support request.
create or replace function public.cali_access_status()
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
  if account_id is null then
    return jsonb_build_object('eligible', false, 'reason', 'signed_out', 'isAdmin', false, 'username', null);
  end if;

  select jsonb_build_object(
    'eligible', public.cali_is_eligible_user(),
    'isAdmin', coalesce(s.is_admin, false),
    'username', s.username,
    'accountType', case when lower(u.email) ~ '@rtu\.edu\.ph$' then 'institutional' else 'personal' end,
    'reason', case
      when s.suspended_at is not null then 'suspended'
      when not public.cali_is_eligible_user() then 'personal_login_disabled'
      else null
    end,
    'suspensionReason', case when s.suspended_at is not null then s.suspension_reason else null end
  )
  into result
  from auth.users u
  left join public.students s on s.user_id = u.id
  where u.id = account_id;

  return coalesce(result, jsonb_build_object('eligible', false, 'reason', 'account_unavailable', 'isAdmin', false, 'username', null));
end;
$$;

revoke all on function public.cali_access_status() from public, anon;
grant execute on function public.cali_access_status() to authenticated;
