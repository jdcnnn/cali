-- Study Reviewers: private TipTap documents and privacy-conscious AI drafts.
create table public.reviewers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.students (user_id) on delete cascade,
  subject_id uuid references public.schedule_subjects (id) on delete set null,
  title text not null,
  content jsonb not null,
  plain_text text not null default '',
  origin text not null default 'manual',
  ai_model text,
  revision integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint reviewers_title_valid check (char_length(btrim(title)) between 1 and 160),
  constraint reviewers_content_valid check (jsonb_typeof(content) = 'object' and octet_length(content::text) <= 1000000),
  constraint reviewers_plain_text_valid check (char_length(plain_text) <= 200000),
  constraint reviewers_origin_valid check (origin in ('manual', 'ai')),
  constraint reviewers_revision_valid check (revision >= 1)
);

create index reviewers_user_updated_idx on public.reviewers (user_id, updated_at desc);
create index reviewers_subject_idx on public.reviewers (subject_id) where subject_id is not null;
create index reviewers_search_idx on public.reviewers using gin (
  to_tsvector('simple', coalesce(title, '') || ' ' || coalesce(plain_text, ''))
);

create trigger reviewers_set_updated_at
before update on public.reviewers
for each row execute function public.set_cali_updated_at();

create table public.reviewer_ai_requests (
  id uuid primary key,
  user_id uuid not null references public.students (user_id) on delete cascade,
  source_type text not null,
  detail text not null,
  status text not null default 'processing',
  model text,
  failure_reason text,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint reviewer_ai_requests_source_valid check (source_type in ('pdf', 'docx', 'text')),
  constraint reviewer_ai_requests_detail_valid check (detail in ('concise', 'standard', 'detailed')),
  constraint reviewer_ai_requests_status_valid check (status in ('processing', 'succeeded', 'failed', 'saved', 'discarded')),
  constraint reviewer_ai_requests_failure_valid check (failure_reason is null or char_length(failure_reason) <= 120)
);

create unique index reviewer_ai_one_active_user_idx on public.reviewer_ai_requests (user_id)
where status = 'processing';
create index reviewer_ai_requests_user_created_idx on public.reviewer_ai_requests (user_id, created_at desc);
create index reviewer_ai_requests_global_created_idx on public.reviewer_ai_requests (created_at desc);

create table public.reviewer_ai_drafts (
  request_id uuid primary key references public.reviewer_ai_requests (id) on delete cascade,
  user_id uuid not null references public.students (user_id) on delete cascade,
  title text not null,
  content jsonb not null,
  plain_text text not null,
  expires_at timestamptz not null default (now() + interval '24 hours'),
  created_at timestamptz not null default now(),
  constraint reviewer_ai_drafts_title_valid check (char_length(btrim(title)) between 1 and 160),
  constraint reviewer_ai_drafts_content_valid check (jsonb_typeof(content) = 'object' and octet_length(content::text) <= 1000000),
  constraint reviewer_ai_drafts_plain_valid check (char_length(plain_text) <= 200000)
);

create index reviewer_ai_drafts_user_expiry_idx on public.reviewer_ai_drafts (user_id, expires_at desc);

alter table public.reviewers enable row level security;
alter table public.reviewer_ai_requests enable row level security;
alter table public.reviewer_ai_drafts enable row level security;

revoke all privileges on public.reviewers, public.reviewer_ai_requests, public.reviewer_ai_drafts from public, anon, authenticated;
grant select, delete on public.reviewers to authenticated;
grant select on public.reviewer_ai_requests, public.reviewer_ai_drafts to authenticated;

create policy reviewers_select_own on public.reviewers for select to authenticated
using (user_id = (select auth.uid()));
create policy reviewers_delete_own on public.reviewers for delete to authenticated
using (user_id = (select auth.uid()));
create policy reviewers_eligible on public.reviewers as restrictive for all to authenticated
using ((select public.cali_is_eligible_user()));

create policy reviewer_ai_requests_select_own on public.reviewer_ai_requests for select to authenticated
using (user_id = (select auth.uid()));
create policy reviewer_ai_requests_eligible on public.reviewer_ai_requests as restrictive for select to authenticated
using ((select public.cali_is_eligible_user()));
create policy reviewer_ai_drafts_select_own on public.reviewer_ai_drafts for select to authenticated
using (user_id = (select auth.uid()) and expires_at > now());
create policy reviewer_ai_drafts_eligible on public.reviewer_ai_drafts as restrictive for select to authenticated
using ((select public.cali_is_eligible_user()));

create function public.cali_create_own_reviewer(
  p_title text,
  p_subject_id uuid,
  p_content jsonb,
  p_plain_text text
) returns public.reviewers
language plpgsql security definer set search_path = ''
as $$
declare
  account_id uuid := (select auth.uid());
  created public.reviewers;
begin
  if account_id is null or not public.cali_is_eligible_user() then
    raise exception 'A verified RTU Google account is required' using errcode = '42501';
  end if;
  if p_subject_id is not null and not exists (
    select 1 from public.schedule_subjects where id = p_subject_id and user_id = account_id
  ) then
    raise exception 'Subject not found' using errcode = 'P0002';
  end if;
  insert into public.reviewers (user_id, subject_id, title, content, plain_text)
  values (account_id, p_subject_id, btrim(p_title), p_content, p_plain_text)
  returning * into created;
  return created;
end;
$$;

create function public.cali_update_own_reviewer(
  p_id uuid,
  p_expected_revision integer,
  p_title text,
  p_subject_id uuid,
  p_content jsonb,
  p_plain_text text
) returns public.reviewers
language plpgsql security definer set search_path = ''
as $$
declare
  account_id uuid := (select auth.uid());
  changed public.reviewers;
begin
  if account_id is null or not public.cali_is_eligible_user() then
    raise exception 'A verified RTU Google account is required' using errcode = '42501';
  end if;
  if p_subject_id is not null and not exists (
    select 1 from public.schedule_subjects where id = p_subject_id and user_id = account_id
  ) then
    raise exception 'Subject not found' using errcode = 'P0002';
  end if;
  update public.reviewers set
    title = btrim(p_title), subject_id = p_subject_id, content = p_content,
    plain_text = p_plain_text, revision = revision + 1
  where id = p_id and user_id = account_id and revision = p_expected_revision
  returning * into changed;
  if changed.id is null then
    if exists (select 1 from public.reviewers where id = p_id and user_id = account_id) then
      raise exception 'This reviewer changed in another tab' using errcode = '40001';
    end if;
    raise exception 'Reviewer not found' using errcode = 'P0002';
  end if;
  return changed;
end;
$$;

create function public.cali_duplicate_own_reviewer(p_id uuid)
returns public.reviewers
language plpgsql security definer set search_path = ''
as $$
declare
  account_id uuid := (select auth.uid());
  copied public.reviewers;
begin
  if account_id is null or not public.cali_is_eligible_user() then
    raise exception 'A verified RTU Google account is required' using errcode = '42501';
  end if;
  insert into public.reviewers (user_id, subject_id, title, content, plain_text, origin, ai_model)
  select account_id, subject_id, left(title || ' copy', 160), content, plain_text, origin, ai_model
  from public.reviewers where id = p_id and user_id = account_id
  returning * into copied;
  if copied.id is null then raise exception 'Reviewer not found' using errcode = 'P0002'; end if;
  return copied;
end;
$$;

-- The API calls these functions with the secret server role. Quotas are reserved
-- atomically before any free-provider request leaves Cali.
create function public.cali_reserve_reviewer_generation(
  p_request_id uuid,
  p_user_id uuid,
  p_source_type text,
  p_detail text
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  personal_used integer;
  global_used integer;
  manila_month_start timestamptz := (date_trunc('month', now() at time zone 'Asia/Manila') at time zone 'Asia/Manila');
begin
  perform pg_advisory_xact_lock(hashtext('cali-reviewer-ai-global'));
  if not exists (select 1 from public.students where user_id = p_user_id) then
    raise exception 'Student not found' using errcode = 'P0002';
  end if;
  select count(*) into personal_used from public.reviewer_ai_requests
  where user_id = p_user_id and status in ('succeeded', 'saved', 'discarded') and created_at >= manila_month_start;
  if personal_used >= 10 then raise exception 'PERSONAL_LIMIT' using errcode = 'P0001'; end if;
  if exists (select 1 from public.reviewer_ai_requests where user_id = p_user_id and status = 'processing') then
    raise exception 'ALREADY_PROCESSING' using errcode = 'P0001';
  end if;
  select count(*) into global_used from public.reviewer_ai_requests
  where created_at >= date_trunc('day', now() at time zone 'UTC') at time zone 'UTC';
  if global_used >= 50 then raise exception 'GLOBAL_LIMIT' using errcode = 'P0001'; end if;
  insert into public.reviewer_ai_requests (id, user_id, source_type, detail)
  values (p_request_id, p_user_id, p_source_type, p_detail);
  return jsonb_build_object('personalUsed', personal_used, 'personalLimit', 10, 'globalUsed', global_used + 1);
end;
$$;

create function public.cali_complete_reviewer_generation(
  p_request_id uuid,
  p_user_id uuid,
  p_model text,
  p_title text,
  p_content jsonb,
  p_plain_text text
) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not exists (select 1 from public.reviewer_ai_requests where id = p_request_id and user_id = p_user_id and status = 'processing') then
    raise exception 'Generation request not found' using errcode = 'P0002';
  end if;
  insert into public.reviewer_ai_drafts (request_id, user_id, title, content, plain_text)
  values (p_request_id, p_user_id, btrim(p_title), p_content, p_plain_text);
  update public.reviewer_ai_requests set status = 'succeeded', model = left(p_model, 160), completed_at = now()
  where id = p_request_id and user_id = p_user_id;
end;
$$;

create function public.cali_fail_reviewer_generation(p_request_id uuid, p_user_id uuid, p_reason text)
returns void language sql security definer set search_path = ''
as $$
  update public.reviewer_ai_requests set status = 'failed', failure_reason = left(p_reason, 120), completed_at = now()
  where id = p_request_id and user_id = p_user_id and status = 'processing';
$$;

create function public.cali_save_own_generated_reviewer(p_request_id uuid, p_subject_id uuid)
returns public.reviewers
language plpgsql security definer set search_path = ''
as $$
declare
  account_id uuid := (select auth.uid());
  saved public.reviewers;
begin
  if account_id is null or not public.cali_is_eligible_user() then
    raise exception 'A verified RTU Google account is required' using errcode = '42501';
  end if;
  if p_subject_id is not null and not exists (
    select 1 from public.schedule_subjects where id = p_subject_id and user_id = account_id
  ) then raise exception 'Subject not found' using errcode = 'P0002'; end if;
  insert into public.reviewers (user_id, subject_id, title, content, plain_text, origin, ai_model)
  select account_id, p_subject_id, d.title, d.content, d.plain_text, 'ai', r.model
  from public.reviewer_ai_drafts d join public.reviewer_ai_requests r on r.id = d.request_id
  where d.request_id = p_request_id and d.user_id = account_id and d.expires_at > now()
  returning * into saved;
  if saved.id is null then raise exception 'Generated draft not found or expired' using errcode = 'P0002'; end if;
  update public.reviewer_ai_requests set status = 'saved' where id = p_request_id and user_id = account_id;
  delete from public.reviewer_ai_drafts where request_id = p_request_id and user_id = account_id;
  return saved;
end;
$$;

create function public.cali_discard_own_generated_reviewer(p_request_id uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare account_id uuid := (select auth.uid());
begin
  delete from public.reviewer_ai_drafts where request_id = p_request_id and user_id = account_id;
  update public.reviewer_ai_requests set status = 'discarded' where id = p_request_id and user_id = account_id and status = 'succeeded';
end;
$$;

create function public.cali_reviewer_ai_quota()
returns jsonb language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'used', count(*) filter (where status in ('succeeded', 'saved', 'discarded')),
    'limit', 10,
    'resetsAt', ((date_trunc('month', now() at time zone 'Asia/Manila') + interval '1 month') at time zone 'Asia/Manila')
  ) from public.reviewer_ai_requests
  where user_id = (select auth.uid())
    and created_at >= (date_trunc('month', now() at time zone 'Asia/Manila') at time zone 'Asia/Manila');
$$;

revoke all on function public.cali_create_own_reviewer(text, uuid, jsonb, text) from public, anon;
revoke all on function public.cali_update_own_reviewer(uuid, integer, text, uuid, jsonb, text) from public, anon;
revoke all on function public.cali_duplicate_own_reviewer(uuid) from public, anon;
revoke all on function public.cali_save_own_generated_reviewer(uuid, uuid) from public, anon;
revoke all on function public.cali_discard_own_generated_reviewer(uuid) from public, anon;
revoke all on function public.cali_reviewer_ai_quota() from public, anon;
grant execute on function public.cali_create_own_reviewer(text, uuid, jsonb, text) to authenticated;
grant execute on function public.cali_update_own_reviewer(uuid, integer, text, uuid, jsonb, text) to authenticated;
grant execute on function public.cali_duplicate_own_reviewer(uuid) to authenticated;
grant execute on function public.cali_save_own_generated_reviewer(uuid, uuid) to authenticated;
grant execute on function public.cali_discard_own_generated_reviewer(uuid) to authenticated;
grant execute on function public.cali_reviewer_ai_quota() to authenticated;

revoke all on function public.cali_reserve_reviewer_generation(uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function public.cali_complete_reviewer_generation(uuid, uuid, text, text, jsonb, text) from public, anon, authenticated;
revoke all on function public.cali_fail_reviewer_generation(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.cali_reserve_reviewer_generation(uuid, uuid, text, text) to service_role;
grant execute on function public.cali_complete_reviewer_generation(uuid, uuid, text, text, jsonb, text) to service_role;
grant execute on function public.cali_fail_reviewer_generation(uuid, uuid, text) to service_role;

-- Include Study data in the existing permanent account-deletion transaction.
create or replace function public.cali_delete_own_account()
returns void language plpgsql security definer set search_path = ''
as $$
declare account_id uuid := (select auth.uid());
begin
  if account_id is null then raise exception 'Authentication is required' using errcode = '42501'; end if;
  delete from public.reminder_deliveries where reminder_id in (select id from public.reminder_queue where user_id = account_id) or subscription_id in (select id from public.push_subscriptions where user_id = account_id);
  delete from public.reminder_queue where user_id = account_id;
  delete from public.push_subscriptions where user_id = account_id;
  delete from public.task_steps where task_id in (select id from public.tasks where user_id = account_id);
  delete from public.tasks where user_id = account_id;
  delete from public.calendar_events where user_id = account_id;
  delete from public.reviewer_ai_drafts where user_id = account_id;
  delete from public.reviewer_ai_requests where user_id = account_id;
  delete from public.reviewers where user_id = account_id;
  delete from public.schedule_meetings where subject_id in (select id from public.schedule_subjects where user_id = account_id);
  delete from public.schedule_subjects where user_id = account_id;
  delete from public.students where user_id = account_id;
  delete from auth.users where id = account_id;
  if not found then raise exception 'Account not found' using errcode = 'P0002'; end if;
end;
$$;

revoke all on function public.cali_delete_own_account() from public, anon;
grant execute on function public.cali_delete_own_account() to authenticated;
