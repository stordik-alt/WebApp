-- Regression fix: recalculate_import_item_kpis(uuid) was dropped as
-- "unused legacy" in 20260916200000, but 4 functions still call it
-- internally (auto_approve_import_item, approve_import_item,
-- revalidate_import_item_after_admin_header_save,
-- ensure_import_item_canonical_kpi_before_validation) — confirmed via
-- `select proname from pg_proc where prosrc ilike '%recalculate_import_item_kpis%'`.
-- This broke every live import: the VALIDATING-transition trigger chain
-- calls it before reconstruct_import_item_hourly even runs, so the whole
-- transaction failed with "function ... does not exist".
--
-- What was actually legacy was its OLD internal formula for
-- import_item_hourly (the pre-V19 CLASSIC/TEFF split, now fully superseded
-- by reconstruct_import_item_hourly). What callers genuinely still need is
-- its OTHER job: aggregating the (now V19-correct) hourly rows into
-- import_item_rows.performance/available_time/oee and
-- import_items.ocr_data.actual_shift_*_pct, which nothing else computes.
-- This restores the function under the same name/signature so none of its
-- 4 callers need to change, but its body now just ensures the hourly rows
-- are fresh (calls reconstruct_import_item_hourly) and aggregates them,
-- weighted by each hour's reconstructed productive minutes.
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
  where h.import_item_id = p_import_item_id;

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
        'kpi_model_version', '2.01-AUTO-reconstruction-v19'
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
    '{kpi_model_version}', to_jsonb('2.01-AUTO-reconstruction-v19'::text), true
  )
  where id = p_import_item_id;
end;
$$;

grant execute on function public.recalculate_import_item_kpis(uuid) to authenticated;
