-- Discovered while backfilling: import_item_hourly had its own trigger calling
-- the just-retired public.recalculate_import_item_kpis() on every hourly row
-- change (including the UPDATEs made by reconstruct_import_item_hourly itself),
-- which now breaks reconstruction entirely since that function no longer
-- exists. This trigger only existed to re-run the old v17.1 formula; it has
-- no independent purpose now that reconstruct_import_item_hourly (V18.2)
-- computes and writes the hourly KPI fields directly.
drop trigger if exists trg_import_item_hourly_recalculate_kpis on public.import_item_hourly;
drop function if exists public.recalculate_import_item_kpis_after_hourly_change();
