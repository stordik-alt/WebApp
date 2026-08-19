CREATE OR REPLACE FUNCTION public.prevent_duplicate_quality_alert_history()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  last_row public.quality_alert_history%ROWTYPE;
BEGIN
  -- Zamkne řádek alertu, takže souběžná uložení se serializují.
  PERFORM 1 FROM public.weekly_records WHERE id = NEW.weekly_record_id FOR UPDATE;

  SELECT * INTO last_row
  FROM public.quality_alert_history
  WHERE weekly_record_id = NEW.weekly_record_id
  ORDER BY created_at DESC, id DESC
  LIMIT 1;

  IF FOUND
     AND last_row.alert_cause IS NOT DISTINCT FROM NEW.alert_cause
     AND last_row.alert_note IS NOT DISTINCT FROM NEW.alert_note
     AND last_row.operator_error IS NOT DISTINCT FROM NEW.operator_error
     AND last_row.final_quality_score IS NOT DISTINCT FROM NEW.final_quality_score
     AND last_row.alert_resolved IS NOT DISTINCT FROM NEW.alert_resolved
  THEN
    RAISE EXCEPTION 'DUPLICATE_QUALITY_ALERT_HISTORY: zaznam je shodny s poslední uloženou verzí'
      USING ERRCODE = '23505';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS quality_alert_history_no_duplicates ON public.quality_alert_history;
CREATE TRIGGER quality_alert_history_no_duplicates
BEFORE INSERT ON public.quality_alert_history
FOR EACH ROW EXECUTE FUNCTION public.prevent_duplicate_quality_alert_history();