-- Verze 2.01 AUTO – production-time reconstruction
--
-- Purpose:
-- 1) Do not assume that the first non-zero production hour represents 60
--    productive minutes when the screenshot shows 100% availability and no
--    downtime. The produced quantity can reveal that production started later.
-- 2) Keep the master Product Profile norm unchanged.
-- 3) Store reconstructed productive minutes and expected output in the hourly
--    calculation metadata so the approval detail can explain the calculation.
--
-- Example: master norm 39 ks/h, actual output 12 ks and no downtime implies
-- approximately 18.46 productive minutes. The row's effective norm is then
-- 12 ks, while OEE still applies the capacity/operator factor separately.

create or replace function public.auto_reconstruct_import_item(uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  p_import_item_id alias for $1;
  v_item public.import_items%rowtype;
  v_operator_count integer;
  v_first_id uuid;
  v_first_hour integer;
  v_output numeric;
  v_norm numeric;
  v_capacity numeric;
  v_availability numeric;
  v_minutes numeric;
  v_expected numeric;
  v_oee numeric;
  v_screenshot_time text;
  r record;
begin
  select * into v_item
  from public.import_items
  where id = p_import_item_id;

  if not found then
    return;
  end if;

  select count(*) into v_operator_count
  from public.import_item_rows
  where import_item_id = p_import_item_id
    and employee_id is not null;

  if v_operator_count < 1 then
    return;
  end if;

  v_screenshot_time := nullif(trim(v_item.ocr_data ->> 'screenshot_time'), '');

  -- Find the first hourly row with real production, in shift order.
  select h.id, h.hour, h.actual_output, h.norm_per_hour, h.capacity,
         h.availability_pct
    into v_first_id, v_first_hour, v_output, v_norm, v_capacity,
         v_availability
  from public.import_item_hourly h
  where h.import_item_id = p_import_item_id
    and coalesce(h.actual_output, 0) > 0
  order by
    case
      when lower(trim(coalesce(v_item.shift, ''))) like 'ra%' and h.hour >= 6 then h.hour - 6
      when lower(trim(coalesce(v_item.shift, ''))) like 'od%' and h.hour >= 14 then h.hour - 14
      when lower(trim(coalesce(v_item.shift, ''))) like 'no%' and h.hour >= 22 then h.hour - 22
      when lower(trim(coalesce(v_item.shift, ''))) like 'no%' then h.hour + 2
      else h.hour
    end,
    h.id
  limit 1;

  if v_first_id is null or v_output is null or v_norm is null or v_norm <= 0 then
    return;
  end if;

  -- Reconstruction is deliberately conservative. We only infer a late start
  -- when the row reports full availability and there is no recorded downtime.
  -- If the first productive hour is already partial for another reason, the
  -- canonical clock-time model remains the source of truth.
  if coalesce(v_availability, 0) < 99.99 then
    return;
  end if;

  v_minutes := greatest(0, least(60, v_output / v_norm * 60));

  -- Do not turn a normal full hour into an artificial partial hour.
  if v_minutes >= 59.5 then
    return;
  end if;

  v_expected := v_norm * v_minutes / 60;
  v_oee := case
    when v_capacity is not null and v_capacity > 0 and v_operator_count > 0
      then 100 * coalesce(v_availability, 100) * (v_capacity / v_operator_count::numeric) / 100
    else null
  end;

  update public.import_item_hourly
  set performance_pct = 100,
      actual_oee_pct = v_oee,
      raw_data = coalesce(raw_data, '{}'::jsonb) || jsonb_build_object(
        'calculation', coalesce(raw_data -> 'calculation', '{}'::jsonb) || jsonb_build_object(
          'reconstruction_model', '2.01-AUTO-production-time-v1',
          'reconstruction_status', 'INFERRED_FROM_OUTPUT',
          'reconstructed_productive_minutes', round(v_minutes, 2),
          'reconstructed_effective_norm', round(v_expected, 2),
          'reconstruction_basis', 'actual_output / Product Profile master norm × 60',
          'reconstruction_confidence', 'DERIVED',
          'capacity', v_capacity,
          'operator_count', v_operator_count,
          'expected_output_without_capacity_factor', round(v_expected, 2),
          'expected_output_with_capacity_factor', case
            when v_capacity is not null and v_capacity > 0
              then round(v_expected * v_capacity / v_operator_count::numeric, 2)
            else null
          end,
          'calculated_performance_pct', 100,
          'calculated_oee_pct', v_oee
        )
      )
  where id = v_first_id;
end;
$$;

grant execute on function public.auto_reconstruct_import_item(uuid) to authenticated;

-- The canonical recalculation runs first. Reconstruction then adjusts only the
-- conservative first-hour case and writes its provenance to raw_data.
create or replace function public.recalculate_import_item_kpis_on_validating()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'VALIDATING' and old.status is distinct from new.status then
    perform public.recalculate_import_item_kpis(new.id);
    perform public.auto_reconstruct_import_item(new.id);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_import_items_recalculate_kpis on public.import_items;
create trigger trg_import_items_recalculate_kpis
after update on public.import_items
for each row
execute function public.recalculate_import_item_kpis_on_validating();

grant execute on function public.recalculate_import_item_kpis_on_validating() to authenticated;

-- Also expose the reconstruction model version on future recalculations.
comment on function public.auto_reconstruct_import_item(uuid) is
'Verze 2.01 AUTO: conservative reconstruction of late production start from actual output and Product Profile master norm.';
