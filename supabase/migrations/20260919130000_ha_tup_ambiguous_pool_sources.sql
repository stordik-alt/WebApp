-- Master Prompt bod 2.4/2.5 (HA -> TUP allocation, "více zdrojů HA"):
-- "Pokud jeden TUP záznam spotřebuje materiál z více HA záznamů, musí být
-- alokace rozdělena a auditovatelná." find_ha_tup_link() already handles
-- the case of one TUP hour drawing cumulatively across multiple HOURS of
-- its single linked HA import_item. It did NOT handle the other case the
-- same section describes: when the Product Profile's HA code matches
-- hourly rows in MORE THAN ONE separate HA import_item on the same
-- work_date/shift/HA-line (e.g. two approved screenshots both covering the
-- same HA production). Previously that returned match_status='AMBIGUOUS'
-- with no ha_import_item_id, and apply_ha_tup_capping() simply skipped the
-- TUP hour entirely - no cap, no audit trail, as if no HA link existed at
-- all. Zero real occurrences found when checked against live data before
-- writing this fix, but the gap is real: an uncapped TUP hour silently
-- overstates Performance/OEE exactly like the "no capping at all" bug
-- fixed for the 3+-TUP-sharing case in 20260919120000_generalize_ha_tup_split.sql.
--
-- Fix, following the same "no more precise data available -> conservative,
-- audited default" precedent already used for the 2-way/N-way TUP split
-- (Master Prompt bod 2.8): when multiple HA import_items are equally
-- plausible sources, POOL their cumulative available output together
-- (sum, not pick-one-and-guess) instead of giving up. This can never
-- overstate the TUP's expected output beyond what's true if the ambiguous
-- batches really are separate physical production (the correct answer),
-- and if they turn out to be duplicate/corrected re-approvals of the same
-- physical shift, that is a distinct data-quality problem the existing
-- data integrity audit is the right place to catch - HA->TUP capping's job
-- is only to reconstruct material flow as best the approved data supports,
-- never to silently decide which approved record is "the real one".
-- Every ambiguous case remains fully auditable: raw_data.calculation.
-- ha_tup_linkage now records ha_source_import_item_ids (every contributing
-- HA import_item) and ha_source_ambiguous, never just a single opaque id.

drop function if exists public.find_ha_tup_link(text, text, date, text);

create or replace function public.find_ha_tup_link(
  p_tup_product_code text,
  p_line text,
  p_work_date date,
  p_shift text
)
returns table (
  ha_import_item_id uuid,
  ha_product_code text,
  match_status text,
  ha_import_item_ids uuid[]
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_ha_codes text[];
  v_tup_line_name text;
  v_ids uuid[];
  v_matched_code text;
begin
  select array_agg(distinct pp.ha_subassy)
  into v_ha_codes
  from public.product_profiles pp
  where public.codes_match(
          lower(regexp_replace(coalesce(pp.tup_subassy, ''), '\s+', '', 'g')),
          lower(regexp_replace(coalesce(p_tup_product_code, ''), '\s+', '', 'g'))
        )
    and pp.ha_subassy is not null
    and pp.valid_from is not null
    and pp.valid_from <= p_work_date
    and (pp.valid_to is null or pp.valid_to >= p_work_date);

  if v_ha_codes is null or array_length(v_ha_codes, 1) = 0 then
    return query select null::uuid, null::text, 'NONE'::text, null::uuid[];
    return;
  end if;

  select w.line_name
  into v_tup_line_name
  from public.workplaces w
  where w.area = 'TUP'
    and (w.source_line = p_line or w.line_name = p_line)
  limit 1;

  if v_tup_line_name is null or v_tup_line_name = 'Neurčeno' then
    return query select null::uuid, v_ha_codes[1], 'NONE'::text, null::uuid[];
    return;
  end if;

  select array_agg(distinct i.id order by i.id), min(h.product_code)
  into v_ids, v_matched_code
  from public.import_item_hourly h
  join public.import_items i on i.id = h.import_item_id
  join public.workplaces w2 on w2.area = 'HA' and (w2.source_line = i.line or w2.line_name = i.line)
  where w2.line_name = v_tup_line_name
    and i.work_date = p_work_date
    and i.shift = p_shift
    and i.status in ('AUTO_APPROVED', 'APPROVED')
    and exists (
      select 1 from unnest(v_ha_codes) as candidate
      where public.codes_match(
              lower(regexp_replace(coalesce(h.product_code, ''), '\s+', '', 'g')),
              lower(regexp_replace(candidate, '\s+', '', 'g'))
            )
    );

  if v_ids is null or array_length(v_ids, 1) = 0 then
    return query select null::uuid, v_ha_codes[1], 'NONE'::text, null::uuid[];
  elsif array_length(v_ids, 1) > 1 then
    return query select null::uuid, v_matched_code, 'AMBIGUOUS'::text, v_ids;
  else
    return query select v_ids[1], v_matched_code, 'LINKED'::text, v_ids;
  end if;
end;
$$;

grant execute on function public.find_ha_tup_link(text, text, date, text) to authenticated;

create or replace function public.apply_ha_tup_capping(
  p_tup_import_item_id uuid,
  p_tup_product_code text,
  p_allocation_fraction numeric default 1.0
)
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
  v_allocated_ha numeric;
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

  if v_link.match_status = 'NONE' or v_link.ha_import_item_ids is null or array_length(v_link.ha_import_item_ids, 1) = 0 then
    return jsonb_build_object('status', coalesce(v_link.match_status, 'NONE'));
  end if;

  v_shift_start_hour := public.auto_shift_start_minute(v_item.shift) / 60;

  for r in
    select h.id, h.hour, h.actual_output,
      nullif(trim(coalesce(h.raw_data -> 'calculation' ->> 'expected_output_at_current_staffing', '')), '')::numeric as expected,
      h.availability_pct,
      coalesce(
        nullif(trim(coalesce(h.raw_data -> 'calculation' ->> 'availability_applied_to_oee', '')), '')::numeric,
        h.availability_pct
      ) as availability_for_oee,
      ((h.hour - v_shift_start_hour + 24) % 24) as rel_hour
    from public.import_item_hourly h
    where h.import_item_id = p_tup_import_item_id
      and public.codes_match(
            lower(regexp_replace(coalesce(h.product_code, ''), '\s+', '', 'g')),
            lower(regexp_replace(p_tup_product_code, '\s+', '', 'g'))
          )
    order by ((h.hour - v_shift_start_hour + 24) % 24)
  loop
    -- Pools cumulative-by-hour output across every candidate HA import_item
    -- (a single-element array for the normal LINKED case - identical result
    -- to before - or every ambiguous candidate when match_status='AMBIGUOUS').
    select coalesce(sum(h2.actual_output), 0)
    into v_cum_ha
    from public.import_item_hourly h2
    where h2.import_item_id = any(v_link.ha_import_item_ids)
      and public.codes_match(
            lower(regexp_replace(coalesce(h2.product_code, ''), '\s+', '', 'g')),
            lower(regexp_replace(v_link.ha_product_code, '\s+', '', 'g'))
          )
      and ((h2.hour - v_shift_start_hour + 24) % 24) <= r.rel_hour;

    v_allocated_ha := v_cum_ha * p_allocation_fraction;

    v_expected_before := r.expected;
    if v_expected_before is null or v_expected_before <= 0 then
      continue;
    end if;

    v_expected_after := least(v_expected_before, v_allocated_ha);
    if v_expected_after <= 0 then
      v_perf_new := null;
    elsif r.actual_output is not null then
      v_perf_new := r.actual_output / v_expected_after * 100;
    else
      v_perf_new := null;
    end if;
    v_oee_new := case when v_perf_new is not null and r.availability_for_oee is not null then v_perf_new * r.availability_for_oee / 100 else null end;

    update public.import_item_hourly
    set performance_pct = coalesce(v_perf_new, performance_pct),
        actual_oee_pct = coalesce(v_oee_new, actual_oee_pct),
        raw_data = coalesce(raw_data, '{}'::jsonb) || jsonb_build_object(
          'calculation', coalesce(raw_data -> 'calculation', '{}'::jsonb) || jsonb_build_object(
            'ha_tup_linkage', jsonb_build_object(
              'linked_ha_import_item_id', v_link.ha_import_item_id,
              'ha_source_import_item_ids', to_jsonb(v_link.ha_import_item_ids),
              'ha_source_ambiguous', v_link.match_status = 'AMBIGUOUS',
              'ha_product_code', v_link.ha_product_code,
              'ha_cumulative_available', v_cum_ha,
              'allocation_fraction', p_allocation_fraction,
              'ha_allocated_available', v_allocated_ha,
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

  return jsonb_build_object('status', 'APPLIED', 'hours_updated', v_updated, 'linked_ha_import_item_id', v_link.ha_import_item_id, 'ha_source_ambiguous', v_link.match_status = 'AMBIGUOUS', 'allocation_fraction', p_allocation_fraction);
end;
$$;

grant execute on function public.apply_ha_tup_capping(uuid, text, numeric) to authenticated;

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
  v_split_applied integer := 0;
  v_ambiguous_applied integer := 0;
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
      with tup_candidates as (
        select distinct i2.id as import_item_id, h.product_code, i2.line
        from public.import_items i2
        join public.import_item_hourly h on h.import_item_id = i2.id
        where i2.work_date = v_pair.work_date
          and i2.shift = v_pair.shift
          and i2.status in ('AUTO_APPROVED', 'APPROVED')
          and h.product_code ~* '^T_'
      ),
      linked as (
        select tc.import_item_id, tc.product_code, l.ha_import_item_ids, l.match_status
        from tup_candidates tc
        cross join lateral public.find_ha_tup_link(tc.product_code, tc.line, v_pair.work_date, v_pair.shift) l
        where l.match_status in ('LINKED', 'AMBIGUOUS')
      ),
      -- Groups by the FULL set of contributing HA import_items, not a
      -- single id, so two AMBIGUOUS TUP products that resolve to the same
      -- pooled HA source set are still recognized as sharing that source
      -- (and get the same 1/N split treatment a plain LINKED pairing would).
      sharing as (
        select ha_import_item_ids, count(*) as tup_count
        from linked
        group by ha_import_item_ids
      )
      select l.import_item_id, l.product_code, l.match_status, s.tup_count
      from linked l
      join sharing s on s.ha_import_item_ids = l.ha_import_item_ids
    loop
      v_checked := v_checked + 1;
      v_result := public.apply_ha_tup_capping(v_tup.import_item_id, v_tup.product_code, 1.0 / v_tup.tup_count);
      if v_tup.tup_count > 1 and v_result ->> 'status' = 'APPLIED' then
        v_split_applied := v_split_applied + 1;
      end if;
      if v_tup.match_status = 'AMBIGUOUS' and v_result ->> 'status' = 'APPLIED' then
        v_ambiguous_applied := v_ambiguous_applied + 1;
      end if;
      if v_result ->> 'status' = 'APPLIED' then
        v_applied := v_applied + 1;
      end if;
    end loop;
  end loop;

  return jsonb_build_object('checked', v_checked, 'applied', v_applied, 'split_applied', v_split_applied, 'ambiguous_applied', v_ambiguous_applied);
end;
$$;

grant execute on function public.evaluate_batch_ha_tup_linkage(uuid) to authenticated;
