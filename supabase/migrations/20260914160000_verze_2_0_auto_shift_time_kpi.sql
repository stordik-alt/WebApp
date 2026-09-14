-- Verze 2.0 AUTO
-- Oprava výpočtu Výkonu a OEE podle skutečné pracovní doby směny.
--
-- Směna trvá 8:00 hodin kalendářního času, z toho:
--   0:30 pauza = 7:30 čisté pracovní směny
--   0:07 příprava linky na začátku směny
--   0:05 úklid linky na konci směny
-- => výrobní čas pro normu = 7:18 = 438 minut.
--
-- Směny:
--   Ranní      06:00–14:00, pauza 10:40–11:10
--   Odpolední  14:00–22:00, pauza 18:00–18:30
--   Noční      22:00–06:00, pauza 02:00–02:30
--
-- Výpočet pracuje s překryvem skutečných intervalů. Pauza 10:40–11:10
-- tedy správně odečte 20 minut z hodiny 10 a 10 minut z hodiny 11.
-- První hodina směny má 53 výrobních minut a poslední 55 minut.

create or replace function public.auto_shift_start_minute(p_shift text)
returns integer
language plpgsql
immutable
as $$
begin
  return case
    when lower(trim(coalesce(p_shift, ''))) in ('ranní', 'ranni') then 6 * 60
    when lower(trim(coalesce(p_shift, ''))) in ('odpolední', 'odpoledni') then 14 * 60
    when lower(trim(coalesce(p_shift, ''))) in ('noční', 'nocni', 'noční směna', 'nocni smena') then 22 * 60
    else null
  end;
end;
$$;

create or replace function public.auto_shift_productive_minutes(
  p_shift text,
  p_hour integer,
  p_screenshot_time text default null,
  p_is_last_hour boolean default false
)
returns numeric
language plpgsql
immutable
as $$
declare
  v_shift_start integer;
  v_hour_start integer;
  v_hour_end integer;
  v_clip_end integer;
  v_pause_start integer;
  v_pause_end integer;
  v_setup_start integer;
  v_setup_end integer;
  v_cleanup_start integer;
  v_cleanup_end integer;
  v_screenshot_minute integer;
  v_screenshot_abs integer;
  v_minutes numeric;
begin
  if p_hour is null then
    return null;
  end if;

  v_shift_start := public.auto_shift_start_minute(p_shift);
  if v_shift_start is null then
    return 60;
  end if;

  -- Převod hodinové hodnoty (včetně 0–5 u noční směny) do časové osy
  -- konkrétní směny začínající v 06:00/14:00/22:00.
  v_hour_start := v_shift_start + mod((p_hour * 60 - v_shift_start + 1440), 1440);
  v_hour_end := v_hour_start + 60;

  -- Výrobní okno směny bez 7min přípravy a 5min úklidu.
  v_setup_start := v_shift_start;
  v_setup_end := v_shift_start + 7;
  v_cleanup_start := v_shift_start + 8 * 60 - 5;
  v_cleanup_end := v_shift_start + 8 * 60;

  -- Pauza podle směny.
  if lower(trim(coalesce(p_shift, ''))) in ('ranní', 'ranni') then
    v_pause_start := 10 * 60 + 40;
    v_pause_end := 11 * 60 + 10;
  elsif lower(trim(coalesce(p_shift, ''))) in ('odpolední', 'odpoledni') then
    v_pause_start := 18 * 60;
    v_pause_end := 18 * 60 + 30;
  elsif lower(trim(coalesce(p_shift, ''))) in ('noční', 'nocni', 'noční směna', 'nocni smena') then
    v_pause_start := 24 * 60 + 2 * 60;
    v_pause_end := 24 * 60 + 2 * 60 + 30;
  else
    v_pause_start := null;
    v_pause_end := null;
  end if;

  -- Oříznutí poslední viditelné hodiny na skutečný čas screenshotu.
  -- Při přesné celé hodině zachováváme dosavadní význam: poslední řádek
  -- představuje právě dokončenou hodinu.
  v_clip_end := v_hour_end;
  if p_is_last_hour and p_screenshot_time ~ '^(?:[01][0-9]|2[0-3]):[0-5][0-9]$' then
    v_screenshot_minute := split_part(p_screenshot_time, ':', 1)::integer * 60
                           + split_part(p_screenshot_time, ':', 2)::integer;
    v_screenshot_abs := v_shift_start + mod((v_screenshot_minute - v_shift_start + 1440), 1440);
    if split_part(p_screenshot_time, ':', 2)::integer <> 0 then
      v_clip_end := least(v_hour_end, v_screenshot_abs);
    end if;
  end if;

  if v_clip_end <= v_hour_start then
    return 0;
  end if;

  v_minutes := v_clip_end - v_hour_start;

  -- Odečti přípravu linky.
  v_minutes := v_minutes - greatest(
    0,
    least(v_clip_end, v_setup_end) - greatest(v_hour_start, v_setup_start)
  );

  -- Odečti úklid linky.
  v_minutes := v_minutes - greatest(
    0,
    least(v_clip_end, v_cleanup_end) - greatest(v_hour_start, v_cleanup_start)
  );

  -- Odečti pauzu.
  if v_pause_start is not null then
    v_minutes := v_minutes - greatest(
      0,
      least(v_clip_end, v_pause_end) - greatest(v_hour_start, v_pause_start)
    );
  end if;

  return greatest(0, least(60, v_minutes));
end;
$$;

revoke all on function public.auto_shift_start_minute(text) from public;
grant execute on function public.auto_shift_start_minute(text) to authenticated;
revoke all on function public.auto_shift_productive_minutes(text, integer, text, boolean) from public;
grant execute on function public.auto_shift_productive_minutes(text, integer, text, boolean) to authenticated;

-- Kanonický přepočet KPI pro 2.0 AUTO.
-- Důležité: Výkon/OEE se zde přepočítají z reálného výstupu a Product Profile,
-- nikoliv z OCR hodnot výkonu pracovníků.
create or replace function public.recalculate_import_item_kpis(p_import_item_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
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
  select * into v_shift
  from public.import_items
  where id = p_import_item_id;

  if v_shift is null then
    return;
  end if;

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
    nullif(ocr_data ->> 'screenshot_time', ''),
    nullif(ocr_data ->> 'screenshotTime', ''),
    nullif(ocr_data ->> 'actual_time', ''),
    nullif(ocr_data ->> 'time', '')
  ) into v_screenshot_time
  from public.import_items
  where id = p_import_item_id;

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

    -- Hodinový Výkon = skutečný výstup / efektivní norma pro skutečný
    -- výrobní čas hodiny × 100.
    v_perf := case
      when r.actual_output is not null and v_norm is not null and v_norm > 0 and v_weight > 0
        then (r.actual_output / (v_norm * v_weight / 60.0)) * 100.0
      else null
    end;

    -- Hodinové OEE = Výkon × Dostupnost × (kapacita / počet operátorů) / 100.
    v_oee := case
      when v_perf is not null and r.availability_pct is not null and v_capacity is not null and v_capacity > 0
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
            'shift', v_shift,
            'shift_start', case when public.auto_shift_start_minute(v_shift) = 360 then '06:00' when public.auto_shift_start_minute(v_shift) = 840 then '14:00' when public.auto_shift_start_minute(v_shift) = 1320 then '22:00' else null end,
            'shift_duration_minutes', 480,
            'scheduled_break_minutes', 30,
            'start_preparation_minutes', 7,
            'end_cleanup_minutes', 5,
            'standard_productive_minutes', 438,
            'effective_productive_minutes', v_weight,
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

-- AUTO schválení musí zachovat stejné kanonické KPI, které spočítala DB.
-- Původní verze zde znovu dělala prostý AVG hodinových hodnot a tím mohla
-- ztratit časové vážení. Proto nyní vždy nejprve spustí kanonický přepočet.
create or replace function public.auto_approve_import_item(p_import_item_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_item public.import_items%rowtype;
  v_performance numeric;
  v_availability numeric;
  v_shift_oee numeric;
  v_now timestamptz := now();
  v_legacy jsonb;
begin
  select * into v_item
  from public.import_items
  where id = p_import_item_id
    and status = 'VALIDATING'
  for update;

  if not found then
    raise exception 'AUTO import není ve stavu VALIDATING nebo neexistuje.' using errcode = 'P0002';
  end if;

  -- Jediný zdroj KPI.
  perform public.recalculate_import_item_kpis(p_import_item_id);

  select
    nullif(trim(ocr_data ->> 'actual_shift_performance_pct'), '')::numeric,
    nullif(trim(ocr_data ->> 'actual_shift_availability_pct'), '')::numeric,
    nullif(trim(ocr_data ->> 'actual_shift_oee_pct'), '')::numeric
  into v_performance, v_availability, v_shift_oee
  from public.import_items
  where id = p_import_item_id;

  update public.import_item_rows
  set performance = v_performance,
      available_time = v_availability,
      oee = v_shift_oee,
      raw_data = jsonb_set(
        jsonb_set(
          jsonb_set(coalesce(raw_data, '{}'::jsonb), '{performance}', to_jsonb(v_performance), true),
          '{available_time}', to_jsonb(v_availability), true),
        '{oee}', to_jsonb(v_shift_oee), true),
      updated_at = v_now
  where import_item_id = p_import_item_id
    and daily_record_id is null;

  v_legacy := public.auto_approve_import_item_legacy(p_import_item_id);
  return v_legacy;
end;
$$;

grant execute on function public.auto_approve_import_item(uuid) to authenticated;

-- Dokumentace modelu přímo v DB pro audit a budoucí vývoj.
comment on function public.auto_shift_productive_minutes(text, integer, text, boolean)
is '2.0 AUTO: produktivní minuty v hodině podle směny, 30min pauzy, 7min přípravy linky a 5min úklidu.';

comment on function public.recalculate_import_item_kpis(uuid)
is '2.0 AUTO: kanonický výpočet Výkonu/OEE s časovým modelem směny 8h - 30min pauza - 7min příprava - 5min úklid = 438 výrobních minut.';
