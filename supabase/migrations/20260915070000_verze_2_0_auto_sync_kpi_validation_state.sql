-- Verze 2.0 AUTO
-- Keep validation blockers synchronized with the canonical DB KPI calculation.
-- pending_reasons is JSONB, so JSONB array helpers are used instead of text[] helpers.
-- The KPI trigger recalculates hourly/shift KPI first; this follow-up trigger removes
-- stale KPI blockers once the persisted hourly data is valid.

CREATE OR REPLACE FUNCTION public.sync_import_item_kpi_validation_state()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_has_hourly boolean := false;
  v_has_invalid_kpi boolean := false;
  v_reasons jsonb := '[]'::jsonb;
BEGIN
  IF NEW.status <> 'VALIDATING' THEN
    RETURN NEW;
  END IF;

  SELECT
    count(*) > 0,
    bool_or(
      performance_pct IS NULL
      OR availability_pct IS NULL
      OR actual_oee_pct IS NULL
    )
  INTO v_has_hourly, v_has_invalid_kpi
  FROM public.import_item_hourly
  WHERE import_item_id = NEW.id;

  IF v_has_hourly AND NOT COALESCE(v_has_invalid_kpi, false) THEN
    SELECT COALESCE(
      jsonb_agg(reason ORDER BY reason),
      '[]'::jsonb
    )
    INTO v_reasons
    FROM jsonb_array_elements_text(COALESCE(NEW.pending_reasons, '[]'::jsonb)) AS reason
    WHERE reason NOT IN (
      'HOURLY_KPI_MISSING',
      'OEE_MISSING',
      'PERFORMANCE_MISSING',
      'AVAILABILITY_MISSING',
      'HOURLY_DATA_MISSING'
    );

    UPDATE public.import_items
    SET pending_reasons = v_reasons
    WHERE id = NEW.id
      AND pending_reasons IS DISTINCT FROM v_reasons;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_import_items_sync_kpi_validation_state
ON public.import_items;

CREATE TRIGGER trg_import_items_sync_kpi_validation_state
AFTER UPDATE ON public.import_items
FOR EACH ROW
WHEN (
  NEW.status = 'VALIDATING'
  AND (
    OLD.status IS DISTINCT FROM NEW.status
    OR (NEW.ocr_data -> 'hourly_metrics') IS DISTINCT FROM (OLD.ocr_data -> 'hourly_metrics')
  )
)
EXECUTE FUNCTION public.sync_import_item_kpi_validation_state();

-- Repair existing records whose KPI are already valid but whose blocker list is stale.
UPDATE public.import_items i
SET pending_reasons = COALESCE(
  (
    SELECT jsonb_agg(reason ORDER BY reason)
    FROM jsonb_array_elements_text(COALESCE(i.pending_reasons, '[]'::jsonb)) AS reason
    WHERE reason NOT IN (
      'HOURLY_KPI_MISSING',
      'OEE_MISSING',
      'PERFORMANCE_MISSING',
      'AVAILABILITY_MISSING',
      'HOURLY_DATA_MISSING'
    )
  ),
  '[]'::jsonb
)
WHERE EXISTS (
  SELECT 1
  FROM public.import_item_hourly h
  WHERE h.import_item_id = i.id
)
AND NOT EXISTS (
  SELECT 1
  FROM public.import_item_hourly h
  WHERE h.import_item_id = i.id
    AND (
      h.performance_pct IS NULL
      OR h.availability_pct IS NULL
      OR h.actual_oee_pct IS NULL
    )
)
AND EXISTS (
  SELECT 1
  FROM jsonb_array_elements_text(COALESCE(i.pending_reasons, '[]'::jsonb)) AS reason
  WHERE reason IN (
    'HOURLY_KPI_MISSING',
    'OEE_MISSING',
    'PERFORMANCE_MISSING',
    'AVAILABILITY_MISSING',
    'HOURLY_DATA_MISSING'
  )
);
