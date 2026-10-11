-- Private reviewer bookmarks are independent from access grants. A bookmark
-- never grants access; saved items are listed only while the reviewer remains
-- visible and fully readable by the current account.

create table public.reviewer_bookmarks (
  user_id uuid not null references auth.users(id) on delete cascade,
  reviewer_id uuid not null references public.reviewers(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, reviewer_id)
);

create index reviewer_bookmarks_reviewer_idx on public.reviewer_bookmarks(reviewer_id);

alter table public.reviewer_bookmarks enable row level security;
revoke all on public.reviewer_bookmarks from public, anon, authenticated;

create or replace function public.cali_set_reviewer_saved(
  p_reviewer_id uuid,
  p_saved boolean
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  account_id uuid := (select auth.uid());
  reviewer_is_readable boolean;
begin
  if account_id is null or not public.cali_is_eligible_user() then
    raise exception 'Authentication is required' using errcode = '42501';
  end if;

  if not coalesce(p_saved, false) then
    delete from public.reviewer_bookmarks
    where user_id = account_id and reviewer_id = p_reviewer_id;
    return false;
  end if;

  select true into reviewer_is_readable
  from public.reviewers reviewer
  join public.students owner on owner.user_id = reviewer.user_id
  where reviewer.id = p_reviewer_id
    and reviewer.visibility in ('public', 'preview')
    and reviewer.moderated_at is null
    and owner.suspended_at is null
    and owner.community_hidden_at is null
    and (
      reviewer.visibility = 'public'
      or reviewer.user_id = account_id
      or exists (
        select 1
        from public.reviewer_access_grants grant_row
        where grant_row.reviewer_id = reviewer.id
          and grant_row.grantee_id = account_id
          and grant_row.access_type in ('read', 'copy')
          and grant_row.status = 'active'
      )
    );

  if not coalesce(reviewer_is_readable, false) then
    raise exception 'Full read access is required before saving this reviewer' using errcode = '42501';
  end if;

  insert into public.reviewer_bookmarks(user_id, reviewer_id)
  values (account_id, p_reviewer_id)
  on conflict (user_id, reviewer_id) do nothing;

  return true;
end;
$$;

create or replace function public.cali_list_saved_reviewers(p_limit integer default 48)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  account_id uuid := (select auth.uid());
  result jsonb;
begin
  if account_id is null or not public.cali_is_eligible_user() then
    raise exception 'Authentication is required' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(
    public.cali_community_card_json(reviewer, account_id)
      || jsonb_build_object('isSaved', true)
    order by bookmark.created_at desc
  ), '[]'::jsonb)
  into result
  from public.reviewer_bookmarks bookmark
  join public.reviewers reviewer on reviewer.id = bookmark.reviewer_id
  join public.students owner on owner.user_id = reviewer.user_id
  where bookmark.user_id = account_id
    and reviewer.visibility in ('public', 'preview')
    and reviewer.moderated_at is null
    and owner.suspended_at is null
    and owner.community_hidden_at is null
    and (
      reviewer.visibility = 'public'
      or reviewer.user_id = account_id
      or exists (
        select 1
        from public.reviewer_access_grants grant_row
        where grant_row.reviewer_id = reviewer.id
          and grant_row.grantee_id = account_id
          and grant_row.access_type in ('read', 'copy')
          and grant_row.status = 'active'
      )
    )
    and bookmark.reviewer_id in (
      select recent.reviewer_id
      from public.reviewer_bookmarks recent
      where recent.user_id = account_id
      order by recent.created_at desc
      limit least(greatest(coalesce(p_limit, 48), 1), 100)
    );

  return result;
end;
$$;

create or replace function public.cali_get_community_reviewer(p_reviewer_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  account_id uuid := (select auth.uid());
  reviewer public.reviewers;
  full_access boolean;
  item_count integer;
  visible_count integer;
  card jsonb;
begin
  if account_id is null or not public.cali_is_eligible_user() then
    raise exception 'Authentication is required' using errcode = '42501';
  end if;

  select r.* into reviewer
  from public.reviewers r
  join public.students owner on owner.user_id = r.user_id
  where r.id = p_reviewer_id
    and (owner.suspended_at is null or r.user_id = account_id);

  if reviewer.id is null then
    raise exception 'Reviewer not found' using errcode = 'P0002';
  end if;

  full_access := reviewer.user_id = account_id
    or reviewer.visibility = 'public'
    or exists (
      select 1
      from public.reviewer_access_grants grant_row
      where grant_row.reviewer_id = reviewer.id
        and grant_row.grantee_id = account_id
        and grant_row.access_type in ('read', 'copy')
        and grant_row.status = 'active'
    );

  if reviewer.moderated_at is not null and reviewer.user_id <> account_id and not public.cali_is_admin(account_id) then
    raise exception 'Reviewer is unavailable' using errcode = 'P0002';
  end if;
  if reviewer.visibility = 'private' and reviewer.user_id <> account_id then
    raise exception 'Reviewer is unavailable' using errcode = 'P0002';
  end if;

  item_count := jsonb_array_length(coalesce(reviewer.content -> 'content', '[]'::jsonb));
  visible_count := case
    when full_access then item_count
    when item_count = 0 then 0
    else greatest(1, ceil(item_count * 0.2)::integer)
  end;
  card := public.cali_community_card_json(reviewer, account_id);

  return card || jsonb_build_object(
    'content', case when full_access then reviewer.content else public.cali_preview_reviewer_content(reviewer.content) end,
    'isFullContent', full_access,
    'visibleItemCount', visible_count,
    'totalItemCount', item_count,
    'isOwner', reviewer.user_id = account_id,
    'isSaved', exists (
      select 1 from public.reviewer_bookmarks bookmark
      where bookmark.user_id = account_id and bookmark.reviewer_id = reviewer.id
    ),
    'canCopy', reviewer.visibility = 'public' or exists (
      select 1 from public.reviewer_access_grants
      where reviewer_id = reviewer.id and grantee_id = account_id and access_type = 'copy' and status = 'active'
    ),
    'requestState', coalesce((
      select jsonb_build_object('id', id, 'type', access_type, 'status', status)
      from public.reviewer_access_requests
      where reviewer_id = reviewer.id and requester_id = account_id
      order by created_at desc limit 1
    ), 'null'::jsonb),
    'contributors', coalesce((
      select jsonb_agg(jsonb_build_object(
        'userId', contributor.contributor_user_id,
        'username', coalesce(student.username, contributor.contributor_username_snapshot),
        'avatarUrl', student.avatar_url
      ) order by contributor.position)
      from public.reviewer_contributors contributor
      left join public.students student on student.user_id = contributor.contributor_user_id
      where contributor.reviewer_id = reviewer.id
    ), '[]'::jsonb)
  );
end
$$;

revoke all on function public.cali_set_reviewer_saved(uuid, boolean), public.cali_list_saved_reviewers(integer) from public, anon;
grant execute on function public.cali_set_reviewer_saved(uuid, boolean), public.cali_list_saved_reviewers(integer) to authenticated;
