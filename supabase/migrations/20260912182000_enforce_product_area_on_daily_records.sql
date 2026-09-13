-- ============================================================
-- HA / TUP separation by product code
--
-- H_* products belong only to HA workplaces (041.xx).
-- T_* products belong only to TUP workplaces (050.xx).
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

  IF upper(btrim(v_product_code)) ~ '^T_' THEN
    v_area := 'TUP';
  ELSIF upper(btrim(v_product_code)) ~ '^H_' THEN
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
-- Repair existing incorrectly assigned records.
-- ============================================================

WITH record_lines AS (
  SELECT
    dr.id,
    dr.line,
    p.code AS product_code,
    CASE
      WHEN upper(btrim(p.code)) ~ '^T_' THEN 'TUP'
      WHEN upper(btrim(p.code)) ~ '^H_' THEN 'HA'
      ELSE NULL
    END AS required_area,
    (
      regexp_match(
        dr.line,
        '(L[0-9]+\s*/\s*[0-9]+(?:\s+HF)?|Olovo)\s*$',
        'i'
      )
    )[1] AS raw_line_name
  FROM public.daily_records dr
  JOIN public.products p ON p.id = dr.product_id
  WHERE dr.line IS NOT NULL
), normalized AS (
  SELECT
    rl.*,
    CASE
      WHEN lower(rl.raw_line_name) = 'olovo' THEN 'Olovo'
      WHEN rl.raw_line_name IS NOT NULL THEN upper(
        regexp_replace(
          regexp_replace(rl.raw_line_name, '\s*/\s*', '/', 'g'),
          '\s+HF$', ' HF', 'i'
        )
      )
      ELSE NULL
    END AS line_name
  FROM record_lines rl
  WHERE rl.required_area IS NOT NULL
), targets AS (
  SELECT DISTINCT ON (n.id)
    n.id,
    COALESCE(
      w.source_line,
      w.code || ' - ' || w.workplace_name || ' ' || w.line_name
    ) AS target_line
  FROM normalized n
  JOIN public.workplaces w
    ON w.area = n.required_area
   AND upper(regexp_replace(w.line_name, '\s+', '', 'g')) =
       upper(regexp_replace(n.line_name, '\s+', '', 'g'))
  WHERE n.line_name IS NOT NULL
  ORDER BY n.id, w.code
)
UPDATE public.daily_records dr
SET line = t.target_line
FROM targets t
WHERE dr.id = t.id
  AND dr.line IS DISTINCT FROM t.target_line;
