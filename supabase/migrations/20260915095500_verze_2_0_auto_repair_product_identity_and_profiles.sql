-- Verze 2.0 AUTO
-- Repair OCR product identity from the authoritative hourly product column.
-- A workplace/line label (e.g. 041.01 - HandAssy, 050.13 - TouchUp) must never
-- become import_items.product_code.
-- Product Profiles are resolved historically by work_date, not only by valid_to IS NULL.
-- Multiple products in one screenshot remain represented in import_item_hourly;
-- import_items.product_code is only the primary/first detected product for the header.

create or replace function public.repair_import_item_product_identity(p_import_item_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item public.import_items%rowtype;
  v_current_product_id uuid;
  v_current_is_valid boolean := false;
  v_primary_code text;
  v_primary_name text;
  v_primary_id uuid;
  v_distinct_count integer := 0;
  v_profile_count integer := 0;
  v_missing_profile_count integer := 0;
  v_detected jsonb := '[]'::jsonb;
  v_profile_status text := 'MISSING';
begin
  select * into v_item
  from public.import_items
  where id = p_import_item_id;

  if not found then
    return;
  end if;

  -- First trust actual product codes already extracted from the hourly table.
  -- Ignore nulls and obvious workplace/header labels by requiring a real products row.
  select count(*) into v_distinct_count
  from (
    select distinct lower(regexp_replace(trim(h.product_code), '\s+', '', 'g')) as code
    from public.import_item_hourly h
    join public.products p
      on lower(regexp_replace(trim(p.code), '\s+', '', 'g')) = lower(regexp_replace(trim(h.product_code), '\s+', '', 'g'))
    where h.import_item_id = p_import_item_id
      and nullif(trim(h.product_code), '') is not null
  ) x;

  if v_distinct_count > 0 then
    select p.code, p.name, p.id
      into v_primary_code, v_primary_name, v_primary_id
    from public.import_item_hourly h
    join public.products p
      on lower(regexp_replace(trim(p.code), '\s+', '', 'g')) = lower(regexp_replace(trim(h.product_code), '\s+', '', 'g'))
    where h.import_item_id = p_import_item_id
      and nullif(trim(h.product_code), '') is not null
    order by h.hour asc, h.id asc
    limit 1;

    select coalesce(jsonb_agg(x.code order by x.first_hour, x.code), '[]'::jsonb)
      into v_detected
    from (
      select p.code, min(h.hour) as first_hour
      from public.import_item_hourly h
      join public.products p
        on lower(regexp_replace(trim(p.code), '\s+', '', 'g')) = lower(regexp_replace(trim(h.product_code), '\s+', '', 'g'))
      where h.import_item_id = p_import_item_id
        and nullif(trim(h.product_code), '') is not null
      group by p.code
    ) x;
  end if;

  -- If hourly data has no resolvable product yet, keep a valid existing header product.
  if v_primary_code is null and nullif(trim(v_item.product_code), '') is not null then
    select p.id, p.code, p.name
      into v_primary_id, v_primary_code, v_primary_name
    from public.products p
    where lower(regexp_replace(trim(p.code), '\s+', '', 'g')) = lower(regexp_replace(trim(v_item.product_code), '\s+', '', 'g'))
    limit 1;

    if v_primary_code is not null then
      v_detected := jsonb_build_array(v_primary_code);
    end if;
  end if;

  if v_primary_code is not null then
    -- Historical profile lookup: valid_from/valid_to must contain the import date.
    -- For a multi-product screenshot every detected product must have a complete profile.
    select count(*) into v_profile_count
    from (
      select distinct p.code
      from public.import_item_hourly h
      join public.products p
        on lower(regexp_replace(trim(p.code), '\s+', '', 'g')) = lower(regexp_replace(trim(h.product_code), '\s+', '', 'g'))
      where h.import_item_id = p_import_item_id
        and nullif(trim(h.product_code), '') is not null
      union
      select v_primary_code
    ) products_seen
    join lateral (
      select pp.id, pp.h_norm_per_hour, pp.h_capacity, pp.t_norm_per_hour, pp.t_capacity
      from public.product_profiles pp
      where (
        lower(regexp_replace(coalesce(pp.ha_subassy, ''), '\s+', '', 'g')) = lower(regexp_replace(products_seen.code, '\s+', '', 'g'))
        or lower(regexp_replace(coalesce(pp.tup_subassy, ''), '\s+', '', 'g')) = lower(regexp_replace(products_seen.code, '\s+', '', 'g'))
      )
      and (v_item.work_date is null or pp.valid_from is null or pp.valid_from <= v_item.work_date)
      and (v_item.work_date is null or pp.valid_to is null or pp.valid_to >= v_item.work_date)
      and pp.h_norm_per_hour > 0
      and pp.h_capacity >= 1
      and pp.t_norm_per_hour > 0
      and pp.t_capacity >= 1
      order by pp.valid_to is null desc, pp.valid_from desc nulls last, pp.version_no desc nulls last
      limit 1
    ) profile on true;

    select count(*) into v_missing_profile_count
    from (
      select distinct p.code
      from public.import_item_hourly h
      join public.products p
        on lower(regexp_replace(trim(p.code), '\s+', '', 'g')) = lower(regexp_replace(trim(h.product_code), '\s+', '', 'g'))
      where h.import_item_id = p_import_item_id
        and nullif(trim(h.product_code), '') is not null
      union
      select v_primary_code
    ) products_seen
    where not exists (
      select 1
      from public.product_profiles pp
      where (
        lower(regexp_replace(coalesce(pp.ha_subassy, ''), '\s+', '', 'g')) = lower(regexp_replace(products_seen.code, '\s+', '', 'g'))
        or lower(regexp_replace(coalesce(pp.tup_subassy, ''), '\s+', '', 'g')) = lower(regexp_replace(products_seen.code, '\s+', '', 'g'))
      )
      and (v_item.work_date is null or pp.valid_from is null or pp.valid_from <= v_item.work_date)
      and (v_item.work_date is null or pp.valid_to is null or pp.valid_to >= v_item.work_date)
      and pp.h_norm_per_hour > 0
      and pp.h_capacity >= 1
      and pp.t_norm_per_hour > 0
      and pp.t_capacity >= 1
    );

    if v_missing_profile_count = 0 then
      v_profile_status := 'VALID';
    elsif v_profile_count > 0 then
      v_profile_status := 'INCOMPLETE';
    else
      v_profile_status := 'MISSING';
    end if;

    update public.import_items
    set product_code = v_primary_code,
        product_name = v_primary_name,
        product_id = v_primary_id,
        product_match_status = 'EXACT',
        product_profile_status = v_profile_status,
        ocr_data = coalesce(ocr_data, '{}'::jsonb) || jsonb_build_object(
          'resolved_product_code', v_primary_code,
          'detected_product_codes', v_detected,
          'product_identity_model_version', '2.0-AUTO-product-identity-v1'
        )
    where id = p_import_item_id;
  end if;
end;
$$;

grant execute on function public.repair_import_item_product_identity(uuid) to authenticated;

create or replace function public.repair_import_item_product_identity_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if pg_trigger_depth() > 1 then
    return new;
  end if;
  if new.status = 'VALIDATING' then
    perform public.repair_import_item_product_identity(new.id);
  end if;
  return new;
end;
$$;

grant execute on function public.repair_import_item_product_identity_trigger() to authenticated;

drop trigger if exists trg_import_items_repair_product_identity on public.import_items;
create trigger trg_import_items_repair_product_identity
after update on public.import_items
for each row
when (new.status = 'VALIDATING')
execute function public.repair_import_item_product_identity_trigger();

-- Backfill existing imports affected by OCR workplace/header confusion or historical profiles.
do $$
declare
  r record;
begin
  for r in
    select id
    from public.import_items
    where status in ('VALIDATING','PENDING_APPROVAL','AUTO_APPROVED','APPROVED')
  loop
    perform public.repair_import_item_product_identity(r.id);
  end loop;
end $$;

-- Rebuild only stale product/profile blockers after the identity repair.
-- Employee/KPI/shift blockers are intentionally preserved.
update public.import_items i
set pending_reasons = coalesce((
  select jsonb_agg(reason order by ord)
  from jsonb_array_elements_text(coalesce(i.pending_reasons, '[]'::jsonb)) with ordinality as x(reason, ord)
  where reason not in ('PRODUCT_NOT_FOUND','PRODUCT_PROFILE_MISSING','PRODUCT_PROFILE_INCOMPLETE')
), '[]'::jsonb)
where i.status = 'PENDING_APPROVAL'
  and i.product_id is not null
  and i.product_profile_status = 'VALID';
