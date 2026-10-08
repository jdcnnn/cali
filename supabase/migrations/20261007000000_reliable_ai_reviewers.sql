-- Private, short-lived AI reviewer drafts. Source material is deliberately never persisted.
alter table public.reviewers
  add column if not exists origin text not null default 'manual',
  add column if not exists ai_model text;
alter table public.reviewers drop constraint if exists reviewers_origin_valid;
alter table public.reviewers add constraint reviewers_origin_valid check (origin in ('manual', 'ai'));

create table public.reviewer_generation_requests (
  id uuid primary key,
  user_id uuid not null references public.students(user_id) on delete cascade,
  source_type text not null check (source_type in ('pdf', 'scan')),
  detail text not null check (detail in ('concise', 'standard', 'detailed')),
  status text not null default 'processing' check (status in ('processing', 'succeeded', 'failed', 'saved', 'discarded')),
  model text,
  prompt_version text not null,
  prompt_tokens integer check (prompt_tokens is null or prompt_tokens >= 0),
  output_tokens integer check (output_tokens is null or output_tokens >= 0),
  failure_reason text check (failure_reason is null or char_length(failure_reason) <= 80),
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create unique index reviewer_generation_one_active_idx on public.reviewer_generation_requests(user_id) where status = 'processing';
create index reviewer_generation_user_month_idx on public.reviewer_generation_requests(user_id, created_at desc);

create table public.generated_reviewer_drafts (
  request_id uuid primary key references public.reviewer_generation_requests(id) on delete cascade,
  user_id uuid not null references public.students(user_id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 160),
  content jsonb not null check (jsonb_typeof(content) = 'object' and octet_length(content::text) <= 1000000),
  plain_text text not null check (char_length(plain_text) <= 200000),
  revision integer not null default 1 check (revision >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '24 hours')
);
create index generated_reviewer_drafts_expiry_idx on public.generated_reviewer_drafts(expires_at);
create index generated_reviewer_drafts_user_idx on public.generated_reviewer_drafts(user_id, updated_at desc);

alter table public.reviewer_generation_requests enable row level security;
alter table public.generated_reviewer_drafts enable row level security;
revoke all on public.reviewer_generation_requests, public.generated_reviewer_drafts from public, anon, authenticated;
grant select on public.reviewer_generation_requests, public.generated_reviewer_drafts to authenticated;

create policy reviewer_generation_requests_own on public.reviewer_generation_requests for select to authenticated
using (user_id = (select auth.uid()) and (select public.cali_is_eligible_user()));
create policy generated_reviewer_drafts_own on public.generated_reviewer_drafts for select to authenticated
using (user_id = (select auth.uid()) and expires_at > now() and (select public.cali_is_eligible_user()));

create function public.cali_cleanup_generated_reviewer_drafts()
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.reviewer_generation_requests r set status = 'failed', failure_reason = 'request_timeout', completed_at = now()
  where r.status = 'processing' and r.created_at < now() - interval '15 minutes';
  delete from public.generated_reviewer_drafts where expires_at <= now();
end;
$$;

create function public.cali_reserve_reviewer_generation(
  p_request_id uuid, p_user_id uuid, p_source_type text, p_detail text, p_prompt_version text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  prior public.reviewer_generation_requests;
  successful_count integer;
  draft_json jsonb;
  month_start timestamptz := date_trunc('month', now() at time zone 'Asia/Manila') at time zone 'Asia/Manila';
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));
  perform public.cali_cleanup_generated_reviewer_drafts();
  select * into prior from public.reviewer_generation_requests where id = p_request_id;
  if prior.id is not null then
    if prior.user_id <> p_user_id then raise exception 'REQUEST_ID_CONFLICT' using errcode = 'P0001'; end if;
    if prior.status in ('succeeded', 'saved', 'discarded') then
      select jsonb_build_object('requestId', d.request_id, 'title', d.title, 'content', d.content, 'plainText', d.plain_text, 'revision', d.revision, 'expiresAt', d.expires_at)
      into draft_json from public.generated_reviewer_drafts d where d.request_id = prior.id and d.expires_at > now();
    end if;
    return jsonb_build_object('action', 'existing', 'status', prior.status, 'draft', draft_json);
  end if;
  if exists (select 1 from public.reviewer_generation_requests where user_id = p_user_id and status = 'processing') then
    raise exception 'ALREADY_PROCESSING' using errcode = 'P0001';
  end if;
  select count(*) into successful_count from public.reviewer_generation_requests
  where user_id = p_user_id and created_at >= month_start and status in ('succeeded', 'saved', 'discarded');
  if successful_count >= 10 then raise exception 'PERSONAL_LIMIT' using errcode = 'P0001'; end if;
  insert into public.reviewer_generation_requests(id, user_id, source_type, detail, prompt_version)
  values (p_request_id, p_user_id, p_source_type, p_detail, left(p_prompt_version, 80));
  return jsonb_build_object('action', 'reserved', 'used', successful_count, 'limit', 10);
end;
$$;

create function public.cali_complete_reviewer_generation(
  p_request_id uuid, p_user_id uuid, p_model text, p_prompt_tokens integer, p_output_tokens integer,
  p_title text, p_content jsonb, p_plain_text text
) returns void language plpgsql security definer set search_path = '' as $$
begin
  perform public.cali_cleanup_generated_reviewer_drafts();
  if not exists (select 1 from public.reviewer_generation_requests where id = p_request_id and user_id = p_user_id and status = 'processing') then
    raise exception 'REQUEST_NOT_PROCESSING' using errcode = 'P0002';
  end if;
  insert into public.generated_reviewer_drafts(request_id, user_id, title, content, plain_text)
  values (p_request_id, p_user_id, btrim(p_title), p_content, p_plain_text);
  update public.reviewer_generation_requests set status = 'succeeded', model = left(p_model, 160),
    prompt_tokens = p_prompt_tokens, output_tokens = p_output_tokens, completed_at = now()
  where id = p_request_id and user_id = p_user_id;
end;
$$;

create function public.cali_fail_reviewer_generation(p_request_id uuid, p_user_id uuid, p_reason text)
returns void language sql security definer set search_path = '' as $$
  update public.reviewer_generation_requests set status = 'failed', failure_reason = left(p_reason, 80), completed_at = now()
  where id = p_request_id and user_id = p_user_id and status = 'processing';
$$;

create function public.cali_update_own_generated_reviewer(
  p_request_id uuid, p_expected_revision integer, p_title text, p_content jsonb, p_plain_text text
) returns public.generated_reviewer_drafts language plpgsql security definer set search_path = '' as $$
declare account_id uuid := (select auth.uid()); changed public.generated_reviewer_drafts;
begin
  perform public.cali_cleanup_generated_reviewer_drafts();
  if account_id is null or not public.cali_is_eligible_user() then raise exception 'A verified RTU Google account is required' using errcode = '42501'; end if;
  update public.generated_reviewer_drafts set title = btrim(p_title), content = p_content, plain_text = p_plain_text,
    revision = revision + 1, updated_at = now()
  where request_id = p_request_id and user_id = account_id and revision = p_expected_revision and expires_at > now()
  returning * into changed;
  if changed.request_id is null then raise exception 'DRAFT_CONFLICT_OR_EXPIRED' using errcode = 'P0001'; end if;
  return changed;
end;
$$;

create function public.cali_save_own_generated_reviewer(p_request_id uuid, p_subject_id uuid)
returns public.reviewers language plpgsql security definer set search_path = '' as $$
declare account_id uuid := (select auth.uid()); saved public.reviewers;
begin
  perform public.cali_cleanup_generated_reviewer_drafts();
  if account_id is null or not public.cali_is_eligible_user() then raise exception 'A verified RTU Google account is required' using errcode = '42501'; end if;
  if p_subject_id is not null and not exists (select 1 from public.schedule_subjects where id = p_subject_id and user_id = account_id) then raise exception 'Subject not found' using errcode = 'P0002'; end if;
  insert into public.reviewers(user_id, subject_id, title, content, plain_text, origin, ai_model)
  select account_id, p_subject_id, d.title, d.content, d.plain_text, 'ai', r.model
  from public.generated_reviewer_drafts d join public.reviewer_generation_requests r on r.id = d.request_id
  where d.request_id = p_request_id and d.user_id = account_id and d.expires_at > now()
  returning * into saved;
  if saved.id is null then raise exception 'Generated draft not found or expired' using errcode = 'P0002'; end if;
  update public.reviewer_generation_requests set status = 'saved' where id = p_request_id and user_id = account_id;
  delete from public.generated_reviewer_drafts where request_id = p_request_id and user_id = account_id;
  return saved;
end;
$$;

create function public.cali_discard_own_generated_reviewer(p_request_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare account_id uuid := (select auth.uid());
begin
  perform public.cali_cleanup_generated_reviewer_drafts();
  if account_id is null or not public.cali_is_eligible_user() then raise exception 'A verified RTU Google account is required' using errcode = '42501'; end if;
  delete from public.generated_reviewer_drafts where request_id = p_request_id and user_id = account_id;
  update public.reviewer_generation_requests set status = 'discarded' where id = p_request_id and user_id = account_id and status = 'succeeded';
end;
$$;

create function public.cali_reviewer_generation_quota()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare account_id uuid := (select auth.uid()); used_count integer; reset_at timestamptz;
begin
  perform public.cali_cleanup_generated_reviewer_drafts();
  if account_id is null or not public.cali_is_eligible_user() then raise exception 'A verified RTU Google account is required' using errcode = '42501'; end if;
  reset_at := (date_trunc('month', now() at time zone 'Asia/Manila') + interval '1 month') at time zone 'Asia/Manila';
  select count(*) into used_count from public.reviewer_generation_requests where user_id = account_id
    and created_at >= (date_trunc('month', now() at time zone 'Asia/Manila') at time zone 'Asia/Manila')
    and status in ('succeeded', 'saved', 'discarded');
  return jsonb_build_object('used', used_count, 'limit', 10, 'resetsAt', reset_at);
end;
$$;

revoke all on function public.cali_cleanup_generated_reviewer_drafts() from public, anon, authenticated;
revoke all on function public.cali_reserve_reviewer_generation(uuid, uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.cali_complete_reviewer_generation(uuid, uuid, text, integer, integer, text, jsonb, text) from public, anon, authenticated;
revoke all on function public.cali_fail_reviewer_generation(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.cali_cleanup_generated_reviewer_drafts() to service_role;
grant execute on function public.cali_reserve_reviewer_generation(uuid, uuid, text, text, text) to service_role;
grant execute on function public.cali_complete_reviewer_generation(uuid, uuid, text, integer, integer, text, jsonb, text) to service_role;
grant execute on function public.cali_fail_reviewer_generation(uuid, uuid, text) to service_role;

revoke all on function public.cali_update_own_generated_reviewer(uuid, integer, text, jsonb, text) from public, anon;
revoke all on function public.cali_save_own_generated_reviewer(uuid, uuid) from public, anon;
revoke all on function public.cali_discard_own_generated_reviewer(uuid) from public, anon;
revoke all on function public.cali_reviewer_generation_quota() from public, anon;
grant execute on function public.cali_update_own_generated_reviewer(uuid, integer, text, jsonb, text) to authenticated;
grant execute on function public.cali_save_own_generated_reviewer(uuid, uuid) to authenticated;
grant execute on function public.cali_discard_own_generated_reviewer(uuid) to authenticated;
grant execute on function public.cali_reviewer_generation_quota() to authenticated;

-- Keep account deletion transactional with the schema as it exists after Study Sets.
create or replace function public.cali_delete_own_account()
returns void language plpgsql security definer set search_path = '' as $$
declare account_id uuid := (select auth.uid());
begin
  if account_id is null then raise exception 'Authentication is required' using errcode = '42501'; end if;
  delete from public.reminder_deliveries where reminder_id in (select id from public.reminder_queue where user_id = account_id) or subscription_id in (select id from public.push_subscriptions where user_id = account_id);
  delete from public.reminder_queue where user_id = account_id;
  delete from public.push_subscriptions where user_id = account_id;
  delete from public.task_steps where task_id in (select id from public.tasks where user_id = account_id);
  delete from public.tasks where user_id = account_id;
  delete from public.calendar_events where user_id = account_id;
  delete from public.quiz_attempts where user_id = account_id;
  delete from public.quizzes where user_id = account_id;
  delete from public.flashcard_sets where user_id = account_id;
  delete from public.generated_reviewer_drafts where user_id = account_id;
  delete from public.reviewer_generation_requests where user_id = account_id;
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
