begin;

-- Some products are variants inside an existing H/T family.  The authoritative
-- Product Profile is keyed by the family pair, while the import validator also
-- needs to resolve the concrete imported product code.  Create a lightweight
-- active profile alias for such a concrete product instead of mutating the
-- existing family profile (which can violate product_profiles_active_ha_tup_unique_idx).
do $$
declare
  i record;
  p record;
  f record;
  base_pp record;
  v_norm numeric;
  v_capacity integer;
  v_existing uuid;
  v_version integer;
begin
  for i in
    select id, product_id, product_code, work_date
    from public.import_items
    where product_profile_status = 'MISSING'
      and product_id is not null
      and product_code is not null
  loop
    select id, code, family_id, variant_type, employees_per_product
      into p
    from public.products
    where id = i.product_id;

    if p.id is null or p.family_id is null then
      continue;
    end if;

    select id, h_product_id, t_product_id
      into f
    from public.product_families
    where id = p.family_id;

    if f.id is null then
      continue;
    end if;

    select * into base_pp
    from public.product_profiles
    where id = f.id
      and valid_to is null
    order by valid_from desc nulls last, version_no desc nulls last
    limit 1;

    if base_pp.id is null then
      continue;
    end if;

    if upper(coalesce(p.variant_type, '')) = 'T' then
      select pn.norm_per_hour into v_norm
      from public.product_norms pn
      where pn.product_id = p.id
        and pn.operation = 'TUP'
        and pn.valid_from <= coalesce(i.work_date, current_date)
        and (pn.valid_to is null or pn.valid_to >= coalesce(i.work_date, current_date))
        and pn.norm_per_hour > 0
      order by pn.valid_from desc, pn.created_at desc
      limit 1;

      if v_norm is null then
        v_norm := base_pp.t_norm_per_hour;
      end if;
      v_capacity := greatest(coalesce(p.employees_per_product, base_pp.t_capacity, 1), 1);

      select id into v_existing
      from public.product_profiles
      where valid_to is null
        and lower(regexp_replace(coalesce(ha_subassy, ''), '\s+', '', 'g')) = lower(regexp_replace(coalesce(base_pp.ha_subassy, ''), '\s+', '', 'g'))
        and lower(regexp_replace(coalesce(tup_subassy, ''), '\s+', '', 'g')) = lower(regexp_replace(coalesce(p.code, ''), '\s+', '', 'g'))
      limit 1;

      if v_existing is null then
        select coalesce(max(version_no), 0) + 1 into v_version
        from public.product_profiles
        where lower(regexp_replace(coalesce(ha_subassy, ''), '\s+', '', 'g')) = lower(regexp_replace(coalesce(base_pp.ha_subassy, ''), '\s+', '', 'g'));

        insert into public.product_profiles (
          profile_name, ha_subassy, h_capacity, h_norm_per_hour,
          tup_subassy, t_capacity, t_norm_per_hour,
          valid_from, valid_to, version_no
        ) values (
          coalesce(base_pp.profile_name, p.code),
          base_pp.ha_subassy,
          base_pp.h_capacity,
          base_pp.h_norm_per_hour,
          p.code,
          v_capacity,
          v_norm,
          coalesce(i.work_date, current_date),
          null,
          greatest(v_version, 1)
        );
      end if;

    elsif upper(coalesce(p.variant_type, '')) = 'H' then
      select pn.norm_per_hour into v_norm
      from public.product_norms pn
      where pn.product_id = p.id
        and pn.operation = 'HA'
        and pn.valid_from <= coalesce(i.work_date, current_date)
        and (pn.valid_to is null or pn.valid_to >= coalesce(i.work_date, current_date))
        and pn.norm_per_hour > 0
      order by pn.valid_from desc, pn.created_at desc
      limit 1;

      if v_norm is null then
        v_norm := base_pp.h_norm_per_hour;
      end if;
      v_capacity := greatest(coalesce(p.employees_per_product, base_pp.h_capacity, 1), 1);

      select id into v_existing
      from public.product_profiles
      where valid_to is null
        and lower(regexp_replace(coalesce(ha_subassy, ''), '\s+', '', 'g')) = lower(regexp_replace(coalesce(p.code, ''), '\s+', '', 'g'))
        and lower(regexp_replace(coalesce(tup_subassy, ''), '\s+', '', 'g')) = lower(regexp_replace(coalesce(base_pp.tup_subassy, ''), '\s+', '', 'g'))
      limit 1;

      if v_existing is null then
        select coalesce(max(version_no), 0) + 1 into v_version
        from public.product_profiles
        where lower(regexp_replace(coalesce(tup_subassy, ''), '\s+', '', 'g')) = lower(regexp_replace(coalesce(base_pp.tup_subassy, ''), '\s+', '', 'g'));

        insert into public.product_profiles (
          profile_name, ha_subassy, h_capacity, h_norm_per_hour,
          tup_subassy, t_capacity, t_norm_per_hour,
          valid_from, valid_to, version_no
        ) values (
          coalesce(base_pp.profile_name, p.code),
          p.code,
          v_capacity,
          v_norm,
          base_pp.tup_subassy,
          base_pp.t_capacity,
          base_pp.t_norm_per_hour,
          coalesce(i.work_date, current_date),
          null,
          greatest(v_version, 1)
        );
      end if;
    end if;
  end loop;
end $$;

notify pgrst, 'reload schema';
commit;
