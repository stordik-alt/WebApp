-- Regression test for Master Prompt sections 13-14 (data integrity audit
-- mechanism). Proves run_data_integrity_audit() actually detects each
-- violation class it claims to, not just that it runs without error against
-- already-clean data - an audit that silently reports zero problems even
-- when problems exist is worse than no audit at all.
--
-- Only exercises the checks that are safe to trigger with fixture data
-- without fighting FK/trigger constraints that legitimately prevent the
-- others (e.g. DUPLICATE_DAILY_RECORD_NATURAL_KEY is already guarded by a
-- real UNIQUE constraint at insert time - see duplicate_vs_conflict_resolution
-- .test.sql for that path instead). OVERLAPPING_ACTIVE_PROFILE_KEY turned
-- out, while writing this test, to be the same story: this schema already
-- has product_profiles_active_ha_tup_unique_idx enforcing it, so instead of
-- injecting a state the DB physically refuses to create, this test proves
-- that constraint is what keeps the check permanently at zero. Entirely
-- non-destructive: everything happens inside begin/rollback.

begin;

do $$
declare
  v_admin_id uuid;
  v_batch_id uuid;
  v_item_id uuid;
  v_result record;
  v_found_false_valid boolean := false;
  v_found_stuck boolean := false;
  v_ha_code text := 'TEST_INTEGRITY_AUDIT_HA';
  v_tup_code text := 'TEST_INTEGRITY_AUDIT_TUP';
begin
  select user_id into v_admin_id from public.user_roles where role = 'admin' limit 1;
  if v_admin_id is null then
    raise exception 'TEST SKIPPED (no admin user in this environment): cannot exercise run_data_integrity_audit()''s has_role() check';
  end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin_id::text)::text, true);

  -- 1) V4014_FALSE_VALID_PROFILE: a header claiming VALID with no product.
  insert into public.import_batches (id, status, total_items) values (gen_random_uuid(), 'PROCESSING', 1) returning id into v_batch_id;
  insert into public.import_items (id, batch_id, status, product_profile_status, product_id, screenshot_path, source_hash)
  values (gen_random_uuid(), v_batch_id, 'PENDING_APPROVAL', 'VALID', null, 'test/integrity-audit.png', 'test-integrity-audit-hash')
  returning id into v_item_id;

  -- 2) STUCK_IMPORT: an item parked in VALIDATING well past the 30-minute
  -- threshold.
  insert into public.import_items (id, batch_id, status, updated_at, screenshot_path, source_hash)
  values (gen_random_uuid(), v_batch_id, 'VALIDATING', now() - interval '2 hours', 'test/integrity-audit-stuck.png', 'test-integrity-audit-stuck-hash');

  -- 3) OVERLAPPING_ACTIVE_PROFILE_KEY: this schema already refuses to create
  -- the state that check looks for - profile_key is a generated column, and
  -- product_profiles_active_ha_tup_unique_idx makes a second concurrently-
  -- active row for the same (ha_subassy, tup_subassy) pair impossible to
  -- insert. Prove that directly instead of trying to inject a state that
  -- can't exist.
  declare
    v_overlap_inserted boolean := false;
  begin
    insert into public.product_profiles (id, ha_subassy, h_capacity, h_norm_per_hour, tup_subassy, t_capacity, t_norm_per_hour, profile_name, valid_from, valid_to)
    values (gen_random_uuid(), v_ha_code, 10, 10, v_tup_code, 10, 10, 'Integrity audit test A', current_date, null);
    begin
      insert into public.product_profiles (id, ha_subassy, h_capacity, h_norm_per_hour, tup_subassy, t_capacity, t_norm_per_hour, profile_name, valid_from, valid_to)
      values (gen_random_uuid(), v_ha_code, 10, 10, v_tup_code, 10, 10, 'Integrity audit test B', current_date, null);
      v_overlap_inserted := true;
    exception when unique_violation then
      v_overlap_inserted := false;
    end;
    if v_overlap_inserted then
      raise exception 'TEST FAILED: a second concurrently-active product_profiles row for the same (ha_subassy, tup_subassy) was inserted - product_profiles_active_ha_tup_unique_idx no longer enforces this';
    end if;
  end;

  for v_result in select * from public.run_data_integrity_audit() loop
    if v_result.check_name = 'V4014_FALSE_VALID_PROFILE' and v_result.violation_count > 0 and v_result.sample_ids @> array[v_item_id] then
      v_found_false_valid := true;
    end if;
    if v_result.check_name = 'STUCK_IMPORT' and v_result.violation_count > 0 then
      v_found_stuck := true;
    end if;
  end loop;

  if not v_found_false_valid then
    raise exception 'TEST FAILED: run_data_integrity_audit() did not flag the injected V4014_FALSE_VALID_PROFILE fixture';
  end if;
  if not v_found_stuck then
    raise exception 'TEST FAILED: run_data_integrity_audit() did not flag the injected STUCK_IMPORT fixture';
  end if;

  -- Access control: a non-admin must be rejected, not silently see nothing.
  declare
    v_non_admin_allowed boolean := false;
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid()::text)::text, true);
    begin
      perform * from public.run_data_integrity_audit();
      v_non_admin_allowed := true;
    exception when others then
      v_non_admin_allowed := false;
    end;
    if v_non_admin_allowed then
      raise exception 'TEST FAILED: run_data_integrity_audit() must reject a non-admin caller';
    end if;
  end;
end $$;

rollback;

-- If this script reaches here, run_data_integrity_audit() correctly detects
-- real violations of each tested invariant and enforces admin-only access,
-- and no fixture data was left behind.
