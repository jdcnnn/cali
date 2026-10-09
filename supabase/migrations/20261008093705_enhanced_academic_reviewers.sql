-- No source text or user instructions are stored in the generation audit.
alter table public.reviewer_generation_requests
  add column input_hash text check (input_hash is null or input_hash ~ '^[0-9a-f]{64}$'),
  add column saved_reviewer_id uuid references public.reviewers(id) on delete set null;

create or replace function public.cali_cleanup_generated_reviewer_drafts()
returns void language plpgsql security definer set search_path = '' as $$
begin
  -- Longer than the 120-second function limit; crashed requests no longer block for 15 minutes.
  update public.reviewer_generation_requests set status = 'failed', failure_reason = 'request_timeout', completed_at = now()
  where status = 'processing' and created_at < now() - interval '3 minutes';
  delete from public.generated_reviewer_drafts where expires_at <= now();
end;
$$;

create function public.cali_reserve_reviewer_generation(
  p_request_id uuid, p_user_id uuid, p_source_type text, p_detail text, p_prompt_version text, p_input_hash text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare prior public.reviewer_generation_requests; successful_count integer; draft_json jsonb;
  month_start timestamptz := date_trunc('month', now() at time zone 'Asia/Manila') at time zone 'Asia/Manila';
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));
  perform public.cali_cleanup_generated_reviewer_drafts();
  select * into prior from public.reviewer_generation_requests where id = p_request_id;
  if prior.id is not null then
    if prior.user_id <> p_user_id or (prior.input_hash is not null and prior.input_hash is distinct from p_input_hash) then
      raise exception 'REQUEST_ID_CONFLICT' using errcode = 'P0001';
    end if;
    select jsonb_build_object('requestId', d.request_id, 'title', d.title, 'content', d.content, 'plainText', d.plain_text, 'revision', d.revision, 'expiresAt', d.expires_at)
      into draft_json from public.generated_reviewer_drafts d where d.request_id = prior.id and d.expires_at > now();
    return jsonb_build_object('action', 'existing', 'status', prior.status, 'draft', draft_json);
  end if;
  if exists (select 1 from public.reviewer_generation_requests where user_id = p_user_id and status = 'processing') then
    raise exception 'ALREADY_PROCESSING' using errcode = 'P0001';
  end if;
  select count(*) into successful_count from public.reviewer_generation_requests
    where user_id = p_user_id and created_at >= month_start and status in ('succeeded', 'saved', 'discarded');
  if successful_count >= 10 then raise exception 'PERSONAL_LIMIT' using errcode = 'P0001'; end if;
  insert into public.reviewer_generation_requests(id, user_id, source_type, detail, prompt_version, input_hash)
    values (p_request_id, p_user_id, p_source_type, p_detail, left(p_prompt_version, 80), p_input_hash);
  return jsonb_build_object('action', 'reserved', 'used', successful_count, 'limit', 10);
end;
$$;

-- Keep the existing endpoint compatible during rolling deployment.
create or replace function public.cali_reserve_reviewer_generation(
  p_request_id uuid, p_user_id uuid, p_source_type text, p_detail text, p_prompt_version text
) returns jsonb language sql security definer set search_path = '' as $$
  select public.cali_reserve_reviewer_generation(p_request_id, p_user_id, p_source_type, p_detail, p_prompt_version, null);
$$;

create function public.cali_save_own_generated_reviewer(p_request_id uuid, p_subject_id uuid, p_expected_revision integer)
returns public.reviewers language plpgsql security definer set search_path = '' as $$
declare account_id uuid := (select auth.uid()); saved public.reviewers; draft public.generated_reviewer_drafts;
  generation public.reviewer_generation_requests;
begin
  if account_id is null or not public.cali_is_eligible_user() then raise exception 'A verified RTU Google account is required' using errcode = '42501'; end if;
  select * into generation from public.reviewer_generation_requests where id = p_request_id and user_id = account_id for update;
  if generation.id is null then raise exception 'Generated draft not found' using errcode = 'P0002'; end if;
  -- A lost response can be retried without creating a second reviewer.
  if generation.status = 'saved' then
    select * into saved from public.reviewers where id = generation.saved_reviewer_id and user_id = account_id;
    if saved.id is null then raise exception 'Saved reviewer is no longer available' using errcode = 'P0002'; end if;
    return saved;
  end if;
  select * into draft from public.generated_reviewer_drafts where request_id = p_request_id and user_id = account_id for update;
  if draft.request_id is null or draft.expires_at <= now() or generation.status <> 'succeeded' then
    raise exception 'Generated draft not found or expired' using errcode = 'P0002';
  end if;
  if draft.revision is distinct from p_expected_revision then raise exception 'DRAFT_CONFLICT' using errcode = 'P0001'; end if;
  if p_subject_id is not null and not exists (select 1 from public.schedule_subjects where id = p_subject_id and user_id = account_id) then
    raise exception 'Subject not found' using errcode = 'P0002';
  end if;
  insert into public.reviewers(user_id, subject_id, title, content, plain_text, origin, ai_model)
    values (account_id, p_subject_id, draft.title, draft.content, draft.plain_text, 'ai', generation.model) returning * into saved;
  update public.reviewer_generation_requests set status = 'saved', saved_reviewer_id = saved.id where id = p_request_id;
  delete from public.generated_reviewer_drafts where request_id = p_request_id;
  return saved;
end;
$$;

create or replace function public.cali_save_own_generated_reviewer(p_request_id uuid, p_subject_id uuid)
returns public.reviewers language plpgsql security definer set search_path = '' as $$
declare expected_revision integer;
begin
  select revision into expected_revision from public.generated_reviewer_drafts where request_id = p_request_id and user_id = (select auth.uid());
  return public.cali_save_own_generated_reviewer(p_request_id, p_subject_id, expected_revision);
end;
$$;

create or replace function public.cali_discard_own_generated_reviewer(p_request_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare account_id uuid := (select auth.uid());
begin
  if account_id is null or not public.cali_is_eligible_user() then raise exception 'A verified RTU Google account is required' using errcode = '42501'; end if;
  perform 1 from public.reviewer_generation_requests where id = p_request_id and user_id = account_id for update;
  delete from public.generated_reviewer_drafts where request_id = p_request_id and user_id = account_id;
  update public.reviewer_generation_requests set status = 'discarded' where id = p_request_id and user_id = account_id and status = 'succeeded';
end;
$$;

revoke all on function public.cali_reserve_reviewer_generation(uuid, uuid, text, text, text, text) from public, anon, authenticated;
grant execute on function public.cali_reserve_reviewer_generation(uuid, uuid, text, text, text, text) to service_role;
revoke all on function public.cali_save_own_generated_reviewer(uuid, uuid, integer) from public, anon;
grant execute on function public.cali_save_own_generated_reviewer(uuid, uuid, integer) to authenticated;
