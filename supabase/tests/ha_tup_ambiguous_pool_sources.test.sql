-- Regression test for Master Prompt bod 2.4/2.5 (HA -> TUP allocation,
-- "více zdrojů HA"): when a TUP product's Product Profile HA code matches
-- hourly rows in MORE THAN ONE approved HA import_item on the same
-- work_date/shift/HA-line, find_ha_tup_link() used to return
-- match_status='AMBIGUOUS' with no ha_import_item_id, and
-- apply_ha_tup_capping() simply skipped that TUP hour entirely - no cap,
-- no audit trail, exactly as if no HA link existed. Zero real occurrences
-- were found in production data before this fix, but an uncapped TUP hour
-- silently overstates Performance/OEE the same way the pre-fix 3+-TUP
-- sharing bug did.
--
-- Fix: find_ha_tup_link() now also returns ha_import_item_ids (every
-- candidate, not just one), and apply_ha_tup_capping() pools their
-- cumulative-by-hour output together (sum) instead of giving up - the same
-- "no more precise data -> conservative, audited default" precedent
-- already used for the 2-way/N-way TUP split (bod 2.8). Every ambiguous
-- case stays fully auditable: raw_data.calculation.ha_tup_linkage records
-- ha_source_import_item_ids (every contributing HA import_item) and
-- ha_source_ambiguous, never just a single opaque id.
--
-- This test builds two separate HA import_items (30 + 20 pcs) that both
-- match the same TUP product/date/shift/line - the AMBIGUOUS scenario -
-- and asserts the pooled 50 pcs correctly caps the TUP hour's performance,
-- that evaluate_batch_ha_tup_linkage() picks it up too (ambiguous_applied),
-- and that re-running it is idempotent. Entirely non-destructive:
-- everything happens inside begin/rollback.

begin;

insert into product_profiles (ha_subassy, h_capacity, h_norm_per_hour, tup_subassy, t_capacity, t_norm_per_hour, valid_from)
values ('H_TESTAMBIG999', 1, 100, 'T_TESTAMBIG999', 1, 100, '1999-01-01');

insert into workplaces (code, line_name, workplace_name, area, source_line)
values ('TESTAMBIG_HA', 'TEST_AMBIG_LINE', 'Test HA workplace', 'HA', 'TEST_AMBIG_LINE'),
       ('TESTAMBIG_TUP', 'TEST_AMBIG_LINE', 'Test TUP workplace', 'TUP', 'TEST_AMBIG_LINE');

insert into import_batches (id, status, total_items) values
  ('c1c1c1c1-0000-0000-0000-000000000001', 'PROCESSING', 3);

-- Two SEPARATE HA import_items on the same work_date/shift/line, both
-- approved, both carrying hourly rows for the same product - the
-- AMBIGUOUS scenario (e.g. two approved screenshots of the same HA line).
insert into import_items (id, batch_id, status, work_date, shift, line, screenshot_path, source_hash) values
  ('c2c2c2c2-0000-0000-0000-000000000001', 'c1c1c1c1-0000-0000-0000-000000000001', 'AUTO_APPROVED', '1999-01-03', 'Ranní', 'TEST_AMBIG_LINE', 'test/ha-ambig-1.png', 'test-fixture-ha-ambig-1'),
  ('c3c3c3c3-0000-0000-0000-000000000001', 'c1c1c1c1-0000-0000-0000-000000000001', 'AUTO_APPROVED', '1999-01-03', 'Ranní', 'TEST_AMBIG_LINE', 'test/ha-ambig-2.png', 'test-fixture-ha-ambig-2'),
  ('c4c4c4c4-0000-0000-0000-000000000001', 'c1c1c1c1-0000-0000-0000-000000000001', 'AUTO_APPROVED', '1999-01-03', 'Ranní', 'TEST_AMBIG_LINE', 'test/tup-ambig.png', 'test-fixture-tup-ambig');

insert into import_item_hourly (import_item_id, hour, product_code, actual_output) values
  ('c2c2c2c2-0000-0000-0000-000000000001', 8, 'H_TESTAMBIG999', 30),
  ('c3c3c3c3-0000-0000-0000-000000000001', 8, 'H_TESTAMBIG999', 20);

insert into import_item_hourly (import_item_id, hour, product_code, actual_output, raw_data) values (
  'c4c4c4c4-0000-0000-0000-000000000001', 8, 'T_TESTAMBIG999', 100,
  jsonb_build_object('calculation', jsonb_build_object('expected_output_at_current_staffing', 100, 'availability_applied_to_oee', 100))
);

do $$
declare
  v_link record;
begin
  select * into v_link from public.find_ha_tup_link('T_TESTAMBIG999', 'TEST_AMBIG_LINE', '1999-01-03'::date, 'Ranní');
  if v_link.match_status <> 'AMBIGUOUS' then
    raise exception 'TEST FAILED: expected match_status AMBIGUOUS, got %', v_link.match_status;
  end if;
  if v_link.ha_import_item_id is not null then
    raise exception 'TEST FAILED: expected no single ha_import_item_id when ambiguous, got %', v_link.ha_import_item_id;
  end if;
  if array_length(v_link.ha_import_item_ids, 1) <> 2 then
    raise exception 'TEST FAILED: expected 2 candidate HA import_items, got %', v_link.ha_import_item_ids;
  end if;
end $$;

do $$
declare
  v_result jsonb;
  v_perf numeric;
  v_oee numeric;
  v_ambiguous boolean;
  v_cum numeric;
begin
  v_result := public.apply_ha_tup_capping('c4c4c4c4-0000-0000-0000-000000000001', 'T_TESTAMBIG999', 1.0);
  if v_result ->> 'status' <> 'APPLIED' then
    raise exception 'TEST FAILED: expected APPLIED, got %', v_result;
  end if;
  if (v_result ->> 'ha_source_ambiguous')::boolean is distinct from true then
    raise exception 'TEST FAILED: expected ha_source_ambiguous=true, got %', v_result;
  end if;

  select performance_pct, actual_oee_pct,
    (raw_data->'calculation'->'ha_tup_linkage'->>'ha_source_ambiguous')::boolean,
    (raw_data->'calculation'->'ha_tup_linkage'->>'ha_cumulative_available')::numeric
  into v_perf, v_oee, v_ambiguous, v_cum
  from import_item_hourly where import_item_id = 'c4c4c4c4-0000-0000-0000-000000000001' and hour = 8;

  -- HA sources pooled: 30 + 20 = 50 available. actual 100 / 50 * 100 = 200%.
  if abs(v_cum - 50) > 0.000001 then
    raise exception 'TEST FAILED: expected pooled HA available 50, got %', v_cum;
  end if;
  if abs(v_perf - 200) > 0.000001 then
    raise exception 'TEST FAILED: expected performance 200 after pooled capping, got %', v_perf;
  end if;
  if abs(v_oee - v_perf) > 0.000001 then
    raise exception 'TEST FAILED: expected OEE to equal Performance (availability already excluded), got oee=%, perf=%', v_oee, v_perf;
  end if;
  if v_ambiguous is distinct from true then
    raise exception 'TEST FAILED: expected ha_source_ambiguous=true in audit trail, got %', v_ambiguous;
  end if;
end $$;

-- evaluate_batch_ha_tup_linkage must pick this up too (via the sharing/grouping path).
do $$
declare
  v_batch_result jsonb;
begin
  v_batch_result := public.evaluate_batch_ha_tup_linkage('c1c1c1c1-0000-0000-0000-000000000001');
  if coalesce((v_batch_result ->> 'ambiguous_applied')::int, 0) <> 1 then
    raise exception 'TEST FAILED: expected ambiguous_applied=1, got %', v_batch_result;
  end if;
end $$;

-- Idempotence: re-running must not compound the pooled value.
do $$
declare
  v_perf1 numeric;
  v_perf2 numeric;
begin
  select performance_pct into v_perf1 from import_item_hourly where import_item_id = 'c4c4c4c4-0000-0000-0000-000000000001' and hour = 8;
  perform public.evaluate_batch_ha_tup_linkage('c1c1c1c1-0000-0000-0000-000000000001');
  select performance_pct into v_perf2 from import_item_hourly where import_item_id = 'c4c4c4c4-0000-0000-0000-000000000001' and hour = 8;
  if abs(v_perf1 - v_perf2) > 0.000001 then
    raise exception 'TEST FAILED: re-running evaluate_batch_ha_tup_linkage changed performance from % to %', v_perf1, v_perf2;
  end if;
end $$;

rollback;

-- If this script reaches here, ambiguous HA sources are pooled and
-- auditable instead of silently uncapped, and no fixture data was left
-- behind.
