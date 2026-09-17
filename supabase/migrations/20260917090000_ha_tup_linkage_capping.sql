-- Part B of "Master Prompt Agent Hodnoceni Pracovniku": HA -> TUP linkage
-- with output capping. Confirmed scope with the user before implementing:
--   - Granularity: cumulative-by-hour (a TUP hour is capped by HA's
--     cumulative actual_output through that same shift-relative hour, using
--     the only time precision the data actually has - hour buckets, not
--     minutes).
--   - Cross-shift carry-over is explicitly out of scope: a link is only
--     ever considered between an HA and a TUP production on the SAME
--     work_date + shift. No inventory/stock carried across shifts.
--   - Evaluation timing: linkage is evaluated once a whole batch's items are
--     already approved (per the concept doc's own required ordering -
--     "vyhodnocení vazeb probíhá až po zpracování celé importované dávky"),
--     not during per-screenshot processing. Since an HA and its paired TUP
--     are normally two DIFFERENT screenshots (frequently in different
--     batches, possibly uploaded hours or days apart), the evaluator looks
--     at every TUP product for the touched work_date/shift across ALL
--     batches, not just the one just completed - this covers both
--     "HA arrives after TUP" and "TUP arrives after HA" without needing to
--     special-case which side shows up first.
--   - Ambiguous cases (more than one HA candidate matches) are recorded
--     (match_status = 'AMBIGUOUS' from find_ha_tup_link) but the linkage is
--     NOT auto-applied - standard uncapped evaluation stands. No dedicated
--     review UI for ambiguous cases yet (confirmed acceptable for now).
--
-- Evidence required before a link is ever applied (per the concept doc's
-- explicit "must be evidenced, never assumed" rule):
--   1. A product_profiles row pairs this TUP product's code to an HA code
--      (ha_subassy/tup_subassy, matched via the same codes_match() suffix
--      fallback used everywhere else), valid at the work date.
--   2. The TUP screenshot's line resolves (via workplaces) to a line_name,
--      and that line_name is NOT "Neurčeno" (undetermined) - an
--      undetermined line_name is treated as no evidence of a specific
--      physical pairing, so no link is inferred from it.
--   3. Exactly ONE approved import_item on a workplace sharing that
--      line_name (area = 'HA') has hourly data for the paired HA code on
--      the same work_date + shift. Zero matches = no link (standard
--      evaluation). More than one match = ambiguous, not applied.

-- 1) Given a TUP product code + the line/date/shift it was produced on,
-- find its evidenced HA pairing, if any.
create or replace function public.find_ha_tup_link(
  p_tup_product_code text,
  p_line text,
  p_work_date date,
  p_shift text
)
returns table (
  ha_import_item_id uuid,
  ha_product_code text,
  match_status text
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_ha_code text;
  v_tup_line_name text;
  v_ids uuid[];
begin
  select pp.ha_subassy
  into v_ha_code
  from public.product_profiles pp
  where public.codes_match(
          lower(regexp_replace(coalesce(pp.tup_subassy, ''), '\s+', '', 'g')),
          lower(regexp_replace(coalesce(p_tup_product_code, ''), '\s+', '', 'g'))
        )
    and pp.valid_from is not null
    and pp.valid_from <= p_work_date
    and (pp.valid_to is null or pp.valid_to >= p_work_date)
  order by pp.valid_to is null desc, pp.valid_from desc, pp.version_no desc
  limit 1;

  if v_ha_code is null then
    return query select null::uuid, null::text, 'NONE'::text;
    return;
  end if;

  select w.line_name
  into v_tup_line_name
  from public.workplaces w
  where w.source_line = p_line
    and w.area = 'TUP'
  limit 1;

  if v_tup_line_name is null or v_tup_line_name = 'Neurčeno' then
    return query select null::uuid, v_ha_code, 'NONE'::text;
    return;
  end if;

  select array_agg(distinct i.id)
  into v_ids
  from public.import_item_hourly h
  join public.import_items i on i.id = h.import_item_id
  join public.workplaces w2 on w2.source_line = i.line and w2.area = 'HA'
  where w2.line_name = v_tup_line_name
    and i.work_date = p_work_date
    and i.shift = p_shift
    and i.status in ('AUTO_APPROVED', 'APPROVED')
    and public.codes_match(
          lower(regexp_replace(coalesce(h.product_code, ''), '\s+', '', 'g')),
          lower(regexp_replace(v_ha_code, '\s+', '', 'g'))
        );

  if v_ids is null or array_length(v_ids, 1) = 0 then
    return query select null::uuid, v_ha_code, 'NONE'::text;
  elsif array_length(v_ids, 1) > 1 then
    return query select null::uuid, v_ha_code, 'AMBIGUOUS'::text;
  else
    return query select v_ids[1], v_ha_code, 'LINKED'::text;
  end if;
end;
$$;

grant execute on function public.find_ha_tup_link(text, text, date, text) to authenticated;

-- 2) For one TUP import_item + product, if an unambiguous HA link exists,
-- recompute performance/OEE per hour with the expected output capped at
-- HA's cumulative available units through that shift-relative hour, then
-- refresh the already-created daily_records for that product with the
-- corrected weighted aggregate (reusing compute_import_item_product_kpis,
-- which already picks up the updated import_item_hourly values).
create or replace function public.apply_ha_tup_capping(p_tup_import_item_id uuid, p_tup_product_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item public.import_items%rowtype;
  v_link record;
  v_shift_start_hour integer;
  r record;
  v_cum_ha numeric;
  v_expected_before numeric;
  v_expected_after numeric;
  v_perf_new numeric;
  v_oee_new numeric;
  v_updated integer := 0;
  v_product record;
begin
  select * into v_item from public.import_items where id = p_tup_import_item_id;
  if not found or v_item.work_date is null or nullif(trim(coalesce(v_item.shift,'')),'') is null or nullif(trim(coalesce(v_item.line,'')),'') is null then
    return jsonb_build_object('status', 'SKIPPED', 'reason', 'missing_header');
  end if;

  select * into v_link from public.find_ha_tup_link(p_tup_product_code, v_item.line, v_item.work_date, v_item.shift) limit 1;

  if v_link.match_status is distinct from 'LINKED' then
    return jsonb_build_object('status', coalesce(v_link.match_status, 'NONE'));
  end if;

  v_shift_start_hour := public.auto_shift_start_minute(v_item.shift) / 60;

  for r in
    select h.id, h.hour, h.actual_output,
      nullif(trim(coalesce(h.raw_data -> 'calculation' ->> 'expected_output_at_current_staffing', '')), '')::numeric as expected,
      h.availability_pct,
      ((h.hour - v_shift_start_hour + 24) % 24) as rel_hour
    from public.import_item_hourly h
    where h.import_item_id = p_tup_import_item_id
      and public.codes_match(
            lower(regexp_replace(coalesce(h.product_code, ''), '\s+', '', 'g')),
            lower(regexp_replace(p_tup_product_code, '\s+', '', 'g'))
          )
    order by ((h.hour - v_shift_start_hour + 24) % 24)
  loop
    select coalesce(sum(h2.actual_output), 0)
    into v_cum_ha
    from public.import_item_hourly h2
    where h2.import_item_id = v_link.ha_import_item_id
      and public.codes_match(
            lower(regexp_replace(coalesce(h2.product_code, ''), '\s+', '', 'g')),
            lower(regexp_replace(v_link.ha_product_code, '\s+', '', 'g'))
          )
      and ((h2.hour - v_shift_start_hour + 24) % 24) <= r.rel_hour;

    v_expected_before := r.expected;
    if v_expected_before is null or v_expected_before <= 0 then
      continue;
    end if;

    v_expected_after := least(v_expected_before, v_cum_ha);
    if v_expected_after <= 0 then
      v_perf_new := null;
    elsif r.actual_output is not null then
      v_perf_new := r.actual_output / v_expected_after * 100;
    else
      v_perf_new := null;
    end if;
    v_oee_new := case when v_perf_new is not null and r.availability_pct is not null then v_perf_new * r.availability_pct / 100 else null end;

    update public.import_item_hourly
    set performance_pct = coalesce(v_perf_new, performance_pct),
        actual_oee_pct = coalesce(v_oee_new, actual_oee_pct),
        raw_data = coalesce(raw_data, '{}'::jsonb) || jsonb_build_object(
          'calculation', coalesce(raw_data -> 'calculation', '{}'::jsonb) || jsonb_build_object(
            'ha_tup_linkage', jsonb_build_object(
              'linked_ha_import_item_id', v_link.ha_import_item_id,
              'ha_product_code', v_link.ha_product_code,
              'ha_cumulative_available', v_cum_ha,
              'expected_before_cap', v_expected_before,
              'expected_after_cap', v_expected_after,
              'capped', v_expected_after < v_expected_before
            )
          )
        )
    where id = r.id;
    v_updated := v_updated + 1;
  end loop;

  if v_updated = 0 then
    return jsonb_build_object('status', 'NO_HOURS');
  end if;

  select * into v_product
  from public.compute_import_item_product_kpis(p_tup_import_item_id, v_item.work_date) x
  where public.codes_match(
          lower(regexp_replace(x.product_code, '\s+', '', 'g')),
          lower(regexp_replace(p_tup_product_code, '\s+', '', 'g'))
        )
  limit 1;

  if found and v_product.product_id is not null then
    update public.daily_records
    set oee = round(v_product.oee, 2), performance = round(v_product.performance, 2), available_time = round(v_product.availability, 2)
    where import_batch_id = v_item.batch_id
      and work_date = v_item.work_date
      and shift = v_item.shift
      and line = v_item.line
      and product_id = v_product.product_id;
  end if;

  return jsonb_build_object('status', 'APPLIED', 'hours_updated', v_updated, 'linked_ha_import_item_id', v_link.ha_import_item_id);
end;
$$;

grant execute on function public.apply_ha_tup_capping(uuid, text) to authenticated;

-- 3) Batch-level entry point: for every work_date/shift this batch touched,
-- re-evaluate ALL approved TUP products for that work_date/shift across
-- every batch (not just this one) - this is what makes the "evaluate after
-- the whole batch" rule work regardless of whether the HA or TUP screenshot
-- was uploaded first, possibly in an entirely separate batch.
create or replace function public.evaluate_batch_ha_tup_linkage(p_batch_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pair record;
  v_tup record;
  v_result jsonb;
  v_applied integer := 0;
  v_checked integer := 0;
begin
  for v_pair in
    select distinct i.work_date, i.shift
    from public.import_items i
    where i.batch_id = p_batch_id
      and i.status in ('AUTO_APPROVED', 'APPROVED')
      and i.work_date is not null
      and i.shift is not null
  loop
    for v_tup in
      select distinct i2.id as import_item_id, h.product_code
      from public.import_items i2
      join public.import_item_hourly h on h.import_item_id = i2.id
      where i2.work_date = v_pair.work_date
        and i2.shift = v_pair.shift
        and i2.status in ('AUTO_APPROVED', 'APPROVED')
        and h.product_code ~* '^T_'
    loop
      v_checked := v_checked + 1;
      v_result := public.apply_ha_tup_capping(v_tup.import_item_id, v_tup.product_code);
      if v_result ->> 'status' = 'APPLIED' then
        v_applied := v_applied + 1;
      end if;
    end loop;
  end loop;

  return jsonb_build_object('checked', v_checked, 'applied', v_applied);
end;
$$;

grant execute on function public.evaluate_batch_ha_tup_linkage(uuid) to authenticated;
