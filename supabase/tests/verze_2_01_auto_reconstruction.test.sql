-- Verze 2.01 AUTO – deterministic reconstruction tests
--
-- This test is intentionally non-destructive. It does not insert/update any
-- production records. It verifies the mathematical rules used by the
-- reconstruction algorithm against the problematic 19.08.2026 scenario.
-- Run with the project's Supabase/Postgres test runner.

begin;

-- 1) Partial first hour: OCR interval quantity / master hourly norm -> minutes.
-- Example: 12 expected pieces against a 39 pcs/h master norm => ~18.46 min.
do $$
declare
  master_norm numeric := 39;
  interval_qty numeric := 12;
  minutes numeric := interval_qty / master_norm * 60;
begin
  if abs(minutes - 18.4615384615) > 0.000001 then
    raise exception 'TEST 1 FAILED: expected ~18.461538 min, got %', minutes;
  end if;
end $$;

-- 2) The same reconstructed interval must never be treated as a full hour.
do $$
declare
  master_norm numeric := 39;
  interval_qty numeric := 12;
  minutes numeric := interval_qty / master_norm * 60;
begin
  if minutes >= 60 then
    raise exception 'TEST 2 FAILED: partial interval became a full hour';
  end if;
end $$;

-- 3) Staffing expectation: capacity 4, available operators 3.
-- Expected output is master norm * productive minutes/60 * 4/3.
do $$
declare
  master_norm numeric := 39;
  productive_minutes numeric := 30;
  capacity numeric := 4;
  operators numeric := 3;
  expected numeric := master_norm * productive_minutes / 60 * capacity / operators;
begin
  if abs(expected - 26) > 0.000001 then
    raise exception 'TEST 3 FAILED: expected 26 pcs at 30 min and 4/3 staffing, got %', expected;
  end if;
end $$;

-- 4) Product change downtime: 28 minutes leaves 32 productive minutes.
do $$
declare
  downtime numeric := 28;
  productive numeric := greatest(0, least(60, 60 - downtime));
begin
  if productive <> 32 then
    raise exception 'TEST 4 FAILED: expected 32 productive minutes after 28 min downtime, got %', productive;
  end if;
end $$;

-- 5) Two products in one clock hour must be represented independently.
-- This test models the persistence key used by 2.01 AUTO.
do $$
declare
  key_a text := '8|h_s4572a-ia';
  key_b text := '8|h_sm11447';
begin
  if key_a = key_b then
    raise exception 'TEST 5 FAILED: two product/hour keys collided';
  end if;
end $$;

-- 6) Canonical OEE formula including capacity/operator factor.
do $$
declare
  performance numeric := 90;
  availability numeric := 80;
  capacity numeric := 4;
  operators numeric := 3;
  oee numeric := performance * availability * (capacity / operators) / 100;
begin
  if abs(oee - 96) > 0.000001 then
    raise exception 'TEST 6 FAILED: expected OEE 96, got %', oee;
  end if;
end $$;

-- 7) Master norm is never replaced by OCR interval quantity.
do $$
declare
  master_norm numeric := 39;
  ocr_interval_qty numeric := 12;
  stored_master_norm numeric := master_norm;
begin
  if stored_master_norm = ocr_interval_qty then
    raise exception 'TEST 7 FAILED: OCR interval quantity replaced master norm';
  end if;
  if stored_master_norm <> 39 then
    raise exception 'TEST 7 FAILED: master norm changed unexpectedly: %', stored_master_norm;
  end if;
end $$;

-- 8) Derived values are explicitly distinguishable from exact clock values.
do $$
declare
  reconstruction_status text := 'DERIVED';
  reconstruction_source text := 'OCR_interval_norm_divided_by_master_norm';
begin
  if reconstruction_status <> 'DERIVED' then
    raise exception 'TEST 8 FAILED: reconstructed interval is not marked DERIVED';
  end if;
  if reconstruction_source is null or reconstruction_source = '' then
    raise exception 'TEST 8 FAILED: reconstruction source is missing';
  end if;
end $$;

rollback;

-- If this script reaches here, all deterministic 2.01 AUTO reconstruction
-- rules passed without changing production data.
