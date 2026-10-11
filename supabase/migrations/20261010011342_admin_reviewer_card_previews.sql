-- Supply a bounded document preview for the admin reviewer grid without
-- transferring every full reviewer body in the search response.
create or replace function public.cali_reviewer_card_preview(p_content jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object(
    'type', coalesce(p_content ->> 'type', 'doc'),
    'attrs', coalesce(p_content -> 'attrs', '{}'::jsonb),
    'content', coalesce((
      select jsonb_agg(entry.value order by entry.ordinality)
      from jsonb_array_elements(coalesce(p_content -> 'content', '[]'::jsonb))
        with ordinality as entry(value, ordinality)
      where entry.ordinality <= 8
    ), '[]'::jsonb)
  )
$$;

create or replace function public.cali_admin_search_community(
  p_query text default '',
  p_target_type text default 'all'
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  result jsonb;
begin
  if not public.cali_is_admin(actor) then
    raise exception 'Administrator access is required' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'reviewers', case when p_target_type = 'profile' then '[]'::jsonb else coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', item.id,
        'title', item.title,
        'username', item.username,
        'visibility', item.visibility,
        'hidden', item.hidden,
        'reason', item.reason,
        'previewContent', public.cali_reviewer_card_preview(item.content)
      ) order by item.updated_at desc)
      from (
        select r.id, r.title, s.username, r.visibility,
          r.moderated_at is not null as hidden,
          r.moderation_reason as reason,
          r.content,
          r.updated_at
        from public.reviewers r
        join public.students s on s.user_id = r.user_id
        where r.visibility in ('public', 'preview')
          and (
            btrim(coalesce(p_query, '')) = ''
            or r.title ilike '%' || btrim(p_query) || '%'
            or s.username ilike '%' || btrim(p_query) || '%'
          )
        order by r.updated_at desc
        limit 50
      ) item
    ), '[]'::jsonb) end,
    'profiles', case when p_target_type = 'reviewer' then '[]'::jsonb else coalesce((
      select jsonb_agg(jsonb_build_object(
        'userId', profile.user_id,
        'username', profile.username,
        'fullName', profile.full_name,
        'hidden', profile.community_hidden_at is not null,
        'suspended', profile.suspended_at is not null
      ))
      from (
        select * from public.students s
        where btrim(coalesce(p_query, '')) = ''
          or s.username ilike '%' || btrim(p_query) || '%'
          or coalesce(s.full_name, '') ilike '%' || btrim(p_query) || '%'
        limit 50
      ) profile
    ), '[]'::jsonb) end
  ) into result;
  return result;
end;
$$;

revoke all on function public.cali_reviewer_card_preview(jsonb) from public, anon, authenticated;
revoke all on function public.cali_admin_search_community(text, text) from public, anon;
grant execute on function public.cali_admin_search_community(text, text) to authenticated;
