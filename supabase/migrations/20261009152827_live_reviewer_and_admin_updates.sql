grant select on public.admin_audit_log to authenticated;

drop policy if exists admin_audit_log_select_admin on public.admin_audit_log;
create policy admin_audit_log_select_admin
on public.admin_audit_log for select to authenticated
using (
  coalesce((
    select student.is_admin
    from public.students student
    where student.user_id = (select auth.uid())
  ), false)
);

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'reviewers'
  ) then
    alter publication supabase_realtime add table public.reviewers;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'admin_audit_log'
  ) then
    alter publication supabase_realtime add table public.admin_audit_log;
  end if;
end
$$;
