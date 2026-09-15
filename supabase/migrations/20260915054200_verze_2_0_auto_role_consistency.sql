-- Verze 2.0 AUTO: role must follow the product code.
-- H_* products are HA, T_* products are TUP. This removes OCR drift
-- in the employee-position field and also repairs already stored rows.

CREATE OR REPLACE FUNCTION public.normalize_import_item_row_position()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_product_code text;
BEGIN
  SELECT product_code
  INTO v_product_code
  FROM public.import_items
  WHERE id = NEW.import_item_id;

  IF left(upper(coalesce(v_product_code, '')), 2) = 'H_' THEN
    NEW.position := 'HA';
  ELSIF left(upper(coalesce(v_product_code, '')), 2) = 'T_' THEN
    NEW.position := 'TUP';
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

-- Repair rows already stored before this rule existed.
UPDATE public.import_item_rows r
SET position = CASE
  WHEN left(upper(coalesce(i.product_code, '')), 2) = 'H_' THEN 'HA'
  WHEN left(upper(coalesce(i.product_code, '')), 2) = 'T_' THEN 'TUP'
  ELSE r.position
END
FROM public.import_items i
WHERE i.id = r.import_item_id
  AND left(upper(coalesce(i.product_code, '')), 2) IN ('H_', 'T_');

GRANT EXECUTE ON FUNCTION public.normalize_import_item_row_position() TO authenticated;
