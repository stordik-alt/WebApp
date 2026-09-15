-- Verze 2.01 AUTO: allow the current canonical KPI recalculation to update
-- import_item_rows while keeping manual KPI edits protected.
-- The older integrity trigger only recognized the historical 2.0 model marker.

create or replace function public.prevent_manual_import_kpi_edit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  item_status text;
  is_system_recalc boolean;
begin
  select status into item_status
  from public.import_items
  where id = new.import_item_id;

  is_system_recalc :=
    coalesce(new.raw_data -> 'calculation' ->> 'model_version', '') in (
      '2.01-AUTO-effective-minutes-v3',
      '2.01-AUTO-staffing-kpi-v1',
      '2.01-AUTO-downtime-relevance-v2',
      '2.01-AUTO-first-output-downtime-v1',
      '2.01-AUTO-teff-first-hour-downtime-guard-v1'
    )
    or coalesce(new.raw_data ->> 'kpi_model_version', '') in (
      '2.01-AUTO-effective-minutes-v3',
      '2.01-AUTO-staffing-kpi-v1',
      '2.01-AUTO-downtime-relevance-v2',
      '2.01-AUTO-first-output-downtime-v1',
      '2.01-AUTO-teff-first-hour-downtime-guard-v1'
    );

  if tg_op = 'UPDATE'
     and item_status in ('PENDING_APPROVAL', 'AUTO_APPROVED', 'APPROVED')
     and not is_system_recalc
     and (old.oee is distinct from new.oee
       or old.performance is distinct from new.performance
       or old.available_time is distinct from new.available_time) then
    raise exception 'Výkon, Dostupnost a OEE jsou v importu 2.0 AUTO pouze systémově vypočtené hodnoty.';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_import_item_rows_kpi_integrity on public.import_item_rows;
create trigger trg_import_item_rows_kpi_integrity
before update on public.import_item_rows
for each row
execute function public.prevent_manual_import_kpi_edit();

grant execute on function public.prevent_manual_import_kpi_edit() to authenticated;
