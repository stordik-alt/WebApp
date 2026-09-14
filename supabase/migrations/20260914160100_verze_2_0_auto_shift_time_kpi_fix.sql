-- Verze 2.0 AUTO
-- Oprava pořadí načtení směny v předchozí migraci a definitivní kanonický přepočet KPI.

create or replace function public.recalculate_import_item_kpis(p_import_item_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item public.import_items%rowtype;
  v_operator_count integer;
  v_hour_count integer;
  v_perf_weight double precision := 0;
  v_avail_weight double precision := 0;
  v_oee_weight double precision := 0;
  v_perf_total double precision := 0;
  v_avail_total double precision := 0;
  v_oee_total double precision := 0;
  v_shift_perf double precision;
  v_shift_avail double precision;
  v_shift_oee double precision;
  v_shift text;
  v_screenshot_time text;
  r record;
  v_weight double precision;
  v_norm double precision;
  v_capacity double precision;
  v_perf double precision;
  v_oee double precision;
begin
  select * into v_item
  from public.import_items
  where id = p_import_item_id;

  if not found then
    return;
  end if;

  v_shift := v_item.shift;

  select count(*) into v_operator_count
  from public.import_item_rows
  where import_item_id = p_import_item_id
    and employee_id is not null;

  if v_operator_count < 1 then
    return;
  end if;

  select count(*) into v_hour_count
  from public.import_item_hourly
  where import_item_id = p_import_item_id;

  if v_hour_count < 1 then
    return;
  end if;

  select coalesce(
    nullif(v_item.ocr_data ->> 'screenshot_time', ''),
    nullif(v_item.ocr_data ->> 'screenshotTime', ''),
    nullif(v_item.ocr_data ->> 'actual_time', ''),
    nullif(v_item.ocr_data ->> 'time', '')
  ) into v_screenshot_time;

  for r in
    select h.id,
           h.hour,
           h.product_code,
           h.actual_output,
           h.availability_pct,
           row_number() over (
             order by public.auto_shift_start_minute(v_shift)
                    + mod((h.hour * 60 - public.auto_shift_start_minute(v_shift) + 1440), 1440),
                      h.id
           ) as rn
    from public.import_item_hourly h
    where h.import_item_id = p_import_item_id
    order by public.auto_shift_start_minute(v_shift)
           + mod((h.hour * 60 - public.auto_shift_start_minute(v_shift) + 1440), 1440),
             h.id
  loop
    v_weight := public.auto_shift_productive_minutes(
      v_shift,
      r.hour,
      v_screenshot_time,
      r.rn = v_hour_count
    )::double precision;

    select case
      when lower(regexp_replace(coalesce(hp.ha_subassy, ''), '\s+', '', 'g')) = lower(regexp_replace(coalesce(r.product_code, ''), '\s+', '', 'g')) then hp.h_norm_per_hour
      when lower(regexp_replace(coalesce(hp.tup_subassy, ''), '\s+', '', 'g')) = lower(regexp_replace(coalesce(r.product_code, ''), '\s+', '', 'g')) then hp.t_norm_per_hour
      else null
    end,
    case
      when lower(regexp_replace(coalesce(hp.ha_subassy, ''), '\s+', '', 'g')) = lower(regexp_replace(coalesce(r.product_code, ''), '\s+', '', 'g')) then hp.h_capacity
      when lower(regexp_replace(coalesce(hp.tup_subassy, ''), '\s+', '', 'g')) = lower(regexp_replace(coalesce(r.product_code, ''), '\s+', '', 'g')) then hp.t_capacity
      else null
    end
    into v_norm, v_capacity
    from public.product_profiles hp
    where lower(regexp_replace(coalesce(hp.ha_subassy, ''), '\s+', '', 'g')) = lower(regexp_replace(coalesce(r.product_code, ''), '\s+', '', 'g'))
       or lower(regexp_replace(coalesce(hp.tup_subassy, ''), '\s+', '', 'g')) = lower(regexp_replace(coalesce(r.product_code, ''), '\s+', '', 'g'))
    order by hp.valid_to is null desc, hp.valid_from desc nulls last, hp.version_no desc nulls last
    limit 1;

    v_perf := case
      when r.actual_output is not null
       and v_norm is not null
       and v_norm > 0
       and v_weight > 0
        then (r.actual_output / (v_norm * v_weight / 60.0)) * 100.0
      else null
    end;

    v_oee := case
      when v_perf is not null
       and r.availability_pct is not null
       and v_capacity is not null
       and v_capacity > 0
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
            'version', '2.0-AUTO-shift-time-v2',
            'shift', v_shift,
            'shift_start', case
              when public.auto_shift_start_minute(v_shift) = 360 then '06:00'
              when public.auto_shift_start_minute(v_shift) = 840 then '14:00'
              when public.auto_shift_start_minute(v_shift) = 1320 then '22:00'
              else null
            end,
            'shift_duration_minutes', 480,
            'scheduled_break_minutes', 30,
            'start_preparation_minutes', 7,
            'end_cleanup_minutes', 5,
            'standard_productive_minutes', 438,
            'effective_productive_minutes', v_weight,
            'screenshot_time', v_screenshot_time,
            'performance_formula', '(Reálný výstup / (norma × efektivní výrobní minuty / 60)) × 100',
            'oee_formula', '(Výkon × Dostupnost × (kapacita Product Profile / počet operátorů)) / 100',
            'actual_output', r.actual_output,
            'norm_per_hour', v_norm,
            'availability_pct', r.availability_pct,
            'capacity', v_capacity,
            'operator_count', v_operator_count,
            'calculated_performance_pct', v_perf,
            'calculated_oee_pct', v_oee
          )
        )
    where id = r.id;

    if v_weight > 0 then
      if v_perf is not null then
        v_perf_total := v_perf_total + v_perf * v_weight;
        v_perf_weight := v_perf_weight + v_weight;
      end if;
      if r.availability_pct is not null then
        v_avail_total := v_avail_total + r.availability_pct * v_weight;
        v_avail_weight := v_avail_weight + v_weight;
      end if;
      if v_oee is not null then
        v_oee_total := v_oee_total + v_oee * v_weight;
        v_oee_weight := v_oee_weight + v_weight;
      end if;
    end if;
  end loop;

  v_shift_perf := case when v_perf_weight > 0 then v_perf_total / v_perf_weight else null end;
  v_shift_avail := case when v_avail_weight > 0 then v_avail_total / v_avail_weight else null end;
  v_shift_oee := case when v_oee_weight > 0 then v_oee_total / v_oee_weight else null end;

  update public.import_item_rows
  set performance = v_shift_perf,
      available_time = v_shift_avail,
      oee = v_shift_oee
  where import_item_id = p_import_item_id
    and daily_record_id is null;

  update public.import_items
  set ocr_data = jsonb_set(
      jsonb_set(
        jsonb_set(
          jsonb_set(coalesce(ocr_data, '{}'::jsonb), '{actual_shift_performance_pct}', to_jsonb(v_shift_perf), true),
          '{actual_shift_availability_pct}', to_jsonb(v_shift_avail), true),
        '{actual_shift_oee_pct}', to_jsonb(v_shift_oee), true),
      '{shift_time_model}', jsonb_build_object(
        'version', '2.0-AUTO-shift-time-v2',
        'shift_duration_minutes', 480,
        'break_minutes', 30,
        'start_preparation_minutes', 7,
        'end_cleanup_minutes', 5,
        'productive_minutes', 438,
        'shift', v_shift,
        'screenshot_time', v_screenshot_time
      ), true)
  where id = p_import_item_id;
end;
$$;

revoke all on function public.recalculate_import_item_kpis(uuid) from public;
grant execute on function public.recalculate_import_item_kpis(uuid) to authenticated;

-- Přepočet se spustí i při přechodu importu do VALIDATING.
drop trigger if exists trg_import_items_recalculate_kpis on public.import_items;
create trigger trg_import_items_recalculate_kpis
after update on public.import_items
for each row
when (new.status = 'VALIDATING' and old.status is distinct from new.status)
execute function public.recalculate_import_item_kpis_on_validating();
