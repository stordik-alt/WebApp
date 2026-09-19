-- Master Prompt "OPRAVA VÝPOČTŮ CLASSIC OEE + HA -> TUP ALOKACE" bod 1.12:
-- apply_ha_tup_capping() recomputed OEE as performance_pct * availability_pct
-- directly, ignoring the double-counting protection reconstruct_import_item_hourly()
-- already applies and records in raw_data.calculation.availability_applied_to_oee
-- (which is forced to 100 - i.e. excluded from OEE - whenever an hour's
-- productive minutes are themselves derived from measured activity, source
-- TEFF_FROM_OCR_NORM; see 20260917230000_fix_teff_availability_double_count.sql).
--
-- Confirmed live on real data before changing anything: import_item_hourly
-- row 88769263-0dcd-45b5-ac3d-f9e707ad4cba (T_S4962V3538, hour 10) - the
-- exact scenario from Master Prompt section 1.6 (Výkon 139.02%, Dostupnost
-- 41.11%) - had availability_applied_to_oee=100 (correctly excluded by
-- reconstruct_import_item_hourly) but a stored actual_oee_pct of 57.15%,
-- which is exactly performance_pct * availability_pct / 100 (139.02 * 41.11
-- / 100) - proof HA->TUP capping silently reintroduced the double-counted
-- availability after the hourly reconstruction had already excluded it.
--
-- Fix: read availability_applied_to_oee from the hour's own calculation
-- audit trail (falling back to the raw availability_pct column for older
-- rows that predate that field) instead of re-deriving/ignoring that
-- decision here, so HA->TUP capping's OEE recompute always agrees with
-- reconstruct_import_item_hourly's own double-counting protection.
create or replace function public.apply_ha_tup_capping(
  p_tup_import_item_id uuid,
  p_tup_product_code text,
  p_allocation_fraction numeric default 1.0
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item public.import_items%rowtype;
  v_link record;
  v_shift_start_hour integer;
  r record;
  v_cum_ha numeric;
  v_allocated_ha numeric;
  v_expected_before numeric;
  v_expected_after numeric;
  v_perf_new numeric;
  v_oee_new numeric;
  v_updated integer := 0;
  v_product record;
begin
  select * into v_item from public.import_items where id = p_tup_import_item_id;
  if not found or v_item.work_date is null or nullif(trim(coalesce(v_item.shift,'')),'') is null or nullif(trim(coalesce(v_item.line,'')),'') is null then
    return jsonb_build_object('status', 'SKIPPED', 'reason', 'missing_header');
  end if;

  select * into v_link from public.find_ha_tup_link(p_tup_product_code, v_item.line, v_item.work_date, v_item.shift) limit 1;

  if v_link.match_status is distinct from 'LINKED' then
    return jsonb_build_object('status', coalesce(v_link.match_status, 'NONE'));
  end if;

  v_shift_start_hour := public.auto_shift_start_minute(v_item.shift) / 60;

  for r in
    select h.id, h.hour, h.actual_output,
      nullif(trim(coalesce(h.raw_data -> 'calculation' ->> 'expected_output_at_current_staffing', '')), '')::numeric as expected,
      h.availability_pct,
      coalesce(
        nullif(trim(coalesce(h.raw_data -> 'calculation' ->> 'availability_applied_to_oee', '')), '')::numeric,
        h.availability_pct
      ) as availability_for_oee,
      ((h.hour - v_shift_start_hour + 24) % 24) as rel_hour
    from public.import_item_hourly h
    where h.import_item_id = p_tup_import_item_id
      and public.codes_match(
            lower(regexp_replace(coalesce(h.product_code, ''), '\s+', '', 'g')),
            lower(regexp_replace(p_tup_product_code, '\s+', '', 'g'))
          )
    order by ((h.hour - v_shift_start_hour + 24) % 24)
  loop
    select coalesce(sum(h2.actual_output), 0)
    into v_cum_ha
    from public.import_item_hourly h2
    where h2.import_item_id = v_link.ha_import_item_id
      and public.codes_match(
            lower(regexp_replace(coalesce(h2.product_code, ''), '\s+', '', 'g')),
            lower(regexp_replace(v_link.ha_product_code, '\s+', '', 'g'))
          )
      and ((h2.hour - v_shift_start_hour + 24) % 24) <= r.rel_hour;

    v_allocated_ha := v_cum_ha * p_allocation_fraction;

    v_expected_before := r.expected;
    if v_expected_before is null or v_expected_before <= 0 then
      continue;
    end if;

    v_expected_after := least(v_expected_before, v_allocated_ha);
    if v_expected_after <= 0 then
      v_perf_new := null;
    elsif r.actual_output is not null then
      v_perf_new := r.actual_output / v_expected_after * 100;
    else
      v_perf_new := null;
    end if;
    v_oee_new := case when v_perf_new is not null and r.availability_for_oee is not null then v_perf_new * r.availability_for_oee / 100 else null end;

    update public.import_item_hourly
    set performance_pct = coalesce(v_perf_new, performance_pct),
        actual_oee_pct = coalesce(v_oee_new, actual_oee_pct),
        raw_data = coalesce(raw_data, '{}'::jsonb) || jsonb_build_object(
          'calculation', coalesce(raw_data -> 'calculation', '{}'::jsonb) || jsonb_build_object(
            'ha_tup_linkage', jsonb_build_object(
              'linked_ha_import_item_id', v_link.ha_import_item_id,
              'ha_product_code', v_link.ha_product_code,
              'ha_cumulative_available', v_cum_ha,
              'allocation_fraction', p_allocation_fraction,
              'ha_allocated_available', v_allocated_ha,
              'expected_before_cap', v_expected_before,
              'expected_after_cap', v_expected_after,
              'capped', v_expected_after < v_expected_before
            )
          )
        )
    where id = r.id;
    v_updated := v_updated + 1;
  end loop;

  if v_updated = 0 then
    return jsonb_build_object('status', 'NO_HOURS');
  end if;

  select * into v_product
  from public.compute_import_item_product_kpis(p_tup_import_item_id, v_item.work_date) x
  where public.codes_match(
          lower(regexp_replace(x.product_code, '\s+', '', 'g')),
          lower(regexp_replace(p_tup_product_code, '\s+', '', 'g'))
        )
  limit 1;

  if found and v_product.product_id is not null then
    update public.daily_records
    set oee = round(v_product.oee, 2), performance = round(v_product.performance, 2), available_time = round(v_product.availability, 2)
    where import_batch_id = v_item.batch_id
      and work_date = v_item.work_date
      and shift = v_item.shift
      and line = v_item.line
      and product_id = v_product.product_id;
  end if;

  return jsonb_build_object('status', 'APPLIED', 'hours_updated', v_updated, 'linked_ha_import_item_id', v_link.ha_import_item_id, 'allocation_fraction', p_allocation_fraction);
end;
$$;

grant execute on function public.apply_ha_tup_capping(uuid, text, numeric) to authenticated;
