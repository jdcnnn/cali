-- A student can permanently remove only their own CALI account. The existing
-- foreign keys cascade this deletion to their profile and schedule records;
-- the institutional email is removed with the auth.users row.
create or replace function public.cali_delete_own_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  account_id uuid := (select auth.uid());
begin
  if account_id is null or not public.cali_is_eligible_user() then
    raise exception 'A verified RTU Google account is required' using errcode = '42501';
  end if;

  delete from auth.users where id = account_id;
  if not found then
    raise exception 'Account not found' using errcode = 'P0002';
  end if;
end;
$$;

revoke all on function public.cali_delete_own_account() from public, anon;
grant execute on function public.cali_delete_own_account() to authenticated;
