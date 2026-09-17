-- Master Prompt Problem 7: a Product Profile may legitimately cover only
-- HA+TUP, only HA, or only TUP - a TUP-only product has no HA process at
-- all, and that absence must never be treated as an incomplete profile.
--
-- resolve_product_profile() computed profile_complete by requiring BOTH
-- ha_subassy and tup_subassy to be present with valid norm/capacity. Any
-- genuinely TUP-only (or HA-only) profile therefore could never be
-- "complete", permanently blocking it at approval via
-- compute_import_item_product_kpis()'s profile_complete gate - even though
-- nothing about the profile is actually wrong.
--
-- Fixed formula: complete requires at least one side present, and for each
-- side that IS present, that side's own norm/capacity must be valid. A side
-- that is genuinely absent (subassy code null) is never counted against
-- completeness.
create or replace function public.resolve_product_profile(
  p_code text,
  p_work_date date default current_date,
  p_allow_fallback boolean default true
)
returns table (
  product_id uuid,
  product_code text,
  product_name text,
  profile_id uuid,
  profile_ha_subassy text,
  profile_tup_subassy text,
  h_norm_per_hour numeric,
  h_capacity numeric,
  t_norm_per_hour numeric,
  t_capacity numeric,
  profile_complete boolean,
  match_source text
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_code text := nullif(trim(p_code), '');
  v_norm text;
  v_product record;
  v_profile record;
  v_base_code text;
  v_fallback record;
begin
  if v_code is null then
    return;
  end if;
  v_norm := lower(regexp_replace(v_code, '\s+', '', 'g'));

  select p.id, p.code, p.name into v_product
  from public.products p
  where lower(regexp_replace(trim(p.code), '\s+', '', 'g')) = v_norm
    and coalesce(p.active, true)
  limit 1;

  select pp.* into v_profile
  from public.product_profiles pp
  where pp.valid_from <= p_work_date
    and (pp.valid_to is null or pp.valid_to >= p_work_date)
    and (
      lower(regexp_replace(trim(pp.ha_subassy), '\s+', '', 'g')) = v_norm
      or lower(regexp_replace(trim(pp.tup_subassy), '\s+', '', 'g')) = v_norm
    )
  order by pp.valid_to is null desc, pp.valid_from desc, pp.version_no desc
  limit 1;

  if v_product.id is not null and v_profile.id is not null then
    return query select v_product.id, v_product.code, v_product.name, v_profile.id,
      v_profile.ha_subassy, v_profile.tup_subassy, v_profile.h_norm_per_hour, v_profile.h_capacity,
      v_profile.t_norm_per_hour, v_profile.t_capacity,
      (
        (v_profile.ha_subassy is not null or v_profile.tup_subassy is not null)
        and (v_profile.ha_subassy is null or (v_profile.h_norm_per_hour > 0 and v_profile.h_capacity >= 1))
        and (v_profile.tup_subassy is null or (v_profile.t_norm_per_hour > 0 and v_profile.t_capacity >= 1))
      ),
      'EXACT'::text;
    return;
  end if;

  if v_product.id is not null and v_profile.id is null then
    return query select v_product.id, v_product.code, v_product.name,
      null::uuid, null::text, null::text, null::numeric, null::numeric, null::numeric, null::numeric,
      false, 'EXACT_NO_PROFILE'::text;
    return;
  end if;

  if v_product.id is null and v_profile.id is not null then
    return query select null::uuid, null::text, null::text, v_profile.id,
      v_profile.ha_subassy, v_profile.tup_subassy, v_profile.h_norm_per_hour, v_profile.h_capacity,
      v_profile.t_norm_per_hour, v_profile.t_capacity,
      (
        (v_profile.ha_subassy is not null or v_profile.tup_subassy is not null)
        and (v_profile.ha_subassy is null or (v_profile.h_norm_per_hour > 0 and v_profile.h_capacity >= 1))
        and (v_profile.tup_subassy is null or (v_profile.t_norm_per_hour > 0 and v_profile.t_capacity >= 1))
      ),
      'PROFILE_NO_PRODUCT'::text;
    return;
  end if;

  if p_allow_fallback and v_code ~ '[A-Za-z]{1,3}$' then
    v_base_code := regexp_replace(v_code, '[A-Za-z]{1,3}$', '');
    if v_base_code <> '' and lower(v_base_code) <> v_norm then
      select * into v_fallback from public.resolve_product_profile(v_base_code, p_work_date, false) limit 1;
      if found then
        return query select v_fallback.product_id, v_fallback.product_code, v_fallback.product_name,
          v_fallback.profile_id, v_fallback.profile_ha_subassy, v_fallback.profile_tup_subassy,
          v_fallback.h_norm_per_hour, v_fallback.h_capacity, v_fallback.t_norm_per_hour, v_fallback.t_capacity,
          v_fallback.profile_complete, 'SUFFIX_FALLBACK'::text;
        return;
      end if;
    end if;
  end if;

  return;
end;
$$;

grant execute on function public.resolve_product_profile(text, date, boolean) to authenticated;
