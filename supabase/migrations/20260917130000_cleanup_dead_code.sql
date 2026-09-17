-- Cleanup requested after the audit: remove code confirmed unused before
-- touching anything.
--
-- 1) auto_approve_import_item()/approve_import_item() both did a pointless
--    dance before calling their _legacy counterpart: swap ocr_data.hourly_metrics
--    to a synthetic canonical array, call legacy, then restore the original.
--    This only ever mattered while auto_approve_import_item_legacy/
--    approve_import_item_legacy read ocr_data.hourly_metrics for their KPI
--    checks. Since the multi-product rewrite (compute_import_item_product_kpis),
--    neither _legacy function reads ocr_data.hourly_metrics at all anymore -
--    they validate and insert directly from import_item_hourly. Verified this
--    doesn't change behavior in any case: both wrappers' gate on
--    ocr_data.actual_shift_*_pct (a blended, not per-product, computation)
--    can only ever be null in the same situations where the per-product
--    check inside _legacy would already correctly raise its own blocker/
--    exception - the wrapper's gate never catches anything _legacy wouldn't
--    have already caught. recalculate_import_item_kpis() itself is kept -
--    it still runs reconstruct_import_item_hourly() and still populates
--    import_item_rows.performance/available_time/oee, which the review
--    screen displays and _legacy's per-row validation still checks.
create or replace function public.auto_approve_import_item(p_import_item_id uuid)
 returns jsonb
 language plpgsql
 set search_path to 'public'
as $function$
declare
  v_item public.import_items%rowtype;
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

  return public.auto_approve_import_item_legacy(p_import_item_id);
end;
$function$;

create or replace function public.approve_import_item(p_import_item_id uuid, p_actor_id uuid default auth.uid())
 returns jsonb
 language plpgsql
 set search_path to 'public'
as $function$
declare
  v_item public.import_items%rowtype;
begin
  select * into v_item
  from public.import_items
  where id = p_import_item_id
    and status = 'PENDING_APPROVAL'
  for update;

  if not found then
    raise exception 'Import není ve stavu PENDING_APPROVAL nebo neexistuje.' using errcode = 'P0002';
  end if;

  perform public.recalculate_import_item_kpis(p_import_item_id);

  return public.approve_import_item_legacy(p_import_item_id, p_actor_id);
end;
$function$;

-- 2) resolve_product_id_by_code(text) - verified zero callers anywhere in
-- the SQL layer (searched all function bodies) or the JS layer (only
-- appeared in the generated types.ts, never actually invoked) since before
-- this session began. Superseded by resolve_product_profile(), which every
-- real caller uses instead.
drop function if exists public.resolve_product_id_by_code(text);
