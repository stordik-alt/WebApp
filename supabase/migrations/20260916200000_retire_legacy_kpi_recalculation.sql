-- Three overlapping KPI-calculation paths were wired to the same import_items
-- UPDATE cascade: recalculate_import_item_kpis (hardcodes the old, wrong
-- "2.01-AUTO-staffing-kpi-v17.1" model), auto_reconstruct_import_item (a narrow
-- legacy "late start" inference that uses the inverted staffing formula), and
-- reconstruct_import_item_hourly (the correct, current V18.2 implementation).
-- trg_import_items_recalculate_kpis is the only trigger (of all KPI-related
-- triggers on import_items) with no WHEN guard, relying solely on an internal
-- IF check, and ran ahead of the correct V18.2 trigger alphabetically. Nothing
-- in the app calls these RPCs directly (verified via grep across src/), so
-- retiring them leaves reconstruct_import_item_hourly as the sole KPI path.
drop trigger if exists trg_import_items_recalculate_kpis on public.import_items;
drop function if exists public.recalculate_import_item_kpis_on_validating();
drop function if exists public.recalculate_import_item_kpis(uuid);
drop function if exists public.auto_reconstruct_import_item(uuid);
