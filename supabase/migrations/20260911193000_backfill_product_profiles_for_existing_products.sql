begin;

-- Keep Product Profiles authoritative, but make sure older Product ID records
-- that already have a capacity and current norm are represented there as well.
-- This fixes legacy products that predate the Product Profile source-of-truth
-- migration and therefore caused the 3rd OCR sequence to stop with
-- "Product Profile s normou a kapacitou".

do $$
declare
  r record;
  v_profile_id uuid;
  v_norm numeric;
  v_operation text;
  v_code_key text;
begin
  for r in
    select p.id, p.code, p.employees_per_product, p.variant_type
    from public.products p
    where nullif(trim(p.code), '') is not null
  loop
    v_code_key := regexp_replace(lower(trim(coalesce(r.code, ''))), '[^a-z0-9]', '', 'g');
    if v_code_key = '' then
      continue;
    end if;

    v_operation := case
      when upper(coalesce(r.variant_type, '')) = 'T' then 'TUP'
      when upper(trim(r.code)) ~ '^T[_-]' then 'TUP'
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

    if v_norm is null or r.employees_per_product is null or r.employees_per_product < 1 then
      continue;
    end if;

    select pp.id
      into v_profile_id
    from public.product_profiles pp
    where pp.valid_to is null
      and (
        regexp_replace(lower(trim(coalesce(pp.ha_subassy, ''))), '[^a-z0-9]', '', 'g') = v_code_key
        or regexp_replace(lower(trim(coalesce(pp.tup_subassy, ''))), '[^a-z0-9]', '', 'g') = v_code_key
      )
    order by pp.valid_from desc nulls last, pp.version_no desc nulls last, pp.created_at desc nulls last
    limit 1;

    if v_profile_id is null then
      if v_operation = 'TUP' then
        insert into public.product_profiles (
          profile_name,
          ha_subassy,
          h_capacity,
          h_norm_per_hour,
          tup_subassy,
          t_capacity,
          t_norm_per_hour,
          valid_from,
          valid_to,
          version_no
        ) values (
          r.code,
          null,
          null,
          null,
          r.code,
          r.employees_per_product,
          v_norm,
          current_date,
          null,
          1
        );
      else
        insert into public.product_profiles (
          profile_name,
          ha_subassy,
          h_capacity,
          h_norm_per_hour,
          tup_subassy,
          t_capacity,
          t_norm_per_hour,
          valid_from,
          valid_to,
          version_no
        ) values (
          r.code,
          r.code,
          r.employees_per_product,
          v_norm,
          null,
          null,
          null,
          current_date,
          null,
          1
        );
      end if;
    elsif v_operation = 'TUP' then
      update public.product_profiles
      set tup_subassy = case
            when regexp_replace(lower(trim(coalesce(tup_subassy, ''))), '[^a-z0-9]', '', 'g') = v_code_key then tup_subassy
            else r.code
          end,
          t_capacity = case
            when regexp_replace(lower(trim(coalesce(tup_subassy, ''))), '[^a-z0-9]', '', 'g') = v_code_key then coalesce(t_capacity, r.employees_per_product)
            else r.employees_per_product
          end,
          t_norm_per_hour = case
            when regexp_replace(lower(trim(coalesce(tup_subassy, ''))), '[^a-z0-9]', '', 'g') = v_code_key then coalesce(t_norm_per_hour, v_norm)
            else v_norm
          end
      where id = v_profile_id;
    else
      update public.product_profiles
      set ha_subassy = case
            when regexp_replace(lower(trim(coalesce(ha_subassy, ''))), '[^a-z0-9]', '', 'g') = v_code_key then ha_subassy
            else r.code
          end,
          h_capacity = case
            when regexp_replace(lower(trim(coalesce(ha_subassy, ''))), '[^a-z0-9]', '', 'g') = v_code_key then coalesce(h_capacity, r.employees_per_product)
            else r.employees_per_product
          end,
          h_norm_per_hour = case
            when regexp_replace(lower(trim(coalesce(ha_subassy, ''))), '[^a-z0-9]', '', 'g') = v_code_key then coalesce(h_norm_per_hour, v_norm)
            else v_norm
          end
      where id = v_profile_id;
    end if;
  end loop;
end $$;

notify pgrst, 'reload schema';
commit;
