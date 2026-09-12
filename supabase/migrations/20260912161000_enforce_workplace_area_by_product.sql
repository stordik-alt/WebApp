-- Prevent TUP products from being stored under HA (041.xx) workplaces
-- and HA products from being stored under TUP (050.xx) workplaces.
-- The line name (e.g. L1/4 HF) is preserved; the code/source_line is taken
-- from the existing workplace of the correct area.
--
-- Also repairs existing daily_records when this migration is applied.

CREATE OR REPLACE FUNCTION public.normalize_daily_record_line_by_product()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_product_code text;
  v_area text;
  v_line_name text;
  v_source_line text;
BEGIN
  IF NEW.product_id IS NULL OR NEW.line IS NULL OR btrim(NEW.line) = '' THEN
    RETURN NEW;
  END IF;

  SELECT p.code INTO v_product_code
  FROM public.products p
  WHERE p.id = NEW.product_id;

  IF v_product_code IS NULL THEN
    RETURN NEW;
  END IF;

  IF upper(v_product_code) ~ '^T_' THEN
    v_area := 'TUP';
  ELSIF upper(v_product_code) ~ '^H_' THEN
    v_area := 'HA';
  ELSE
    RETURN NEW;
  END IF;

  v_line_name := (regexp_match(NEW.line, '(L[0-9]+\s*/\s*[0-9]+(?:\s+HF)?|Olovo)\s*$', 'i'))[1];
  IF v_line_name IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT w.source_line INTO v_source_line
  FROM public.workplaces w
  WHERE w.area = v_area
    AND upper(regexp_replace(w.line_name, '\s+', '', 'g')) = upper(regexp_replace(v_line_name, '\s+', '', 'g'))
  ORDER BY w.code
  LIMIT 1;

  IF v_source_line IS NOT NULL THEN
    NEW.line := v_source_line;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_normalize_daily_record_line_by_product ON public.daily_records;
CREATE TRIGGER trg_normalize_daily_record_line_by_product
BEFORE INSERT OR UPDATE OF product_id, line ON public.daily_records
FOR EACH ROW
EXECUTE FUNCTION public.normalize_daily_record_line_by_product();

UPDATE public.daily_records
SET line = line
WHERE product_id IS NOT NULL
  AND line IS NOT NULL;
