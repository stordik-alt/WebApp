-- Follow-up to Master Prompt Problem 11: OEE double-counted reduced active
-- time for TEFF hours whose minutes come from the OCR-norm ratio method
-- (TEFF_FROM_OCR_NORM).
--
-- Confirmed against live data before changing anything: hour 8 of a real
-- item - actual_output=36, TEFF-derived minutes=13.125 (from the OCR norm
-- ratio), expected_output=96*13.125/60=21, performance=36/21*100=171% (a
-- genuinely strong result given the shortened window) - then OEE multiplied
-- that by the separately OCR-read Dostupnost (30.31%, itself consistent
-- with the hour's 41-minute recorded downtime) down to 52%. The 41-minute
-- shortfall was being subtracted TWICE: once already baked into the
-- TEFF-derived minutes used for Performance's own expected_output
-- denominator, and again via the Availability multiplier - both measuring
-- essentially the same "this hour wasn't fully active" fact.
--
-- This is NOT a problem for CLASSIC/LAST_HOUR_SCREENSHOT_TIME hours or the
-- TEFF ratio method's own shift-clock FALLBACK sub-path: their minutes come
-- from the fixed shift SCHEDULE (auto_shift_productive_minutes - break/
-- setup/cleanup/screenshot-cutoff), a genuinely different concept from
-- Availability (which then correctly measures actual uptime WITHIN that
-- scheduled window). Only the OCR-norm ratio method's minutes are already
-- an estimate of actual active time, which is what Availability itself
-- separately estimates.
--
-- Fix: Availability is still stored and displayed as-is (the real OCR
-- reading, kept for audit) - only the OEE calculation excludes it
-- (effectively treats it as 100%) specifically when this hour's minutes
-- came from the OCR-norm ratio method, to avoid counting the same
-- shortened-activity fact twice. Every other hour's OEE is unaffected.
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

    -- v_source starting with TEFF_FROM_OCR_NORM means v_minutes is already
    -- an estimate of actual ACTIVE time (inferred from the OCR-read output
    -- rate) - the same underlying fact Availability separately estimates.
    -- Every other source (CLASSIC, LAST_HOUR_SCREENSHOT_TIME, and the TEFF
    -- ratio method's own shift-clock fallback) derives minutes from the
    -- fixed shift SCHEDULE instead, a genuinely different concept that
    -- Availability correctly multiplies against without double-counting.
    v_minutes_is_activity_derived := (v_source like 'TEFF_FROM_OCR_NORM%');
    v_avail_for_oee := case when v_minutes_is_activity_derived then 100 else v_avail end;

    v_oee := case
      when v_perf is not null and v_avail_for_oee is not null
      then v_perf * v_avail_for_oee / 100.0
      else null
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
      raw_data = coalesce(raw_data,'{}'::jsonb)
        || jsonb_build_object(
          'calculation',
          coalesce(raw_data -> 'calculation','{}'::jsonb)
          || jsonb_build_object(
            'model_version', '2.01-AUTO-reconstruction-v21',
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
            'availability_excluded_from_oee_reason', case when v_minutes_is_activity_derived then 'TEFF_MINUTES_ALREADY_REFLECT_ACTIVE_TIME' else null end
          )
        )
    where id = r.id;
  end loop;
end;
$function$;
