-- OPTIONAL rollback, not part of the forward migration directory.
-- First restore the pre-Plaza frontend and keep public Realtime access enabled.
-- To execute later, copy this into a NEW timestamped migration and db push it.
-- The six new Plaza tables are archived, not dropped. No CASCADE is used.
-- This does not recover chat already deleted by the 24-hour retention job.
begin;
set local lock_timeout = '5s';
do $$ begin
 if exists(select 1 from pg_namespace where nspname='plaza_v1_archive') then
  raise exception 'Archive schema already exists; inspect it before rollback';
 end if;
 if exists(select 1 from pg_extension where extname='pg_cron') then
  perform cron.unschedule(jobid) from cron.job where jobname='cali-plaza-cleanup';
 end if;
end $$;

drop trigger if exists plaza_before_student_delete on public.students;
drop policy if exists plaza_receive on realtime.messages;
drop policy if exists plaza_publish on realtime.messages;
drop policy if exists community_vote_receive on realtime.messages;
drop policy if exists community_vote_publish on realtime.messages;
drop policy if exists plaza_chat_read on public.plaza_chat;
drop policy if exists plaza_events_read on public.plaza_events;
do $$ begin
 if exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='plaza_chat') then alter publication supabase_realtime drop table public.plaza_chat; end if;
 if exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='plaza_events') then alter publication supabase_realtime drop table public.plaza_events; end if;
end $$;

drop function public.cali_plaza_preferences();
drop function public.cali_plaza_save_preferences(text,text);
drop function public.cali_plaza_join(uuid,uuid,boolean);
drop function public.cali_plaza_renew(uuid,real,real,real);
drop function public.cali_plaza_leave(uuid);
drop function public.cali_plaza_seat(uuid,text,real,real);
drop function public.cali_plaza_messages(uuid);
drop function public.cali_plaza_send(uuid,text,uuid);
drop function public.cali_plaza_featured_profiles();
drop function public.cali_plaza_report(uuid,text,text);
drop function public.cali_plaza_hide_message(uuid);
drop function public.cali_plaza_set_enabled(boolean);
drop function public.cali_plaza_topic_allowed(text,boolean);
drop function public.cali_plaza_roster(uuid);
drop function public.cali_plaza_member(uuid);
drop function public.cali_plaza_cleanup();
drop function public.cali_plaza_before_student_delete();

create schema plaza_v1_archive;
revoke all on schema plaza_v1_archive from public,anon,authenticated;
revoke all on public.plaza_preferences,public.plaza_rooms,public.plaza_members,public.plaza_seats,public.plaza_chat,public.plaza_events from public,anon,authenticated;
alter table public.plaza_preferences set schema plaza_v1_archive;
alter table public.plaza_rooms set schema plaza_v1_archive;
alter table public.plaza_members set schema plaza_v1_archive;
alter table public.plaza_seats set schema plaza_v1_archive;
alter table public.plaza_chat set schema plaza_v1_archive;
alter table public.plaza_events set schema plaza_v1_archive;
alter table public.cali_system_settings drop column plaza_enabled;
commit;
