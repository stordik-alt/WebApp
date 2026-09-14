-- Verze 2.0 AUTO – FINAL shift-time KPI model
-- Canonical model:
--   shift = 8 clock hours
--   break = 30 min
--   line setup = 7 min at shift start
--   line cleanup = 5 min at shift end
--   productive shift time = 438 min
--   Ranní 06:00–14:00, break 10:40–11:10
--   Odpolední 14:00–22:00, break 18:00–18:30
--   Noční 22:00–06:00, break 02:00–02:30
--
-- The calculation is based on actual clock time, not row position.
-- Night shift therefore remains correct across midnight.

create or replace function public.auto_shift_productive_minutes(
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
  v_hour_norm integer;
  v_rel_start integer;
  v_rel_end integer;
  v_cutoff integer;
  v_minute integer;
begin
  if p_hour is null or p_hour < 0 or p_hour > 23 then
    return 0;
  end if;

  -- Normalize the three supported shift names by their first two letters.
  if left(v_shift, 2) = 'ra' then
    v_start_min := 6 * 60;
    v_pause_start := 4 * 60 + 40;
    v_pause_end := 5 * 60 + 10;
  elsif left(v_shift, 2) = 'od' then
    v_start_min := 14 * 60;
    v_pause_start := 4 * 60;
    v_pause_end := 4 * 60 + 30;
  elsif left(v_shift, 2) = 'no' or left(v_shift, 5) = 'night' then
    v_start_min := 22 * 60;
    v_pause_start := 4 * 60;
    v_pause_end := 4 * 60 + 30;
  else
    -- If the stored shift is unavailable, infer it from the clock hour.
    if p_hour >= 6 and p_hour < 14 then
      v_start_min := 6 * 60;
      v_pause_start := 4 * 60 + 40;
      v_pause_end := 5 * 60 + 10;
    elsif p_hour >= 14 and p_hour < 22 then
      v_start_min := 14 * 60;
      v_pause_start := 4 * 60;
      v_pause_end := 4 * 60 + 30;
    else
      v_start_min := 22 * 60;
      v_pause_start := 4 * 60;
      v_pause_end := 4 * 60 + 30;
    end if;
  end if;

  v_hour_norm := p_hour;
  v_rel_start := ((v_hour_norm * 60 - v_start_min) + 1440) % 1440;
  v_rel_end := v_rel_start + 60;

  -- The screenshot time is the authoritative cutoff for the current hour.
  -- At exactly HH:00 the current hour has zero elapsed minutes.
  if p_screenshot_time is not null and p_screenshot_time ~ '^(?:[01][0-9]|2[0-3]):[0-5][0-9]$' then
    v_minute := split_part(p_screenshot_time, ':', 1)::integer * 60
               + split_part(p_screenshot_time, ':', 2)::integer;
    v_cutoff := ((v_minute - v_start_min) + 1440) % 1440;
    if v_cutoff < v_rel_start then
      return 0;
    end if;
    if v_cutoff < v_rel_end then
      v_rel_end := v_cutoff;
    end if;
  end if;

  -- 7 min setup and 5 min cleanup are excluded from productive time.
  v_minute := greatest(0, least(v_rel_end, 8 * 60 - 5) - greatest(v_rel_start, 7));

  -- Subtract the actual 30-minute break from the relevant clock interval.
  v_minute := v_minute
    - greatest(0, least(v_rel_end, v_pause_end) - greatest(v_rel_start, v_pause_start));

  return greatest(0, least(60, v_minute))::numeric;
end;
$$;

grant execute on function public.auto_shift_productive_minutes(text, integer, text) to authenticated;

-- Canonical DB recalculation used by both AUTO and manual approval paths.
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
    v_minutes := public.auto_shift_productive_minutes(v_item.shift, r.hour, v_screenshot_time)::double precision;

    -- Prefer the role persisted by OCR context when it disambiguates a code
    -- that can exist as both HA and TUP.
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

    v_perf := case
      when r.actual_output is not null and v_norm is not null and v_norm > 0 and v_minutes > 0
        then (r.actual_output / (v_norm * v_minutes / 60.0)) * 100.0
      else null
    end;

    v_oee := case
      when v_perf is not null and r.availability_pct is not null and v_capacity is not null and v_capacity > 0 and v_operator_count > 0
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
      if r.availability_pct is not null and isfinite(r.availability_pct::double precision) then
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

-- Recalculate whenever the item enters validation, after hourly rows have been
-- persisted by the import pipeline.
create or replace function public.recalculate_import_item_kpis_on_validating()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'VALIDATING' and old.status is distinct from new.status then
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

-- AUTO approval wrapper: recalculate canonical KPIs first. The hardened legacy
-- worker expects hourly KPI values, so feed it a temporary one-row canonical
-- summary and restore the original OCR hourly array after the worker returns.
create or replace function public.auto_approve_import_item(p_import_item_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_item public.import_items%rowtype;
  v_original_hourly jsonb;
  v_canonical_hourly jsonb;
  v_legacy jsonb;
  v_perf numeric;
  v_avail numeric;
  v_oee numeric;
begin
  select * into v_item
  from public.import_items
  where id = p_import_item_id
    and status = 'VALIDATING'
  for update;

  if not found then
    raise exception 'AUTO import není ve stavu VALIDATING nebo neexistuje.' using errcode = 'P0002';
  end if;

  perform public.recalculate_import_item_kpis(p_import_item_id);

  select * into v_item from public.import_items where id = p_import_item_id for update;
  v_original_hourly := coalesce(v_item.ocr_data -> 'hourly_metrics', '[]'::jsonb);
  v_perf := nullif(v_item.ocr_data ->> 'actual_shift_performance_pct', '')::numeric;
  v_avail := nullif(v_item.ocr_data ->> 'actual_shift_availability_pct', '')::numeric;
  v_oee := nullif(v_item.ocr_data ->> 'actual_shift_oee_pct', '')::numeric;

  if v_perf is null or v_avail is null or v_oee is null then
    return public.auto_approve_import_item_legacy(p_import_item_id);
  end if;

  v_canonical_hourly := jsonb_build_array(jsonb_build_object(
    'performance_pct', v_perf,
    'availability_pct', v_avail
  ));

  update public.import_items
  set ocr_data = jsonb_set(coalesce(ocr_data, '{}'::jsonb), '{hourly_metrics}', v_canonical_hourly, true)
  where id = p_import_item_id;

  v_legacy := public.auto_approve_import_item_legacy(p_import_item_id);

  update public.import_items
  set ocr_data = jsonb_set(
    jsonb_set(coalesce(ocr_data, '{}'::jsonb), '{hourly_metrics}', v_original_hourly, true),
    '{actual_shift_performance_pct}', to_jsonb(v_perf), true
  )
  where id = p_import_item_id;

  return v_legacy;
end;
$$;

grant execute on function public.auto_approve_import_item(uuid) to authenticated;

-- Manual approval follows the same canonical KPI path. The existing hardened
-- approval worker is renamed once and wrapped with the same temporary summary.
do $$
begin
  if to_regprocedure('public.approve_import_item_legacy(uuid,uuid)') is null
     and to_regprocedure('public.approve_import_item(uuid,uuid)') is not null then
    alter function public.approve_import_item(uuid, uuid) rename to approve_import_item_legacy;
  end if;
end;
$$;

create or replace function public.approve_import_item(p_import_item_id uuid, p_actor_id uuid default auth.uid())
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_item public.import_items%rowtype;
  v_original_hourly jsonb;
  v_canonical_hourly jsonb;
  v_legacy jsonb;
  v_perf numeric;
  v_avail numeric;
  v_oee numeric;
begin
  select * into v_item
  from public.import_items
  where id = p_import_item_id
    and status = 'PENDING_APPROVAL'
  for update;

  if not found then
    raise exception 'Import není ve stavu PENDING_APPROVAL nebo neexistuje.' using errcode = 'P0002';
  end if;

  -- Re-run the canonical model even for a manually corrected item.
  perform public.recalculate_import_item_kpis(p_import_item_id);

  select * into v_item from public.import_items where id = p_import_item_id for update;
  v_original_hourly := coalesce(v_item.ocr_data -> 'hourly_metrics', '[]'::jsonb);
  v_perf := nullif(v_item.ocr_data ->> 'actual_shift_performance_pct', '')::numeric;
  v_avail := nullif(v_item.ocr_data ->> 'actual_shift_availability_pct', '')::numeric;
  v_oee := nullif(v_item.ocr_data ->> 'actual_shift_oee_pct', '')::numeric;

  if v_perf is null or v_avail is null or v_oee is null then
    raise exception 'Import obsahuje neplatné nebo chybějící kanonické KPI.' using errcode = 'P0001';
  end if;

  v_canonical_hourly := jsonb_build_array(jsonb_build_object(
    'performance_pct', v_perf,
    'availability_pct', v_avail
  ));

  update public.import_items
  set ocr_data = jsonb_set(coalesce(ocr_data, '{}'::jsonb), '{hourly_metrics}', v_canonical_hourly, true)
  where id = p_import_item_id;

  v_legacy := public.approve_import_item_legacy(p_import_item_id, p_actor_id);

  -- Preserve the original hourly OCR evidence while retaining canonical shift KPI.
  update public.import_items
  set ocr_data = jsonb_set(
    jsonb_set(
      jsonb_set(coalesce(ocr_data, '{}'::jsonb), '{hourly_metrics}', v_original_hourly, true),
      '{actual_shift_performance_pct}', to_jsonb(v_perf), true
    ),
    '{actual_shift_availability_pct}', to_jsonb(v_avail), true
  )
  where id = p_import_item_id;

  return v_legacy;
end;
$$;

grant execute on function public.approve_import_item(uuid, uuid) to authenticated;

-- Keep the canonical values available for existing approved staging rows too.
-- This does not alter daily_records; it only repairs the Version 2.0 AUTO staging
-- source of truth when the function is explicitly called.
comment on function public.auto_shift_productive_minutes(text, integer, text)
is '2.0 AUTO canonical shift clock: 438 productive minutes per full shift; setup 7m, break 30m, cleanup 5m.';
