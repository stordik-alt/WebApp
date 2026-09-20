-- Regression test for Master Prompt section 12 category G (idempotence):
-- evaluate_batch_ha_tup_linkage() gets called automatically on every
-- approval and on every Reimport (ImportApprovalQueue.tsx), so the exact
-- same batch can realistically be re-evaluated multiple times (e.g. a
-- second product in the same batch gets approved later, re-triggering the
-- whole batch's linkage pass). Running it twice in a row must produce
-- exactly the same capped values the second time - it must not compound
-- the capping (e.g. re-dividing an already-capped expected_output by N
-- again) or drift the numbers on repeated runs.
--
-- Entirely non-destructive: everything happens inside begin/rollback.

begin;

do $$
declare
  v_batch_id uuid;
  v_ha_item_id uuid;
  v_tup_item_id uuid;
  v_ha_workplace_line text;
  v_tup_workplace_line text;
  v_ha_code text := 'H_TEST_IDEMPOTENCE';
  v_tup_code text := 'T_TEST_IDEMPOTENCE';
  v_work_date date := '2099-06-04';
  v_perf_after_first numeric;
  v_oee_after_first numeric;
  v_perf_after_second numeric;
  v_oee_after_second numeric;
begin
  select w1.line_name, w2.line_name into v_ha_workplace_line, v_tup_workplace_line
  from public.workplaces w1
  join public.workplaces w2 on w2.area = 'TUP' and w2.line_name = w1.line_name
  where w1.area = 'HA'
  limit 1;
  if v_ha_workplace_line is null then
    raise exception 'TEST SKIPPED (no HA/TUP workplace pair with a shared line_name in this environment)';
  end if;

  insert into public.product_profiles (id, ha_subassy, h_capacity, h_norm_per_hour, tup_subassy, t_capacity, t_norm_per_hour, profile_name, valid_from, valid_to)
  values (gen_random_uuid(), v_ha_code, 10, 10, v_tup_code, 10, 10, 'Idempotence test', v_work_date, null);

  insert into public.import_batches (id, status, total_items) values (gen_random_uuid(), 'PROCESSING', 2) returning id into v_batch_id;

  insert into public.import_items (id, batch_id, status, work_date, shift, line, screenshot_path, source_hash)
  values (gen_random_uuid(), v_batch_id, 'APPROVED', v_work_date, 'Ranní', v_ha_workplace_line, 'test/idem-ha.png', 'test-idem-ha-hash')
  returning id into v_ha_item_id;
  insert into public.import_item_hourly (import_item_id, hour, product_code, actual_output, availability_pct)
  values (v_ha_item_id, 6, v_ha_code, 60, 95);

  insert into public.import_items (id, batch_id, status, work_date, shift, line, screenshot_path, source_hash)
  values (gen_random_uuid(), v_batch_id, 'APPROVED', v_work_date, 'Ranní', v_tup_workplace_line, 'test/idem-tup.png', 'test-idem-tup-hash')
  returning id into v_tup_item_id;
  insert into public.import_item_hourly (import_item_id, hour, product_code, actual_output, availability_pct, raw_data)
  values (v_tup_item_id, 6, v_tup_code, 5, 95, jsonb_build_object('calculation', jsonb_build_object('expected_output_at_current_staffing', 10)));

  perform public.evaluate_batch_ha_tup_linkage(v_batch_id);
  select performance_pct, actual_oee_pct into v_perf_after_first, v_oee_after_first
  from public.import_item_hourly where import_item_id = v_tup_item_id;

  perform public.evaluate_batch_ha_tup_linkage(v_batch_id);
  select performance_pct, actual_oee_pct into v_perf_after_second, v_oee_after_second
  from public.import_item_hourly where import_item_id = v_tup_item_id;

  if v_perf_after_first is distinct from v_perf_after_second or v_oee_after_first is distinct from v_oee_after_second then
    raise exception 'TEST FAILED: re-running evaluate_batch_ha_tup_linkage() changed already-capped values (perf % -> %, oee % -> %) - capping is not idempotent',
      v_perf_after_first, v_perf_after_second, v_oee_after_first, v_oee_after_second;
  end if;
end $$;

rollback;

-- If this script reaches here, evaluate_batch_ha_tup_linkage() is
-- idempotent - re-running it on an already-capped batch does not drift the
-- values - and no fixture data was left behind.
