-- Surface a reviewer's owner-owned schedule subject throughout Cali Community.
-- Copies intentionally remain unanchored because schedule subjects belong to a
-- specific student account; the new owner can assign the copy to their subject.

create or replace function public.cali_community_card_json(
  p_reviewer public.reviewers,
  p_viewer uuid
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p_reviewer.id,
    'title', p_reviewer.title,
    'description', coalesce(p_reviewer.description, ''),
    'category', p_reviewer.category,
    'subject', case when subject.id is null then null else jsonb_build_object(
      'id', subject.id,
      'code', subject.subject_code,
      'title', subject.title,
      'colorKey', subject.color_key
    ) end,
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
  left join public.schedule_subjects subject
    on subject.id = p_reviewer.subject_id
    and subject.user_id = p_reviewer.user_id
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

create or replace function public.cali_search_community_reviewers(
  p_query text default '',
  p_category text default null,
  p_program text default null,
  p_year_level integer default null,
  p_visibility text default null,
  p_owner_username text default null,
  p_sort text default 'relevance',
  p_limit integer default 36
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare account_id uuid := (select auth.uid()); result jsonb;
begin
  if account_id is null or not public.cali_is_eligible_user() then raise exception 'Authentication is required' using errcode = '42501'; end if;
  with candidates as (
    select r.*, s.username,
      lower(concat_ws(' ', r.title, r.description, r.category, s.username, subject.subject_code, subject.title,
        case when r.visibility = 'public' then r.plain_text else public.cali_reviewer_json_text(public.cali_preview_reviewer_content(r.content)) end)) search_text,
      coalesce((select sum(v.value) from public.reviewer_votes v where v.reviewer_id = r.id), 0)::integer net_votes,
      coalesce((select sum(v.value) from public.reviewer_votes v where v.reviewer_id = r.id and v.created_at >= now() - interval '30 days'), 0)::integer votes_30d,
      coalesce((select count(*) from public.reviewer_usage_daily u where u.reviewer_id = r.id and u.used_on >= (now() at time zone 'UTC')::date - 6), 0)::integer usage_7d,
      coalesce((select count(*) from public.reviewer_usage_daily u where u.reviewer_id = r.id and u.used_on >= (now() at time zone 'UTC')::date - 29), 0)::integer usage_30d
    from public.reviewers r
    join public.students s on s.user_id = r.user_id
    left join public.schedule_subjects subject on subject.id = r.subject_id and subject.user_id = r.user_id
    where r.visibility in ('public', 'preview') and r.moderated_at is null and s.community_hidden_at is null
      and (p_category is null or p_category = '' or lower(r.category) = lower(p_category))
      and (p_program is null or p_program = '' or lower(s.program) = lower(p_program))
      and (p_year_level is null or s.year_level = p_year_level)
      and (p_visibility is null or p_visibility = '' or r.visibility = p_visibility)
      and (p_owner_username is null or p_owner_username = '' or s.username = lower(p_owner_username))
  ), filtered as (
    select *, (3 * votes_30d + usage_7d)::integer trending_score
    from candidates
    where btrim(coalesce(p_query, '')) = '' or search_text like '%' || lower(btrim(p_query)) || '%'
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

create or replace function public.cali_set_reviewer_visibility(
  p_reviewer_id uuid,
  p_visibility text,
  p_description text,
  p_category text,
  p_subject_id uuid
)
returns public.reviewers
language plpgsql
security definer
set search_path = ''
as $$
declare
  account_id uuid := (select auth.uid());
  changed public.reviewers;
  grant_row public.reviewer_access_grants;
begin
  if account_id is null or not public.cali_is_eligible_user() then raise exception 'Authentication is required' using errcode = '42501'; end if;
  if p_visibility not in ('private', 'preview', 'public') then raise exception 'Invalid visibility' using errcode = '22023'; end if;
  if p_subject_id is not null and not exists (
    select 1 from public.schedule_subjects where id = p_subject_id and user_id = account_id
  ) then
    raise exception 'Subject does not belong to this account' using errcode = '42501';
  end if;

  update public.reviewers
  set visibility = p_visibility,
    description = nullif(btrim(p_description), ''),
    category = coalesce(nullif(btrim(p_category), ''), 'General'),
    subject_id = p_subject_id,
    published_at = case when p_visibility = 'private' then published_at else coalesce(published_at, now()) end
  where id = p_reviewer_id and user_id = account_id and moderated_at is null
  returning * into changed;

  if changed.id is null then raise exception 'Reviewer not found' using errcode = 'P0002'; end if;
  if p_visibility = 'private' then
    for grant_row in
      update public.reviewer_access_grants set status = 'revoked', revoked_at = now()
      where reviewer_id = changed.id and status = 'active' returning *
    loop
      insert into public.community_notifications(user_id, actor_id, reviewer_id, kind, title, body, url)
      values (
        grant_row.grantee_id,
        account_id,
        changed.id,
        'access_revoked',
        'Reviewer access ended',
        format('@%s made “%s” private.', (select username from public.students where user_id = account_id), changed.title),
        '/community?view=inbox'
      );
    end loop;
  end if;
  return changed;
end;
$$;

revoke all on function public.cali_set_reviewer_visibility(uuid, text, text, text, uuid) from public;
grant execute on function public.cali_set_reviewer_visibility(uuid, text, text, text, uuid) to authenticated;
