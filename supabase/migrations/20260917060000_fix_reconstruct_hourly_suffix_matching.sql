-- Fourth and last place with the same exact-match-only product identification
-- gap: reconstruct_import_item_hourly() (the V19 downtime-classification
-- reconstruction, which runs on every VALIDATING transition and inside
-- recalculate_import_item_kpis) looks up each hour's norm/capacity by
-- comparing the literal per-hour OCR product_code against
-- product_profiles.ha_subassy/tup_subassy with an exact string match. For a
-- code like T_S4966V4014B that only resolves via resolve_product_profile()'s
-- conservative suffix fallback, this exact match fails for every hour, so
-- norm_per_hour/capacity stay null, expected output and performance_pct get
-- nulled out, and recalculate_import_item_kpis's weighted average ends up
-- null shift-wide - even though the JS-side hourly OCR extraction (fixed in
-- the ocr.hourly.functions.ts commit) already computed real performance_pct
-- values that this reconstruction then immediately overwrites with null.
--
-- Added the shared codes_match() helper (same conservative single-letter
-- suffix fallback as resolve_product_profile() and the JS codesMatch()
-- copies) and used it in place of every direct ha_subassy/tup_subassy
-- equality check here.
create or replace function public.codes_match(a text, b text)
returns boolean
language sql
immutable
as $$
  select case
    when a is null or b is null or a = '' or b = '' then false
    when a = b then true
    when length(a) > length(b) and regexp_replace(a, '[a-z]{1,3}$', '') = b then true
    when length(b) > length(a) and regexp_replace(b, '[a-z]{1,3}$', '') = a then true
    else false
  end;
$$;

create or replace function public.reconstruct_import_item_hourly(p_import_item_id uuid)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_item public.import_items%rowtype;
  v_operator_count integer;
  v_last_hour integer;
  v_first_production_hour integer;
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
  v_source text;
  v_status text;
  v_hour_product_count integer;
  v_is_teff boolean;
  v_is_last_hour boolean;
  v_is_late_start boolean;
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

  select max(h.hour)
  into v_last_hour
  from public.import_item_hourly h
  where h.import_item_id = p_import_item_id;

  select min(h.hour)
  into v_first_production_hour
  from public.import_item_hourly h
  where h.import_item_id = p_import_item_id
    and coalesce(h.actual_output, 0) > 0;

  v_shift_start_hour := public.auto_shift_start_minute(v_item.shift) / 60;

  for r in
    with hour_counts as (
      select
        h.hour,
        count(distinct nullif(trim(coalesce(h.product_code,'')), '')) as product_count
      from public.import_item_hourly h
      where h.import_item_id = p_import_item_id
      group by h.hour
    )
    select
      h.*,
      hc.product_count
    from public.import_item_hourly h
    join hour_counts hc on hc.hour = h.hour
    where h.import_item_id = p_import_item_id
    order by h.hour, h.id
  loop
    v_norm := null;
    v_capacity := null;
    v_ocr_norm := null;
    v_downtime := 0;
    v_minutes := null;
    v_is_last_hour := (r.hour = v_last_hour);
    v_is_late_start := (v_first_production_hour is not null)
      and (r.hour = v_first_production_hour)
      and (r.hour <> v_shift_start_hour);

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

    v_use_teff_base := v_is_teff or v_is_late_start or (v_downtime_category = 'UNCONTROLLABLE');

    if v_use_teff_base then
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
          v_is_last_hour
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
      -- CLASSIC: normal, on-time, single-product hour. Controllable downtime
      -- (if any) does not change calculated time; shift-clock time stands.
      v_minutes := public.auto_shift_productive_minutes(
        v_item.shift,
        r.hour,
        v_item.ocr_data ->> 'screenshot_time',
        v_is_last_hour
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

    v_oee := case
      when v_perf is not null and v_avail is not null
      then v_perf * v_avail / 100.0
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
            'model_version', '2.01-AUTO-reconstruction-v19',
            'calculation_mode', case when v_use_teff_base then 'TEFF' else 'CLASSIC' end,
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
            'is_late_start_hour', v_is_late_start
          )
        )
    where id = r.id;
  end loop;
end;
$function$;
