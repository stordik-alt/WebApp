-- The user ran a real historical recompute and reported "records aren't
-- showing in KE SCHVÁLENÍ" afterward. Investigated: KE SCHVÁLENÍ was
-- correctly empty (0 PENDING_APPROVAL items exist - historical_recompute_*
-- only ever touches already-approved items, so it can never make a pending
-- one disappear). But the recompute DID report "1 needs_review", and there
-- was no way anywhere in the UI to see which record that was - just a bare
-- count. Confirmed the actual item: an already-APPROVED daily_records row
-- for product T_S4962V3520, which has zero Product Profile at all
-- (resolve_product_profile returns EXACT_NO_PROFILE) - correctly left at
-- its last-known-good values rather than corrupted with nulls, but silently
-- so.
--
-- _historical_recompute_run() now collects the same kind of detail array
-- for needs_review as it already does for errors, so the report is
-- actionable instead of just a number.
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
  v_needs_review_list jsonb := '[]'::jsonb;
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

      for v_product in select * from compute_import_item_product_kpis(v_item.id, v_item.work_date) loop
        if v_product.product_id is null or v_product.performance is null or v_product.availability is null or v_product.oee is null then
          v_needs_review := v_needs_review + 1;
          v_needs_review_list := v_needs_review_list || jsonb_build_object(
            'import_item_id', v_item.id,
            'work_date', v_item.work_date,
            'line', v_item.line,
            'product_code', v_product.product_code,
            'reason', case
              when v_product.product_id is null then 'Produkt nenalezen v databázi'
              when not coalesce(v_product.profile_complete, false) then 'Product Profile chybí nebo není kompletní'
              else 'KPI se nepodařilo dopočítat'
            end
          );
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

  declare v_batch_id uuid;
  begin
    foreach v_batch_id in array v_batches loop
      perform evaluate_batch_ha_tup_linkage(v_batch_id);
    end loop;
  end;

  return jsonb_build_object(
    'total', v_total, 'changed', v_changed, 'unchanged', v_unchanged,
    'needs_review', v_needs_review, 'needs_review_details', v_needs_review_list,
    'errors', v_errors, 'error_details', v_error_list,
    'batches_relinked', array_length(v_batches, 1)
  );
end;
$$;
