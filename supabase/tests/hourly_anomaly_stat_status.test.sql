-- Regression test for Master Prompt body 4-5 (ANOMÁLNÍ HODINY / STATISTICKÁ
-- IZOLACE): the per-hour statistical inclusion state machine.
--
-- Verifies:
-- 1. reconstruct_import_item_hourly() auto-flags an hour ANOMALY_PENDING_REVIEW
--    only when its minutes are DERIVED (uncertain reconstruction) AND the
--    resulting performance/OEE is implausible (>200%) - a normal DERIVED
--    hour with a plausible result must stay INCLUDED (bod 4.1: "anomálie
--    není automaticky chyba").
-- 2. compute_import_item_product_kpis() excludes ANOMALY_PENDING_REVIEW/
--    MANUALLY_EXCLUDED hours from its weighted average (bod 5: statistická
--    izolace) - only the normal hour counts.
-- 3. set_hourly_stat_status() lets an admin manually include the flagged
--    hour, and the aggregate then blends both hours (bod 3.5).
-- 4. A manual exclude decision survives a fresh automatic recompute -
--    reconstruct_import_item_hourly() never silently reverts it (bod 6).
-- 5. Exactly the expected number of audit events is recorded (bod 4.5).
-- 6. list_hourly_stat_review() surfaces the manually excluded hour.
-- 7. A caller without the admin role is rejected by set_hourly_stat_status().
--
-- Entirely non-destructive: everything happens inside begin/rollback.

begin;

insert into product_profiles (ha_subassy, h_capacity, h_norm_per_hour, valid_from)
values ('H_TESTANOM999', 1, 100, '1999-01-01');

insert into import_batches (id, status, total_items) values
  ('d1d1d1d1-0000-0000-0000-000000000001', 'PROCESSING', 1);

insert into import_items (id, batch_id, status, work_date, shift, line, screenshot_path, source_hash) values
  ('d2d2d2d2-0000-0000-0000-000000000001', 'd1d1d1d1-0000-0000-0000-000000000001', 'AUTO_APPROVED', '1999-01-04', 'Ranní', 'TEST_ANOM_LINE', 'test/anom.png', 'test-fixture-anom-0001');

-- hour 8: DERIVED (segment start, first hour of the item) but a plausible
-- ~95% result - must stay INCLUDED despite being DERIVED.
-- hour 9: DERIVED (last hour of the item) with an implausible ~250% result
-- - must be flagged ANOMALY_PENDING_REVIEW.
insert into import_item_hourly (import_item_id, hour, product_code, actual_output, role) values
  ('d2d2d2d2-0000-0000-0000-000000000001', 8, 'H_TESTANOM999', 95, 'HA'),
  ('d2d2d2d2-0000-0000-0000-000000000001', 9, 'H_TESTANOM999', 250, 'HA');

do $$
declare
  v_normal_status text;
  v_anom_status text;
  v_anom_perf numeric;
begin
  perform public.reconstruct_import_item_hourly('d2d2d2d2-0000-0000-0000-000000000001');
  select stat_status into v_normal_status from import_item_hourly where import_item_id = 'd2d2d2d2-0000-0000-0000-000000000001' and hour = 8;
  select stat_status, performance_pct into v_anom_status, v_anom_perf from import_item_hourly where import_item_id = 'd2d2d2d2-0000-0000-0000-000000000001' and hour = 9;

  if v_normal_status <> 'INCLUDED' then
    raise exception 'TEST FAILED: plausible DERIVED hour expected INCLUDED, got %', v_normal_status;
  end if;
  if v_anom_status <> 'ANOMALY_PENDING_REVIEW' then
    raise exception 'TEST FAILED: implausible DERIVED hour expected ANOMALY_PENDING_REVIEW, got % (perf=%)', v_anom_status, v_anom_perf;
  end if;
end $$;

do $$
declare
  v_kpi record;
begin
  select * into v_kpi from public.compute_import_item_product_kpis('d2d2d2d2-0000-0000-0000-000000000001', '1999-01-04') limit 1;
  if abs(v_kpi.performance - 95) > 0.01 then
    raise exception 'TEST FAILED: expected aggregate performance ~95 (anomaly excluded), got %', v_kpi.performance;
  end if;
end $$;

-- Simulate an admin session and manually include the anomalous hour.
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);
insert into user_roles (user_id, role) values ('11111111-1111-1111-1111-111111111111', 'admin');

do $$
declare
  v_anom_id uuid;
  v_result jsonb;
  v_kpi record;
begin
  select id into v_anom_id from import_item_hourly where import_item_id = 'd2d2d2d2-0000-0000-0000-000000000001' and hour = 9;
  v_result := public.set_hourly_stat_status(v_anom_id, 'MANUALLY_INCLUDED', 'Ověřeno ručně, výstup je správný', 'test note');
  if v_result ->> 'status' <> 'OK' then
    raise exception 'TEST FAILED: set_hourly_stat_status did not succeed: %', v_result;
  end if;

  select * into v_kpi from public.compute_import_item_product_kpis('d2d2d2d2-0000-0000-0000-000000000001', '1999-01-04') limit 1;
  -- Both hours now count: weighted avg of 95% and 250% with equal minutes -> 172.5%.
  if abs(v_kpi.performance - 172.5) > 0.01 then
    raise exception 'TEST FAILED: expected aggregate performance ~172.5 after manual include, got %', v_kpi.performance;
  end if;
end $$;

-- Manually exclude it instead, and verify a fresh recompute does NOT
-- silently revert the manual decision.
do $$
declare
  v_anom_id uuid;
  v_result jsonb;
  v_status_after_recompute text;
  v_events int;
begin
  select id into v_anom_id from import_item_hourly where import_item_id = 'd2d2d2d2-0000-0000-0000-000000000001' and hour = 9;
  v_result := public.set_hourly_stat_status(v_anom_id, 'MANUALLY_EXCLUDED', 'Nelze spolehlivě určit efektivní čas výroby.', null);
  if v_result ->> 'status' <> 'OK' then
    raise exception 'TEST FAILED: exclude did not succeed: %', v_result;
  end if;

  perform public.reconstruct_import_item_hourly('d2d2d2d2-0000-0000-0000-000000000001');
  select stat_status into v_status_after_recompute from import_item_hourly where id = v_anom_id;
  if v_status_after_recompute <> 'MANUALLY_EXCLUDED' then
    raise exception 'TEST FAILED: automatic recompute silently reverted a manual decision, got %', v_status_after_recompute;
  end if;

  select count(*) into v_events from import_item_hourly_stat_events where import_item_hourly_id = v_anom_id;
  if v_events <> 2 then
    raise exception 'TEST FAILED: expected 2 audit events (include then exclude), got %', v_events;
  end if;
end $$;

do $$
declare
  v_found boolean;
begin
  select exists(select 1 from public.list_hourly_stat_review() where import_item_id = 'd2d2d2d2-0000-0000-0000-000000000001' and hour = 9) into v_found;
  if not v_found then
    raise exception 'TEST FAILED: list_hourly_stat_review did not surface the manually excluded hour';
  end if;
end $$;

-- A non-admin caller must be rejected.
select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', true);
do $$
declare
  v_anom_id uuid;
  v_rejected boolean := false;
begin
  select id into v_anom_id from import_item_hourly where import_item_id = 'd2d2d2d2-0000-0000-0000-000000000001' and hour = 9;
  begin
    perform public.set_hourly_stat_status(v_anom_id, 'MANUALLY_INCLUDED', 'should fail', null);
  exception when others then
    v_rejected := true;
  end;
  if not v_rejected then
    raise exception 'TEST FAILED: non-admin call to set_hourly_stat_status should have been rejected';
  end if;
end $$;

rollback;

-- If this script reaches here, the hourly anomaly stat-status state machine
-- behaves as intended and no fixture data was left behind.
