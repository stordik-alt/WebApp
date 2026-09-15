-- Verze 2.0 AUTO
-- Recalculate canonical KPI after the dedicated hourly OCR pass.
--
-- The import pipeline can replace import_item_hourly while import_items is already
-- VALIDATING. In that case the import_items status/hourly_metrics trigger may not
-- fire again at the moment the final hourly rows are inserted. This trigger makes
-- the hourly table itself the reliable recalculation boundary.
--
-- Only source OCR fields trigger recalculation; the derived KPI columns updated by
-- recalculate_import_item_kpis do not trigger this function again.

CREATE OR REPLACE FUNCTION public.recalculate_import_item_kpis_after_hourly_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.recalculate_import_item_kpis(NEW.import_item_id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_import_item_hourly_recalculate_kpis
ON public.import_item_hourly;

CREATE TRIGGER trg_import_item_hourly_recalculate_kpis
AFTER INSERT OR UPDATE OF actual_output, availability_pct, product_code, role
ON public.import_item_hourly
FOR EACH ROW
EXECUTE FUNCTION public.recalculate_import_item_kpis_after_hourly_change();

grant execute on function public.recalculate_import_item_kpis_after_hourly_change() to authenticated;

-- Repair currently persisted hourly rows as well.
DO $$
DECLARE
  v_item_id uuid;
BEGIN
  FOR v_item_id IN
    SELECT DISTINCT import_item_id
    FROM public.import_item_hourly
  LOOP
    PERFORM public.recalculate_import_item_kpis(v_item_id);
  END LOOP;
END;
$$;
