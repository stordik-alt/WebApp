-- Regression test for the daily_records.import_item_id matching fix.
--
-- Background: _historical_recompute_run() / apply_ha_tup_capping() /
-- refresh_daily_records_for_import_item() used to locate the daily_records
-- row(s) to update via an exact-string match on
-- (import_batch_id, work_date, shift, line, product_id). Confirmed live:
-- import_items.line ("HandAssy L1/4 HF") can legitimately differ in
-- formatting from the daily_records.line it produced ("041.01 - HandAssy
-- L1/4 HF"), silently leaving 13 of 74 real daily_records rows un-updated
-- by today's OEE-formula historical recompute, with no error anywhere.
--
-- Fix: daily_records.import_item_id is a real foreign key, set at approval
-- time and backfilled for existing rows, and every recompute/capping
-- function now matches on (import_item_id, product_id) instead.
--
-- This test deliberately builds a daily_records row whose `line` text does
-- NOT match its originating import_item's `line` text (reproducing the
-- exact drift found live) and asserts refresh_daily_records_for_import_item()
-- still updates it correctly via import_item_id.
--
-- Entirely non-destructive: everything happens inside begin/rollback.

begin;

insert into product_profiles (ha_subassy, h_capacity, h_norm_per_hour, valid_from)
values ('H_TESTDRIFT999', 1, 100, '1999-01-06');

insert into import_batches (id, status, total_items) values
  ('f1f1f1f1-0000-0000-0000-000000000001', 'PROCESSING', 1);

-- Deliberately short/raw line text, unlike the fuller canonical text the
-- corresponding daily_records row below will carry.
insert into import_items (id, batch_id, status, work_date, shift, line, screenshot_path, source_hash) values
  ('f2f2f2f2-0000-0000-0000-000000000001', 'f1f1f1f1-0000-0000-0000-000000000001', 'AUTO_APPROVED', '1999-01-06', 'Ranní', 'TESTDRIFT LINE SHORT', 'test/drift.png', 'test-fixture-drift-0001');

insert into import_item_hourly (import_item_id, hour, product_code, actual_output) values
  ('f2f2f2f2-0000-0000-0000-000000000001', 8, 'H_TESTDRIFT999', 90);

-- Real product needed so compute_import_item_product_kpis() resolves a
-- product_id (matching how a genuine approved record would look).
insert into products (code, name, active)
select 'H_TESTDRIFT999', 'Test drift product', true
where not exists (select 1 from products where code = 'H_TESTDRIFT999');

-- Simulates a daily_records row created by a real approval, but with a
-- line string that has since diverged from import_items.line - the exact
-- drift scenario found live. Deliberately stale performance/oee (as if
-- created before today's OEE fix) to prove a recompute actually touches it.
insert into daily_records (employee_id, work_date, shift, line, product, position, oee, performance, available_time, help_score, approval_status, import_batch_id, import_item_id, product_id)
select e.id, '1999-01-06'::date, 'Ranní', '099.99 - Naprosto jiný text linky', 'H_TESTDRIFT999', 'HA', 12.34, 56.78, 90.00, 0, 'approved',
  'f1f1f1f1-0000-0000-0000-000000000001', 'f2f2f2f2-0000-0000-0000-000000000001', p.id
from employees e, products p
where p.code = 'H_TESTDRIFT999'
limit 1;

do $$
declare
  v_record_id uuid;
  v_result jsonb;
  v_perf numeric;
  v_oee numeric;
  v_line text;
begin
  select id, line into v_record_id, v_line from daily_records
  where import_item_id = 'f2f2f2f2-0000-0000-0000-000000000001';

  if v_record_id is null then
    raise exception 'TEST SETUP FAILED: fixture daily_records row not found (missing an employees row?)';
  end if;
  if v_line = 'TESTDRIFT LINE SHORT' then
    raise exception 'TEST SETUP FAILED: fixture line should differ from import_items.line, got an exact match';
  end if;

  perform public.reconstruct_import_item_hourly('f2f2f2f2-0000-0000-0000-000000000001');
  v_result := public.refresh_daily_records_for_import_item('f2f2f2f2-0000-0000-0000-000000000001');

  if coalesce((v_result ->> 'daily_records_updated')::int, 0) <> 1 then
    raise exception 'TEST FAILED: expected refresh_daily_records_for_import_item to update 1 row despite the line-text drift, got %', v_result;
  end if;

  select performance, oee into v_perf, v_oee from daily_records where id = v_record_id;
  if v_perf is null or abs(v_perf - 90) > 0.01 then
    raise exception 'TEST FAILED: expected performance ~90, got %', v_perf;
  end if;
  if abs(v_oee - v_perf) > 0.000001 then
    raise exception 'TEST FAILED: expected OEE to equal Performance, got oee=%, perf=%', v_oee, v_perf;
  end if;
end $$;

rollback;

-- If this script reaches here, daily_records recompute correctly follows
-- import_item_id even when the originating import's line text has drifted
-- away from the daily_records row it produced, and no fixture data was
-- left behind.
