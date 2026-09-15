-- Verze 2.01 AUTO: ensure import validation always sees canonical hourly KPIs.
-- The import UI must not validate against stale OCR KPI fields. Recalculate the
-- canonical model when an item enters VALIDATING, before finalizeImportItem reads
-- import_item_hourly for PERFORMANCE / AVAILABILITY / OEE validation.

create or replace function public.ensure_import_item_canonical_kpi_before_validation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'VALIDATING'
     and (old.status is distinct from new.status) then
    perform public.recalculate_import_item_kpis(new.id);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_import_items_canonical_kpi_before_validation on public.import_items;
create trigger trg_import_items_canonical_kpi_before_validation
after update of status
on public.import_items
for each row
when (new.status = 'VALIDATING' and old.status is distinct from new.status)
execute function public.ensure_import_item_canonical_kpi_before_validation();

-- Also make the validator-facing fields explicitly canonical whenever hourly
-- data is present. This is intentionally limited to KPI columns and never
-- replaces OCR source data stored in raw_data / ocr_data.
