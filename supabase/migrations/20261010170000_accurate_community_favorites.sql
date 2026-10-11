-- Community Favorites represents positive student favorites, not net sentiment.
-- Weekly use breaks equal-like ties so the order matches the signals shown in UI.
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
      coalesce((select count(*) from public.reviewer_votes v where v.reviewer_id=r.id and v.value=1),0)::integer upvotes,
      coalesce((select count(*) from public.reviewer_votes v where v.reviewer_id=r.id and v.value=-1),0)::integer downvotes,
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
      case when p_sort='top' then upvotes end desc nulls last,
      case when p_sort='top' then usage_7d end desc nulls last,
      case when p_sort='top' then downvotes end asc nulls last,
      case when p_sort in ('trending','most_used') then usage_7d end desc nulls last,
      case when p_sort='relevance' and btrim(coalesce(p_query,''))<>'' then case when lower(title) like lower(btrim(p_query))||'%' then 2 else 1 end end desc nulls last,
      published_at desc,id) result_order
    from filtered order by
      case when p_sort='top' then upvotes end desc nulls last,
      case when p_sort='top' then usage_7d end desc nulls last,
      case when p_sort='top' then downvotes end asc nulls last,
      case when p_sort in ('trending','most_used') then usage_7d end desc nulls last,
      published_at desc,id limit least(greatest(coalesce(p_limit,36),1),48)
  )
  select coalesce(jsonb_agg(public.cali_community_card_json(r,account_id) order by o.result_order),'[]'::jsonb) into result
  from ordered o join public.reviewers r on r.id=o.id;
  return result;
end $$;

-- Return authoritative positive and negative counts with the caller's vote so
-- optimistic UI can reconcile without an additional read request.
create or replace function public.cali_vote_community_reviewer(p_reviewer_id uuid, p_value integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  account_id uuid := (select auth.uid());
  reviewer public.reviewers;
  vote_totals record;
begin
  if account_id is null or not public.cali_is_eligible_user() then raise exception 'Authentication is required' using errcode = '42501'; end if;
  if p_value not in (-1, 0, 1) then raise exception 'Invalid vote' using errcode = '22023'; end if;
  select r.* into reviewer
  from public.reviewers r join public.students s on s.user_id=r.user_id
  where r.id=p_reviewer_id and r.visibility in ('public','preview') and r.moderated_at is null and s.community_hidden_at is null and s.suspended_at is null;
  if reviewer.id is null or reviewer.user_id=account_id then raise exception 'This reviewer cannot be voted on' using errcode = 'P0001'; end if;

  if p_value=0 then
    delete from public.reviewer_votes where reviewer_id=reviewer.id and user_id=account_id;
  else
    insert into public.reviewer_votes(reviewer_id,user_id,value) values(reviewer.id,account_id,p_value)
    on conflict (reviewer_id,user_id) do update set value=excluded.value,updated_at=now();
  end if;

  select coalesce(sum(value),0)::integer net_votes,
    count(*) filter (where value=1)::integer upvotes,
    count(*) filter (where value=-1)::integer downvotes
  into vote_totals from public.reviewer_votes where reviewer_id=reviewer.id;

  return jsonb_build_object(
    'userVote',p_value,
    'netVotes',vote_totals.net_votes,
    'upvotes',vote_totals.upvotes,
    'downvotes',vote_totals.downvotes
  );
end $$;

revoke all on function public.cali_search_community_reviewers(text,text,text,integer,text,text,text,integer), public.cali_vote_community_reviewer(uuid,integer) from public,anon;
grant execute on function public.cali_search_community_reviewers(text,text,text,integer,text,text,text,integer), public.cali_vote_community_reviewer(uuid,integer) to authenticated;
