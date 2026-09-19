-- Master Prompt body 4-5 (ANOMÁLNÍ HODINY / STATISTICKÁ IZOLACE):
-- introduces a per-hour statistical inclusion state machine so a single
-- hour whose effective production time can't be reliably reconstructed can
-- be reviewed and, if needed, excluded from statistics WITHOUT deleting or
-- changing any original production data, and WITHOUT affecting the rest of
-- the day/employee/product/line (bod 4.3: exclusion is per-hour, never
-- automatically per-day/employee/product/line).
--
-- States (bod 4.4), stored on import_item_hourly.stat_status:
--   INCLUDED               - normal, counts in every aggregate (default)
--   ANOMALY_PENDING_REVIEW - automatically flagged by
--                            reconstruct_import_item_hourly() when the
--                            hour's minutes are themselves DERIVED
--                            (uncertain reconstruction, not the fixed shift
--                            clock) AND the resulting performance/OEE is
--                            implausible (>200%, matching the same 200%
--                            threshold already used for
--                            IMPLAUSIBLE_PERFORMANCE_PCT in
--                            run_data_integrity_audit() and the hard
--                            >200% trigger in detect_performance_anomalies())
--                            - excluded from aggregation until a human
--                            decides, the same "pending = not yet counted"
--                            pattern already used for import approval.
--   MANUALLY_INCLUDED       - a human reviewed it and decided to keep it in
--                            statistics despite being flagged (or despite
--                            looking unusual).
--   MANUALLY_EXCLUDED       - a human reviewed it and decided to exclude it.
-- MANUALLY_INCLUDED/MANUALLY_EXCLUDED are never silently overwritten by a
-- later automatic recompute (bod 6: "Ruční rozhodnutí nesmí automatický
-- přepočet tiše zrušit").

alter table public.import_item_hourly
  add column if not exists stat_status text not null default 'INCLUDED';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'import_item_hourly_stat_status_check'
  ) then
    alter table public.import_item_hourly
      add constraint import_item_hourly_stat_status_check
      check (stat_status in ('INCLUDED', 'ANOMALY_PENDING_REVIEW', 'MANUALLY_INCLUDED', 'MANUALLY_EXCLUDED'));
  end if;
end $$;

create index if not exists idx_import_item_hourly_stat_status
  on public.import_item_hourly(stat_status)
  where stat_status <> 'INCLUDED';

-- Audit trail (bod 4.5): who decided, when, previous/new state, reason,
-- free-text note. Mirrors import_item_events' shape/RLS pattern.
create table if not exists public.import_item_hourly_stat_events (
  id uuid primary key default gen_random_uuid(),
  import_item_hourly_id uuid not null references public.import_item_hourly(id) on delete cascade,
  actor_id uuid null,
  created_at timestamptz not null default now(),
  from_status text,
  to_status text not null,
  reason text,
  note text
);

create index if not exists idx_import_item_hourly_stat_events_hourly_id
  on public.import_item_hourly_stat_events(import_item_hourly_id);

alter table public.import_item_hourly_stat_events enable row level security;

drop policy if exists import_item_hourly_stat_events_admin_all on public.import_item_hourly_stat_events;
create policy import_item_hourly_stat_events_admin_all
on public.import_item_hourly_stat_events
for all to authenticated
using (public.has_role(auth.uid(), 'admin'))
with check (public.has_role(auth.uid(), 'admin'));

grant all on public.import_item_hourly_stat_events to service_role;

-- reconstruct_import_item_hourly(): same body as
-- 20260917230000_fix_teff_availability_double_count.sql, with stat_status
-- auto-classification added at the very end of the per-hour loop.
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
    v_avail_for_oee := case when v_minutes_is_activity_derived then 100 else v_avail end;

    v_oee := case
      when v_perf is not null and v_avail_for_oee is not null
      then v_perf * v_avail_for_oee / 100.0
      else null
    end;

    -- Master Prompt bod 4.1/4.4: an hour is flagged ANOMALY_PENDING_REVIEW
    -- only when BOTH (a) its productive minutes are themselves DERIVED
    -- (uncertain reconstruction - the fixed shift-clock sources CLOCK/EMPTY
    -- are not "cannot reliably determine effective time") AND (b) the
    -- resulting performance/OEE is implausible (>200%, or OEE < 0) - the
    -- same 200% threshold already established elsewhere in this codebase
    -- (IMPLAUSIBLE_PERFORMANCE_PCT, detect_performance_anomalies' hard
    -- trigger). A manual decision (MANUALLY_INCLUDED/MANUALLY_EXCLUDED) is
    -- never silently overwritten by this automatic (re)classification.
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
            'model_version', '2.01-AUTO-reconstruction-v22',
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

-- compute_import_item_product_kpis() / recalculate_import_item_kpis():
-- exclude ANOMALY_PENDING_REVIEW / MANUALLY_EXCLUDED hours from every
-- weighted average so bod 5 ("statistická izolace vyřazené hodiny") holds
-- automatically for every downstream consumer - daily_records is the sole
-- source for all daily/weekly/monthly/quarterly/dashboard aggregates, so
-- filtering it out here is the single place this needs to happen.
create or replace function public.compute_import_item_product_kpis(p_import_item_id uuid, p_work_date date default current_date)
returns table (
  product_code text,
  product_id uuid,
  product_name text,
  profile_id uuid,
  profile_complete boolean,
  performance numeric,
  availability numeric,
  oee numeric
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  r record;
begin
  for r in
    with resolved_hours as (
      select
        h.performance_pct,
        h.availability_pct,
        h.actual_oee_pct,
        coalesce(
          nullif(trim(coalesce(h.raw_data -> 'calculation' ->> 'reconstructed_productive_minutes', '')), '')::double precision,
          0
        ) as minutes,
        h.product_code as raw_code,
        rp.product_id as resolved_product_id,
        rp.product_name as resolved_product_name,
        rp.profile_id as resolved_profile_id,
        rp.profile_complete as resolved_profile_complete,
        coalesce(
          rp.product_id::text,
          'unresolved:' || lower(regexp_replace(coalesce(h.product_code, ''), '\s+', '', 'g'))
        ) as group_key
      from public.import_item_hourly h
      left join lateral public.resolve_product_profile(h.product_code, p_work_date) rp on true
      where h.import_item_id = p_import_item_id
        and nullif(trim(coalesce(h.product_code, '')), '') is not null
        and coalesce(h.stat_status, 'INCLUDED') not in ('ANOMALY_PENDING_REVIEW', 'MANUALLY_EXCLUDED')
    )
    select
      (array_agg(raw_code order by raw_code))[1] as pcode,
      (array_agg(resolved_product_id) filter (where resolved_product_id is not null))[1] as rid,
      (array_agg(resolved_product_name) filter (where resolved_product_name is not null))[1] as rname,
      (array_agg(resolved_profile_id) filter (where resolved_profile_id is not null))[1] as rprofile,
      bool_or(coalesce(resolved_profile_complete, false)) as rcomplete,
      case when sum(minutes) filter (where performance_pct is not null) > 0
        then sum(performance_pct * minutes) filter (where performance_pct is not null) / sum(minutes) filter (where performance_pct is not null)
        else null end as perf,
      case when sum(minutes) filter (where availability_pct is not null) > 0
        then sum(availability_pct * minutes) filter (where availability_pct is not null) / sum(minutes) filter (where availability_pct is not null)
        else null end as avail,
      case when sum(minutes) filter (where actual_oee_pct is not null) > 0
        then sum(actual_oee_pct * minutes) filter (where actual_oee_pct is not null) / sum(minutes) filter (where actual_oee_pct is not null)
        else null end as oee_val
    from resolved_hours
    group by group_key
  loop
    product_code := r.pcode;
    product_id := r.rid;
    product_name := r.rname;
    profile_id := r.rprofile;
    profile_complete := r.rcomplete;
    performance := r.perf;
    availability := r.avail;
    oee := r.oee_val;
    return next;
  end loop;
  return;
end;
$$;

create or replace function public.recalculate_import_item_kpis(p_import_item_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_perf_total double precision := 0;
  v_perf_weight double precision := 0;
  v_avail_total double precision := 0;
  v_avail_weight double precision := 0;
  v_oee_total double precision := 0;
  v_oee_weight double precision := 0;
  v_shift_perf double precision;
  v_shift_avail double precision;
  v_shift_oee double precision;
begin
  perform public.reconstruct_import_item_hourly(p_import_item_id);

  select
    coalesce(sum(h.performance_pct * w.minutes) filter (where h.performance_pct is not null), 0),
    coalesce(sum(w.minutes) filter (where h.performance_pct is not null), 0),
    coalesce(sum(h.availability_pct * w.minutes) filter (where h.availability_pct is not null), 0),
    coalesce(sum(w.minutes) filter (where h.availability_pct is not null), 0),
    coalesce(sum(h.actual_oee_pct * w.minutes) filter (where h.actual_oee_pct is not null), 0),
    coalesce(sum(w.minutes) filter (where h.actual_oee_pct is not null), 0)
  into v_perf_total, v_perf_weight, v_avail_total, v_avail_weight, v_oee_total, v_oee_weight
  from public.import_item_hourly h
  cross join lateral (
    select coalesce(
      nullif(trim(coalesce(h.raw_data -> 'calculation' ->> 'reconstructed_productive_minutes', '')), '')::double precision,
      0
    ) as minutes
  ) w
  where h.import_item_id = p_import_item_id
    and coalesce(h.stat_status, 'INCLUDED') not in ('ANOMALY_PENDING_REVIEW', 'MANUALLY_EXCLUDED');

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
        'kpi_model_version', '2.01-AUTO-reconstruction-v22'
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
    '{kpi_model_version}', to_jsonb('2.01-AUTO-reconstruction-v22'::text), true
  )
  where id = p_import_item_id;
end;
$$;

-- Recomputes daily_records for every product on an already-approved
-- import_item from its current import_item_hourly state (respecting
-- stat_status exclusions) - the same per-product update
-- apply_ha_tup_capping()/_historical_recompute_run() already perform,
-- exposed standalone so a manual include/exclude decision can refresh the
-- live daily_records row it affects without re-running the whole approval
-- or HA->TUP linkage pipeline.
create or replace function public.refresh_daily_records_for_import_item(p_import_item_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item public.import_items%rowtype;
  v_product record;
  v_updated integer := 0;
begin
  select * into v_item from public.import_items where id = p_import_item_id;
  if not found or v_item.work_date is null then
    return jsonb_build_object('status', 'SKIPPED', 'reason', 'missing_header');
  end if;

  for v_product in select * from public.compute_import_item_product_kpis(p_import_item_id, v_item.work_date) loop
    if v_product.product_id is null then
      continue;
    end if;
    update public.daily_records
    set oee = round(v_product.oee, 2), performance = round(v_product.performance, 2), available_time = round(v_product.availability, 2)
    where import_batch_id = v_item.batch_id
      and work_date = v_item.work_date
      and shift = v_item.shift
      and line = v_item.line
      and product_id = v_product.product_id;
    if found then
      v_updated := v_updated + 1;
    end if;
  end loop;

  return jsonb_build_object('status', 'REFRESHED', 'daily_records_updated', v_updated);
end;
$$;

grant execute on function public.refresh_daily_records_for_import_item(uuid) to authenticated;

-- Bod 3.5: the only human-facing entry point for a manual include/exclude
-- decision. SECURITY DEFINER (needs to write import_item_hourly +
-- daily_records + insert the audit row atomically regardless of the
-- caller's own RLS), so admin membership is checked explicitly here -
-- this bypasses RLS, so the check cannot be left to policies alone.
create or replace function public.set_hourly_stat_status(
  p_hourly_id uuid,
  p_new_status text,
  p_reason text default null,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hourly public.import_item_hourly%rowtype;
  v_old_status text;
begin
  if not public.has_role(auth.uid(), 'admin') then
    raise exception 'Pouze administrátor může měnit statistický stav hodinového záznamu.' using errcode = '42501';
  end if;

  if p_new_status not in ('MANUALLY_INCLUDED', 'MANUALLY_EXCLUDED') then
    raise exception 'Neplatný nový stav: %. Ruční rozhodnutí musí být MANUALLY_INCLUDED nebo MANUALLY_EXCLUDED.', p_new_status using errcode = '22023';
  end if;

  select * into v_hourly from public.import_item_hourly where id = p_hourly_id for update;
  if not found then
    raise exception 'Hodinový záznam nenalezen.' using errcode = 'P0002';
  end if;

  v_old_status := v_hourly.stat_status;

  update public.import_item_hourly
  set stat_status = p_new_status
  where id = p_hourly_id;

  insert into public.import_item_hourly_stat_events (import_item_hourly_id, actor_id, from_status, to_status, reason, note)
  values (p_hourly_id, auth.uid(), v_old_status, p_new_status, p_reason, p_note);

  perform public.refresh_daily_records_for_import_item(v_hourly.import_item_id);

  return jsonb_build_object('status', 'OK', 'from_status', v_old_status, 'to_status', p_new_status);
end;
$$;

grant execute on function public.set_hourly_stat_status(uuid, text, text, text) to authenticated;

-- Admin-facing review list (bod 3.5): every hour currently pending review
-- or manually excluded, enriched with its import context so an admin can
-- find it without hunting through daily records one at a time.
create or replace function public.list_hourly_stat_review(
  p_statuses text[] default array['ANOMALY_PENDING_REVIEW', 'MANUALLY_EXCLUDED']
)
returns table (
  hourly_id uuid,
  import_item_id uuid,
  hour integer,
  product_code text,
  actual_output numeric,
  performance_pct numeric,
  availability_pct numeric,
  actual_oee_pct numeric,
  stat_status text,
  work_date date,
  shift text,
  line text,
  trace_id text,
  reconstruction_status text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    h.id, h.import_item_id, h.hour, h.product_code, h.actual_output, h.performance_pct, h.availability_pct, h.actual_oee_pct, h.stat_status,
    i.work_date, i.shift, i.line,
    i.trace_id,
    h.raw_data -> 'calculation' ->> 'reconstruction_status'
  from public.import_item_hourly h
  join public.import_items i on i.id = h.import_item_id
  where h.stat_status = any(p_statuses)
    and i.status in ('AUTO_APPROVED', 'APPROVED')
  order by i.work_date desc, h.hour;
$$;

grant execute on function public.list_hourly_stat_review(text[]) to authenticated;
