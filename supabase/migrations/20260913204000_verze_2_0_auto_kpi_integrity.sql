-- 2.0 AUTO: Výkon, Dostupnost a OEE jsou pouze systémově vypočtené hodnoty.
-- 2. sekvence je neposkytuje. 3. sekvence je uloží před AUTO/ručním schválením.

create or replace function public.prevent_manual_import_kpi_edit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE'
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
