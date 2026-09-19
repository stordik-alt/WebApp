-- User decision (this session, after reviewing the discrepancy between
-- Výkon and OEE on real data): the Očekávaný výstup and Výkon formulas
-- stay exactly as they are (staffing stays folded into Očekávaný výstup,
-- as already established). OEE simply equals Výkon from now on - the
-- Dostupnost multiplier that previously made OEE diverge from Výkon for
-- non-TEFF_FROM_OCR_NORM hours is removed. Dostupnost is still measured,
-- stored and displayed (availability_pct, availability_measured) for
-- audit - it is simply never multiplied into OEE anymore, for any hour
-- type, Classic or TEFF alike.
--
-- Implementation: v_avail_for_oee is now unconditionally 100 (previously
-- it was 100 only for TEFF_FROM_OCR_NORM hours, the real v_avail
-- otherwise), so v_oee = v_perf * 100 / 100 = v_perf for every hour. Kept
-- as a multiplication (not a bare assignment) so the raw_data.calculation
-- audit shape (availability_measured vs availability_applied_to_oee) stays
-- meaningful and the existing "Dostupnost X % naměřená, nezapočítává se do
-- OEE" UI note keeps working unchanged - it now fires for every hour with
-- measured availability below 100%, not just TEFF ones.

create or replace function public.reconstruct_import_item_hourly(p_import_item_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_item public.import_items%rowtype;
  v_operator_count integer;
  v_shift_start_hour integer;
  r record;
  v_norm numeric;
  v_capacity numeric;
  v_ocr_norm numeric;
  v_downtime numeric;
  v_minutes numeric;
  v_base_minutes numeric;
  v_expected numeric;
  v_perf numeric;
  v_oee numeric;
  v_avail numeric;
  v_avail_for_oee numeric;
  v_minutes_is_activity_derived boolean;
  v_source text;
  v_status text;
  v_hour_product_count integer;
  v_is_teff boolean;
  v_is_last_hour boolean;
  v_is_segment_start boolean;
  v_is_segment_end_mid_shift boolean;
  v_downtime_category text;
  v_use_teff_base boolean;
  v_existing_stat_status text;
  v_new_stat_status text;
begin
  select *
  into v_item
  from public.import_items
  where id = p_import_item_id;

  if not found then
    return;
  end if;

  select count(*)
  into v_operator_count
  from public.import_item_rows
  where import_item_id = p_import_item_id
    and employee_id is not null;

  v_operator_count := greatest(1, coalesce(v_operator_count, 1));

  v_shift_start_hour := public.auto_shift_start_minute(v_item.shift) / 60;

  for r in
    with hour_counts as (
      select
        h.hour,
        count(distinct nullif(trim(coalesce(h.product_code,'')), '')) as product_count
      from public.import_item_hourly h
      where h.import_item_id = p_import_item_id
      group by h.hour
    ),
    ordered as (
      select
        h.*,
        hc.product_count,
        ((h.hour - v_shift_start_hour + 24) % 24) as rel_hour
      from public.import_item_hourly h
      join hour_counts hc on hc.hour = h.hour
      where h.import_item_id = p_import_item_id
    )
    select
      o.*,
      lag(coalesce(o.actual_output, 0)) over (order by o.rel_hour, o.id) as prev_output,
      lag(o.rel_hour) over (order by o.rel_hour, o.id) as prev_rel_hour,
      lead(coalesce(o.actual_output, 0)) over (order by o.rel_hour, o.id) as next_output,
      lead(o.rel_hour) over (order by o.rel_hour, o.id) as next_rel_hour
    from ordered o
    order by o.rel_hour, o.id
  loop
    v_norm := null;
    v_capacity := null;
    v_ocr_norm := null;
    v_downtime := 0;
    v_minutes := null;

    v_is_last_hour := (r.next_rel_hour is null);
    v_is_segment_start := (r.rel_hour <> 0)
      and (r.prev_rel_hour is null or r.prev_rel_hour <> r.rel_hour - 1 or coalesce(r.prev_output, 0) <= 0);
    v_is_segment_end_mid_shift := (not v_is_last_hour)
      and (r.next_rel_hour <> r.rel_hour + 1 or coalesce(r.next_output, 0) <= 0);

    select x.norm, x.capacity
    into v_norm, v_capacity
    from (
      select
        case
          when upper(coalesce(r.role,'')) = 'HA'
           and public.codes_match(lower(regexp_replace(coalesce(pp.ha_subassy,''),'\s+','','g')), lower(regexp_replace(coalesce(r.product_code,''),'\s+','','g')))
          then pp.h_norm_per_hour
          when upper(coalesce(r.role,'')) = 'TUP'
           and public.codes_match(lower(regexp_replace(coalesce(pp.tup_subassy,''),'\s+','','g')), lower(regexp_replace(coalesce(r.product_code,''),'\s+','','g')))
          then pp.t_norm_per_hour
          when public.codes_match(lower(regexp_replace(coalesce(pp.ha_subassy,''),'\s+','','g')), lower(regexp_replace(coalesce(r.product_code,''),'\s+','','g')))
          then pp.h_norm_per_hour
          when public.codes_match(lower(regexp_replace(coalesce(pp.tup_subassy,''),'\s+','','g')), lower(regexp_replace(coalesce(r.product_code,''),'\s+','','g')))
          then pp.t_norm_per_hour
        end as norm,
        case
          when upper(coalesce(r.role,'')) = 'HA'
           and public.codes_match(lower(regexp_replace(coalesce(pp.ha_subassy,''),'\s+','','g')), lower(regexp_replace(coalesce(r.product_code,''),'\s+','','g')))
          then pp.h_capacity
          when upper(coalesce(r.role,'')) = 'TUP'
           and public.codes_match(lower(regexp_replace(coalesce(pp.tup_subassy,''),'\s+','','g')), lower(regexp_replace(coalesce(r.product_code,''),'\s+','','g')))
          then pp.t_capacity
          when public.codes_match(lower(regexp_replace(coalesce(pp.ha_subassy,''),'\s+','','g')), lower(regexp_replace(coalesce(r.product_code,''),'\s+','','g')))
          then pp.h_capacity
          when public.codes_match(lower(regexp_replace(coalesce(pp.tup_subassy,''),'\s+','','g')), lower(regexp_replace(coalesce(r.product_code,''),'\s+','','g')))
          then pp.t_capacity
        end as capacity,
        pp.valid_from,
        pp.valid_to,
        pp.version_no
      from public.product_profiles pp
      where public.codes_match(lower(regexp_replace(coalesce(pp.ha_subassy,''),'\s+','','g')), lower(regexp_replace(coalesce(r.product_code,''),'\s+','','g')))
         or public.codes_match(lower(regexp_replace(coalesce(pp.tup_subassy,''),'\s+','','g')), lower(regexp_replace(coalesce(r.product_code,''),'\s+','','g')))
    ) x
    where (x.valid_from is null or x.valid_from <= v_item.work_date)
      and (x.valid_to is null or x.valid_to >= v_item.work_date)
    order by
      x.valid_to is null desc,
      x.valid_from desc nulls last,
      x.version_no desc nulls last
    limit 1;

    v_ocr_norm := nullif(coalesce(r.raw_data,'{}'::jsonb) ->> 'ocr_norm_per_hour','')::numeric;

    v_downtime := nullif(coalesce(r.raw_data,'{}'::jsonb) ->> 'downtime_minutes','')::numeric;
    if v_downtime is null then
      v_downtime := nullif(coalesce(r.raw_data,'{}'::jsonb) ->> 'downtime_min','')::numeric;
    end if;
    v_downtime := greatest(0, least(60, coalesce(v_downtime, 0)));

    v_downtime_category := case
      when v_downtime = 0 then 'NONE'
      else upper(public.classify_downtime_reason(r.raw_data ->> 'downtime_reason'))
    end;

    v_hour_product_count := coalesce(r.product_count, 0);
    v_is_teff := v_hour_product_count > 1;

    v_use_teff_base := v_is_teff or v_is_segment_start or v_is_segment_end_mid_shift or (v_downtime_category = 'UNCONTROLLABLE');

    if coalesce(r.actual_output, 0) <= 0 and nullif(trim(coalesce(r.product_code, '')), '') is null then
      v_minutes := 0;
      v_source := 'EMPTY_HOUR_NO_PRODUCTION';
      v_status := 'EMPTY';
    elsif v_is_last_hour then
      v_base_minutes := public.auto_shift_productive_minutes(
        v_item.shift,
        r.hour,
        v_item.ocr_data ->> 'screenshot_time',
        true
      );
      v_source := 'SHIFT_CLOCK_LAST_HOUR_SCREENSHOT_TIME';

      if v_downtime_category = 'CONTROLLABLE' and v_downtime > 0 then
        v_minutes := least(60, v_base_minutes + v_downtime);
        v_source := v_source || '_PLUS_CONTROLLABLE_DOWNTIME';
      else
        v_minutes := v_base_minutes;
      end if;
      v_status := 'DERIVED';
    elsif v_use_teff_base then
      if v_norm is not null
         and v_norm > 0
         and v_ocr_norm is not null
         and v_ocr_norm >= 0
         and v_ocr_norm < v_norm
      then
        v_base_minutes := greatest(0, least(60, (v_ocr_norm / v_norm) * 60));
        v_source := 'TEFF_FROM_OCR_NORM';
      else
        v_base_minutes := public.auto_shift_productive_minutes(
          v_item.shift,
          r.hour,
          v_item.ocr_data ->> 'screenshot_time',
          false
        );
        v_source := 'TEFF_FALLBACK_NO_OCR_NORM_SHIFT_CLOCK';
      end if;

      if v_downtime_category = 'CONTROLLABLE' and v_downtime > 0 then
        v_minutes := least(60, v_base_minutes + v_downtime);
        v_source := v_source || '_PLUS_CONTROLLABLE_DOWNTIME';
        v_status := 'DERIVED';
      else
        v_minutes := v_base_minutes;
        v_status := 'DERIVED';
      end if;
    else
      v_minutes := public.auto_shift_productive_minutes(
        v_item.shift,
        r.hour,
        v_item.ocr_data ->> 'screenshot_time',
        false
      );
      v_source := 'SHIFT_CLOCK_MODEL_CLASSIC';
      v_status := 'CLOCK';
    end if;

    v_minutes := greatest(0, least(60, coalesce(v_minutes, 0)));

    v_expected := case
      when v_norm is not null
       and v_capacity is not null
       and v_capacity > 0
      then
        v_norm * v_minutes / 60.0
        * (v_operator_count::numeric / v_capacity)
      else null
    end;

    v_perf := case
      when r.actual_output is not null
       and v_expected is not null
       and v_expected > 0
      then r.actual_output / v_expected * 100
      else null
    end;

    v_avail := case
      when r.availability_pct is not null
      then greatest(0, least(100, r.availability_pct))
      when v_downtime < 60
      then greatest(0, least(100, (60 - v_downtime) / 60.0 * 100))
      else 0
    end;

    v_minutes_is_activity_derived := (v_source like 'TEFF_FROM_OCR_NORM%');
    -- Product decision: OEE = Výkon, always. Dostupnost is still measured
    -- and audited (v_avail / availability_measured below) but never
    -- multiplied into OEE for any hour type.
    v_avail_for_oee := 100;

    v_oee := case
      when v_perf is not null and v_avail_for_oee is not null
      then v_perf * v_avail_for_oee / 100.0
      else null
    end;

    select stat_status into v_existing_stat_status from public.import_item_hourly where id = r.id;
    v_new_stat_status := case
      when v_existing_stat_status in ('MANUALLY_INCLUDED', 'MANUALLY_EXCLUDED') then v_existing_stat_status
      when v_status = 'DERIVED' and (
        (v_perf is not null and v_perf > 200)
        or (v_oee is not null and (v_oee > 200 or v_oee < 0))
      ) then 'ANOMALY_PENDING_REVIEW'
      else 'INCLUDED'
    end;

    update public.import_item_hourly
    set
      norm_per_hour = v_norm,
      capacity = v_capacity,
      operator_count = v_operator_count,
      performance_pct = v_perf,
      availability_pct = case
        when r.availability_pct is not null then r.availability_pct
        when v_downtime > 0 then v_avail
        else availability_pct
      end,
      actual_oee_pct = v_oee,
      stat_status = v_new_stat_status,
      raw_data = coalesce(raw_data,'{}'::jsonb)
        || jsonb_build_object(
          'calculation',
          coalesce(raw_data -> 'calculation','{}'::jsonb)
          || jsonb_build_object(
            'model_version', '2.01-AUTO-reconstruction-v23',
            'calculation_mode', case when v_status = 'EMPTY' then 'EMPTY' when v_is_last_hour then 'LAST_HOUR_SCREENSHOT_TIME' when v_use_teff_base then 'TEFF' else 'CLASSIC' end,
            'reconstructed_productive_minutes', v_minutes,
            'reconstructed_effective_norm', case when v_norm is not null then v_norm * v_minutes / 60.0 else null end,
            'expected_output_at_current_staffing', v_expected,
            'reconstruction_status', v_status,
            'reconstruction_source', v_source,
            'ocr_interval_norm', v_ocr_norm,
            'downtime_minutes', v_downtime,
            'downtime_category', v_downtime_category,
            'master_norm', v_norm,
            'capacity', v_capacity,
            'operator_count', v_operator_count,
            'staffing_factor', case when v_capacity is not null and v_capacity > 0 then v_operator_count::numeric / v_capacity else null end,
            'hour_product_count', v_hour_product_count,
            'is_teff_hour', v_is_teff,
            'is_segment_start', v_is_segment_start,
            'is_segment_end_mid_shift', v_is_segment_end_mid_shift,
            'is_last_hour_of_item', v_is_last_hour,
            'availability_measured', v_avail,
            'availability_applied_to_oee', v_avail_for_oee,
            'availability_excluded_from_oee_reason', 'OEE_EQUALS_PERFORMANCE_BY_DESIGN'
          )
        )
    where id = r.id;
  end loop;
end;
$function$;

-- apply_ha_tup_capping(): same OEE=Výkon rule for the HA->TUP capped
-- recompute - no more availability_for_oee lookup/multiplication.
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

  if v_link.match_status = 'NONE' or v_link.ha_import_item_ids is null or array_length(v_link.ha_import_item_ids, 1) = 0 then
    return jsonb_build_object('status', coalesce(v_link.match_status, 'NONE'));
  end if;

  v_shift_start_hour := public.auto_shift_start_minute(v_item.shift) / 60;

  for r in
    select h.id, h.hour, h.actual_output,
      nullif(trim(coalesce(h.raw_data -> 'calculation' ->> 'expected_output_at_current_staffing', '')), '')::numeric as expected,
      h.availability_pct,
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
    where h2.import_item_id = any(v_link.ha_import_item_ids)
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
    -- Product decision: OEE = Výkon, always.
    v_oee_new := v_perf_new;

    update public.import_item_hourly
    set performance_pct = coalesce(v_perf_new, performance_pct),
        actual_oee_pct = coalesce(v_oee_new, actual_oee_pct),
        raw_data = coalesce(raw_data, '{}'::jsonb) || jsonb_build_object(
          'calculation', coalesce(raw_data -> 'calculation', '{}'::jsonb) || jsonb_build_object(
            'ha_tup_linkage', jsonb_build_object(
              'linked_ha_import_item_id', v_link.ha_import_item_id,
              'ha_source_import_item_ids', to_jsonb(v_link.ha_import_item_ids),
              'ha_source_ambiguous', v_link.match_status = 'AMBIGUOUS',
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

  return jsonb_build_object('status', 'APPLIED', 'hours_updated', v_updated, 'linked_ha_import_item_id', v_link.ha_import_item_id, 'ha_source_ambiguous', v_link.match_status = 'AMBIGUOUS', 'allocation_fraction', p_allocation_fraction);
end;
$$;

grant execute on function public.apply_ha_tup_capping(uuid, text, numeric) to authenticated;
