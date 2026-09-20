-- Regression test for Master Prompt section 12 category J (date/time
-- boundary tests): resolve_product_profile()'s validity window is
-- valid_from <= work_date AND (valid_to IS NULL OR valid_to >= work_date) -
-- both ends inclusive. This proves the exact boundary days behave as
-- written: the profile resolves on valid_from and on valid_to themselves,
-- but not on the day immediately before valid_from or the day immediately
-- after valid_to. An off-by-one here would mean a Product Profile silently
-- stops (or starts) matching production data a day early/late - the kind of
-- bug that only shows up around a version changeover and is easy to miss in
-- ad-hoc testing.
--
-- Entirely non-destructive: everything happens inside begin/rollback.

begin;

do $$
declare
  v_code text := 'TEST_DATE_BOUNDARY_HA';
  v_valid_from date := '2099-03-10';
  v_valid_to date := '2099-03-20';
  v_result record;
begin
  insert into public.product_profiles (id, ha_subassy, h_capacity, h_norm_per_hour, profile_name, valid_from, valid_to)
  values (gen_random_uuid(), v_code, 10, 10, 'Date boundary test', v_valid_from, v_valid_to);

  -- Day before valid_from: must NOT resolve.
  select * into v_result from public.resolve_product_profile(v_code, v_valid_from - 1, false) limit 1;
  if v_result.profile_id is not null then
    raise exception 'TEST FAILED: profile resolved one day before valid_from (%), should not have', v_valid_from - 1;
  end if;

  -- Exactly valid_from: must resolve.
  select * into v_result from public.resolve_product_profile(v_code, v_valid_from, false) limit 1;
  if v_result.profile_id is null then
    raise exception 'TEST FAILED: profile did not resolve exactly on valid_from (%)', v_valid_from;
  end if;

  -- Exactly valid_to: must still resolve (inclusive end).
  select * into v_result from public.resolve_product_profile(v_code, v_valid_to, false) limit 1;
  if v_result.profile_id is null then
    raise exception 'TEST FAILED: profile did not resolve exactly on valid_to (%) - end boundary should be inclusive', v_valid_to;
  end if;

  -- Day after valid_to: must NOT resolve.
  select * into v_result from public.resolve_product_profile(v_code, v_valid_to + 1, false) limit 1;
  if v_result.profile_id is not null then
    raise exception 'TEST FAILED: profile resolved one day after valid_to (%), should not have', v_valid_to + 1;
  end if;
end $$;

rollback;

-- If this script reaches here, resolve_product_profile()'s validity window
-- is correctly inclusive on both valid_from and valid_to, and no fixture
-- data was left behind.
