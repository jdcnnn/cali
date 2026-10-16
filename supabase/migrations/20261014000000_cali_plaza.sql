-- Additive Plaza V1 contracts. Availability stays off until authenticated QA.
alter table public.cali_system_settings add column if not exists plaza_enabled boolean not null default false;
create table public.plaza_preferences (
  user_id uuid primary key references public.students(user_id) on delete cascade,
  base text not null check (base in ('boy','girl')),
  color text not null check (color in ('#189ad3','#5277d9','#749f84','#d77a86','#dcab62','#f1eee5'))
);
create table public.plaza_rooms (id uuid primary key default gen_random_uuid(), created_at timestamptz not null default now());
create table public.plaza_members (
  user_id uuid primary key references public.students(user_id) on delete cascade,
  session_id uuid not null unique,
  room_id uuid not null references public.plaza_rooms(id) on delete cascade,
  spawn integer not null check (spawn between 0 and 7),
  x real not null default 0 check (x between -26 and 26),
  z real not null default 15 check (z between -21 and 21),
  yaw real not null default 3.141593 check (yaw between -100000 and 100000),
  expires_at timestamptz not null,
  seat text,
  unique(room_id,seat)
);
create index plaza_members_room_idx on public.plaza_members(room_id,expires_at);
create table public.plaza_seats (id text primary key, x real not null, z real not null);
insert into public.plaza_seats select 'fountain-'||i, sin(i*pi()/3)*2.35, 1.75+cos(i*pi()/3)*2.35 from generate_series(0,5) i;
insert into public.plaza_seats
select 'bench-'||b.i||'-'||j, b.x+cos(b.yaw)*(j-1)*.85, b.z-sin(b.yaw)*(j-1)*.85
from (values (0,-14.0,-4.0,pi()/2),(1,-12.4,-6.1,0.0),(2,13.0,5.0,-pi()/2),(3,15.1,7.1,pi())) b(i,x,z,yaw) cross join generate_series(0,2) j;
alter table public.plaza_members add foreign key (seat) references public.plaza_seats(id);
create table public.plaza_chat (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.students(user_id) on delete cascade,
  room_id uuid not null references public.plaza_rooms(id) on delete cascade,
  nonce uuid not null,
  username text not null,
  body text not null check (char_length(btrim(body)) between 1 and 280),
  created_at timestamptz not null default now(),
  hidden_at timestamptz,
  unique(user_id,nonce)
);
create index plaza_chat_room_idx on public.plaza_chat(room_id,created_at desc);
create index plaza_chat_sender_idx on public.plaza_chat(user_id,created_at desc);
-- Events contain only invalidation metadata, never message text or private identity.
create table public.plaza_events (id bigint generated always as identity primary key, room_id uuid not null references public.plaza_rooms(id) on delete cascade, kind text not null, created_at timestamptz not null default now());
alter table public.plaza_preferences enable row level security;
alter table public.plaza_rooms enable row level security;
alter table public.plaza_members enable row level security;
alter table public.plaza_seats enable row level security;
alter table public.plaza_chat enable row level security;
alter table public.plaza_events enable row level security;
revoke all on public.plaza_preferences,public.plaza_rooms,public.plaza_members,public.plaza_seats,public.plaza_chat,public.plaza_events from public,anon,authenticated;

create function public.cali_plaza_member(p_room uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select public.cali_is_eligible_user() and exists(select 1 from public.cali_system_settings where plaza_enabled)
 and exists(select 1 from public.plaza_members m join public.students s on s.user_id=m.user_id
 where m.user_id=auth.uid() and m.room_id=p_room and m.expires_at>now() and s.community_hidden_at is null)
$$;
revoke all on function public.cali_plaza_member(uuid) from public,anon;
grant execute on function public.cali_plaza_member(uuid) to authenticated;
grant select on public.plaza_chat,public.plaza_events to authenticated;
create policy plaza_chat_read on public.plaza_chat for select to authenticated using(public.cali_plaza_member(room_id) and hidden_at is null and created_at>now()-interval '24 hours');
create policy plaza_events_read on public.plaza_events for select to authenticated using(public.cali_plaza_member(room_id));

create function public.cali_plaza_preferences()
returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('base',base,'color',color) from public.plaza_preferences where user_id=auth.uid() and public.cali_is_eligible_user()
$$;
create function public.cali_plaza_save_preferences(p_base text,p_color text)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if not public.cali_is_eligible_user() then raise exception 'Authentication is required' using errcode='42501'; end if;
 insert into public.plaza_preferences(user_id,base,color) values(auth.uid(),p_base,p_color)
 on conflict(user_id) do update set color=excluded.color where plaza_preferences.base=excluded.base;
 if not found then raise exception 'Your avatar base is already selected'; end if;
 return public.cali_plaza_preferences();
end $$;

create function public.cali_plaza_roster(p_room uuid)
returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('userId',m.user_id,'sessionId',m.session_id,'username',s.username,'base',p.base,'color',p.color,'x',m.x,'z',m.z,'yaw',m.yaw,'seat',m.seat) order by s.username),'[]'::jsonb)
 from public.plaza_members m join public.students s on s.user_id=m.user_id join public.plaza_preferences p on p.user_id=m.user_id
 where m.room_id=p_room and m.expires_at>now() and s.suspended_at is null and s.community_hidden_at is null
$$;
revoke all on function public.cali_plaza_roster(uuid) from public,anon,authenticated;

create function public.cali_plaza_join(p_session uuid,p_room uuid default null,p_takeover boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
declare account_id uuid:=auth.uid(); membership public.plaza_members; destination uuid; spawn_index integer;
begin
 if not public.cali_is_eligible_user() or not exists(select 1 from public.students where user_id=account_id and community_hidden_at is null) then raise exception 'Your account cannot enter Plaza' using errcode='42501'; end if;
 if not exists(select 1 from public.cali_system_settings where plaza_enabled) then raise exception 'Plaza is currently closed. Please try again later.'; end if;
 if not exists(select 1 from public.plaza_preferences where user_id=account_id) then raise exception 'Choose your student avatar first'; end if;
 -- Serialize allocation, including simultaneous overflow and seat recovery.
 perform pg_advisory_xact_lock(2026101400);
 delete from public.plaza_members where expires_at<=now();
 select * into membership from public.plaza_members where user_id=account_id for update;
 if membership.user_id is not null and membership.session_id<>p_session and not p_takeover then raise exception 'Plaza is open in another tab. Take over that session to continue.'; end if;
 if membership.user_id is not null and membership.session_id=p_session then
  update public.plaza_members set expires_at=now()+interval '90 seconds' where user_id=account_id;
  return jsonb_build_object('roomId',membership.room_id,'sessionId',p_session,'spawn',membership.spawn,'members',public.cali_plaza_roster(membership.room_id));
 end if;
 delete from public.plaza_members where user_id=account_id;
 if p_room is not null and exists(select 1 from public.plaza_rooms where id=p_room) and (select count(*) from public.plaza_members where room_id=p_room)<20 then destination:=p_room; end if;
 if destination is null then select r.id into destination from public.plaza_rooms r where (select count(*) from public.plaza_members where room_id=r.id)<20 order by r.created_at limit 1; end if;
 if destination is not null and not exists(select 1 from public.plaza_members where room_id=destination)
 and (select count(distinct room_id) from public.plaza_members)>=2 then raise exception 'Plaza is full. Please try again shortly.'; end if;
 if destination is null then
  -- School-demo guardrail: at most two simultaneous instances (40 students).
  if (select count(*) from public.plaza_rooms r where exists(select 1 from public.plaza_members m where m.room_id=r.id))>=2 then raise exception 'Plaza is full. Please try again shortly.'; end if;
  insert into public.plaza_rooms default values returning id into destination;
 end if;
 select i into spawn_index from generate_series(0,7) i order by (select count(*) from public.plaza_members where room_id=destination and spawn=i),i limit 1;
 insert into public.plaza_members(user_id,session_id,room_id,spawn,x,z,expires_at) values(account_id,p_session,destination,spawn_index,(spawn_index%4-1.5)*1.4,14+(spawn_index/4)*1.6,now()+interval '90 seconds');
 insert into public.plaza_events(room_id,kind) values(destination,'roster');
 return jsonb_build_object('roomId',destination,'sessionId',p_session,'spawn',spawn_index,'members',public.cali_plaza_roster(destination));
end $$;

create function public.cali_plaza_renew(p_session uuid,p_x real,p_z real,p_yaw real)
returns jsonb language plpgsql security definer set search_path='' as $$
declare destination uuid;
begin
 select room_id into destination from public.plaza_members where user_id=auth.uid() and session_id=p_session and expires_at>now();
 if destination is null or not public.cali_plaza_member(destination) then raise exception 'Your Plaza session has ended. Rejoin to continue.' using errcode='42501'; end if;
 update public.plaza_members set x=p_x,z=p_z,yaw=p_yaw,expires_at=now()+interval '90 seconds' where user_id=auth.uid() and session_id=p_session;
 return public.cali_plaza_roster(destination);
end $$;
create function public.cali_plaza_leave(p_session uuid)
returns void language plpgsql security definer set search_path='' as $$
declare destination uuid;
begin
 delete from public.plaza_members where user_id=auth.uid() and session_id=p_session returning room_id into destination;
 if destination is not null then insert into public.plaza_events(room_id,kind) values(destination,'roster'); end if;
end $$;
create function public.cali_plaza_seat(p_session uuid,p_seat text,p_x real,p_z real)
returns jsonb language plpgsql security definer set search_path='' as $$
declare destination uuid; seat_row public.plaza_seats;
begin
 perform pg_advisory_xact_lock(2026101400);
 delete from public.plaza_members where expires_at<=now();
 select room_id into destination from public.plaza_members where user_id=auth.uid() and session_id=p_session;
 if destination is null or not public.cali_plaza_member(destination) then raise exception 'Your Plaza session has ended' using errcode='42501'; end if;
 if p_seat is not null then
  select * into seat_row from public.plaza_seats where id=p_seat;
  if seat_row.id is null or (p_x-seat_row.x)^2+(p_z-seat_row.z)^2>1.7^2 then raise exception 'Move closer to this seat'; end if;
  update public.plaza_members set seat=p_seat,x=seat_row.x,z=seat_row.z where user_id=auth.uid();
 else update public.plaza_members set seat=null,x=p_x,z=p_z where user_id=auth.uid(); end if;
 insert into public.plaza_events(room_id,kind) values(destination,'roster');
 return public.cali_plaza_roster(destination);
exception when unique_violation then raise exception 'Someone is already sitting here';
end $$;

create function public.cali_plaza_messages(p_room uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if not public.cali_plaza_member(p_room) then raise exception 'Room access is required' using errcode='42501'; end if;
 select coalesce(jsonb_agg(to_jsonb(m)-'nonce' order by m.created_at),'[]'::jsonb) into result from (select * from public.plaza_chat where room_id=p_room and hidden_at is null and created_at>now()-interval '24 hours' order by created_at desc,id limit 50) m;
 return result;
end $$;
create function public.cali_plaza_send(p_session uuid,p_body text,p_nonce uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare destination uuid; message public.plaza_chat; account_id uuid:=auth.uid();
begin
 select room_id into destination from public.plaza_members where user_id=account_id and session_id=p_session;
 if destination is null or not public.cali_plaza_member(destination) then raise exception 'Room access is required' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(hashtextextended(account_id::text,0));
 select * into message from public.plaza_chat where user_id=account_id and nonce=p_nonce;
 if message.id is not null then return to_jsonb(message)-'nonce'; end if;
 if exists(select 1 from public.plaza_chat where user_id=account_id and created_at>now()-interval '2 seconds') or (select count(*) from public.plaza_chat where user_id=account_id and created_at>now()-interval '1 minute')>=15 then raise exception 'Please wait a moment before sending another message'; end if;
 insert into public.plaza_chat(user_id,room_id,nonce,username,body) select account_id,destination,p_nonce,s.username,btrim(p_body) from public.students s where s.user_id=account_id returning * into message;
 return to_jsonb(message)-'nonce';
end $$;
create function public.cali_plaza_featured_profiles()
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if not public.cali_is_eligible_user() then raise exception 'Authentication is required' using errcode='42501'; end if;
 select coalesce(jsonb_agg(public.cali_get_community_profile(s.username)),'[]'::jsonb) into result from (select username from public.students where community_hidden_at is null and suspended_at is null order by md5(user_id::text||(now() at time zone 'UTC')::date::text) limit 6) s;
 return result;
end $$;
create function public.cali_plaza_report(p_message uuid,p_reason text,p_details text)
returns void language plpgsql security definer set search_path='' as $$
declare message public.plaza_chat;
begin
 select * into message from public.plaza_chat where id=p_message and hidden_at is null and created_at>now()-interval '24 hours';
 if message.id is null or not public.cali_plaza_member(message.room_id) then raise exception 'Message unavailable' using errcode='42501'; end if;
 if char_length(btrim(p_details))<10 then raise exception 'Add at least 10 characters of context'; end if;
 perform public.cali_report_community_target('profile',message.user_id,p_reason,left(format('Plaza message %s at %s: %s | Context: %s',message.id,message.created_at,message.body,p_details),1000));
end $$;
create function public.cali_plaza_hide_message(p_message uuid)
returns void language plpgsql security definer set search_path='' as $$
declare destination uuid;
begin
 if not public.cali_is_eligible_user() or not public.cali_is_admin(auth.uid()) then raise exception 'Administrator access is required' using errcode='42501'; end if;
 update public.plaza_chat set hidden_at=now() where id=p_message returning room_id into destination;
 if destination is null then raise exception 'Message not found'; end if;
 insert into public.plaza_events(room_id,kind) values(destination,'chat');
 insert into public.admin_audit_log(actor_id,action,target_type,target_id) values(auth.uid(),'plaza.message.hidden','plaza_message',p_message::text);
end $$;
create function public.cali_plaza_set_enabled(p_enabled boolean)
returns void language plpgsql security definer set search_path='' as $$
begin
 if not public.cali_is_eligible_user() or not public.cali_is_admin(auth.uid()) then raise exception 'Administrator access is required' using errcode='42501'; end if;
 update public.cali_system_settings set plaza_enabled=p_enabled,updated_at=now(),updated_by=auth.uid();
 insert into public.admin_audit_log(actor_id,action,target_type,details) values(auth.uid(),'plaza.availability.changed','system',jsonb_build_object('enabled',p_enabled));
end $$;

-- Sender-bound private topics prevent one student publishing as another.
create function public.cali_plaza_topic_allowed(p_topic text,p_write boolean)
returns boolean language plpgsql stable security definer set search_path='' as $$
declare parts text[]:=string_to_array(p_topic,':'); destination uuid; sender uuid;
begin
 if array_length(parts,1)<>4 or parts[1]<>'plaza' or parts[3]<>'player' then return false; end if;
 begin destination:=parts[2]::uuid; sender:=parts[4]::uuid; exception when invalid_text_representation then return false; end;
 return public.cali_plaza_member(destination) and exists(select 1 from public.plaza_members m where m.room_id=destination and m.session_id=sender and m.expires_at>now() and (not p_write or m.user_id=auth.uid()));
end $$;
revoke all on function public.cali_plaza_topic_allowed(text,boolean) from public,anon;
grant execute on function public.cali_plaza_topic_allowed(text,boolean) to authenticated;
create policy plaza_receive on realtime.messages for select to authenticated using(extension in ('broadcast','presence') and public.cali_plaza_topic_allowed(realtime.topic(),false));
create policy plaza_publish on realtime.messages for insert to authenticated with check(extension in ('broadcast','presence') and public.cali_plaza_topic_allowed(realtime.topic(),true));
-- Existing Community vote invalidations move to private channels too. These
-- topic-specific policies do not grant any additional access to Plaza streams.
create policy community_vote_receive on realtime.messages for select to authenticated using(extension='broadcast' and realtime.topic()='community-reviewer-votes' and public.cali_is_eligible_user());
create policy community_vote_publish on realtime.messages for insert to authenticated with check(extension='broadcast' and realtime.topic()='community-reviewer-votes' and public.cali_is_eligible_user());
-- Deploy matching clients and verify both flows before disabling project-wide
-- Realtime public access in Studio. This migration does not change that setting.

do $$ begin
 if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and tablename='plaza_chat') then alter publication supabase_realtime add table public.plaza_chat; end if;
 if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and tablename='plaza_events') then alter publication supabase_realtime add table public.plaza_events; end if;
end $$;
create function public.cali_plaza_cleanup()
returns void language plpgsql security definer set search_path='' as $$
begin
 delete from public.plaza_members where expires_at<=now();
 delete from public.plaza_chat where created_at<=now()-interval '24 hours';
 delete from public.plaza_events where created_at<=now()-interval '10 minutes';
end $$;
revoke all on function public.cali_plaza_cleanup() from public,anon,authenticated;
-- Existing account-deletion transaction cascades through students. Make the
-- Plaza deletion contract explicit before that existing transaction runs.
create function public.cali_plaza_before_student_delete()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 delete from public.plaza_chat where user_id=old.user_id;
 delete from public.plaza_members where user_id=old.user_id;
 delete from public.plaza_preferences where user_id=old.user_id;
 return old;
end $$;
create trigger plaza_before_student_delete before delete on public.students for each row execute function public.cali_plaza_before_student_delete();
revoke all on function public.cali_plaza_before_student_delete() from public,anon,authenticated;
-- Supabase Cron is optional locally; without it, expired rows remain invisible.
do $$ begin
 if exists(select 1 from pg_extension where extname='pg_cron') then
  perform cron.schedule('cali-plaza-cleanup','0 * * * *','select public.cali_plaza_cleanup()');
 end if;
end $$;
do $$ declare f record; begin
 for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('cali_plaza_preferences','cali_plaza_save_preferences','cali_plaza_join','cali_plaza_renew','cali_plaza_leave','cali_plaza_seat','cali_plaza_messages','cali_plaza_send','cali_plaza_featured_profiles','cali_plaza_report','cali_plaza_hide_message','cali_plaza_set_enabled') loop
  execute format('revoke all on function %s from public, anon',f.signature);
  execute format('grant execute on function %s to authenticated',f.signature);
 end loop;
end $$;
