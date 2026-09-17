-- Reconstruction only runs on the one-time transition into VALIDATING, so
-- existing data never picks up later fixes to reconstruct_import_item_hourly.
-- This backfills the single test import (041.05 - HandAssy krátká linka -
-- OLOVO, 2026-08-19, screenshot_time 13:51) whose hourly rows were still
-- stamped with the old "2.01-AUTO-staffing-kpi-v17.1" model, so it reflects
-- the current V18.2 logic for inspection.
select public.reconstruct_import_item_hourly('67b811ae-200d-4e3b-8137-4c6645e0446d'::uuid);
