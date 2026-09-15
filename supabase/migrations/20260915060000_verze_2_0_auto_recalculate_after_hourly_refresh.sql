-- Verze 2.0 AUTO: recalculate KPI after the second OCR/hourly persistence pass.
--
-- Root cause:
-- ScreenshotImportV2 persists the header/employee data first, which changes
-- import_items.status to VALIDATING and triggers the canonical KPI calculation.
-- It then runs the dedicated hourly OCR pass and persists the refreshed
-- hourly_metrics again while the row is already VALIDATING. The old trigger
-- only reacted to a status transition, so the refreshed hourly rows kept their
-- raw OCR KPI fields (including NULL availability) and finalizeImportItem read
-- those stale values before calling auto_approve_import_item.
--
-- Fix: also trigger when the hourly_metrics JSON changes while the item is
-- already VALIDATING. recalculate_import_item_kpis updates only the derived
-- KPI fields in ocr_data, not hourly_metrics, so this condition does not cause
-- recursive recalculation.

create or replace function public.recalculate_import_item_kpis_on_validating()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'VALIDATING'
     and (
       old.status is distinct from new.status
       or (new.ocr_data -> 'hourly_metrics') is distinct from (old.ocr_data -> 'hourly_metrics')
     ) then
    perform public.recalculate_import_item_kpis(new.id);
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
