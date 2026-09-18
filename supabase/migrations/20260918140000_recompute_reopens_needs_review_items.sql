-- BUG FIX: _historical_recompute_run() could DETECT that a product's KPI
-- couldn't be recomputed (product not found / Product Profile missing or
-- incomplete / KPI failed) but never DID anything about it beyond returning
-- a one-time JSON report to the caller. The affected import_item stayed
-- AUTO_APPROVED/APPROVED with stale daily_records and never surfaced in
-- "Ke schválení" - the finding was lost the moment the admin closed the
-- recompute dialog, with no persistent trace anywhere in the database.
--
-- Fix: when a product needs review, reopen its import_item through the SAME
-- PENDING_APPROVAL queue every other blocked import already uses, with
-- pending_reasons set so the existing "Ke schválení" UI shows why. Products
-- that DID compute successfully in the same pass keep their already-applied
-- daily_records updates - only items with at least one broken product get
-- reopened, and only from AUTO_APPROVED/APPROVED (never touches an item a
-- human is already mid-review on).
create or replace function public._historical_recompute_run(p_work_date_from date, p_work_date_to date, p_sample_limit integer)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_item record;
  v_total integer := 0;
  v_changed integer := 0;
  v_unchanged integer := 0;
  v_errors integer := 0;
  v_needs_review integer := 0;
  v_reopened integer := 0;
  v_error_list jsonb := '[]'::jsonb;
  v_needs_review_list jsonb := '[]'::jsonb;
  v_batches uuid[] := '{}';
  v_before jsonb;
  v_after jsonb;
  v_product record;
  v_item_reasons jsonb;
  v_item_needs_review boolean;
  v_reason_code text;
begin
  for v_item in
    select i.id, i.batch_id, i.work_date, i.shift, i.line, i.status
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

      v_item_reasons := '[]'::jsonb;
      v_item_needs_review := false;

      for v_product in select * from compute_import_item_product_kpis(v_item.id, v_item.work_date) loop
        if v_product.product_id is null or v_product.performance is null or v_product.availability is null or v_product.oee is null then
          v_needs_review := v_needs_review + 1;
          v_item_needs_review := true;
          v_reason_code := case
            when v_product.product_id is null then 'PRODUCT_NOT_FOUND'
            when not coalesce(v_product.profile_complete, false) then 'PRODUCT_PROFILE_MISSING'
            else 'HOURLY_KPI_MISSING'
          end;
          if not (v_item_reasons ? v_reason_code) then
            v_item_reasons := v_item_reasons || to_jsonb(v_reason_code);
          end if;
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

      if v_item_needs_review then
        update import_items
        set status = 'PENDING_APPROVAL',
            pending_reasons = v_item_reasons,
            product_profile_status = case when v_item_reasons ? 'PRODUCT_PROFILE_MISSING' then 'MISSING' else product_profile_status end
        where id = v_item.id and status in ('AUTO_APPROVED', 'APPROVED');
        if found then
          v_reopened := v_reopened + 1;
          insert into import_item_events (import_item_id, event_type, from_status, to_status, payload)
          values (v_item.id, 'RECOMPUTE_NEEDS_REVIEW', v_item.status, 'PENDING_APPROVAL', jsonb_build_object('reasons', v_item_reasons));
        end if;
      end if;

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
    'reopened_for_review', v_reopened,
    'errors', v_errors, 'error_details', v_error_list,
    'batches_relinked', array_length(v_batches, 1)
  );
end;
$function$;
