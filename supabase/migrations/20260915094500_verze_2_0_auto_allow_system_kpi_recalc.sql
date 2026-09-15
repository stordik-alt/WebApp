-- Verze 2.0 AUTO
-- Allow canonical system KPI recalculation while preserving the protection
-- against manual KPI edits in the approval queue.
--
-- The canonical recalculation writes kpi_model_version into raw_data in the
-- same UPDATE as performance/availability/OEE. Manual edits do not carry this
-- system marker, so the integrity trigger can distinguish the two cases.

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

  is_system_recalc := coalesce(new.raw_data ->> 'kpi_model_version', '') = '2.0-AUTO-shift-time-v1';

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

revoke all on function public.prevent_manual_import_kpi_edit() from public;
grant execute on function public.prevent_manual_import_kpi_edit() to authenticated;

-- Re-run canonical KPI calculation for existing imports so employee matching
-- and operator_count/OEE are brought into sync after the employee backfill.
do $$
declare
  r record;
begin
  for r in
    select distinct import_item_id as id
    from public.import_item_rows
    where import_item_id in (
      select id
      from public.import_items
      where status in ('VALIDATING','PENDING_APPROVAL','AUTO_APPROVED','APPROVED')
    )
  loop
    perform public.recalculate_import_item_kpis(r.id);
  end loop;
end $$;
