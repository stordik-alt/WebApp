-- ============================================================
-- HA / TUP separation by product code
--
-- H_* products belong only to HA workplaces (041.xx).
-- T_* products belong only to TUP workplaces (050.xx).
-- The line name (for example L1/4 HF) is kept, while the
-- workplace source_line is switched to the matching area.
-- ============================================================

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

  SELECT p.code
    INTO v_product_code
  FROM public.products p
  WHERE p.id = NEW.product_id;

  IF v_product_code IS NULL THEN
    RETURN NEW;
  END IF;

  IF upper(btrim(v_product_code)) LIKE 'T\_%' ESCAPE '\\' THEN
    v_area := 'TUP';
  ELSIF upper(btrim(v_product_code)) LIKE 'H\_%' ESCAPE '\\' THEN
    v_area := 'HA';
  ELSE
    RETURN NEW;
  END IF;

  v_line_name := (
    regexp_match(
      NEW.line,
      '(L[0-9]+\s*/\s*[0-9]+(?:\s+HF)?|Olovo)\s*$',
      'i'
    )
  )[1];

  IF v_line_name IS NULL THEN
    RETURN NEW;
  END IF;

  IF lower(v_line_name) = 'olovo' THEN
    v_line_name := 'Olovo';
  ELSE
    v_line_name := regexp_replace(v_line_name, '\s*/\s*', '/', 'g');
    v_line_name := regexp_replace(v_line_name, '\s+HF$', ' HF', 'i');
    v_line_name := upper(v_line_name);
  END IF;

  SELECT COALESCE(
           w.source_line,
           w.code || ' - ' || w.workplace_name || ' ' || w.line_name
         )
    INTO v_source_line
  FROM public.workplaces w
  WHERE w.area = v_area
    AND upper(regexp_replace(w.line_name, '\s+', '', 'g')) =
        upper(regexp_replace(v_line_name, '\s+', '', 'g'))
  ORDER BY w.code
  LIMIT 1;

  IF v_source_line IS NOT NULL AND NEW.line IS DISTINCT FROM v_source_line THEN
    NEW.line := v_source_line;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_normalize_daily_record_line_by_product
ON public.daily_records;

CREATE TRIGGER trg_normalize_daily_record_line_by_product
BEFORE INSERT OR UPDATE OF product_id, line
ON public.daily_records
FOR EACH ROW
EXECUTE FUNCTION public.normalize_daily_record_line_by_product();

-- ============================================================
-- Repair existing records.
-- This uses the same product-area and line-name rules as the
-- trigger, so old incorrectly assigned T_* / H_* rows are moved
-- to the matching workplace.
-- ============================================================

UPDATE public.daily_records dr
SET line = target.source_line
FROM LATERAL (
  SELECT COALESCE(
           w.source_line,
           w.code || ' - ' || w.workplace_name || ' ' || w.line_name
         ) AS source_line
  FROM public.products p
  JOIN public.workplaces w
    ON w.area = CASE
      WHEN upper(btrim(p.code)) LIKE 'T\_%' ESCAPE '\\' THEN 'TUP'
      WHEN upper(btrim(p.code)) LIKE 'H\_%' ESCAPE '\\' THEN 'HA'
      ELSE NULL
    END
  WHERE p.id = dr.product_id
    AND (
      CASE
        WHEN lower((regexp_match(dr.line, '(L[0-9]+\s*/\s*[0-9]+(?:\s+HF)?|Olovo)\s*$', 'i'))[1]) = 'olovo'
          THEN 'Olovo'
        ELSE upper(regexp_replace(
          regexp_replace((regexp_match(dr.line, '(L[0-9]+\s*/\s*[0-9]+(?:\s+HF)?|Olovo)\s*$', 'i'))[1], '\s*/\s*', '/', 'g'),
          '\s+HF$', ' HF', 'i'
        ))
      END
    ) = upper(regexp_replace(w.line_name, '\s+', '', 'g'))
       OR upper(regexp_replace(w.line_name, '\s+', '', 'g')) = upper(regexp_replace(
            CASE
              WHEN lower((regexp_match(dr.line, '(L[0-9]+\s*/\s*[0-9]+(?:\s+HF)?|Olovo)\s*$', 'i'))[1]) = 'olovo'
                THEN 'Olovo'
              ELSE upper(regexp_replace(
                regexp_replace((regexp_match(dr.line, '(L[0-9]+\s*/\s*[0-9]+(?:\s+HF)?|Olovo)\s*$', 'i'))[1], '\s*/\s*', '/', 'g'),
                '\s+HF$', ' HF', 'i'
              ))
            END,
            '\s+', '', 'g'
          ))
  ORDER BY w.code
  LIMIT 1
) target
WHERE dr.product_id IS NOT NULL
  AND dr.line IS NOT NULL
  AND dr.line IS DISTINCT FROM target.source_line;
