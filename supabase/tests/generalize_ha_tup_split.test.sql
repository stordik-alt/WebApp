-- Regression test for Master Prompt sections 1-2 (HA->TUP allocation
-- correctness): evaluate_batch_ha_tup_linkage() must apply capping to EVERY
-- TUP product sharing an HA feedstock, not just up to 2 - before this fix,
-- 3+ way sharing was silently skipped entirely (a real live case on
-- 2026-09-18 had 6 TUP products sharing one HA, all uncapped). This test
-- only proves the mechanism now runs for N>2 rather than skipping - it does
-- NOT assert the resulting percentages are "correct", since applying this
-- fix to real 6-way-shared data produced implausible results (365-600%
-- OEE) that were reverted pending a separate investigation into whether an
-- even 1/N split is the right allocation model, or whether norm/capacity
-- data for those specific profiles needs review. See the session notes for
-- that open question.
--
-- Entirely non-destructive: everything happens inside begin/rollback.

begin;

do $$
declare
  v_batch_id uuid;
  v_ha_item_id uuid;
  v_tup_item_1_id uuid;
  v_tup_item_2_id uuid;
  v_tup_item_3_id uuid;
  v_ha_workplace_line text;
  v_tup_workplace_line text;
  v_ha_code text := 'H_TEST_SPLIT_GEN';
  v_tup_code text := 'T_TEST_SPLIT_GEN';
  v_work_date date := '2099-06-02';
  v_result jsonb;
  v_capped_count integer;
begin
  -- Reuse a real HA/TUP workplace pair so find_ha_tup_link's line-mapping
  -- resolves - fabricating new workplaces would risk not matching the
  -- function's actual join conditions.
  select w1.line_name, w2.line_name into v_ha_workplace_line, v_tup_workplace_line
  from public.workplaces w1
  join public.workplaces w2 on w2.area = 'TUP' and w2.line_name = w1.line_name
  where w1.area = 'HA'
  limit 1;
  if v_ha_workplace_line is null then
    raise exception 'TEST SKIPPED (no HA/TUP workplace pair with a shared line_name in this environment)';
  end if;

  insert into public.product_profiles (id, ha_subassy, h_capacity, h_norm_per_hour, tup_subassy, t_capacity, t_norm_per_hour, profile_name, valid_from, valid_to)
  values (gen_random_uuid(), v_ha_code, 10, 10, v_tup_code, 10, 10, 'Split generalization test', v_work_date, null);

  insert into public.import_batches (id, status, total_items) values (gen_random_uuid(), 'PROCESSING', 4) returning id into v_batch_id;

  insert into public.import_items (id, batch_id, status, work_date, shift, line, screenshot_path, source_hash)
  values (gen_random_uuid(), v_batch_id, 'APPROVED', v_work_date, 'Ranní', v_ha_workplace_line, 'test/split-gen-ha.png', 'test-split-gen-ha-hash')
  returning id into v_ha_item_id;
  insert into public.import_item_hourly (import_item_id, hour, product_code, actual_output, availability_pct)
  values (v_ha_item_id, 6, v_ha_code, 60, 95), (v_ha_item_id, 7, v_ha_code, 60, 95);

  -- Three TUP import_items, each producing the SAME tup_code from the SAME
  -- HA-linked line/date/shift - this is the "N>2 sharing" scenario that was
  -- previously entirely skipped.
  insert into public.import_items (id, batch_id, status, work_date, shift, line, screenshot_path, source_hash)
  values
    (gen_random_uuid(), v_batch_id, 'APPROVED', v_work_date, 'Ranní', v_tup_workplace_line, 'test/split-gen-tup1.png', 'test-split-gen-tup1-hash')
  returning id into v_tup_item_1_id;
  insert into public.import_items (id, batch_id, status, work_date, shift, line, screenshot_path, source_hash)
  values
    (gen_random_uuid(), v_batch_id, 'APPROVED', v_work_date, 'Ranní', v_tup_workplace_line, 'test/split-gen-tup2.png', 'test-split-gen-tup2-hash')
  returning id into v_tup_item_2_id;
  insert into public.import_items (id, batch_id, status, work_date, shift, line, screenshot_path, source_hash)
  values
    (gen_random_uuid(), v_batch_id, 'APPROVED', v_work_date, 'Ranní', v_tup_workplace_line, 'test/split-gen-tup3.png', 'test-split-gen-tup3-hash')
  returning id into v_tup_item_3_id;

  insert into public.import_item_hourly (import_item_id, hour, product_code, actual_output, availability_pct, raw_data)
  values
    (v_tup_item_1_id, 6, v_tup_code, 5, 95, jsonb_build_object('calculation', jsonb_build_object('expected_output_at_current_staffing', 10))),
    (v_tup_item_2_id, 6, v_tup_code, 5, 95, jsonb_build_object('calculation', jsonb_build_object('expected_output_at_current_staffing', 10))),
    (v_tup_item_3_id, 6, v_tup_code, 5, 95, jsonb_build_object('calculation', jsonb_build_object('expected_output_at_current_staffing', 10)));

  v_result := public.evaluate_batch_ha_tup_linkage(v_batch_id);

  if coalesce((v_result ->> 'checked')::int, 0) <> 3 then
    raise exception 'TEST FAILED: expected 3 TUP candidates checked, got %', v_result;
  end if;
  if coalesce((v_result ->> 'applied')::int, 0) <> 3 then
    raise exception 'TEST FAILED: all 3 sharing TUP items must get capping applied (not skipped), got %', v_result;
  end if;
  if coalesce((v_result ->> 'split_applied')::int, 0) <> 3 then
    raise exception 'TEST FAILED: all 3 should be counted as split (tup_count > 1), got %', v_result;
  end if;

  select count(*) into v_capped_count
  from public.import_item_hourly
  where import_item_id in (v_tup_item_1_id, v_tup_item_2_id, v_tup_item_3_id)
    and abs((raw_data -> 'calculation' -> 'ha_tup_linkage' ->> 'allocation_fraction')::numeric - 1.0/3) < 0.0000001;
  if v_capped_count <> 3 then
    raise exception 'TEST FAILED: expected all 3 hourly rows to record an even 1/3 allocation_fraction, got % matching rows', v_capped_count;
  end if;
end $$;

rollback;

-- If this script reaches here, evaluate_batch_ha_tup_linkage() correctly
-- applies capping to all N sharing TUP products (previously skipped for
-- N>2), and no fixture data was left behind.
