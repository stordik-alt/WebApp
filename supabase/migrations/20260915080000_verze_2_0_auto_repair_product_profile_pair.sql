begin;

-- Repair Product Profiles that exist only for one side (typically TUP) or
-- were never materialized from the H/T family.  The import validator requires
-- a complete H/T pair, so use the canonical product_families relation and the
-- best available legacy norms to complete the active profile.
do $$
declare
  f record;
  h record;
  t record;
  pp record;
  v_h_norm numeric;
  v_t_norm numeric;
  v_profile_id uuid;
  v_version integer;
begin
  for f in
    select pf.id, pf.name, pf.h_product_id, pf.t_product_id
    from public.product_families pf
    where pf.h_product_id is not null
      and pf.t_product_id is not null
  loop
    select id, code, employees_per_product
      into h
    from public.products
    where id = f.h_product_id;

    select id, code, employees_per_product
      into t
    from public.products
    where id = f.t_product_id;

    if h.id is null or t.id is null then
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
      set profile_name = coalesce(pp.profile_name, f.name, h.code),
          ha_subassy = coalesce(nullif(trim(pp.ha_subassy), ''), h.code),
          h_capacity = coalesce(pp.h_capacity, h.employees_per_product, 1),
          h_norm_per_hour = coalesce(pp.h_norm_per_hour, v_h_norm),
          tup_subassy = coalesce(nullif(trim(pp.tup_subassy), ''), t.code),
          t_capacity = coalesce(pp.t_capacity, t.employees_per_product, 1),
          t_norm_per_hour = coalesce(pp.t_norm_per_hour, v_t_norm)
      where id = pp.id;
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
        coalesce(f.name, h.code), h.code, greatest(coalesce(h.employees_per_product, 1), 1), v_h_norm,
        t.code, greatest(coalesce(t.employees_per_product, 1), 1), v_t_norm,
        current_date, null, greatest(v_version, 1)
      );
    end if;
  end loop;
end $$;

notify pgrst, 'reload schema';
commit;
