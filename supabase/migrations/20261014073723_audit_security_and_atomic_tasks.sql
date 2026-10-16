-- Additive audit reinforcements. Preserve existing APIs and student records.
set local lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.cali_save_quiz_attempt(p_id uuid, p_answers jsonb, p_first_answers jsonb, p_current_index integer, p_phase text)
 RETURNS quiz_attempts
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  account_id uuid := (select auth.uid());
  changed public.quiz_attempts;
  question_total integer;
begin
  if account_id is null or not public.cali_is_eligible_user() then raise exception 'Authentication is required' using errcode = '42501'; end if;
  if jsonb_typeof(p_answers) <> 'object' or jsonb_typeof(p_first_answers) <> 'object'
    or octet_length(p_answers::text) > 250000 or octet_length(p_first_answers::text) > 250000 then
    raise exception 'Invalid quiz answers' using errcode = '22023';
  end if;
  if p_phase not in ('first_pass', 'review') then raise exception 'Invalid quiz phase' using errcode = '22023'; end if;

  select jsonb_array_length(snapshot->'questions') into question_total
  from public.quiz_attempts where id = p_id and user_id = account_id and status = 'active';
  if question_total is null then raise exception 'Active quiz attempt not found' using errcode = 'P0002'; end if;
  if p_current_index < 0 or p_current_index >= question_total then raise exception 'Invalid question position' using errcode = '22023'; end if;

  update public.quiz_attempts set answers = p_answers, first_answers = p_first_answers,
    current_index = p_current_index, phase = p_phase
  where id = p_id and user_id = account_id and status = 'active'
  returning * into changed;
  return changed;
end;
$function$;

CREATE OR REPLACE FUNCTION public.cali_complete_quiz_attempt(p_id uuid, p_answers jsonb, p_first_answers jsonb, p_phase text)
 RETURNS quiz_attempts
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  account_id uuid := (select auth.uid());
  existing public.quiz_attempts;
  changed public.quiz_attempts;
  question jsonb;
  final_score integer := 0;
  initial_score integer := 0;
  question_total integer := 0;
begin
  if account_id is null or not public.cali_is_eligible_user() then raise exception 'Authentication is required' using errcode = '42501'; end if;
  if jsonb_typeof(p_answers) <> 'object' or jsonb_typeof(p_first_answers) <> 'object' then
    raise exception 'Invalid quiz answers' using errcode = '22023';
  end if;
  if p_phase not in ('first_pass', 'review') then raise exception 'Invalid quiz phase' using errcode = '22023'; end if;

  select * into existing from public.quiz_attempts
  where id = p_id and user_id = account_id and status = 'active' for update;
  if existing.id is null then raise exception 'Active quiz attempt not found' using errcode = 'P0002'; end if;

  for question in select * from jsonb_array_elements(existing.snapshot->'questions') loop
    question_total := question_total + 1;
    if p_answers->>(question->>'id') = question->>'correctChoiceId' then final_score := final_score + 1; end if;
    if p_first_answers->>(question->>'id') = question->>'correctChoiceId' then initial_score := initial_score + 1; end if;
  end loop;
  if question_total < 1 then raise exception 'The quiz has no questions' using errcode = '22023'; end if;

  update public.quiz_attempts set answers = p_answers, first_answers = p_first_answers,
    phase = p_phase, status = 'completed', score = final_score,
    first_try_score = initial_score, total = question_total, completed_at = current_timestamp
  where id = p_id returning * into changed;
  return changed;
end;
$function$;

CREATE OR REPLACE FUNCTION public.cali_abandon_quiz_attempt(p_id uuid)
 RETURNS quiz_attempts
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare changed public.quiz_attempts;
begin
  if auth.uid() is null or not public.cali_is_eligible_user() then raise exception 'Authentication is required' using errcode = '42501'; end if;
  update public.quiz_attempts set status = 'abandoned'
  where id = p_id and user_id = (select auth.uid()) and status = 'active'
  returning * into changed;
  if changed.id is null then raise exception 'Active quiz attempt not found' using errcode = 'P0002'; end if;
  return changed;
end;
$function$;


create or replace function public.cali_valid_reviewer_document(value jsonb)
returns boolean language sql immutable set search_path = '' as $$
  with recursive nodes(node, depth) as (
    select value, 0
    union all
    select child, depth + 1 from nodes
    cross join lateral jsonb_array_elements(case when jsonb_typeof(node->'content') = 'array' then node->'content' else '[]'::jsonb end) child
    where depth <= 40
  )
  select coalesce(
    jsonb_typeof(value) = 'object' and value->>'type' = 'doc'
    and jsonb_typeof(value->'content') = 'array'
    and octet_length(value::text) <= 1000000
    and (select count(*) <= 20000 and bool_and(
      depth <= 40 and jsonb_typeof(node) = 'object'
      and coalesce(node->>'type','') = any(array['doc','paragraph','heading','text','hardBreak','horizontalRule','bulletList','orderedList','listItem','taskList','taskItem','blockquote','codeBlock','table','tableRow','tableCell','tableHeader','columns','column'])
      and (not node ? 'content' or jsonb_typeof(node->'content') = 'array')
      and (not node ? 'attrs' or jsonb_typeof(node->'attrs') = 'object')
      and (not node ? 'text' or jsonb_typeof(node->'text') = 'string')
      and (node->>'type' <> 'text' or coalesce(jsonb_typeof(node->'text') = 'string',false))
      and (not node ? 'marks' or (
        jsonb_typeof(node->'marks') = 'array'
        and jsonb_array_length(case when jsonb_typeof(node->'marks')='array' then node->'marks' else '[]'::jsonb end) <= 20
        and not exists(
          select 1 from jsonb_array_elements(case when jsonb_typeof(node->'marks')='array' then node->'marks' else '[]'::jsonb end) mark
          where jsonb_typeof(mark) <> 'object'
             or coalesce(mark->>'type','') <> all(array['bold','italic','underline','strike','code','link','textStyle','highlight'])
             or (mark ? 'attrs' and jsonb_typeof(mark->'attrs') <> 'object')
             or (mark->>'type' = 'link' and not coalesce(
               char_length(mark->'attrs'->>'href') <= 2048
               and mark->'attrs'->>'href' !~ '[[:space:]\\]'
               and mark->'attrs'->>'href' ~* '^(https?://|mailto:|/[^/]|/$|#)', false))
        )
      ))
    ) from nodes), false)
$$;
revoke all on function public.cali_valid_reviewer_document(jsonb) from public,anon;
grant execute on function public.cali_valid_reviewer_document(jsonb) to authenticated,service_role;

create or replace function public.cali_check_reviewer_document()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' or new.content is distinct from old.content then
    if not public.cali_valid_reviewer_document(new.content) then
      raise exception 'Invalid reviewer document' using errcode = '22023';
    end if;
  end if;
  return new;
end $$;
revoke all on function public.cali_check_reviewer_document() from public,anon,authenticated;
create trigger reviewers_document_shape before insert or update of content on public.reviewers
for each row execute function public.cali_check_reviewer_document();
create trigger generated_drafts_document_shape before insert or update of content on public.generated_reviewer_drafts
for each row execute function public.cali_check_reviewer_document();

create or replace function public.cali_valid_push_endpoint(value text)
returns boolean language sql immutable set search_path = '' as $$
  select coalesce(char_length(value) between 20 and 2048
    and value !~ '[[:space:]\\#]'
    and value ~* '^https://(fcm[.]googleapis[.]com|updates[.]push[.]services[.]mozilla[.]com|web[.]push[.]apple[.]com|[a-z0-9-]+[.]notify[.]windows[.]com)(:443)?/[^[:space:]]*$', false)
$$;
revoke all on function public.cali_valid_push_endpoint(text) from public,anon;
grant execute on function public.cali_valid_push_endpoint(text) to authenticated,service_role;

create or replace function public.cali_save_own_push_subscription(p_endpoint text,p_p256dh text,p_auth text,p_user_agent text)
returns public.push_subscriptions language plpgsql security definer set search_path = '' as $$
declare account_id uuid := auth.uid(); saved public.push_subscriptions; key_bytes bytea; auth_bytes bytea;
begin
  if account_id is null or not public.cali_is_eligible_user() then raise exception 'Authentication is required' using errcode='42501'; end if;
  if not public.cali_valid_push_endpoint(p_endpoint)
    or p_p256dh is null or p_p256dh !~ '^[A-Za-z0-9_-]{87}=?$'
    or p_auth is null or p_auth !~ '^[A-Za-z0-9_-]{22}(==)?$'
    or char_length(coalesce(p_user_agent,'')) > 1000 then
    raise exception 'Invalid push subscription' using errcode='22023';
  end if;
  key_bytes := decode(rpad(translate(p_p256dh,'-_','+/'),88,'='),'base64');
  auth_bytes := decode(rpad(translate(p_auth,'-_','+/'),24,'='),'base64');
  if octet_length(key_bytes) <> 65 or get_byte(key_bytes,0) <> 4 or octet_length(auth_bytes) <> 16 then
    raise exception 'Invalid push subscription keys' using errcode='22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(account_id::text,0));
  if not exists(select 1 from public.push_subscriptions where endpoint=p_endpoint and user_id=account_id and is_active)
    and (select count(*) from public.push_subscriptions where user_id=account_id and is_active) >= 12 then
    raise exception 'This account already has twelve notification devices' using errcode='22023';
  end if;
  insert into public.push_subscriptions(user_id,endpoint,p256dh,auth,user_agent,is_active)
  values(account_id,p_endpoint,p_p256dh,p_auth,nullif(p_user_agent,''),true)
  on conflict(endpoint) do update set user_id=excluded.user_id,p256dh=excluded.p256dh,auth=excluded.auth,user_agent=excluded.user_agent,is_active=true
  where public.push_subscriptions.user_id=account_id
     or (public.push_subscriptions.p256dh=p_p256dh and public.push_subscriptions.auth=p_auth)
  returning * into saved;
  if saved.id is null then raise exception 'Push subscription belongs to another device' using errcode='42501'; end if;
  return saved;
end $$;
-- Clients continue using the existing RPCs; reject bypasses through direct writes.
revoke insert,update on public.push_subscriptions from authenticated;


create function public.cali_save_own_task(p_task_id uuid,p_create boolean,p_details jsonb,p_steps jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare account_id uuid := auth.uid(); saved public.tasks; checklist jsonb; next_position integer; subject_id uuid;
begin
  if account_id is null or not public.cali_is_eligible_user() then raise exception 'Authentication is required' using errcode='42501'; end if;
  if p_task_id is null or p_create is null or jsonb_typeof(p_details) is distinct from 'object' then raise exception 'Invalid task details' using errcode='22023'; end if;
  subject_id := nullif(p_details->>'schedule_subject_id','')::uuid;
  if subject_id is not null and not exists(select 1 from public.schedule_subjects where id=subject_id and user_id=account_id) then raise exception 'Subject not found' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended(account_id::text,0));
  select * into saved from public.tasks where id=p_task_id for update;
  if saved.id is not null and saved.user_id<>account_id then raise exception 'Task not found' using errcode='42501'; end if;
  if saved.id is null then
    if not p_create then raise exception 'Task not found' using errcode='P0002'; end if;
    select coalesce(max(position)+1,0) into next_position from public.tasks where user_id=account_id and status='todo';
    insert into public.tasks(id,user_id,title,notes,schedule_subject_id,due_date,due_time,planned_date,priority,status,position,reminder_minutes)
    values(p_task_id,account_id,btrim(p_details->>'title'),nullif(btrim(p_details->>'notes'),''),subject_id,
      (p_details->>'due_date')::date,nullif(p_details->>'due_time','')::time,nullif(p_details->>'planned_date','')::date,
      p_details->>'priority','todo',next_position,(p_details->>'reminder_minutes')::integer)
    returning * into saved;
  else
    update public.tasks set title=btrim(p_details->>'title'),notes=nullif(btrim(p_details->>'notes'),''),
      schedule_subject_id=subject_id,due_date=(p_details->>'due_date')::date,due_time=nullif(p_details->>'due_time','')::time,
      planned_date=nullif(p_details->>'planned_date','')::date,priority=p_details->>'priority',reminder_minutes=(p_details->>'reminder_minutes')::integer
    where id=p_task_id and user_id=account_id returning * into saved;
  end if;
  select coalesce(jsonb_agg(step order by step.position),'[]'::jsonb) into checklist
    from public.cali_replace_own_task_steps(saved.id,p_steps) step;
  return jsonb_build_object('task',to_jsonb(saved),'steps',checklist);
end $$;
revoke all on function public.cali_save_own_task(uuid,boolean,jsonb,jsonb) from public,anon;
grant execute on function public.cali_save_own_task(uuid,boolean,jsonb,jsonb) to authenticated;

