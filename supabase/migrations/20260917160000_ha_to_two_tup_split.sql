-- Master Prompt Problem 6: one HA line can feed two TUP workplaces at the
-- same time (both workplaces.line_name tagged the same as the HA's, which
-- the existing evidence mechanism from Part B already resolves to the same
-- HA import_item independently for each TUP). Before this fix, each of the
-- two TUP items independently called apply_ha_tup_capping and capped its
-- own expected output at the HA's FULL cumulative availability - meaning
-- both TUPs could simultaneously claim up to 100% of the same HA output,
-- exactly what the concept doc forbids ("nesmí přidělit 100 % HA produkce
-- každému ze dvou TUP pracovišť").
--
-- apply_ha_tup_capping now takes an allocation fraction (default 1.0,
-- preserving existing single-TUP behavior exactly). evaluate_batch_ha_tup_linkage
-- groups every LINKED TUP candidate for a work_date/shift by which HA
-- import_item it resolves to:
--   - exactly 1 TUP on that HA: unchanged, fraction 1.0.
--   - exactly 2 TUP sharing that HA: the one ratio the doc authorizes
--     without more precise allocation data - 50/50 - so the two allocations
--     always sum to the HA's full cumulative output, never double-claim it.
--   - 3+ TUP sharing one HA: no formula is specified in the doc for that
--     case ("50 % není univerzální pravidlo pro libovolný počet TUP"), and
--     inventing an even 1/N split would be exactly the kind of assumption
--     the doc forbids. Left uncapped (standard evaluation stands), the same
--     precedent already established for the AMBIGUOUS-HA-match case.

-- A default-valued 3rd parameter does not replace the existing 2-arg
-- signature in Postgres (function identity is by argument types) - drop it
-- explicitly first, or both overloads would coexist and any 2-arg caller
-- would become ambiguous.
drop function if exists public.apply_ha_tup_capping(uuid, text);

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

  return jsonb_build_object('status', 'APPLIED', 'hours_updated', v_updated, 'linked_ha_import_item_id', v_link.ha_import_item_id, 'allocation_fraction', p_allocation_fraction);
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
  v_skipped_multi integer := 0;
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
        select tc.import_item_id, tc.product_code, l.ha_import_item_id, l.match_status
        from tup_candidates tc
        cross join lateral public.find_ha_tup_link(tc.product_code, tc.line, v_pair.work_date, v_pair.shift) l
      ),
      sharing as (
        select ha_import_item_id, count(*) as tup_count
        from linked
        where match_status = 'LINKED'
        group by ha_import_item_id
      )
      select l.import_item_id, l.product_code, s.tup_count
      from linked l
      join sharing s on s.ha_import_item_id = l.ha_import_item_id
      where l.match_status = 'LINKED'
    loop
      v_checked := v_checked + 1;
      if v_tup.tup_count = 1 then
        v_result := public.apply_ha_tup_capping(v_tup.import_item_id, v_tup.product_code, 1.0);
      elsif v_tup.tup_count = 2 then
        v_result := public.apply_ha_tup_capping(v_tup.import_item_id, v_tup.product_code, 0.5);
        if v_result ->> 'status' = 'APPLIED' then
          v_split_applied := v_split_applied + 1;
        end if;
      else
        v_skipped_multi := v_skipped_multi + 1;
        continue;
      end if;
      if v_result ->> 'status' = 'APPLIED' then
        v_applied := v_applied + 1;
      end if;
    end loop;
  end loop;

  return jsonb_build_object('checked', v_checked, 'applied', v_applied, 'split_applied', v_split_applied, 'skipped_multi_tup_share', v_skipped_multi);
end;
$$;

grant execute on function public.evaluate_batch_ha_tup_linkage(uuid) to authenticated;
