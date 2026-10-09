-- Global login policy, generalized administrators, suspension, and audited admin APIs.

create table if not exists public.cali_system_settings (
  singleton boolean primary key default true check (singleton),
  allow_personal_google_login boolean not null default false,
  updated_by uuid references public.students(user_id) on delete set null,
  updated_at timestamptz not null default now()
);
insert into public.cali_system_settings(singleton) values (true) on conflict (singleton) do nothing;
alter table public.cali_system_settings enable row level security;
revoke all on public.cali_system_settings from public, anon, authenticated;

do $$
begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'students' and column_name = 'is_community_admin')
     and not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'students' and column_name = 'is_admin') then
    alter table public.students rename column is_community_admin to is_admin;
  end if;
end $$;

alter table public.students
  add column if not exists is_admin boolean not null default false,
  add column if not exists suspended_at timestamptz,
  add column if not exists suspended_by uuid references public.students(user_id) on delete set null,
  add column if not exists suspension_reason text;
alter table public.students drop constraint if exists students_suspension_valid;
alter table public.students add constraint students_suspension_valid check (
  (suspended_at is null and suspended_by is null and suspension_reason is null)
  or (suspended_at is not null and suspended_by is not null and char_length(btrim(suspension_reason)) between 3 and 500)
);
revoke update (is_admin, suspended_at, suspended_by, suspension_reason) on public.students from authenticated;

create table if not exists public.admin_audit_log (
  id bigint generated always as identity primary key,
  actor_id uuid not null references public.students(user_id) on delete restrict,
  action text not null check (action ~ '^[a-z][a-z0-9_.-]{2,80}$'),
  target_type text,
  target_id text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint admin_audit_details_object check (jsonb_typeof(details) = 'object')
);
create index if not exists admin_audit_log_created_idx on public.admin_audit_log(created_at desc);
alter table public.admin_audit_log enable row level security;
revoke all on public.admin_audit_log from public, anon, authenticated;

create or replace function public.cali_is_admin(p_user_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select s.is_admin from public.students s where s.user_id = p_user_id), false)
$$;
revoke all on function public.cali_is_admin(uuid) from public, anon, authenticated;

create or replace function public.cali_community_is_admin(p_user_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.cali_is_admin(p_user_id)
$$;
revoke all on function public.cali_community_is_admin(uuid) from public, anon, authenticated;

create or replace function public.cali_is_eligible_user()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from auth.users u
    join auth.identities i on i.user_id = u.id
    left join public.students s on s.user_id = u.id
    cross join public.cali_system_settings cfg
    where u.id = (select auth.uid())
      and s.suspended_at is null
      and u.email_confirmed_at is not null
      and i.provider = 'google'
      and lower(i.identity_data ->> 'email') = lower(u.email)
      and i.identity_data ->> 'email_verified' = 'true'
      and (lower(u.email) ~ '^[^@]+@rtu\.edu\.ph$' or cfg.allow_personal_google_login or coalesce(s.is_admin, false))
  )
$$;
revoke all on function public.cali_is_eligible_user() from public, anon;
grant execute on function public.cali_is_eligible_user() to authenticated;

create or replace function public.cali_public_login_mode()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('allowPersonalGoogleLogin', allow_personal_google_login)
  from public.cali_system_settings where singleton
$$;
revoke all on function public.cali_public_login_mode() from public;
grant execute on function public.cali_public_login_mode() to anon, authenticated;

create or replace function public.cali_before_user_created(event jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare allowed boolean;
begin
  select allow_personal_google_login into allowed from public.cali_system_settings where singleton;
  if event -> 'user' -> 'app_metadata' ->> 'provider' = 'google'
     and (coalesce(allowed, false) or lower(event -> 'user' ->> 'email') ~ '^[^@]+@rtu\.edu\.ph$') then
    return '{}'::jsonb;
  end if;
  return jsonb_build_object('error', jsonb_build_object('http_code', 403,
    'message', case when allowed then 'Use a verified Google account to sign in.' else 'Use a verified RTU Google account to sign in.' end));
end $$;
revoke all on function public.cali_before_user_created(jsonb) from public, anon, authenticated;
grant execute on function public.cali_before_user_created(jsonb) to supabase_auth_admin;

create or replace function public.cali_access_status()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare account_id uuid := (select auth.uid()); result jsonb;
begin
  if account_id is null then return jsonb_build_object('eligible', false, 'reason', 'signed_out', 'isAdmin', false); end if;
  select jsonb_build_object(
    'eligible', public.cali_is_eligible_user(), 'isAdmin', coalesce(s.is_admin, false),
    'accountType', case when lower(u.email) ~ '@rtu\.edu\.ph$' then 'institutional' else 'personal' end,
    'reason', case when s.suspended_at is not null then 'suspended'
      when not public.cali_is_eligible_user() then 'personal_login_disabled' else null end,
    'suspensionReason', case when s.suspended_at is not null then s.suspension_reason else null end
  ) into result from auth.users u left join public.students s on s.user_id = u.id where u.id = account_id;
  return coalesce(result, jsonb_build_object('eligible', false, 'reason', 'account_unavailable', 'isAdmin', false));
end $$;
revoke all on function public.cali_access_status() from public, anon;
grant execute on function public.cali_access_status() to authenticated;

create or replace function public.cali_complete_onboarding(p_username text,p_program text,p_year_level smallint)
returns public.students language plpgsql security definer set search_path='' as $$
declare identity_data jsonb; google_name text; google_avatar text; student public.students;
begin
  if not public.cali_is_eligible_user() then raise exception 'An eligible verified Google account is required' using errcode='42501'; end if;
  if p_username is null or p_username !~ '^[a-z0-9_]{3,30}$' or p_program is null or char_length(btrim(p_program)) not between 1 and 120 or p_year_level is null or p_year_level not between 1 and 5 then raise exception 'Invalid onboarding details' using errcode='22023'; end if;
  select i.identity_data into identity_data from auth.identities i join auth.users u on u.id=i.user_id where i.user_id=(select auth.uid()) and i.provider='google' and lower(i.identity_data->>'email')=lower(u.email) and i.identity_data->>'email_verified'='true' limit 1;
  google_name:=nullif(btrim(coalesce(identity_data->>'full_name',identity_data->>'name','')),'');
  google_avatar:=nullif(btrim(coalesce(identity_data->>'avatar_url',identity_data->>'picture','')),'');
  if google_name is not null and char_length(google_name)>200 then google_name:=null; end if;
  if google_avatar is not null and (char_length(google_avatar)>2048 or google_avatar !~ '^https://') then google_avatar:=null; end if;
  insert into public.students(user_id,username,program,year_level,full_name,avatar_url) values((select auth.uid()),p_username,btrim(p_program),p_year_level,google_name,google_avatar) on conflict(user_id) do nothing returning * into student;
  if student.user_id is null then select * into student from public.students where user_id=(select auth.uid()); end if;
  return student;
end $$;
revoke all on function public.cali_complete_onboarding(text,text,smallint) from public,anon;
grant execute on function public.cali_complete_onboarding(text,text,smallint) to authenticated;

create or replace function public.cali_refresh_google_profile()
returns public.students language plpgsql security definer set search_path='' as $$
declare identity_data jsonb; google_name text; google_avatar text; student public.students;
begin
  if not public.cali_is_eligible_user() then raise exception 'An eligible verified Google account is required' using errcode='42501'; end if;
  select i.identity_data into identity_data from auth.identities i join auth.users u on u.id=i.user_id where i.user_id=(select auth.uid()) and i.provider='google' and lower(i.identity_data->>'email')=lower(u.email) and i.identity_data->>'email_verified'='true' limit 1;
  google_name:=nullif(btrim(coalesce(identity_data->>'full_name',identity_data->>'name','')),''); google_avatar:=nullif(btrim(coalesce(identity_data->>'avatar_url',identity_data->>'picture','')),'');
  if google_name is not null and char_length(google_name)>200 then google_name:=null; end if;
  if google_avatar is not null and (char_length(google_avatar)>2048 or google_avatar !~ '^https://') then google_avatar:=null; end if;
  update public.students set full_name=google_name,avatar_url=google_avatar where user_id=(select auth.uid()) and (full_name,avatar_url) is distinct from (google_name,google_avatar) returning * into student;
  if student.user_id is null then select * into student from public.students where user_id=(select auth.uid()); end if;
  return student;
end $$;
revoke all on function public.cali_refresh_google_profile() from public,anon;
grant execute on function public.cali_refresh_google_profile() to authenticated;

create or replace function public.cali_admin_overview()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare account_id uuid := (select auth.uid()); result jsonb;
begin
  if not public.cali_is_admin(account_id) then raise exception 'Administrator access is required' using errcode = '42501'; end if;
  select jsonb_build_object(
    'totalUsers', count(*), 'activeUsers', count(*) filter (where s.suspended_at is null),
    'suspendedUsers', count(*) filter (where s.suspended_at is not null),
    'institutionalUsers', count(*) filter (where lower(u.email) ~ '@rtu\.edu\.ph$'),
    'personalUsers', count(*) filter (where lower(u.email) !~ '@rtu\.edu\.ph$'),
    'sharedReviewers', (select count(*) from public.reviewers r join public.students owner on owner.user_id = r.user_id where r.visibility in ('public','preview') and r.moderated_at is null and owner.suspended_at is null),
    'openReports', (select count(*) from public.community_reports where status = 'open'),
    'allowPersonalGoogleLogin', (select allow_personal_google_login from public.cali_system_settings where singleton)
  ) into result from public.students s join auth.users u on u.id = s.user_id;
  return result;
end $$;

create or replace function public.cali_admin_search_users(p_query text default '', p_status text default 'all', p_account_type text default 'all', p_page integer default 1, p_page_size integer default 25)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare account_id uuid := (select auth.uid()); result jsonb; safe_page integer := greatest(coalesce(p_page,1),1); safe_size integer := least(greatest(coalesce(p_page_size,25),1),100);
begin
  if not public.cali_is_admin(account_id) then raise exception 'Administrator access is required' using errcode = '42501'; end if;
  with filtered as (
    select s.user_id, s.username, s.full_name, u.email, s.program, s.year_level, s.is_admin, s.suspended_at, s.suspension_reason, s.created_at,
      case when lower(u.email) ~ '@rtu\.edu\.ph$' then 'institutional' else 'personal' end account_type
    from public.students s join auth.users u on u.id = s.user_id
    where (btrim(coalesce(p_query,'')) = '' or s.username ilike '%'||btrim(p_query)||'%' or coalesce(s.full_name,'') ilike '%'||btrim(p_query)||'%' or u.email ilike '%'||btrim(p_query)||'%')
      and (p_status = 'all' or (p_status = 'active' and s.suspended_at is null) or (p_status = 'suspended' and s.suspended_at is not null) or (p_status = 'admin' and s.is_admin))
      and (p_account_type = 'all' or (p_account_type = 'institutional' and lower(u.email) ~ '@rtu\.edu\.ph$') or (p_account_type = 'personal' and lower(u.email) !~ '@rtu\.edu\.ph$'))
  ), page_rows as (select * from filtered order by created_at desc, user_id offset (safe_page-1)*safe_size limit safe_size)
  select jsonb_build_object('items', coalesce((select jsonb_agg(jsonb_build_object('userId',user_id,'username',username,'fullName',full_name,'email',email,'program',program,'yearLevel',year_level,'isAdmin',is_admin,'suspendedAt',suspended_at,'suspensionReason',suspension_reason,'createdAt',created_at,'accountType',account_type) order by created_at desc) from page_rows),'[]'::jsonb), 'total', (select count(*) from filtered), 'page', safe_page, 'pageSize', safe_size) into result;
  return result;
end $$;

create or replace function public.cali_admin_set_user_suspension(p_user_id uuid, p_suspended boolean, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare actor uuid := (select auth.uid()); target public.students;
begin
  if not public.cali_is_admin(actor) then raise exception 'Administrator access is required' using errcode = '42501'; end if;
  select * into target from public.students where user_id = p_user_id for update;
  if target.user_id is null then raise exception 'User not found' using errcode = 'P0002'; end if;
  if target.user_id = actor then raise exception 'Administrators cannot suspend themselves' using errcode = '42501'; end if;
  if target.is_admin then raise exception 'Administrators cannot suspend another administrator' using errcode = '42501'; end if;
  if p_suspended and char_length(btrim(coalesce(p_reason,''))) < 3 then raise exception 'A suspension reason is required' using errcode = '22023'; end if;
  update public.students set suspended_at = case when p_suspended then now() else null end, suspended_by = case when p_suspended then actor else null end, suspension_reason = case when p_suspended then left(btrim(p_reason),500) else null end where user_id = p_user_id;
  update public.push_subscriptions set is_active = false where user_id = p_user_id and p_suspended;
  insert into public.admin_audit_log(actor_id,action,target_type,target_id,details) values(actor,case when p_suspended then 'user.suspended' else 'user.restored' end,'user',p_user_id::text,jsonb_build_object('reason',case when p_suspended then left(btrim(p_reason),500) else null end));
end $$;

create or replace function public.cali_admin_list_reports(p_status text default 'open')
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare actor uuid := (select auth.uid()); result jsonb;
begin
  if not public.cali_is_admin(actor) then raise exception 'Administrator access is required' using errcode = '42501'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'targetType',r.target_type,'targetId',coalesce(r.reviewer_id,r.profile_user_id),'targetLabel',case when r.target_type='reviewer' then rv.title else profile.username end,'reporter',reporter.username,'reason',r.reason,'details',r.details,'status',r.status,'createdAt',r.created_at) order by r.created_at desc),'[]'::jsonb) into result
  from public.community_reports r join public.students reporter on reporter.user_id=r.reporter_id left join public.reviewers rv on rv.id=r.reviewer_id left join public.students profile on profile.user_id=r.profile_user_id
  where p_status='all' or r.status=p_status;
  return result;
end $$;

create or replace function public.cali_admin_resolve_report(p_report_id uuid, p_action text, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare actor uuid := (select auth.uid()); report public.community_reports;
begin
  if not public.cali_is_admin(actor) then raise exception 'Administrator access is required' using errcode = '42501'; end if;
  if p_action not in ('dismiss','hide') then raise exception 'Invalid report action' using errcode='22023'; end if;
  if char_length(btrim(coalesce(p_reason,''))) < 3 then raise exception 'A resolution reason is required' using errcode='22023'; end if;
  select * into report from public.community_reports where id=p_report_id and status='open' for update;
  if report.id is null then raise exception 'Open report not found' using errcode='P0002'; end if;
  if p_action='hide' and report.target_type='reviewer' then update public.reviewers set moderated_at=now(), moderation_reason=left(btrim(p_reason),500) where id=report.reviewer_id; end if;
  if p_action='hide' and report.target_type='profile' then update public.students set community_hidden_at=now() where user_id=report.profile_user_id; end if;
  update public.community_reports set status=case when p_action='hide' then 'hidden' else 'dismissed' end,resolution_note=left(btrim(p_reason),500),resolved_by=actor,resolved_at=now() where id=report.id;
  insert into public.admin_audit_log(actor_id,action,target_type,target_id,details) values(actor,'report.'||p_action,report.target_type,coalesce(report.reviewer_id,report.profile_user_id)::text,jsonb_build_object('reportId',report.id,'reason',left(btrim(p_reason),500)));
end $$;

create or replace function public.cali_admin_search_community(p_query text default '', p_target_type text default 'all')
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare actor uuid := (select auth.uid()); result jsonb;
begin
  if not public.cali_is_admin(actor) then raise exception 'Administrator access is required' using errcode = '42501'; end if;
  select jsonb_build_object(
    'reviewers', case when p_target_type='profile' then '[]'::jsonb else coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'title',r.title,'username',s.username,'visibility',r.visibility,'hidden',r.moderated_at is not null,'reason',r.moderation_reason)) from public.reviewers r join public.students s on s.user_id=r.user_id where r.visibility in ('public','preview') and (btrim(coalesce(p_query,''))='' or r.title ilike '%'||btrim(p_query)||'%' or s.username ilike '%'||btrim(p_query)||'%') limit 50),'[]'::jsonb) end,
    'profiles', case when p_target_type='reviewer' then '[]'::jsonb else coalesce((select jsonb_agg(jsonb_build_object('userId',s.user_id,'username',s.username,'fullName',s.full_name,'hidden',s.community_hidden_at is not null,'suspended',s.suspended_at is not null)) from public.students s where (btrim(coalesce(p_query,''))='' or s.username ilike '%'||btrim(p_query)||'%' or coalesce(s.full_name,'') ilike '%'||btrim(p_query)||'%') limit 50),'[]'::jsonb) end
  ) into result;
  return result;
end $$;

create or replace function public.cali_admin_set_community_visibility(p_target_type text,p_target_id uuid,p_hidden boolean,p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare actor uuid := (select auth.uid());
begin
  if not public.cali_is_admin(actor) then raise exception 'Administrator access is required' using errcode='42501'; end if;
  if char_length(btrim(coalesce(p_reason,''))) < 3 then raise exception 'A moderation reason is required' using errcode='22023'; end if;
  if p_target_type='reviewer' then update public.reviewers set moderated_at=case when p_hidden then now() else null end,moderation_reason=case when p_hidden then left(btrim(p_reason),500) else null end where id=p_target_id; if not found then raise exception 'Reviewer not found' using errcode='P0002'; end if;
  elsif p_target_type='profile' then update public.students set community_hidden_at=case when p_hidden then now() else null end where user_id=p_target_id; if not found then raise exception 'Profile not found' using errcode='P0002'; end if;
  else raise exception 'Invalid moderation target' using errcode='22023'; end if;
  insert into public.admin_audit_log(actor_id,action,target_type,target_id,details) values(actor,'community.'||case when p_hidden then 'hidden' else 'restored' end,p_target_type,p_target_id::text,jsonb_build_object('reason',left(btrim(p_reason),500)));
end $$;

create or replace function public.cali_admin_get_system_settings()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare actor uuid := (select auth.uid()); result jsonb;
begin
  if not public.cali_is_admin(actor) then raise exception 'Administrator access is required' using errcode='42501'; end if;
  select jsonb_build_object('allowPersonalGoogleLogin',c.allow_personal_google_login,'updatedAt',c.updated_at,'updatedBy',s.username) into result from public.cali_system_settings c left join public.students s on s.user_id=c.updated_by where c.singleton;
  return result;
end $$;

create or replace function public.cali_admin_set_personal_login(p_allowed boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid := (select auth.uid()); result jsonb;
begin
  if not public.cali_is_admin(actor) then raise exception 'Administrator access is required' using errcode='42501'; end if;
  update public.cali_system_settings set allow_personal_google_login=p_allowed,updated_by=actor,updated_at=now() where singleton;
  insert into public.admin_audit_log(actor_id,action,target_type,target_id,details) values(actor,'system.personal_login_changed','system','login-policy',jsonb_build_object('allowed',p_allowed));
  select public.cali_admin_get_system_settings() into result; return result;
end $$;

create or replace function public.cali_admin_audit_history(p_limit integer default 50)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare actor uuid := (select auth.uid()); result jsonb;
begin
  if not public.cali_is_admin(actor) then raise exception 'Administrator access is required' using errcode='42501'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'actor',s.username,'action',a.action,'targetType',a.target_type,'targetId',a.target_id,'details',a.details,'createdAt',a.created_at) order by a.created_at desc),'[]'::jsonb) into result from (select * from public.admin_audit_log order by created_at desc limit least(greatest(coalesce(p_limit,50),1),200)) a join public.students s on s.user_id=a.actor_id;
  return result;
end $$;

-- Compatibility for the former Community moderation UI.
create or replace function public.cali_community_admin_status() returns boolean language sql stable security definer set search_path='' as $$ select public.cali_is_admin((select auth.uid())) $$;
create or replace function public.cali_list_community_reports() returns jsonb language sql stable security definer set search_path='' as $$ select public.cali_admin_list_reports('open') $$;
create or replace function public.cali_moderate_community_report(p_report_id uuid,p_action text,p_note text default null) returns void language plpgsql security definer set search_path='' as $$ begin perform public.cali_admin_resolve_report(p_report_id,p_action,coalesce(nullif(btrim(p_note),''),'Resolved through Community moderation')); end $$;

-- Suspended creators disappear without changing independent moderation flags.
create or replace function public.cali_search_community_reviewers(
  p_query text default '', p_category text default null, p_program text default null,
  p_year_level integer default null, p_visibility text default null,
  p_owner_username text default null, p_sort text default 'relevance', p_limit integer default 36
)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare account_id uuid := (select auth.uid()); result jsonb;
begin
  if account_id is null or not public.cali_is_eligible_user() then raise exception 'Authentication is required' using errcode='42501'; end if;
  with candidates as (
    select r.*,
      coalesce((select sum(v.value) from public.reviewer_votes v where v.reviewer_id=r.id),0)::integer net_votes,
      coalesce((select count(*) from public.reviewer_usage_daily u where u.reviewer_id=r.id and u.used_on >= (now() at time zone 'UTC')::date-6),0)::integer usage_7d,
      lower(concat_ws(' ',r.title,r.description,r.category,s.username,subject.subject_code,subject.title,
        case when r.visibility='public' then r.plain_text else public.cali_reviewer_json_text(public.cali_preview_reviewer_content(r.content)) end)) search_text
    from public.reviewers r join public.students s on s.user_id=r.user_id
    left join public.schedule_subjects subject on subject.id=r.subject_id and subject.user_id=r.user_id
    where r.visibility in ('public','preview') and r.moderated_at is null and s.community_hidden_at is null and s.suspended_at is null
      and (coalesce(p_category,'')='' or lower(r.category)=lower(p_category))
      and (coalesce(p_program,'')='' or lower(s.program)=lower(p_program))
      and (p_year_level is null or s.year_level=p_year_level)
      and (coalesce(p_visibility,'')='' or r.visibility=p_visibility)
      and (coalesce(p_owner_username,'')='' or s.username=lower(p_owner_username))
  ), filtered as (
    select * from candidates where btrim(coalesce(p_query,''))='' or search_text like '%'||lower(btrim(p_query))||'%'
  ), ordered as (
    select *,row_number() over(order by
      case when p_sort='top' then net_votes end desc nulls last,
      case when p_sort in ('trending','most_used') then usage_7d end desc nulls last,
      case when p_sort='relevance' and btrim(coalesce(p_query,''))<>'' then case when lower(title) like lower(btrim(p_query))||'%' then 2 else 1 end end desc nulls last,
      published_at desc,id) result_order
    from filtered order by
      case when p_sort='top' then net_votes end desc nulls last,
      case when p_sort in ('trending','most_used') then usage_7d end desc nulls last,
      published_at desc,id limit least(greatest(coalesce(p_limit,36),1),48)
  )
  select coalesce(jsonb_agg(public.cali_community_card_json(r,account_id) order by o.result_order),'[]'::jsonb) into result
  from ordered o join public.reviewers r on r.id=o.id;
  return result;
end $$;

create or replace function public.cali_get_community_profile(p_username text)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare account_id uuid := (select auth.uid()); profile public.students;
begin
  if account_id is null or not public.cali_is_eligible_user() then raise exception 'Authentication is required' using errcode='42501'; end if;
  select * into profile from public.students where username=lower(btrim(p_username)) and community_hidden_at is null and suspended_at is null;
  if profile.user_id is null then raise exception 'Profile not found' using errcode='P0002'; end if;
  return jsonb_build_object('userId',profile.user_id,'username',profile.username,'avatarUrl',profile.avatar_url,'bio',coalesce(profile.bio,''),'program',profile.program,'yearLevel',profile.year_level,'joinedAt',profile.created_at,'isOwnProfile',profile.user_id=account_id);
end $$;

create or replace function public.cali_get_community_reviewer(p_reviewer_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare account_id uuid := (select auth.uid()); reviewer public.reviewers; full_access boolean; item_count integer; visible_count integer; card jsonb;
begin
  if account_id is null or not public.cali_is_eligible_user() then raise exception 'Authentication is required' using errcode='42501'; end if;
  select r.* into reviewer from public.reviewers r join public.students owner on owner.user_id=r.user_id where r.id=p_reviewer_id and (owner.suspended_at is null or r.user_id=account_id);
  if reviewer.id is null then raise exception 'Reviewer not found' using errcode='P0002'; end if;
  full_access := reviewer.user_id=account_id or reviewer.visibility='public' or exists(select 1 from public.reviewer_access_grants where reviewer_id=reviewer.id and grantee_id=account_id and access_type='read' and status='active');
  if reviewer.moderated_at is not null and reviewer.user_id<>account_id and not public.cali_is_admin(account_id) then raise exception 'Reviewer is unavailable' using errcode='P0002'; end if;
  if reviewer.visibility='private' and reviewer.user_id<>account_id then raise exception 'Reviewer is unavailable' using errcode='P0002'; end if;
  item_count:=jsonb_array_length(coalesce(reviewer.content->'content','[]'::jsonb)); visible_count:=case when full_access then item_count when item_count=0 then 0 else greatest(1,ceil(item_count*0.2)::integer) end;
  card:=public.cali_community_card_json(reviewer,account_id);
  return card||jsonb_build_object('content',case when full_access then reviewer.content else public.cali_preview_reviewer_content(reviewer.content) end,'isFullContent',full_access,'visibleItemCount',visible_count,'totalItemCount',item_count,'isOwner',reviewer.user_id=account_id,'canCopy',reviewer.visibility='public' or exists(select 1 from public.reviewer_access_grants where reviewer_id=reviewer.id and grantee_id=account_id and access_type='copy' and status='active'),'requestState',coalesce((select jsonb_build_object('id',id,'type',access_type,'status',status) from public.reviewer_access_requests where reviewer_id=reviewer.id and requester_id=account_id order by created_at desc limit 1),'null'::jsonb),'contributors',coalesce((select jsonb_agg(jsonb_build_object('userId',c.contributor_user_id,'username',coalesce(s.username,c.contributor_username_snapshot),'avatarUrl',s.avatar_url) order by c.position) from public.reviewer_contributors c left join public.students s on s.user_id=c.contributor_user_id where c.reviewer_id=reviewer.id),'[]'::jsonb));
end $$;

create or replace function public.cali_claim_community_notifications(p_limit integer default 50)
returns setof public.community_notifications language plpgsql security definer set search_path='' as $$
begin
  return query update public.community_notifications n set push_status='processing',push_claimed_at=now(),push_attempts=push_attempts+1
  where n.id in (select q.id from public.community_notifications q join public.students s on s.user_id=q.user_id where q.push_status='pending' and q.push_next_attempt_at<=now() and s.suspended_at is null order by q.created_at for update of q skip locked limit least(greatest(p_limit,1),100)) returning n.*;
end $$;

do $$ declare signature regprocedure; begin
  foreach signature in array array[
    'public.cali_admin_overview()'::regprocedure,'public.cali_admin_search_users(text,text,text,integer,integer)'::regprocedure,
    'public.cali_admin_set_user_suspension(uuid,boolean,text)'::regprocedure,'public.cali_admin_list_reports(text)'::regprocedure,
    'public.cali_admin_resolve_report(uuid,text,text)'::regprocedure,'public.cali_admin_search_community(text,text)'::regprocedure,
    'public.cali_admin_set_community_visibility(text,uuid,boolean,text)'::regprocedure,'public.cali_admin_get_system_settings()'::regprocedure,
    'public.cali_admin_set_personal_login(boolean)'::regprocedure,'public.cali_admin_audit_history(integer)'::regprocedure
  ] loop execute format('revoke all on function %s from public, anon',signature); execute format('grant execute on function %s to authenticated',signature); end loop;
end $$;
revoke all on function public.cali_claim_community_notifications(integer) from public,anon,authenticated;
grant execute on function public.cali_claim_community_notifications(integer) to service_role;
grant execute on function public.cali_search_community_reviewers(text,text,text,integer,text,text,text,integer), public.cali_get_community_profile(text), public.cali_get_community_reviewer(uuid) to authenticated;

-- Bootstrap after deploy (IDs intentionally not committed):
-- update public.students set is_admin = true where user_id in ('<auth-user-id>'::uuid);
