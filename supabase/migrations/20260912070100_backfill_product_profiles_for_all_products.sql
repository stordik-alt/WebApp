begin;

-- Every Product ID must have a Product Profile, even when the legacy data is
-- missing a confirmed norm. Missing norms remain NULL and therefore cannot be
-- used for OCR/daily OEE until an administrator confirms them.
do $$
declare
  r record;
  v_operation text;
  v_existing_id uuid;
  v_norm numeric;
  v_code_key text;
begin
  for r in
    select p.id, p.code, p.employees_per_product, p.variant_type
    from public.products p
    where nullif(trim(p.code), '') is not null
  loop
    v_code_key := regexp_replace(lower(trim(r.code)), '[^a-z0-9]', '', 'g');
    v_operation := case
      when upper(coalesce(r.variant_type, '')) = 'T' or upper(trim(r.code)) ~ '^T[_-]' then 'TUP'
      else 'HA'
    end;

    select pn.norm_per_hour
      into v_norm
    from public.product_norms pn
    where pn.product_id = r.id
      and pn.operation = v_operation
      and pn.norm_per_hour is not null
      and pn.norm_per_hour > 0
      and pn.valid_from <= current_date
      and (pn.valid_to is null or pn.valid_to >= current_date)
    order by pn.valid_from desc nulls last, pn.created_at desc nulls last
    limit 1;

    select pp.id
      into v_existing_id
    from public.product_profiles pp
    where pp.valid_to is null
      and (
        regexp_replace(lower(trim(coalesce(pp.ha_subassy, ''))), '[^a-z0-9]', '', 'g') = v_code_key
        or regexp_replace(lower(trim(coalesce(pp.tup_subassy, ''))), '[^a-z0-9]', '', 'g') = v_code_key
      )
    order by pp.valid_from desc nulls last, pp.version_no desc nulls last, pp.created_at desc nulls last
    limit 1;

    if v_existing_id is null then
      if v_operation = 'TUP' then
        insert into public.product_profiles (
          profile_name, ha_subassy, h_capacity, h_norm_per_hour,
          tup_subassy, t_capacity, t_norm_per_hour,
          valid_from, valid_to, version_no
        ) values (
          r.code, null, null, null,
          r.code, r.employees_per_product, v_norm,
          current_date, null, 1
        );
      else
        insert into public.product_profiles (
          profile_name, ha_subassy, h_capacity, h_norm_per_hour,
          tup_subassy, t_capacity, t_norm_per_hour,
          valid_from, valid_to, version_no
        ) values (
          r.code, r.code, r.employees_per_product, v_norm,
          null, null, null,
          current_date, null, 1
        );
      end if;
    end if;
  end loop;
end $$;

notify pgrst, 'reload schema';
commit;
