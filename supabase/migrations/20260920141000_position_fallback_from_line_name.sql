-- Position resolution for imported employees:
-- 1) Trust an explicit HA/TUP position from OCR/admin input.
-- 2) If missing/invalid, derive it from the production line name:
--    HandAssy => HA, TouchUp => TUP.
-- 3) Never derive an employee position from Product ID. A Product Profile may
--    contain both HA and TUP and product prefixes are not a reliable worker role.

CREATE OR REPLACE FUNCTION public.normalize_import_item_row_position()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_line text;
  v_position text;
BEGIN
  v_position := upper(trim(coalesce(NEW.position, '')));

  IF v_position IN ('HA', 'TUP') THEN
    NEW.position := v_position;
    RETURN NEW;
  END IF;

  SELECT line
  INTO v_line
  FROM public.import_items
  WHERE id = NEW.import_item_id;

  IF lower(coalesce(v_line, '')) ~ 'hand[[:space:]_-]*assy' THEN
    NEW.position := 'HA';
  ELSIF lower(coalesce(v_line, '')) ~ 'touch[[:space:]_-]*up' THEN
    NEW.position := 'TUP';
  ELSE
    NEW.position := NULL;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_import_item_rows_normalize_position
ON public.import_item_rows;

CREATE TRIGGER trg_import_item_rows_normalize_position
BEFORE INSERT OR UPDATE OF import_item_id, position
ON public.import_item_rows
FOR EACH ROW
EXECUTE FUNCTION public.normalize_import_item_row_position();

GRANT EXECUTE ON FUNCTION public.normalize_import_item_row_position() TO authenticated;
