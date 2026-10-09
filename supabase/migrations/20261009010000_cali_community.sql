-- Cali Community: authenticated reviewer discovery, access requests, versions,
-- votes, reports, inbox notifications, and privacy-safe previews.

alter table public.students
  add column if not exists bio text,
  add column if not exists is_community_admin boolean not null default false,
  add column if not exists community_hidden_at timestamptz;

alter table public.students drop constraint if exists students_bio_valid;
alter table public.students add constraint students_bio_valid
  check (bio is null or char_length(btrim(bio)) <= 280);

grant update (bio) on public.students to authenticated;

alter table public.reviewers
  add column if not exists visibility text not null default 'private',
  add column if not exists description text,
  add column if not exists category text not null default 'General',
  add column if not exists parent_reviewer_id uuid references public.reviewers(id) on delete set null,
  add column if not exists root_reviewer_id uuid references public.reviewers(id) on delete set null,
  add column if not exists original_author_id uuid references public.students(user_id) on delete set null,
  add column if not exists original_author_username text,
  add column if not exists published_at timestamptz,
  add column if not exists moderated_at timestamptz,
  add column if not exists moderation_reason text;

alter table public.reviewers drop constraint if exists reviewers_visibility_valid;
alter table public.reviewers drop constraint if exists reviewers_description_valid;
alter table public.reviewers drop constraint if exists reviewers_category_valid;
alter table public.reviewers add constraint reviewers_visibility_valid check (visibility in ('private', 'preview', 'public'));
alter table public.reviewers add constraint reviewers_description_valid check (description is null or char_length(btrim(description)) <= 420);
alter table public.reviewers add constraint reviewers_category_valid check (char_length(btrim(category)) between 1 and 80);

create index if not exists reviewers_community_published_idx
  on public.reviewers (visibility, published_at desc)
  where visibility in ('public', 'preview') and moderated_at is null;
create index if not exists reviewers_community_owner_idx
  on public.reviewers (user_id, visibility, published_at desc);
create index if not exists reviewers_community_lineage_idx
  on public.reviewers (root_reviewer_id, parent_reviewer_id);

create table public.reviewer_contributors (
  id uuid primary key default gen_random_uuid(),
  reviewer_id uuid not null references public.reviewers(id) on delete cascade,
  contributor_user_id uuid references public.students(user_id) on delete set null,
  contributor_username_snapshot text not null,
  position integer not null,
  created_at timestamptz not null default now(),
  constraint reviewer_contributors_username_valid check (contributor_username_snapshot ~ '^[a-z0-9_]{3,30}$'),
  constraint reviewer_contributors_position_valid check (position >= 0),
  unique (reviewer_id, contributor_username_snapshot)
);

create table public.reviewer_access_requests (
  id uuid primary key default gen_random_uuid(),
  reviewer_id uuid not null references public.reviewers(id) on delete cascade,
  requester_id uuid not null references public.students(user_id) on delete cascade,
  access_type text not null,
  status text not null default 'pending',
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint reviewer_access_requests_type_valid check (access_type in ('read', 'copy')),
  constraint reviewer_access_requests_status_valid check (status in ('pending', 'approved', 'denied', 'cancelled'))
);
create unique index reviewer_access_requests_pending_idx
  on public.reviewer_access_requests(reviewer_id, requester_id, access_type) where status = 'pending';
create index reviewer_access_requests_requester_idx on public.reviewer_access_requests(requester_id, created_at desc);
create index reviewer_access_requests_reviewer_idx on public.reviewer_access_requests(reviewer_id, created_at desc);

create table public.reviewer_access_grants (
  id uuid primary key default gen_random_uuid(),
  request_id uuid references public.reviewer_access_requests(id) on delete set null,
  reviewer_id uuid not null references public.reviewers(id) on delete cascade,
  grantee_id uuid not null references public.students(user_id) on delete cascade,
  access_type text not null,
  status text not null default 'active',
  consumed_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  constraint reviewer_access_grants_type_valid check (access_type in ('read', 'copy')),
  constraint reviewer_access_grants_status_valid check (status in ('active', 'consumed', 'revoked')),
  constraint reviewer_access_grants_consumption_valid check (
    (status = 'consumed' and access_type = 'copy' and consumed_at is not null)
    or (status <> 'consumed' and consumed_at is null)
  )
);
create unique index reviewer_access_grants_active_idx
  on public.reviewer_access_grants(reviewer_id, grantee_id, access_type) where status = 'active';

create table public.reviewer_votes (
  reviewer_id uuid not null references public.reviewers(id) on delete cascade,
  user_id uuid not null references public.students(user_id) on delete cascade,
  value smallint not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (reviewer_id, user_id),
  constraint reviewer_votes_value_valid check (value in (-1, 1))
);
create index reviewer_votes_reviewer_value_idx on public.reviewer_votes(reviewer_id, value);

create table public.reviewer_usage_daily (
  reviewer_id uuid not null references public.reviewers(id) on delete cascade,
  user_id uuid not null references public.students(user_id) on delete cascade,
  used_on date not null default (now() at time zone 'UTC')::date,
  created_at timestamptz not null default now(),
  primary key (reviewer_id, user_id, used_on)
);
create index reviewer_usage_daily_rank_idx on public.reviewer_usage_daily(used_on desc, reviewer_id);

create table public.community_notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.students(user_id) on delete cascade,
  actor_id uuid references public.students(user_id) on delete set null,
  reviewer_id uuid references public.reviewers(id) on delete cascade,
  kind text not null,
  title text not null,
  body text not null,
  url text not null default '/community?view=inbox',
  read_at timestamptz,
  push_status text not null default 'pending',
  push_attempts integer not null default 0,
  push_next_attempt_at timestamptz not null default now(),
  push_claimed_at timestamptz,
  push_sent_at timestamptz,
  push_last_error text,
  created_at timestamptz not null default now(),
  constraint community_notifications_kind_valid check (kind in ('access_request', 'access_approved', 'access_denied', 'access_revoked', 'reviewer_copied', 'moderation')),
  constraint community_notifications_copy_valid check (char_length(title) between 1 and 120 and char_length(body) between 1 and 320),
  constraint community_notifications_url_valid check (url ~ '^/'),
  constraint community_notifications_push_status_valid check (push_status in ('pending', 'processing', 'sent', 'missed')),
  constraint community_notifications_push_attempts_valid check (push_attempts between 0 and 3)
);
create index community_notifications_user_idx on public.community_notifications(user_id, created_at desc);
create index community_notifications_push_idx on public.community_notifications(push_next_attempt_at, created_at)
  where push_status = 'pending';

create table public.community_notification_deliveries (
  notification_id uuid not null references public.community_notifications(id) on delete cascade,
  subscription_id uuid not null references public.push_subscriptions(id) on delete cascade,
  delivered_at timestamptz not null default now(),
  primary key (notification_id, subscription_id)
);

create table public.community_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references public.students(user_id) on delete cascade,
  target_type text not null,
  reviewer_id uuid references public.reviewers(id) on delete cascade,
  profile_user_id uuid references public.students(user_id) on delete cascade,
  reason text not null,
  details text,
  status text not null default 'open',
  resolution_note text,
  resolved_by uuid references public.students(user_id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  constraint community_reports_target_valid check (
    (target_type = 'reviewer' and reviewer_id is not null and profile_user_id is null)
    or (target_type = 'profile' and profile_user_id is not null and reviewer_id is null)
  ),
  constraint community_reports_reason_valid check (reason in ('spam', 'inappropriate', 'copyright', 'misleading', 'other')),
  constraint community_reports_details_valid check (details is null or char_length(btrim(details)) <= 1000),
  constraint community_reports_other_valid check (reason <> 'other' or char_length(btrim(coalesce(details, ''))) >= 10),
  constraint community_reports_status_valid check (status in ('open', 'dismissed', 'hidden'))
);
create unique index community_reports_open_reviewer_idx
  on public.community_reports(reporter_id, reviewer_id) where status = 'open' and reviewer_id is not null;
create unique index community_reports_open_profile_idx
  on public.community_reports(reporter_id, profile_user_id) where status = 'open' and profile_user_id is not null;
create index community_reports_queue_idx on public.community_reports(status, created_at desc);

create trigger reviewer_access_requests_set_updated_at before update on public.reviewer_access_requests
for each row execute function public.set_cali_updated_at();
create trigger reviewer_votes_set_updated_at before update on public.reviewer_votes
for each row execute function public.set_cali_updated_at();

alter table public.reviewer_contributors enable row level security;
alter table public.reviewer_access_requests enable row level security;
alter table public.reviewer_access_grants enable row level security;
alter table public.reviewer_votes enable row level security;
alter table public.reviewer_usage_daily enable row level security;
alter table public.community_notifications enable row level security;
alter table public.community_notification_deliveries enable row level security;
alter table public.community_reports enable row level security;

revoke all on public.reviewer_contributors, public.reviewer_access_requests, public.reviewer_access_grants,
  public.reviewer_votes, public.reviewer_usage_daily, public.community_notifications,
  public.community_notification_deliveries, public.community_reports from public, anon, authenticated;
grant select, update (read_at) on public.community_notifications to authenticated;

create policy community_notifications_select_own on public.community_notifications for select to authenticated
using (user_id = (select auth.uid()));
create policy community_notifications_read_own on public.community_notifications for update to authenticated
using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create function public.cali_community_is_admin(p_user_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select is_community_admin from public.students where user_id = p_user_id), false)
$$;

create function public.cali_preview_reviewer_content(p_content jsonb)
returns jsonb language plpgsql immutable set search_path = '' as $$
declare nodes jsonb; item_count integer; visible_count integer; preview_nodes jsonb;
begin
  nodes := coalesce(p_content->'content', '[]'::jsonb);
  if jsonb_typeof(nodes) <> 'array' then return p_content; end if;
  item_count := jsonb_array_length(nodes);
  visible_count := case when item_count = 0 then 0 else greatest(1, ceil(item_count * 0.2)::integer) end;
  select coalesce(jsonb_agg(item.value order by item.ordinality), '[]'::jsonb) into preview_nodes
  from jsonb_array_elements(nodes) with ordinality as item(value, ordinality)
  where item.ordinality <= visible_count;
  return jsonb_set(p_content, '{content}', preview_nodes, true);
end;
$$;

create function public.cali_reviewer_json_text(p_content jsonb)
returns text language sql immutable set search_path = '' as $$
  select coalesce(string_agg(trim(both '"' from value::text), ' '), '')
  from jsonb_path_query(p_content, 'strict $.**.text') as value
$$;

create function public.cali_community_card_json(p_reviewer public.reviewers, p_viewer uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', p_reviewer.id,
    'title', p_reviewer.title,
    'description', coalesce(p_reviewer.description, ''),
    'category', p_reviewer.category,
    'visibility', p_reviewer.visibility,
    'updatedAt', p_reviewer.updated_at,
    'publishedAt', p_reviewer.published_at,
    'parentReviewerId', p_reviewer.parent_reviewer_id,
    'rootReviewerId', p_reviewer.root_reviewer_id,
    'isVersion', p_reviewer.parent_reviewer_id is not null,
    'isOwner', p_reviewer.user_id = p_viewer,
    'creator', jsonb_build_object(
      'userId', owner.user_id,
      'username', owner.username,
      'avatarUrl', owner.avatar_url,
      'program', owner.program,
      'yearLevel', owner.year_level
    ),
    'netVotes', coalesce(votes.net_votes, 0),
    'upvotes', coalesce(votes.upvotes, 0),
    'downvotes', coalesce(votes.downvotes, 0),
    'userVote', coalesce((select value from public.reviewer_votes where reviewer_id = p_reviewer.id and user_id = p_viewer), 0),
    'usage7d', coalesce(usage.usage_7d, 0),
    'usage30d', coalesce(usage.usage_30d, 0),
    'excerpt', left(case when p_reviewer.visibility = 'public' then p_reviewer.plain_text else public.cali_reviewer_json_text(public.cali_preview_reviewer_content(p_reviewer.content)) end, 260)
  )
  from public.students owner
  left join lateral (
    select coalesce(sum(value), 0)::integer net_votes,
      count(*) filter (where value = 1)::integer upvotes,
      count(*) filter (where value = -1)::integer downvotes
    from public.reviewer_votes where reviewer_id = p_reviewer.id
  ) votes on true
  left join lateral (
    select count(*) filter (where used_on >= (now() at time zone 'UTC')::date - 6)::integer usage_7d,
      count(*) filter (where used_on >= (now() at time zone 'UTC')::date - 29)::integer usage_30d
    from public.reviewer_usage_daily where reviewer_id = p_reviewer.id
  ) usage on true
  where owner.user_id = p_reviewer.user_id
$$;

create function public.cali_search_community_reviewers(
  p_query text default '', p_category text default null, p_program text default null,
  p_year_level integer default null, p_visibility text default null,
  p_owner_username text default null, p_sort text default 'relevance', p_limit integer default 36
) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare account_id uuid := (select auth.uid()); result jsonb;
begin
  if account_id is null or not public.cali_is_eligible_user() then raise exception 'Authentication is required' using errcode = '42501'; end if;
  with candidates as (
    select r.*, s.username,
      lower(concat_ws(' ', r.title, r.description, r.category, s.username,
        case when r.visibility = 'public' then r.plain_text else public.cali_reviewer_json_text(public.cali_preview_reviewer_content(r.content)) end)) search_text,
      coalesce((select sum(v.value) from public.reviewer_votes v where v.reviewer_id = r.id), 0)::integer net_votes,
      coalesce((select sum(v.value) from public.reviewer_votes v where v.reviewer_id = r.id and v.created_at >= now() - interval '30 days'), 0)::integer votes_30d,
      coalesce((select count(*) from public.reviewer_usage_daily u where u.reviewer_id = r.id and u.used_on >= (now() at time zone 'UTC')::date - 6), 0)::integer usage_7d,
      coalesce((select count(*) from public.reviewer_usage_daily u where u.reviewer_id = r.id and u.used_on >= (now() at time zone 'UTC')::date - 29), 0)::integer usage_30d
    from public.reviewers r join public.students s on s.user_id = r.user_id
    where r.visibility in ('public', 'preview') and r.moderated_at is null and s.community_hidden_at is null
      and (p_category is null or p_category = '' or lower(r.category) = lower(p_category))
      and (p_program is null or p_program = '' or lower(s.program) = lower(p_program))
      and (p_year_level is null or s.year_level = p_year_level)
      and (p_visibility is null or p_visibility = '' or r.visibility = p_visibility)
      and (p_owner_username is null or p_owner_username = '' or s.username = lower(p_owner_username))
  ), filtered as (
    select *, (3 * votes_30d + usage_7d)::integer trending_score
    from candidates
    where btrim(coalesce(p_query, '')) = ''
      or search_text like '%' || lower(btrim(p_query)) || '%'
  ), ordered as (
    select filtered.*,
      row_number() over (order by
        case when p_sort = 'trending' then trending_score end desc nulls last,
        case when p_sort = 'top' then net_votes end desc nulls last,
        case when p_sort = 'most_used' then usage_30d end desc nulls last,
        case when p_sort = 'newest' then published_at end desc nulls last,
        case when p_sort = 'relevance' and btrim(coalesce(p_query, '')) <> '' then
          case when lower(title) like lower(btrim(p_query)) || '%' then 3 when lower(title) like '%' || lower(btrim(p_query)) || '%' then 2 else 1 end
        end desc nulls last,
        published_at desc, id
      ) as result_order
    from filtered
    order by
      case when p_sort = 'trending' then trending_score end desc nulls last,
      case when p_sort = 'top' then net_votes end desc nulls last,
      case when p_sort = 'most_used' then usage_30d end desc nulls last,
      case when p_sort = 'newest' then published_at end desc nulls last,
      case when p_sort = 'relevance' and btrim(coalesce(p_query, '')) <> '' then
        case when lower(title) like lower(btrim(p_query)) || '%' then 3 when lower(title) like '%' || lower(btrim(p_query)) || '%' then 2 else 1 end
      end desc nulls last,
      published_at desc, id
    limit least(greatest(coalesce(p_limit, 36), 1), 48)
  )
  select coalesce(jsonb_agg(public.cali_community_card_json(reviewer, account_id) order by ordered.result_order), '[]'::jsonb)
  into result from ordered join public.reviewers reviewer on reviewer.id = ordered.id;
  return result;
end;
$$;

create function public.cali_get_community_profile(p_username text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare account_id uuid := (select auth.uid()); profile public.students;
begin
  if account_id is null or not public.cali_is_eligible_user() then raise exception 'Authentication is required' using errcode = '42501'; end if;
  select * into profile from public.students where username = lower(btrim(p_username)) and community_hidden_at is null;
  if profile.user_id is null then raise exception 'Profile not found' using errcode = 'P0002'; end if;
  return jsonb_build_object('userId', profile.user_id, 'username', profile.username, 'avatarUrl', profile.avatar_url,
    'bio', coalesce(profile.bio, ''), 'program', profile.program, 'yearLevel', profile.year_level,
    'joinedAt', profile.created_at, 'isOwnProfile', profile.user_id = account_id);
end;
$$;

create function public.cali_get_community_reviewer(p_reviewer_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare account_id uuid := (select auth.uid()); reviewer public.reviewers; full_access boolean; item_count integer; visible_count integer; card jsonb;
begin
  if account_id is null or not public.cali_is_eligible_user() then raise exception 'Authentication is required' using errcode = '42501'; end if;
  select * into reviewer from public.reviewers where id = p_reviewer_id;
  if reviewer.id is null then raise exception 'Reviewer not found' using errcode = 'P0002'; end if;
  full_access := reviewer.user_id = account_id or reviewer.visibility = 'public' or exists (
    select 1 from public.reviewer_access_grants where reviewer_id = reviewer.id and grantee_id = account_id and access_type = 'read' and status = 'active'
  );
  if reviewer.moderated_at is not null and reviewer.user_id <> account_id and not public.cali_community_is_admin(account_id) then
    raise exception 'Reviewer is unavailable' using errcode = 'P0002';
  end if;
  if reviewer.visibility = 'private' and reviewer.user_id <> account_id then raise exception 'Reviewer is unavailable' using errcode = 'P0002'; end if;
  item_count := jsonb_array_length(coalesce(reviewer.content->'content', '[]'::jsonb));
  visible_count := case when full_access then item_count when item_count = 0 then 0 else greatest(1, ceil(item_count * 0.2)::integer) end;
  card := public.cali_community_card_json(reviewer, account_id);
  return card || jsonb_build_object(
    'content', case when full_access then reviewer.content else public.cali_preview_reviewer_content(reviewer.content) end,
    'isFullContent', full_access,
    'visibleItemCount', visible_count,
    'totalItemCount', item_count,
    'isOwner', reviewer.user_id = account_id,
    'canCopy', reviewer.visibility = 'public' or exists (select 1 from public.reviewer_access_grants where reviewer_id = reviewer.id and grantee_id = account_id and access_type = 'copy' and status = 'active'),
    'requestState', coalesce((select jsonb_build_object('id', id, 'type', access_type, 'status', status) from public.reviewer_access_requests where reviewer_id = reviewer.id and requester_id = account_id order by created_at desc limit 1), 'null'::jsonb),
    'contributors', coalesce((select jsonb_agg(jsonb_build_object('userId', c.contributor_user_id, 'username', coalesce(s.username, c.contributor_username_snapshot), 'avatarUrl', s.avatar_url) order by c.position) from public.reviewer_contributors c left join public.students s on s.user_id = c.contributor_user_id where c.reviewer_id = reviewer.id), '[]'::jsonb)
  );
end;
$$;

create function public.cali_set_reviewer_visibility(p_reviewer_id uuid, p_visibility text, p_description text, p_category text)
returns public.reviewers language plpgsql security definer set search_path = '' as $$
declare account_id uuid := (select auth.uid()); changed public.reviewers; grant_row public.reviewer_access_grants;
begin
  if account_id is null or not public.cali_is_eligible_user() then raise exception 'Authentication is required' using errcode = '42501'; end if;
  if p_visibility not in ('private', 'preview', 'public') then raise exception 'Invalid visibility' using errcode = '22023'; end if;
  update public.reviewers set visibility = p_visibility, description = nullif(btrim(p_description), ''), category = coalesce(nullif(btrim(p_category), ''), 'General'),
    published_at = case when p_visibility = 'private' then published_at else coalesce(published_at, now()) end
  where id = p_reviewer_id and user_id = account_id and moderated_at is null returning * into changed;
  if changed.id is null then raise exception 'Reviewer not found' using errcode = 'P0002'; end if;
  if p_visibility = 'private' then
    for grant_row in update public.reviewer_access_grants set status = 'revoked', revoked_at = now()
      where reviewer_id = changed.id and status = 'active' returning * loop
      insert into public.community_notifications(user_id, actor_id, reviewer_id, kind, title, body, url)
      values (grant_row.grantee_id, account_id, changed.id, 'access_revoked', 'Reviewer access ended',
        format('@%s made “%s” private.', (select username from public.students where user_id = account_id), changed.title), '/community?view=inbox');
    end loop;
  end if;
  return changed;
end;
$$;

create function public.cali_request_reviewer_access(p_reviewer_id uuid, p_access_type text)
returns public.reviewer_access_requests language plpgsql security definer set search_path = '' as $$
declare account_id uuid := (select auth.uid()); reviewer public.reviewers; created public.reviewer_access_requests; requester_username text;
begin
  if account_id is null or not public.cali_is_eligible_user() then raise exception 'Authentication is required' using errcode = '42501'; end if;
  if p_access_type not in ('read', 'copy') then raise exception 'Invalid access type' using errcode = '22023'; end if;
  select * into reviewer from public.reviewers where id = p_reviewer_id and visibility = 'preview' and moderated_at is null;
  if reviewer.id is null or reviewer.user_id = account_id then raise exception 'Access cannot be requested' using errcode = 'P0001'; end if;
  if exists (select 1 from public.reviewer_access_grants where reviewer_id = reviewer.id and grantee_id = account_id and access_type = p_access_type and status = 'active') then raise exception 'Access is already active' using errcode = 'P0001'; end if;
  insert into public.reviewer_access_requests(reviewer_id, requester_id, access_type)
  values (reviewer.id, account_id, p_access_type) returning * into created;
  select student.username into requester_username from public.students student where student.user_id = account_id;
  insert into public.community_notifications(user_id, actor_id, reviewer_id, kind, title, body, url)
  values (reviewer.user_id, account_id, reviewer.id, 'access_request', 'New reviewer access request',
    format('@%s requested %s access to “%s”.', requester_username, case when p_access_type = 'copy' then 'copy' else 'read-only' end, reviewer.title), '/community?view=inbox');
  return created;
exception when unique_violation then raise exception 'A request is already pending' using errcode = 'P0001';
end;
$$;

create function public.cali_resolve_reviewer_access(p_request_id uuid, p_approve boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare account_id uuid := (select auth.uid()); request_row public.reviewer_access_requests; reviewer public.reviewers; grant_row public.reviewer_access_grants;
begin
  if account_id is null or not public.cali_is_eligible_user() then raise exception 'Authentication is required' using errcode = '42501'; end if;
  select * into request_row from public.reviewer_access_requests where id = p_request_id and status = 'pending' for update;
  if request_row.id is null then raise exception 'Request is no longer pending' using errcode = 'P0002'; end if;
  select * into reviewer from public.reviewers where id = request_row.reviewer_id and user_id = account_id;
  if reviewer.id is null then raise exception 'Request not found' using errcode = 'P0002'; end if;
  update public.reviewer_access_requests set status = case when p_approve then 'approved' else 'denied' end, resolved_at = now() where id = request_row.id;
  if p_approve then
    update public.reviewer_access_grants set status = 'revoked', revoked_at = now()
      where reviewer_id = reviewer.id and grantee_id = request_row.requester_id and access_type = request_row.access_type and status = 'active';
    insert into public.reviewer_access_grants(request_id, reviewer_id, grantee_id, access_type)
    values (request_row.id, reviewer.id, request_row.requester_id, request_row.access_type) returning * into grant_row;
  end if;
  insert into public.community_notifications(user_id, actor_id, reviewer_id, kind, title, body, url)
  values (request_row.requester_id, account_id, reviewer.id, case when p_approve then 'access_approved' else 'access_denied' end,
    case when p_approve then 'Reviewer access approved' else 'Reviewer access request declined' end,
    format('@%s %s your %s request for “%s”.', (select username from public.students where user_id = account_id), case when p_approve then 'approved' else 'declined' end, case when request_row.access_type = 'copy' then 'copy' else 'read-only' end, reviewer.title),
    case when p_approve then '/community/reviewer/' || reviewer.id::text else '/community?view=inbox' end);
  return jsonb_build_object('requestId', request_row.id, 'status', case when p_approve then 'approved' else 'denied' end, 'grantId', grant_row.id);
end;
$$;

create function public.cali_revoke_reviewer_access(p_grant_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare account_id uuid := (select auth.uid()); grant_row public.reviewer_access_grants; reviewer public.reviewers;
begin
  select g.* into grant_row from public.reviewer_access_grants g join public.reviewers r on r.id = g.reviewer_id
    where g.id = p_grant_id and g.status = 'active' and r.user_id = account_id for update of g;
  if grant_row.id is null then raise exception 'Active grant not found' using errcode = 'P0002'; end if;
  update public.reviewer_access_grants set status = 'revoked', revoked_at = now() where id = grant_row.id;
  select * into reviewer from public.reviewers where id = grant_row.reviewer_id;
  insert into public.community_notifications(user_id, actor_id, reviewer_id, kind, title, body, url)
  values (grant_row.grantee_id, account_id, reviewer.id, 'access_revoked', 'Reviewer access ended',
    format('@%s revoked your access to “%s”.', (select username from public.students where user_id = account_id), reviewer.title), '/community?view=inbox');
end;
$$;

create function public.cali_copy_community_reviewer(p_reviewer_id uuid)
returns public.reviewers language plpgsql security definer set search_path = '' as $$
declare account_id uuid := (select auth.uid()); source public.reviewers; copied public.reviewers; copy_grant public.reviewer_access_grants; source_username text;
begin
  if account_id is null or not public.cali_is_eligible_user() then raise exception 'Authentication is required' using errcode = '42501'; end if;
  select * into source from public.reviewers where id = p_reviewer_id and moderated_at is null for share;
  if source.id is null or source.visibility = 'private' or source.user_id = account_id then raise exception 'Reviewer cannot be copied' using errcode = 'P0001'; end if;
  if source.visibility <> 'public' then
    select * into copy_grant from public.reviewer_access_grants where reviewer_id = source.id and grantee_id = account_id and access_type = 'copy' and status = 'active' for update;
    if copy_grant.id is null then raise exception 'Copy access is required' using errcode = '42501'; end if;
  end if;
  select username into source_username from public.students where user_id = source.user_id;
  insert into public.reviewers(user_id, title, content, plain_text, origin, ai_model, visibility, description, category,
    parent_reviewer_id, root_reviewer_id, original_author_id, original_author_username)
  values (account_id, left(source.title || ' copy', 160), source.content, source.plain_text, source.origin, source.ai_model, 'private', source.description, source.category,
    source.id, coalesce(source.root_reviewer_id, source.id), coalesce(source.original_author_id, source.user_id), coalesce(source.original_author_username, source_username))
  returning * into copied;
  insert into public.reviewer_contributors(reviewer_id, contributor_user_id, contributor_username_snapshot, position)
    select copied.id, contributor_user_id, contributor_username_snapshot, position from public.reviewer_contributors where reviewer_id = source.id;
  insert into public.reviewer_contributors(reviewer_id, contributor_user_id, contributor_username_snapshot, position)
    values (copied.id, source.user_id, source_username, coalesce((select max(position) + 1 from public.reviewer_contributors where reviewer_id = copied.id), 0))
    on conflict (reviewer_id, contributor_username_snapshot) do nothing;
  if copy_grant.id is not null then update public.reviewer_access_grants set status = 'consumed', consumed_at = now() where id = copy_grant.id; end if;
  return copied;
end;
$$;

create function public.cali_vote_community_reviewer(p_reviewer_id uuid, p_value integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare account_id uuid := (select auth.uid()); reviewer public.reviewers; net integer;
begin
  if account_id is null or not public.cali_is_eligible_user() then raise exception 'Authentication is required' using errcode = '42501'; end if;
  if p_value not in (-1, 0, 1) then raise exception 'Invalid vote' using errcode = '22023'; end if;
  select * into reviewer from public.reviewers where id = p_reviewer_id and visibility in ('public', 'preview') and moderated_at is null;
  if reviewer.id is null or reviewer.user_id = account_id then raise exception 'This reviewer cannot be voted on' using errcode = 'P0001'; end if;
  if p_value = 0 then delete from public.reviewer_votes where reviewer_id = reviewer.id and user_id = account_id;
  else insert into public.reviewer_votes(reviewer_id, user_id, value) values (reviewer.id, account_id, p_value)
    on conflict (reviewer_id, user_id) do update set value = excluded.value, updated_at = now(); end if;
  select coalesce(sum(value), 0)::integer into net from public.reviewer_votes where reviewer_id = reviewer.id;
  return jsonb_build_object('userVote', p_value, 'netVotes', net);
end;
$$;

create function public.cali_record_community_reviewer_use(p_reviewer_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare account_id uuid := (select auth.uid()); reviewer public.reviewers;
begin
  if account_id is null then return; end if;
  select * into reviewer from public.reviewers where id = p_reviewer_id and visibility in ('public', 'preview') and moderated_at is null;
  if reviewer.id is null or reviewer.user_id = account_id then return; end if;
  insert into public.reviewer_usage_daily(reviewer_id, user_id) values (reviewer.id, account_id) on conflict do nothing;
end;
$$;

create function public.cali_report_community_target(p_target_type text, p_target_id uuid, p_reason text, p_details text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare account_id uuid := (select auth.uid()); report_id uuid;
begin
  if account_id is null or not public.cali_is_eligible_user() then raise exception 'Authentication is required' using errcode = '42501'; end if;
  if p_target_type = 'reviewer' then
    if not exists (select 1 from public.reviewers where id = p_target_id and user_id <> account_id and visibility in ('public', 'preview')) then raise exception 'Reviewer cannot be reported' using errcode = 'P0002'; end if;
    insert into public.community_reports(reporter_id, target_type, reviewer_id, reason, details) values (account_id, 'reviewer', p_target_id, p_reason, nullif(btrim(p_details), '')) returning id into report_id;
  elsif p_target_type = 'profile' then
    if p_target_id = account_id or not exists (select 1 from public.students where user_id = p_target_id) then raise exception 'Profile cannot be reported' using errcode = 'P0002'; end if;
    insert into public.community_reports(reporter_id, target_type, profile_user_id, reason, details) values (account_id, 'profile', p_target_id, p_reason, nullif(btrim(p_details), '')) returning id into report_id;
  else raise exception 'Invalid report target' using errcode = '22023'; end if;
  return report_id;
exception when unique_violation then raise exception 'You already have an open report for this item' using errcode = 'P0001';
end;
$$;

create function public.cali_get_community_inbox()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare account_id uuid := (select auth.uid()); result jsonb;
begin
  if account_id is null or not public.cali_is_eligible_user() then raise exception 'Authentication is required' using errcode = '42501'; end if;
  select jsonb_build_object(
    'incoming', coalesce((select jsonb_agg(jsonb_build_object('id', q.id, 'type', q.access_type, 'status', q.status, 'createdAt', q.created_at,
      'reviewer', jsonb_build_object('id', r.id, 'title', r.title, 'visibility', r.visibility),
      'student', jsonb_build_object('userId', s.user_id, 'username', s.username, 'avatarUrl', s.avatar_url),
      'grantId', g.id) order by q.created_at desc)
      from public.reviewer_access_requests q join public.reviewers r on r.id = q.reviewer_id join public.students s on s.user_id = q.requester_id
      left join public.reviewer_access_grants g on g.request_id = q.id and g.status = 'active'
      where r.user_id = account_id), '[]'::jsonb),
    'outgoing', coalesce((select jsonb_agg(jsonb_build_object('id', q.id, 'type', q.access_type, 'status', q.status, 'createdAt', q.created_at,
      'reviewer', jsonb_build_object('id', r.id, 'title', r.title, 'visibility', r.visibility),
      'student', jsonb_build_object('userId', s.user_id, 'username', s.username, 'avatarUrl', s.avatar_url),
      'grantId', g.id) order by q.created_at desc)
      from public.reviewer_access_requests q join public.reviewers r on r.id = q.reviewer_id join public.students s on s.user_id = r.user_id
      left join public.reviewer_access_grants g on g.request_id = q.id
      where q.requester_id = account_id), '[]'::jsonb),
    'notifications', coalesce((select jsonb_agg(jsonb_build_object('id', n.id, 'kind', n.kind, 'title', n.title, 'body', n.body, 'url', n.url, 'readAt', n.read_at, 'createdAt', n.created_at) order by n.created_at desc)
      from (select * from public.community_notifications where user_id = account_id order by created_at desc limit 60) n), '[]'::jsonb),
    'unreadCount', (select count(*) from public.community_notifications where user_id = account_id and read_at is null)
  ) into result;
  return result;
end;
$$;

create function public.cali_mark_community_notifications_read()
returns void language sql security definer set search_path = '' as $$
  update public.community_notifications set read_at = now() where user_id = (select auth.uid()) and read_at is null
$$;

create function public.cali_community_admin_status()
returns boolean language sql stable security definer set search_path = '' as $$ select public.cali_community_is_admin((select auth.uid())) $$;

create function public.cali_list_community_reports()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare account_id uuid := (select auth.uid()); result jsonb;
begin
  if not public.cali_community_is_admin(account_id) then raise exception 'Administrator access is required' using errcode = '42501'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id', report.id, 'targetType', report.target_type, 'targetId', coalesce(report.reviewer_id, report.profile_user_id),
    'reason', report.reason, 'details', report.details, 'status', report.status, 'createdAt', report.created_at,
    'reporter', reporter.username,
    'targetLabel', case when report.target_type = 'reviewer' then reviewer.title else profile.username end) order by report.created_at desc), '[]'::jsonb)
  into result from public.community_reports report join public.students reporter on reporter.user_id = report.reporter_id
    left join public.reviewers reviewer on reviewer.id = report.reviewer_id left join public.students profile on profile.user_id = report.profile_user_id
  where report.status = 'open';
  return result;
end;
$$;

create function public.cali_moderate_community_report(p_report_id uuid, p_action text, p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare account_id uuid := (select auth.uid()); report public.community_reports;
begin
  if not public.cali_community_is_admin(account_id) then raise exception 'Administrator access is required' using errcode = '42501'; end if;
  if p_action not in ('dismiss', 'hide') then raise exception 'Invalid moderation action' using errcode = '22023'; end if;
  select * into report from public.community_reports where id = p_report_id and status = 'open' for update;
  if report.id is null then raise exception 'Open report not found' using errcode = 'P0002'; end if;
  if p_action = 'hide' and report.target_type = 'reviewer' then update public.reviewers set moderated_at = now(), moderation_reason = report.reason where id = report.reviewer_id; end if;
  if p_action = 'hide' and report.target_type = 'profile' then update public.students set community_hidden_at = now() where user_id = report.profile_user_id; end if;
  update public.community_reports set status = case when p_action = 'hide' then 'hidden' else 'dismissed' end,
    resolution_note = nullif(btrim(p_note), ''), resolved_by = account_id, resolved_at = now() where id = report.id;
end;
$$;

create function public.cali_claim_community_notifications(p_limit integer default 50)
returns setof public.community_notifications language plpgsql security definer set search_path = '' as $$
begin
  return query
  update public.community_notifications n set push_status = 'processing', push_claimed_at = now(), push_attempts = push_attempts + 1
  where n.id in (select id from public.community_notifications where push_status = 'pending' and push_next_attempt_at <= now() order by created_at for update skip locked limit least(greatest(p_limit, 1), 100))
  returning n.*;
end;
$$;

revoke all on function public.cali_community_is_admin(uuid), public.cali_preview_reviewer_content(jsonb), public.cali_reviewer_json_text(jsonb), public.cali_community_card_json(public.reviewers, uuid) from public, anon, authenticated;
revoke all on function public.cali_search_community_reviewers(text, text, text, integer, text, text, text, integer), public.cali_get_community_profile(text), public.cali_get_community_reviewer(uuid), public.cali_set_reviewer_visibility(uuid, text, text, text), public.cali_request_reviewer_access(uuid, text), public.cali_resolve_reviewer_access(uuid, boolean), public.cali_revoke_reviewer_access(uuid), public.cali_copy_community_reviewer(uuid), public.cali_vote_community_reviewer(uuid, integer), public.cali_record_community_reviewer_use(uuid), public.cali_report_community_target(text, uuid, text, text), public.cali_get_community_inbox(), public.cali_mark_community_notifications_read(), public.cali_community_admin_status(), public.cali_list_community_reports(), public.cali_moderate_community_report(uuid, text, text) from public, anon;
grant execute on function public.cali_search_community_reviewers(text, text, text, integer, text, text, text, integer), public.cali_get_community_profile(text), public.cali_get_community_reviewer(uuid), public.cali_set_reviewer_visibility(uuid, text, text, text), public.cali_request_reviewer_access(uuid, text), public.cali_resolve_reviewer_access(uuid, boolean), public.cali_revoke_reviewer_access(uuid), public.cali_copy_community_reviewer(uuid), public.cali_vote_community_reviewer(uuid, integer), public.cali_record_community_reviewer_use(uuid), public.cali_report_community_target(text, uuid, text, text), public.cali_get_community_inbox(), public.cali_mark_community_notifications_read(), public.cali_community_admin_status(), public.cali_list_community_reports(), public.cali_moderate_community_report(uuid, text, text) to authenticated;
revoke all on function public.cali_claim_community_notifications(integer) from public, anon, authenticated;
grant execute on function public.cali_claim_community_notifications(integer) to service_role;

-- Existing reviewer writes remain private by default. Community reads only use
-- the projection RPCs above, preventing Preview bodies from leaking through a
-- direct table select.
