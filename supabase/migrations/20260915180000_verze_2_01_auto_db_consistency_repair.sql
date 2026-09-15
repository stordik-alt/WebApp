-- Verze 2.01 AUTO: repair legacy database state that CREATE TABLE IF NOT EXISTS
-- cannot repair on an already-existing Supabase project.

-- 1) import_items.ocr_data must always be a JSON object, including legacy DBs
-- where the original DEFAULT/NOT NULL definition was not applied.
UPDATE public.import_items
SET ocr_data = '{}'::jsonb
WHERE ocr_data IS NULL;

ALTER TABLE public.import_items
  ALTER COLUMN ocr_data SET DEFAULT '{}'::jsonb,
  ALTER COLUMN ocr_data SET NOT NULL;

-- 2) Canonical effective production time is persisted explicitly so the UI
-- aggregation cannot fall back to the legacy 60-minute weighting.
ALTER TABLE public.import_item_hourly
  ADD COLUMN IF NOT EXISTS actual_minutes numeric;

-- Keep actual_minutes synchronized with the canonical calculation payload.
CREATE OR REPLACE FUNCTION public.sync_import_item_hourly_actual_minutes_2_01()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_minutes numeric;
BEGIN
  IF pg_trigger_depth() > 1 THEN
    RETURN NEW;
  END IF;

  v_minutes := NULLIF(
    COALESCE(
      NEW.raw_data->'calculation'->>'productive_minutes',
      NEW.raw_data->'calculation'->>'reconstructed_productive_minutes'
    ),
    ''
  )::numeric;

  IF v_minutes IS NOT NULL AND v_minutes >= 0 THEN
    NEW.actual_minutes := v_minutes;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_import_item_hourly_sync_actual_minutes_2_01
  ON public.import_item_hourly;

CREATE TRIGGER trg_import_item_hourly_sync_actual_minutes_2_01
BEFORE INSERT OR UPDATE OF raw_data
ON public.import_item_hourly
FOR EACH ROW
EXECUTE FUNCTION public.sync_import_item_hourly_actual_minutes_2_01();

-- The legacy reconstruction trigger can overwrite canonical 2.01 KPI values
-- after recalculate_import_item_kpis() has already produced them.
DROP TRIGGER IF EXISTS zz_import_items_reconstruct_2_01
  ON public.import_item_hourly;
DROP TRIGGER IF EXISTS zz_import_items_reconstruct_2_01
  ON public.import_items;

-- Backfill actual_minutes for existing canonical rows without changing any
-- other KPI values.
UPDATE public.import_item_hourly h
SET actual_minutes = x.minutes
FROM (
  SELECT id,
         NULLIF(
           COALESCE(
             raw_data->'calculation'->>'productive_minutes',
             raw_data->'calculation'->>'reconstructed_productive_minutes'
           ),
           ''
         )::numeric AS minutes
  FROM public.import_item_hourly
) x
WHERE h.id = x.id
  AND x.minutes IS NOT NULL
  AND x.minutes >= 0;
