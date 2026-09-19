-- Regression test for the user decision (2026-09-19): OEE = Výkon, always.
--
-- Background: the Očekávaný výstup and Výkon formulas stay exactly as they
-- are (staffing folded into Očekávaný výstup, already established). The
-- Dostupnost multiplier that previously made OEE diverge from Výkon for
-- CLASSIC-mode hours (and any non-TEFF_FROM_OCR_NORM hour with real
-- sub-100% measured availability) is removed - Dostupnost is still
-- measured and stored (availability_pct) but never multiplied into OEE
-- for any hour type.
--
-- Before this fix, a real production hour (H_S4572A-IA,
-- import_item_hourly id 185a9854-49b8-419c-be3c-62c90e7bda36) had
-- performance_pct=160.0 but actual_oee_pct=85.3 (availability_pct=53.33%
-- was still being multiplied in for this CLASSIC-sourced hour). This test
-- builds an equivalent synthetic CLASSIC-mode hour and asserts OEE now
-- equals Performance despite availability being well below 100%.
--
-- Entirely non-destructive: everything happens inside begin/rollback.

begin;

insert into product_profiles (ha_subassy, h_capacity, h_norm_per_hour, valid_from)
values ('H_TESTOEEPERF999', 1, 100, '1999-01-01');

insert into import_batches (id, status, total_items) values
  ('e1e1e1e1-0000-0000-0000-000000000001', 'PROCESSING', 3);

insert into import_items (id, batch_id, status, work_date, shift, line, screenshot_path, source_hash) values
  ('e2e2e2e2-0000-0000-0000-000000000001', 'e1e1e1e1-0000-0000-0000-000000000001', 'AUTO_APPROVED', '1999-01-05', 'Ranní', 'TEST_OEEPERF_LINE', 'test/oeeperf.png', 'test-fixture-oeeperf-0001');

-- Three hours so the middle one (hour 9) takes the CLASSIC/SHIFT_CLOCK_MODEL
-- path (not first, not last, no product change, no downtime) - the path
-- that previously multiplied real measured availability into OEE.
insert into import_item_hourly (import_item_id, hour, product_code, actual_output, availability_pct) values
  ('e2e2e2e2-0000-0000-0000-000000000001', 8, 'H_TESTOEEPERF999', 90, 100),
  ('e2e2e2e2-0000-0000-0000-000000000001', 9, 'H_TESTOEEPERF999', 90, 53.33),
  ('e2e2e2e2-0000-0000-0000-000000000001', 10, 'H_TESTOEEPERF999', 90, 100);

do $$
declare
  v_perf numeric;
  v_oee numeric;
  v_avail numeric;
  v_mode text;
begin
  perform public.reconstruct_import_item_hourly('e2e2e2e2-0000-0000-0000-000000000001');

  select performance_pct, actual_oee_pct, availability_pct, raw_data->'calculation'->>'calculation_mode'
  into v_perf, v_oee, v_avail, v_mode
  from import_item_hourly where import_item_id = 'e2e2e2e2-0000-0000-0000-000000000001' and hour = 9;

  if v_mode <> 'CLASSIC' then
    raise exception 'TEST SETUP FAILED: expected hour 9 to be CLASSIC, got %', v_mode;
  end if;
  if v_avail is null or abs(v_avail - 53.33) > 0.01 then
    raise exception 'TEST SETUP FAILED: expected measured availability ~53.33, got %', v_avail;
  end if;

  -- The whole point of the fix: despite availability being far below 100%,
  -- OEE must equal Performance exactly.
  if abs(v_oee - v_perf) > 0.000001 then
    raise exception 'TEST FAILED: OEE (%) does not equal Performance (%) for a CLASSIC hour with availability %', v_oee, v_perf, v_avail;
  end if;
end $$;

-- Also verify via apply_ha_tup_capping's independent OEE recompute path.
insert into workplaces (code, line_name, workplace_name, area, source_line)
values ('TESTOEEPERF_HA', 'TEST_OEEPERF_HA_LINE', 'Test HA workplace', 'HA', 'TEST_OEEPERF_HA_LINE'),
       ('TESTOEEPERF_TUP', 'TEST_OEEPERF_HA_LINE', 'Test TUP workplace', 'TUP', 'TEST_OEEPERF_HA_LINE');

insert into product_profiles (ha_subassy, h_capacity, h_norm_per_hour, tup_subassy, t_capacity, t_norm_per_hour, valid_from)
values ('H_TESTOEEPERFHA999', 1, 100, 'T_TESTOEEPERFTUP999', 1, 100, '1999-01-01');

insert into import_items (id, batch_id, status, work_date, shift, line, screenshot_path, source_hash) values
  ('e3e3e3e3-0000-0000-0000-000000000001', 'e1e1e1e1-0000-0000-0000-000000000001', 'AUTO_APPROVED', '1999-01-05', 'Ranní', 'TEST_OEEPERF_HA_LINE', 'test/oeeperf-ha.png', 'test-fixture-oeeperf-ha-0001'),
  ('e4e4e4e4-0000-0000-0000-000000000001', 'e1e1e1e1-0000-0000-0000-000000000001', 'AUTO_APPROVED', '1999-01-05', 'Ranní', 'TEST_OEEPERF_HA_LINE', 'test/oeeperf-tup.png', 'test-fixture-oeeperf-tup-0001');

insert into import_item_hourly (import_item_id, hour, product_code, actual_output) values
  ('e3e3e3e3-0000-0000-0000-000000000001', 8, 'H_TESTOEEPERFHA999', 50);

insert into import_item_hourly (import_item_id, hour, product_code, actual_output, availability_pct, raw_data) values (
  'e4e4e4e4-0000-0000-0000-000000000001', 8, 'T_TESTOEEPERFTUP999', 60, 40.0,
  jsonb_build_object('calculation', jsonb_build_object('expected_output_at_current_staffing', 100))
);

do $$
declare
  v_result jsonb;
  v_perf numeric;
  v_oee numeric;
begin
  v_result := public.apply_ha_tup_capping('e4e4e4e4-0000-0000-0000-000000000001', 'T_TESTOEEPERFTUP999', 1.0);
  if v_result ->> 'status' <> 'APPLIED' then
    raise exception 'TEST FAILED: expected APPLIED, got %', v_result;
  end if;

  select performance_pct, actual_oee_pct into v_perf, v_oee
  from import_item_hourly where import_item_id = 'e4e4e4e4-0000-0000-0000-000000000001' and hour = 8;

  if abs(v_oee - v_perf) > 0.000001 then
    raise exception 'TEST FAILED: apply_ha_tup_capping OEE (%) does not equal Performance (%) despite low availability', v_oee, v_perf;
  end if;
end $$;

rollback;

-- If this script reaches here, OEE equals Performance for every hour type
-- (Classic and HA->TUP-capped alike) and no fixture data was left behind.
