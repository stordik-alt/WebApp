-- Verze 2.0/2.01 AUTO: correct hourly productive time for startup gaps and real downtime.
--
-- Rules:
-- 1) Empty OCR rows (0 output / no product / zero norm) remain excluded from KPI weighting.
-- 2) The first real production row after an empty start is treated as a partial
--    production hour. Its productive minutes are inferred from actual output
--    and the canonical Product Profile norm at 100% availability.
-- 3) For every normal hour, productive minutes are reduced by the recorded
--    availability. Example: 28 min downtime => 32 productive minutes.
-- 4) Performance is calculated against effective norm for the actual productive
--    minutes. OEE then combines performance and availability as before.
-- 5) The OCR norm is never used as the source of truth.

create or replace function public.recalculate_import_item_kpis(p_import_item_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item public.import_items%rowtype;
  v_operator_count integer;
  v_perf_weight double precision := 0;
  v_avail_weight double precision := 0;
  v_oee_weight double precision := 0;
  v_perf_total double precision := 0;
  v_avail_total double precision := 0;
  v_oee_total double precision := 0;
  v_shift_perf double precision;
  v_shift_avail double precision;
  v_shift_oee double precision;
  r record;
  v_clock_minutes double precision;
  v_minutes double precision;
  v_norm double precision;
  v_capacity double precision;
  v_perf double precision;
  v_oee double precision;
  v_screenshot_time text;
  v_seen_productive boolean := false;
  v_is_first_productive boolean;
  v_inferred_minutes double precision;
begin
  select * into v_item
  from public.import_items
  where id = p_import_item_id;

  if not found then
    return;
  end if;

  select count(*) into v_operator_count
  from public.import_item_rows
  where import_item_id = p_import_item_id
    and employee_id is not null;

  if v_operator_count < 1 then
    return;
  end if;

  v_screenshot_time := nullif(trim(v_item.ocr_data ->> 'screenshot_time'), '');

  for r in
    select h.id, h.hour, h.product_code, h.role, h.actual_output, h.availability_pct
    from public.import_item_hourly h
    where h.import_item_id = p_import_item_id
    order by
      case
        when lower(trim(coalesce(v_item.shift, ''))) like 'ra%' and h.hour >= 6 then h.hour - 6
        when lower(trim(coalesce(v_item.shift, ''))) like 'od%' and h.hour >= 14 then h.hour - 14
        when lower(trim(coalesce(v_item.shift, ''))) like 'no%' and h.hour >= 22 then h.hour - 22
        when lower(trim(coalesce(v_item.shift, ''))) like 'no%' then h.hour + 2
        else h.hour
      end,
      h.id
  loop
    -- Never let an empty OCR row consume time or distort the shift KPI.
    if coalesce(r.actual_output, 0) <= 0 then
      continue;
    end if;

    v_is_first_productive := not v_seen_productive;
    v_seen_productive := true;

    v_clock_minutes := public.auto_shift_productive_minutes(v_item.shift, r.hour, v_screenshot_time)::double precision;

    select
      case
        when upper(coalesce(r.role, '')) = 'HA'
             and lower(regexp_replace(coalesce(pp.ha_subassy, ''), '\s+', '', 'g')) = lower(regexp_replace(coalesce(r.product_code, ''), '\s+', '', 'g')) then pp.h_norm_per_hour
        when upper(coalesce(r.role, '')) = 'TUP'
             and lower(regexp_replace(coalesce(pp.tup_subassy, ''), '\s+', '', 'g')) = lower(regexp_replace(coalesce(r.product_code, ''), '\s+', '', 'g')) then pp.t_norm_per_hour
        when lower(regexp_replace(coalesce(pp.ha_subassy, ''), '\s+', '', 'g')) = lower(regexp_replace(coalesce(r.product_code, ''), '\s+', '', 'g'))
             and lower(regexp_replace(coalesce(pp.tup_subassy, ''), '\s+', '', 'g')) <> lower(regexp_replace(coalesce(r.product_code, ''), '\s+', '', 'g')) then pp.h_norm_per_hour
        when lower(regexp_replace(coalesce(pp.tup_subassy, ''), '\s+', '', 'g')) = lower(regexp_replace(coalesce(r.product_code, ''), '\s+', '', 'g'))
             and lower(regexp_replace(coalesce(pp.ha_subassy, ''), '\s+', '', 'g')) <> lower(regexp_replace(coalesce(r.product_code, ''), '\s+', '', 'g')) then pp.t_norm_per_hour
        else null
      end,
      case
        when upper(coalesce(r.role, '')) = 'HA'
             and lower(regexp_replace(coalesce(pp.ha_subassy, ''), '\s+', '', 'g')) = lower(regexp_replace(coalesce(r.product_code, ''), '\s+', '', 'g')) then pp.h_capacity
        when upper(coalesce(r.role, '')) = 'TUP'
             and lower(regexp_replace(coalesce(pp.tup_subassy, ''), '\s+', '', 'g')) = lower(regexp_replace(coalesce(r.product_code, ''), '\s+', '', 'g')) then pp.t_capacity
        when lower(regexp_replace(coalesce(pp.ha_subassy, ''), '\s+', '', 'g')) = lower(regexp_replace(coalesce(r.product_code, ''), '\s+', '', 'g'))
             and lower(regexp_replace(coalesce(pp.tup_subassy, ''), '\s+', '', 'g')) <> lower(regexp_replace(coalesce(r.product_code, ''), '\s+', '', 'g')) then pp.h_capacity
        when lower(regexp_replace(coalesce(pp.tup_subassy, ''), '\s+', '', 'g')) = lower(regexp_replace(coalesce(r.product_code, ''), '\s+', '', 'g'))
             and lower(regexp_replace(coalesce(pp.ha_subassy, ''), '\s+', '', 'g')) <> lower(regexp_replace(coalesce(r.product_code, ''), '\s+', '', 'g')) then pp.t_capacity
        else null
      end
    into v_norm, v_capacity
    from public.product_profiles pp
    where lower(regexp_replace(coalesce(pp.ha_subassy, ''), '\s+', '', 'g')) = lower(regexp_replace(coalesce(r.product_code, ''), '\s+', '', 'g'))
       or lower(regexp_replace(coalesce(pp.tup_subassy, ''), '\s+', '', 'g')) = lower(regexp_replace(coalesce(r.product_code, ''), '\s+', '', 'g'))
    order by pp.valid_to is null desc, pp.valid_from desc nulls last, pp.version_no desc nulls last
    limit 1;

    if v_norm is null or v_norm <= 0 then
      continue;
    end if;

    -- Availability is already the measured share of productive time in the
    -- hour. Convert it back to minutes so downtime affects the performance
    -- denominator too. 53.33% => 32 minutes for a 60-minute hour.
    v_minutes := v_clock_minutes * greatest(0, least(100, coalesce(r.availability_pct, 100))) / 100.0;

    -- If the first real output appears after an empty opening hour and the
    -- hour has 100% availability, infer the actual startup point from the
    -- canonical norm. E.g. 12 pcs at a 14.0187 pcs/h norm means 51.36 min
    -- of production, so production started about 7:08:38.
    if v_is_first_productive
       and coalesce(r.availability_pct, 100) >= 99.999
       and coalesce(r.actual_output, 0) > 0 then
      v_inferred_minutes := (r.actual_output / v_norm) * 60.0;
      if v_inferred_minutes > 0 and v_inferred_minutes < v_minutes then
        v_minutes := v_inferred_minutes;
      end if;
    end if;

    if v_minutes <= 0 then
      continue;
    end if;

    v_perf := (r.actual_output / (v_norm * v_minutes / 60.0)) * 100.0;

    v_oee := case
      when r.availability_pct is not null and v_capacity is not null and v_capacity > 0 and v_operator_count > 0
        then v_perf * r.availability_pct * (v_capacity / v_operator_count::double precision) / 100.0
      else null
    end;

    update public.import_item_hourly
    set norm_per_hour = v_norm,
        capacity = v_capacity,
        operator_count = v_operator_count,
        performance_pct = v_perf,
        actual_oee_pct = v_oee,
        raw_data = coalesce(raw_data, '{}'::jsonb) || jsonb_build_object(
          'calculation', jsonb_build_object(
            'model_version', '2.01-AUTO-first-output-downtime-v1',
            'productive_minutes', v_minutes,
            'clock_productive_minutes', v_clock_minutes,
            'availability_pct', r.availability_pct,
            'effective_norm', v_norm * v_minutes / 60.0,
            'first_productive_row', v_is_first_productive,
            'startup_inferred_from_norm', v_is_first_productive,
            'performance_formula', '(Reálný výstup / (norma × skutečné produktivní minuty / 60)) × 100',
            'oee_formula', '(Výkon × Dostupnost × (kapacita / počet operátorů)) / 100',
            'actual_output', r.actual_output,
            'norm_per_hour', v_norm,
            'capacity', v_capacity,
            'operator_count', v_operator_count,
            'calculated_performance_pct', v_perf,
            'calculated_oee_pct', v_oee
          )
        )
    where id = r.id;

    v_perf_total := v_perf_total + v_perf * v_minutes;
    v_perf_weight := v_perf_weight + v_minutes;

    if r.availability_pct is not null and isfinite(r.availability_pct::double precision) then
      v_avail_total := v_avail_total + r.availability_pct * v_minutes;
      v_avail_weight := v_avail_weight + v_minutes;
    end if;

    if v_oee is not null then
      v_oee_total := v_oee_total + v_oee * v_minutes;
      v_oee_weight := v_oee_weight + v_minutes;
    end if;
  end loop;

  v_shift_perf := case when v_perf_weight > 0 then v_perf_total / v_perf_weight else null end;
  v_shift_avail := case when v_avail_weight > 0 then v_avail_total / v_avail_weight else null end;
  v_shift_oee := case when v_oee_weight > 0 then v_oee_total / v_oee_weight else null end;

  update public.import_item_rows
  set performance = v_shift_perf,
      available_time = v_shift_avail,
      oee = v_shift_oee,
      raw_data = coalesce(raw_data, '{}'::jsonb) || jsonb_build_object(
        'performance', v_shift_perf,
        'available_time', v_shift_avail,
        'oee', v_shift_oee,
        'kpi_model_version', '2.01-AUTO-first-output-downtime-v1'
      )
  where import_item_id = p_import_item_id
    and daily_record_id is null;

  update public.import_items
  set ocr_data = jsonb_set(
      jsonb_set(
        jsonb_set(
          jsonb_set(coalesce(ocr_data, '{}'::jsonb), '{actual_shift_performance_pct}', to_jsonb(v_shift_perf), true),
          '{actual_shift_availability_pct}', to_jsonb(v_shift_avail), true
        ),
        '{actual_shift_oee_pct}', to_jsonb(v_shift_oee), true
      ),
      '{kpi_model_version}', to_jsonb('2.01-AUTO-first-output-downtime-v1'::text), true
    )
  where id = p_import_item_id;
end;
$$;

grant execute on function public.recalculate_import_item_kpis(uuid) to authenticated;
