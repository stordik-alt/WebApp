begin;

-- Final repair path: do not depend on product_families being populated.
-- Products already carry family_id/variant_type, so reconstruct the H/T pair
-- directly for any imported product code that has no usable active profile.
do $$
declare
  t record;
  h record;
  pp record;
  v_h_norm numeric;
  v_t_norm numeric;
  v_profile_id uuid;
  v_version integer;
begin
  for t in
    select p.id, p.code, p.family_id, p.employees_per_product
    from public.products p
    where upper(coalesce(p.variant_type, '')) = 'T'
      and nullif(trim(p.code), '') is not null
  loop
    if t.family_id is null then
      continue;
    end if;

    select p.id, p.code, p.employees_per_product into h
    from public.products p
    where p.family_id = t.family_id
      and upper(coalesce(p.variant_type, '')) = 'H'
    order by p.created_at asc
    limit 1;

    if h.id is null then
      continue;
    end if;

    select pn.norm_per_hour into v_h_norm
    from public.product_norms pn
    where pn.product_id = h.id
      and pn.operation = 'HA'
      and pn.norm_per_hour is not null
      and pn.norm_per_hour > 0
    order by
      case when pn.valid_from <= current_date and (pn.valid_to is null or pn.valid_to >= current_date) then 0 else 1 end,
      pn.valid_from desc nulls last,
      pn.created_at desc nulls last
    limit 1;

    select pn.norm_per_hour into v_t_norm
    from public.product_norms pn
    where pn.product_id = t.id
      and pn.operation = 'TUP'
      and pn.norm_per_hour is not null
      and pn.norm_per_hour > 0
    order by
      case when pn.valid_from <= current_date and (pn.valid_to is null or pn.valid_to >= current_date) then 0 else 1 end,
      pn.valid_from desc nulls last,
      pn.created_at desc nulls last
    limit 1;

    if v_h_norm is null or v_t_norm is null then
      continue;
    end if;

    select * into pp
    from public.product_profiles p
    where p.valid_to is null
      and (
        lower(regexp_replace(coalesce(p.ha_subassy, ''), '\\s+', '', 'g')) = lower(regexp_replace(h.code, '\\s+', '', 'g'))
        or lower(regexp_replace(coalesce(p.tup_subassy, ''), '\\s+', '', 'g')) = lower(regexp_replace(t.code, '\\s+', '', 'g'))
      )
    order by p.valid_from desc nulls last, p.version_no desc nulls last, p.created_at desc nulls last
    limit 1;

    if pp.id is not null then
      update public.product_profiles
      set profile_name = coalesce(pp.profile_name, t.code),
          ha_subassy = h.code,
          h_capacity = greatest(coalesce(pp.h_capacity, h.employees_per_product, 1), 1),
          h_norm_per_hour = coalesce(pp.h_norm_per_hour, v_h_norm),
          tup_subassy = t.code,
          t_capacity = greatest(coalesce(pp.t_capacity, t.employees_per_product, 1), 1),
          t_norm_per_hour = coalesce(pp.t_norm_per_hour, v_t_norm)
      where id = pp.id;
      v_profile_id := pp.id;
    else
      select coalesce(max(p.version_no), 0) + 1 into v_version
      from public.product_profiles p
      where lower(regexp_replace(coalesce(p.ha_subassy, ''), '\\s+', '', 'g')) = lower(regexp_replace(h.code, '\\s+', '', 'g'))
         or lower(regexp_replace(coalesce(p.tup_subassy, ''), '\\s+', '', 'g')) = lower(regexp_replace(t.code, '\\s+', '', 'g'));

      insert into public.product_profiles (
        profile_name, ha_subassy, h_capacity, h_norm_per_hour,
        tup_subassy, t_capacity, t_norm_per_hour,
        valid_from, valid_to, version_no
      ) values (
        coalesce(t.code, h.code), h.code, greatest(coalesce(h.employees_per_product, 1), 1), v_h_norm,
        t.code, greatest(coalesce(t.employees_per_product, 1), 1), v_t_norm,
        current_date, null, greatest(v_version, 1)
      ) returning id into v_profile_id;
    end if;
  end loop;
end $$;

notify pgrst, 'reload schema';
commit;
