-- Regression test for Master Prompt "OPRAVA VYPOCTU CLASSIC OEE + HA -> TUP
-- ALOKACE" bod 1.12: apply_ha_tup_capping() used to recompute OEE as
-- performance_pct * availability_pct directly, ignoring the double-counting
-- protection reconstruct_import_item_hourly() already decided and recorded
-- in raw_data.calculation.availability_applied_to_oee (forced to 100 -
-- excluded from OEE - whenever an hour's productive minutes are themselves
-- derived from measured activity, e.g. the TEFF_FROM_OCR_NORM source).
--
-- Root cause confirmed against real production data before writing this
-- fixture: import_item_hourly row 88769263-0dcd-45b5-ac3d-f9e707ad4cba
-- (T_S4962V3538, hour 10) - the exact scenario from Master Prompt section
-- 1.6 (Vykon 139.02%, Dostupnost 41.11%) - had availability_applied_to_oee
-- = 100 (correctly excluded) but a stored actual_oee_pct of 57.15%, exactly
-- performance_pct * availability_pct / 100 - proof HA->TUP capping silently
-- reintroduced the double-counted availability after the hourly
-- reconstruction had already excluded it.
--
-- This test builds a synthetic HA + TUP import_item pair on a work_date
-- (1999-01-02) that can never collide with real data, with a TUP hourly row
-- whose availability_pct (41.11, deliberately low) has already been marked
-- excluded from OEE (availability_applied_to_oee = 100), and asserts that
-- after apply_ha_tup_capping() recomputes performance/OEE for the capped
-- expected output, actual_oee_pct still equals performance_pct - i.e.
-- availability is not multiplied back in a second time. Entirely
-- non-destructive: everything happens inside begin/rollback.

begin;

insert into product_profiles (ha_subassy, h_capacity, h_norm_per_hour, tup_subassy, t_capacity, t_norm_per_hour, valid_from)
values ('H_TESTCAP999', 1, 100, 'T_TESTCAP999', 1, 100, '1999-01-01');

insert into workplaces (code, line_name, workplace_name, area, source_line)
values ('TESTCAP_HA', 'TEST_CAP_LINE', 'Test HA workplace', 'HA', 'TEST_CAP_LINE'),
       ('TESTCAP_TUP', 'TEST_CAP_LINE', 'Test TUP workplace', 'TUP', 'TEST_CAP_LINE');

insert into import_batches (id, status, total_items) values
  ('a1a1a1a1-0000-0000-0000-000000000001', 'PROCESSING', 2);

insert into import_items (id, batch_id, status, work_date, shift, line, screenshot_path, source_hash) values
  ('a2a2a2a2-0000-0000-0000-000000000001', 'a1a1a1a1-0000-0000-0000-000000000001', 'AUTO_APPROVED', '1999-01-02', 'Ranní', 'TEST_CAP_LINE', 'test/ha-tup-capping-ha.png', 'test-fixture-ha-tup-capping-ha-0001'),
  ('a3a3a3a3-0000-0000-0000-000000000001', 'a1a1a1a1-0000-0000-0000-000000000001', 'AUTO_APPROVED', '1999-01-02', 'Ranní', 'TEST_CAP_LINE', 'test/ha-tup-capping-tup.png', 'test-fixture-ha-tup-capping-tup-0001');

-- HA only made 50 pcs available - less than the TUP's uncapped expected
-- output of 100, so capping (and the performance recompute it triggers)
-- actually engages.
insert into import_item_hourly (import_item_id, hour, product_code, actual_output)
values ('a2a2a2a2-0000-0000-0000-000000000001', 8, 'H_TESTCAP999', 50);

-- Simulates a TUP hour reconstruct_import_item_hourly() already flagged as
-- TEFF_FROM_OCR_NORM: availability_applied_to_oee = 100 (excluded from OEE)
-- even though the raw OCR availability_pct is a deliberately low 41.11.
insert into import_item_hourly (import_item_id, hour, product_code, actual_output, availability_pct, raw_data)
values (
  'a3a3a3a3-0000-0000-0000-000000000001', 8, 'T_TESTCAP999', 139, 41.11,
  jsonb_build_object('calculation', jsonb_build_object('expected_output_at_current_staffing', 100, 'availability_applied_to_oee', 100))
);

do $$
declare
  v_result jsonb;
  v_perf numeric;
  v_oee numeric;
begin
  v_result := public.apply_ha_tup_capping('a3a3a3a3-0000-0000-0000-000000000001', 'T_TESTCAP999', 1.0);
  if v_result ->> 'status' <> 'APPLIED' then
    raise exception 'TEST FAILED: expected status APPLIED, got %', v_result;
  end if;

  select performance_pct, actual_oee_pct into v_perf, v_oee
  from import_item_hourly
  where import_item_id = 'a3a3a3a3-0000-0000-0000-000000000001' and hour = 8;

  -- 139 actual / 50 capped expected * 100 = 278% - capping must still
  -- recompute performance against the HA-limited expected output.
  if abs(v_perf - 278) > 0.000001 then
    raise exception 'TEST FAILED: expected performance_pct 278 after capping, got %', v_perf;
  end if;

  -- The double-counting bug produced 278 * 41.11 / 100 = 114.2858 here.
  -- The fix must leave OEE equal to Performance, since availability was
  -- already excluded from OEE before HA->TUP capping ran.
  if abs(v_oee - v_perf) > 0.000001 then
    raise exception 'TEST FAILED: OEE (%) does not equal Performance (%) - availability was double-counted', v_oee, v_perf;
  end if;
end $$;

rollback;

-- If this script reaches here, apply_ha_tup_capping() no longer
-- double-counts availability and no fixture data was left behind.
