-- Regression test for the "Ke schválení" bulk-recompute fix.
--
-- Root cause this guards against: _historical_recompute_run() could DETECT
-- that a product's KPI couldn't be recomputed (product not found / Product
-- Profile missing or incomplete / KPI failed) but only ever reported it in
-- the function's one-time JSON response - it never touched the import_items
-- row, so the finding was lost the moment the admin closed the recompute
-- dialog and the item stayed AUTO_APPROVED/APPROVED with stale
-- daily_records forever, never surfacing in "Ke schválení".
--
-- This test builds a fully synthetic import_item (batch/item/hourly row)
-- referencing a product code that has no product_profile anywhere, on a
-- work_date (1999-01-01) that can never collide with real data, and asserts
-- that running _historical_recompute_run() over that date reopens the item
-- into PENDING_APPROVAL with a PRODUCT_NOT_FOUND reason and a matching
-- audit event - the exact behavior the fix added. Entirely non-destructive:
-- everything happens inside begin/rollback.

begin;

insert into import_batches (id, status, total_items)
values ('00000000-0000-0000-0000-000000000001', 'PROCESSING', 1);

insert into import_items (id, batch_id, status, work_date, shift, line, screenshot_path, source_hash)
values (
  '00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001',
  'AUTO_APPROVED', '1999-01-01', 'Ranní', 'TEST_LINE',
  'test/recompute-reopens-needs-review-fixture.png', 'test-fixture-recompute-needs-review-0001'
);

-- A product code guaranteed to resolve to neither a products row nor a
-- product_profiles row, so compute_import_item_product_kpis() reports it as
-- needing review (product_id is null).
insert into import_item_hourly (import_item_id, hour, product_code, actual_output, performance_pct, availability_pct)
values ('00000000-0000-0000-0000-000000000002', 8, 'H_TESTNOPROFILE_XYZ123', 10, 90, 95);

do $$
declare
  v_result jsonb;
begin
  v_result := public._historical_recompute_run('1999-01-01'::date, '1999-01-01'::date, 100);

  if coalesce((v_result ->> 'needs_review')::int, 0) < 1 then
    raise exception 'TEST FAILED: expected needs_review >= 1, got %', v_result -> 'needs_review';
  end if;

  if coalesce((v_result ->> 'reopened_for_review')::int, 0) <> 1 then
    raise exception 'TEST FAILED: expected reopened_for_review = 1, got %', v_result -> 'reopened_for_review';
  end if;
end $$;

do $$
declare
  v_status text;
  v_reasons jsonb;
begin
  select status, pending_reasons into v_status, v_reasons
  from import_items where id = '00000000-0000-0000-0000-000000000002';

  if v_status <> 'PENDING_APPROVAL' then
    raise exception 'TEST FAILED: expected import_items.status = PENDING_APPROVAL, got %', v_status;
  end if;

  if not (v_reasons @> '["PRODUCT_NOT_FOUND"]'::jsonb) then
    raise exception 'TEST FAILED: expected pending_reasons to contain PRODUCT_NOT_FOUND, got %', v_reasons;
  end if;
end $$;

do $$
declare
  v_events int;
begin
  select count(*) into v_events
  from import_item_events
  where import_item_id = '00000000-0000-0000-0000-000000000002'
    and event_type = 'RECOMPUTE_NEEDS_REVIEW'
    and from_status = 'AUTO_APPROVED'
    and to_status = 'PENDING_APPROVAL';

  if v_events <> 1 then
    raise exception 'TEST FAILED: expected exactly 1 RECOMPUTE_NEEDS_REVIEW audit event, got %', v_events;
  end if;
end $$;

rollback;

-- If this script reaches here, the recompute-reopens-needs-review fix
-- behaves as intended and no fixture data was left behind.
