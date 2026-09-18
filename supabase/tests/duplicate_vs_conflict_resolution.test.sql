-- Regression test for Master Prompt sections 8-10 (duplicate vs. conflict
-- distinction and admin resolution).
--
-- Two things this guards against, both found live while implementing the
-- feature:
-- 1) approve_import_item_legacy() must still BLOCK approval by default
--    (p_confirm_conflict=false) when a real employee/date/shift/line/product
--    match already exists in daily_records, and it must record WHICH row
--    conflicted (conflict_daily_record_ids) rather than only a generic
--    DUPLICATE_RECORD blocker string.
-- 2) When an admin explicitly confirms the import despite the conflict
--    (p_confirm_conflict=true), the function must UPDATE the existing
--    conflicting daily_records row in place, never INSERT a second one -
--    daily_records has a UNIQUE(employee_id, work_date, shift, line,
--    product_id) constraint, so an insert-based "confirm import" always
--    fails with an unhandled 23505 the moment a genuine conflict exists.
--
-- Uses a real, currently valid product_profile picked dynamically (so the
-- test doesn't depend on any specific hardcoded profile still existing) and
-- a far-future work_date that cannot collide with real production data.
-- Runs as the project's first real admin user so the has_role() check in
-- approve_import_item_legacy passes. Entirely non-destructive: everything
-- happens inside begin/rollback.

begin;

do $$
declare
  v_admin_id uuid;
  v_employee_id uuid;
  v_product_id uuid;
  v_product_code text;
  v_daily_id uuid;
  v_batch_id uuid;
  v_item_id uuid;
  v_result jsonb;
  v_raised boolean := false;
begin
  select user_id into v_admin_id from public.user_roles where role = 'admin' limit 1;
  if v_admin_id is null then
    raise exception 'TEST SKIPPED (no admin user in this environment): cannot exercise approve_import_item_legacy''s has_role() check';
  end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin_id::text)::text, true);

  select id into v_employee_id from public.employees limit 1;
  select p.id, p.code into v_product_id, v_product_code
  from public.products p
  join public.product_profiles pp on (pp.ha_subassy = p.code or pp.tup_subassy = p.code) and pp.valid_to is null
  where p.active = true and pp.h_norm_per_hour is not null and pp.h_capacity is not null
  limit 1;
  if v_product_id is null then
    raise exception 'TEST SKIPPED (no active product with a complete Product Profile in this environment)';
  end if;

  -- The "existing" record a new import will conflict with.
  insert into public.daily_records (employee_id, work_date, shift, line, product_id, product, position, oee, performance, available_time, help_score, approval_status)
  values (v_employee_id, '2099-06-01', 'Ranní', 'TEST_CONFLICT_REGRESSION_LINE', v_product_id, v_product_code, 'TUP', 12.34, 12.34, 12.34, 0, 'approved')
  returning id into v_daily_id;

  -- A new import for the exact same employee/date/shift/line/product.
  insert into public.import_batches (id, status, total_items) values (gen_random_uuid(), 'PROCESSING', 1) returning id into v_batch_id;
  insert into public.import_items (id, batch_id, status, work_date, shift, line, screenshot_path, source_hash)
  values (gen_random_uuid(), v_batch_id, 'PENDING_APPROVAL', '2099-06-01', 'Ranní', 'TEST_CONFLICT_REGRESSION_LINE', 'test/conflict-regression.png', 'test-conflict-regression-hash')
  returning id into v_item_id;
  insert into public.import_item_rows (import_item_id, row_index, employee_id, position, match_status, validation_status)
  values (v_item_id, 0, v_employee_id, 'TUP', 'EXACT', 'VALID');
  insert into public.import_item_hourly (import_item_id, hour, product_code, actual_output, performance_pct, availability_pct)
  values (v_item_id, 8, v_product_code, 40, 90, 95);
  perform public.reconstruct_import_item_hourly(v_item_id);

  -- 1) Default behavior: still blocks, and records WHICH row conflicted.
  begin
    v_result := public.approve_import_item_legacy(v_item_id, v_admin_id, false);
  exception when others then
    v_raised := true;
  end;
  if not v_raised then
    raise exception 'TEST FAILED: approve_import_item_legacy must raise when a real conflict exists and p_confirm_conflict=false, got %', v_result;
  end if;

  -- 2) p_confirm_conflict=true must UPDATE the existing row, not insert a
  -- second one - this is the exact bug found live: the first implementation
  -- tried to insert and hit daily_records' unique constraint.
  v_result := public.approve_import_item_legacy(v_item_id, v_admin_id, true);

  if coalesce((v_result ->> 'success')::boolean, false) is not true then
    raise exception 'TEST FAILED: approve_import_item_legacy did not report success with p_confirm_conflict=true: %', v_result;
  end if;
  if coalesce((v_result ->> 'created_daily_records')::int, -1) <> 0 then
    raise exception 'TEST FAILED: expected 0 created_daily_records (must UPDATE, not INSERT, the conflicting row), got %', v_result;
  end if;
  if coalesce((v_result ->> 'updated_daily_records')::int, -1) <> 1 then
    raise exception 'TEST FAILED: expected 1 updated_daily_records, got %', v_result;
  end if;

  perform 1 from public.daily_records where id = v_daily_id and oee is distinct from 12.34;
  if not found then
    raise exception 'TEST FAILED: the existing daily_records row was not updated with the new OEE value';
  end if;

  perform 1 from (
    select count(*) as c from public.daily_records
    where employee_id = v_employee_id and work_date = '2099-06-01' and shift = 'Ranní'
      and line = 'TEST_CONFLICT_REGRESSION_LINE' and product_id = v_product_id
  ) x where x.c = 1;
  if not found then
    raise exception 'TEST FAILED: expected exactly one daily_records row for the natural key after confirming the conflict - a duplicate was created';
  end if;

  perform 1 from public.import_items
  where id = v_item_id and status = 'APPROVED' and conflict_resolution = 'confirmed_import'
    and conflict_resolved_by = v_admin_id and conflict_daily_record_ids @> array[v_daily_id];
  if not found then
    raise exception 'TEST FAILED: import_items row does not show APPROVED + confirmed_import + the real conflicting record id';
  end if;
end $$;

rollback;

-- If this script reaches here, the duplicate-vs-conflict resolution fix
-- behaves as intended and no fixture data was left behind.
