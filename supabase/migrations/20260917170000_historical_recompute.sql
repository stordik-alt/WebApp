-- Master Prompt Problem 10: bulk-recompute all existing approved records
-- with the CURRENT calculation logic, without deleting history, without
-- re-importing screenshots, and without creating new production records -
-- purely: load the already-stored input data, apply today's rules, update
-- the derived results in place.
--
-- What counts as "input" vs "derived" (per the doc's explicit warning not to
-- confuse them) was established by reading reconstruct_import_item_hourly()
-- itself: import_item_hourly.actual_output, .availability_pct and the
-- OCR-era keys of .raw_data (downtime_minutes/downtime_reason/
-- ocr_norm_per_hour - never raw_data.calculation, which that function
-- itself writes) are true input, never touched by any recompute. norm_per_hour,
-- capacity, operator_count, performance_pct, actual_oee_pct and
-- raw_data.calculation are derived and safe to overwrite. product_profiles
-- is read live/current, so a corrected profile is automatically picked up.
--
-- Two entry points:
--   historical_recompute_preview() - a TRUE dry run. Runs the exact same
--     recompute inside a nested PL/pgSQL exception block, which PostgreSQL
--     implicitly treats as a savepoint: every write made inside is rolled
--     back the moment the block deliberately raises at the end, while the
--     counts already captured in local variables survive to be returned.
--     No caller-visible transaction is ever left half-committed.
--   historical_recompute_apply() - the real, committing recompute. Only
--     ever UPDATEs existing import_item_hourly/daily_records rows matched
--     by their existing identity (import_item_id / batch+work_date+shift+
--     line+product_id) - never inserts a new daily_record and never
--     deletes anything. Re-running it against unchanged inputs recomputes
--     to the same outputs (idempotent) and reapplies HA->TUP linkage
--     through the already-idempotent evaluate_batch_ha_tup_linkage().
--     A per-item failure is caught and reported, never aborts the batch,
--     and never leaves a record with corrupted/null KPIs - a failed item's
--     daily_records are simply left at their last-known-good values.

create or replace function public._historical_recompute_run(
  p_work_date_from date,
  p_work_date_to date,
  p_sample_limit integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item record;
  v_total integer := 0;
  v_changed integer := 0;
  v_unchanged integer := 0;
  v_errors integer := 0;
  v_needs_review integer := 0;
  v_error_list jsonb := '[]'::jsonb;
  v_batches uuid[] := '{}';
  v_before jsonb;
  v_after jsonb;
  v_product record;
begin
  for v_item in
    select i.id, i.batch_id, i.work_date, i.shift, i.line
    from import_items i
    where i.status in ('AUTO_APPROVED', 'APPROVED')
      and (p_work_date_from is null or i.work_date >= p_work_date_from)
      and (p_work_date_to is null or i.work_date <= p_work_date_to)
    order by i.work_date, i.id
    limit p_sample_limit
  loop
    v_total := v_total + 1;
    begin
      select jsonb_agg(jsonb_build_object('id', id, 'performance_pct', performance_pct, 'availability_pct', availability_pct, 'actual_oee_pct', actual_oee_pct) order by id)
      into v_before from import_item_hourly where import_item_id = v_item.id;

      perform reconstruct_import_item_hourly(v_item.id);

      select jsonb_agg(jsonb_build_object('id', id, 'performance_pct', performance_pct, 'availability_pct', availability_pct, 'actual_oee_pct', actual_oee_pct) order by id)
      into v_after from import_item_hourly where import_item_id = v_item.id;

      if v_before is distinct from v_after then v_changed := v_changed + 1; else v_unchanged := v_unchanged + 1; end if;

      -- Refresh daily_records for every product this item produced, matched
      -- by its existing (batch, date, shift, line, product) identity - never
      -- inserted, never deleted. A product whose recompute can no longer
      -- resolve a complete profile/KPI is left untouched and flagged rather
      -- than overwritten with nulls.
      for v_product in select * from compute_import_item_product_kpis(v_item.id, v_item.work_date) loop
        if v_product.product_id is null or v_product.performance is null or v_product.availability is null or v_product.oee is null then
          v_needs_review := v_needs_review + 1;
          continue;
        end if;
        update daily_records
        set oee = round(v_product.oee, 2), performance = round(v_product.performance, 2), available_time = round(v_product.availability, 2)
        where import_batch_id = v_item.batch_id and work_date = v_item.work_date and shift = v_item.shift and line = v_item.line and product_id = v_product.product_id;
      end loop;

      if v_item.batch_id is not null and not (v_item.batch_id = any(v_batches)) then
        v_batches := v_batches || v_item.batch_id;
      end if;
    exception when others then
      v_errors := v_errors + 1;
      v_error_list := v_error_list || jsonb_build_object('import_item_id', v_item.id, 'work_date', v_item.work_date, 'error', sqlerrm);
    end;
  end loop;

  -- Reapply HA->TUP linkage fresh on top of the just-reconstructed
  -- (uncapped) values - reconstruct_import_item_hourly has no knowledge of
  -- capping, so any previously-applied capping must be redone here or the
  -- stale ha_tup_linkage audit trail would no longer match the numbers.
  declare v_batch_id uuid;
  begin
    foreach v_batch_id in array v_batches loop
      perform evaluate_batch_ha_tup_linkage(v_batch_id);
    end loop;
  end;

  return jsonb_build_object(
    'total', v_total, 'changed', v_changed, 'unchanged', v_unchanged,
    'needs_review', v_needs_review, 'errors', v_errors, 'error_details', v_error_list,
    'batches_relinked', array_length(v_batches, 1)
  );
end;
$$;

create or replace function public.historical_recompute_preview(
  p_work_date_from date default null,
  p_work_date_to date default null,
  p_sample_limit integer default 50
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_result jsonb;
begin
  begin
    v_result := public._historical_recompute_run(p_work_date_from, p_work_date_to, p_sample_limit);
    raise exception 'DRY_RUN_ROLLBACK';
  exception when others then
    if sqlerrm <> 'DRY_RUN_ROLLBACK' then
      raise;
    end if;
  end;
  return v_result || jsonb_build_object('dry_run', true);
end;
$$;

create or replace function public.historical_recompute_apply(
  p_work_date_from date default null,
  p_work_date_to date default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_result jsonb;
begin
  v_result := public._historical_recompute_run(p_work_date_from, p_work_date_to, null);
  return v_result || jsonb_build_object('dry_run', false);
end;
$$;

grant execute on function public.historical_recompute_preview(date, date, integer) to authenticated;
grant execute on function public.historical_recompute_apply(date, date) to authenticated;
