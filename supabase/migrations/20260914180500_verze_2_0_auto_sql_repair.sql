-- Verze 2.0 AUTO: SQL repair migration
-- Run this once in Supabase SQL Editor when the earlier migration sequence
-- failed on recalculate_import_item_kpis_on_validating().
--
-- This script is intentionally self-contained for the KPI/time-model path.
-- It fixes the PostgreSQL signature conflict by recreating
-- auto_shift_productive_minutes with one canonical return type: numeric.

begin;

-- Remove both possible historical signatures. PostgreSQL does not allow
-- CREATE OR REPLACE to change a function return type.
drop function if exists public.auto_shift_productive_minutes(text, integer, text);

create function public.auto_shift_productive_minutes(
  p_shift text,
  p_hour integer,
  p_screenshot_time text default null
)
returns numeric
language plpgsql
immutable
set search_path = public
as $$
declare
  v_shift text := lower(trim(coalesce(p_shift, '')));
  v_start_min integer;
  v_pause_start integer;
  v_pause_end integer;
  v_rel_start integer;
  v_rel_end integer;
  v_cutoff integer;
  v_minute integer;
begin
  if p_hour is null or p_hour < 0 or p_hour > 23 then
    return 0;
  end if;

  if left(v_shift, 2) = 'ra' then
    v_start_min := 360;
    v_pause_start := 280;
    v_pause_end := 310;
  elsif left(v_shift, 2) = 'od' then
    v_start_min := 840;
    v_pause_start := 240;
    v_pause_end := 270;
  elsif left(v_shift, 2) = 'no' or left(v_shift, 5) = 'night' then
    v_start_min := 1320;
    v_pause_start := 240;
    v_pause_end := 270;
  elsif p_hour >= 6 and p_hour < 14 then
    v_start_min := 360;
    v_pause_start := 280;
    v_pause_end := 310;
  elsif p_hour >= 14 and p_hour < 22 then
    v_start_min := 840;
    v_pause_start := 240;
    v_pause_end := 270;
  else
    v_start_min := 1320;
    v_pause_start := 240;
    v_pause_end := 270;
  end if;

  v_rel_start := ((p_hour * 60 - v_start_min) + 1440) % 1440;
  v_rel_end := v_rel_start + 60;

  if p_screenshot_time is not null
     and p_screenshot_time ~ '^(?:[01][0-9]|2[0-3]):[0-5][0-9]$' then
    v_cutoff := (
      (split_part(p_screenshot_time, ':', 1)::integer * 60
       + split_part(p_screenshot_time, ':', 2)::integer
       - v_start_min) + 1440
    ) % 1440;

    if v_cutoff < v_rel_start then
      return 0;
    end if;

    if v_cutoff < v_rel_end then
      v_rel_end := v_cutoff;
    end if;
  end if;

  -- 7 min setup, 30 min break, 5 min cleanup.
  v_minute := greatest(
    0,
    least(v_rel_end, 475) - greatest(v_rel_start, 7)
  );

  v_minute := v_minute - greatest(
    0,
    least(v_rel_end, v_pause_end) - greatest(v_rel_start, v_pause_start)
  );

  return greatest(0, least(60, v_minute))::numeric;
end;
$$;

grant execute on function public.auto_shift_productive_minutes(text, integer, text) to authenticated;

-- Canonical KPI recalculation. It uses actual productive clock minutes,
-- Product Profile norm/capacity, OCR availability and the existing OEE formula.
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
  v_minutes double precision;
  v_norm double precision;
  v_capacity double precision;
  v_perf double precision;
  v_oee double precision;
  v_screenshot_time text;
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
    v_minutes := public.auto_shift_productive_minutes(
      v_item.shift, r.hour, v_screenshot_time
    )::double precision;

    select
      case
        when upper(coalesce(r.role, '')) = 'HA'
             and lower(regexp_replace(coalesce(pp.ha_subassy, ''), '\\s+', '', 'g')) = lower(regexp_replace(coalesce(r.product_code, ''), '\\s+', '', 'g')) then pp.h_norm_per_hour
        when upper(coalesce(r.role, '')) = 'TUP'
             and lower(regexp_replace(coalesce(pp.tup_subassy, ''), '\\s+', '', 'g')) = lower(regexp_replace(coalesce(r.product_code, ''), '\\s+', '', 'g')) then pp.t_norm_per_hour
        when lower(regexp_replace(coalesce(pp.ha_subassy, ''), '\\s+', '', 'g')) = lower(regexp_replace(coalesce(r.product_code, ''), '\\s+', '', 'g'))
             and lower(regexp_replace(coalesce(pp.tup_subassy, ''), '\\s+', '', 'g')) <> lower(regexp_replace(coalesce(r.product_code, ''), '\\s+', '', 'g')) then pp.h_norm_per_hour
        when lower(regexp_replace(coalesce(pp.tup_subassy, ''), '\\s+', '', 'g')) = lower(regexp_replace(coalesce(r.product_code, ''), '\\s+', '', 'g'))
             and lower(regexp_replace(coalesce(pp.ha_subassy, ''), '\\s+', '', 'g')) <> lower(regexp_replace(coalesce(r.product_code, ''), '\\s+', '', 'g')) then pp.t_norm_per_hour
        else null
      end,
      case
        when upper(coalesce(r.role, '')) = 'HA'
             and lower(regexp_replace(coalesce(pp.ha_subassy, ''), '\\s+', '', 'g')) = lower(regexp_replace(coalesce(r.product_code, ''), '\\s+', '', 'g')) then pp.h_capacity
        when upper(coalesce(r.role, '')) = 'TUP'
             and lower(regexp_replace(coalesce(pp.tup_subassy, ''), '\\s+', '', 'g')) = lower(regexp_replace(coalesce(r.product_code, ''), '\\s+', '', 'g')) then pp.t_capacity
        when lower(regexp_replace(coalesce(pp.ha_subassy, ''), '\\s+', '', 'g')) = lower(regexp_replace(coalesce(r.product_code, ''), '\\s+', '', 'g'))
             and lower(regexp_replace(coalesce(pp.tup_subassy, ''), '\\s+', '', 'g')) <> lower(regexp_replace(coalesce(r.product_code, ''), '\\s+', '', 'g')) then pp.h_capacity
        when lower(regexp_replace(coalesce(pp.tup_subassy, ''), '\\s+', '', 'g')) = lower(regexp_replace(coalesce(r.product_code, ''), '\\s+', '', 'g'))
             and lower(regexp_replace(coalesce(pp.ha_subassy, ''), '\\s+', '', 'g')) <> lower(regexp_replace(coalesce(r.product_code, ''), '\\s+', '', 'g')) then pp.t_capacity
        else null
      end
    into v_norm, v_capacity
    from public.product_profiles pp
    where lower(regexp_replace(coalesce(pp.ha_subassy, ''), '\\s+', '', 'g')) = lower(regexp_replace(coalesce(r.product_code, ''), '\\s+', '', 'g'))
       or lower(regexp_replace(coalesce(pp.tup_subassy, ''), '\\s+', '', 'g')) = lower(regexp_replace(coalesce(r.product_code, ''), '\\s+', '', 'g'))
    order by pp.valid_to is null desc, pp.valid_from desc nulls last, pp.version_no desc nulls last
    limit 1;

    v_perf := case
      when r.actual_output is not null
       and v_norm is not null
       and v_norm > 0
       and v_minutes > 0
      then (r.actual_output / (v_norm * v_minutes / 60.0)) * 100.0
      else null
    end;

    v_oee := case
      when v_perf is not null
       and r.availability_pct is not null
       and v_capacity is not null
       and v_capacity > 0
       and v_operator_count > 0
      then v_perf * r.availability_pct
           * (v_capacity / v_operator_count::double precision) / 100.0
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
            'model_version', '2.0-AUTO-shift-time-v1',
            'productive_minutes', v_minutes,
            'effective_norm', case when v_norm is not null then v_norm * v_minutes / 60.0 else null end,
            'performance_formula', '(Reálný výstup / (norma × produktivní minuty / 60)) × 100',
            'oee_formula', '(Výkon × Dostupnost × (kapacita / počet operátorů)) / 100',
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

    if v_minutes > 0 then
      if v_perf is not null then
        v_perf_total := v_perf_total + v_perf * v_minutes;
        v_perf_weight := v_perf_weight + v_minutes;
      end if;

      if r.availability_pct is not null
         and isfinite(r.availability_pct::double precision) then
        v_avail_total := v_avail_total + r.availability_pct * v_minutes;
        v_avail_weight := v_avail_weight + v_minutes;
      end if;

      if v_oee is not null then
        v_oee_total := v_oee_total + v_oee * v_minutes;
        v_oee_weight := v_oee_weight + v_minutes;
      end if;
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
        'kpi_model_version', '2.0-AUTO-shift-time-v1'
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
    '{kpi_model_version}', to_jsonb('2.0-AUTO-shift-time-v1'::text), true
  )
  where id = p_import_item_id;
end;
$$;

grant execute on function public.recalculate_import_item_kpis(uuid) to authenticated;

-- The trigger function must exist before CREATE TRIGGER is executed.
create or replace function public.recalculate_import_item_kpis_on_validating()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'VALIDATING'
     and old.status is distinct from new.status then
    perform public.recalculate_import_item_kpis(new.id);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_import_items_recalculate_kpis on public.import_items;

create trigger trg_import_items_recalculate_kpis
after update on public.import_items
for each row
execute function public.recalculate_import_item_kpis_on_validating();

grant execute on function public.recalculate_import_item_kpis_on_validating() to authenticated;

commit;

-- Expected canonical model:
-- Ranní    06:00–14:00, break 10:40–11:10
-- Odpolední 14:00–22:00, break 18:00–18:30
-- Noční    22:00–06:00, break 02:00–02:30
-- 7 min setup + 30 min break + 5 min cleanup = 438 productive minutes.
