-- Expose availability only; student records remain protected by RLS.
create or replace function public.cali_username_available(p_username text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  normalized_username text := lower(btrim(p_username));
begin
  if not public.cali_is_eligible_user() then
    raise exception 'An eligible verified Google account is required' using errcode = '42501';
  end if;
  if normalized_username is null or normalized_username !~ '^[a-z0-9_]{3,30}$' then
    raise exception 'Invalid username' using errcode = '22023';
  end if;
  return not exists (
    select 1 from public.students where username = normalized_username
  );
end;
$$;

revoke all on function public.cali_username_available(text) from public, anon, authenticated;
grant execute on function public.cali_username_available(text) to authenticated;
