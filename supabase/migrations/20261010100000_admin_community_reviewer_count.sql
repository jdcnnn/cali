-- Return the exact matching reviewer total separately from the bounded preview
-- page so the admin UI never presents the result-array length as a total.
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
    'reviewerCount', case when p_target_type = 'profile' then 0 else (
      select count(*)
      from public.reviewers r
      join public.students s on s.user_id = r.user_id
      where r.visibility in ('public', 'preview')
        and (
          btrim(coalesce(p_query, '')) = ''
          or r.title ilike '%' || btrim(p_query) || '%'
          or s.username ilike '%' || btrim(p_query) || '%'
        )
    ) end,
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
    'profiles', '[]'::jsonb
  ) into result;
  return result;
end;
$$;

revoke all on function public.cali_admin_search_community(text, text) from public, anon;
grant execute on function public.cali_admin_search_community(text, text) to authenticated;
