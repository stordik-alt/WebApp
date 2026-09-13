-- Repair workplace line names that were stored as "Neurčeno" even though
-- the line is present in source_line or workplace_name.

UPDATE public.workplaces
SET line_name = parsed.line_name,
    updated_at = now()
FROM (
  SELECT
    w.id,
    CASE
      WHEN (regexp_match(
        COALESCE(w.source_line, w.workplace_name),
        '(L[0-9]+\s*/\s*[0-9]+(?:\s+HF)?|Olovo)\s*$',
        'i'
      ))[1] ~* '^Olovo$'
        THEN 'Olovo'
      ELSE upper(
        regexp_replace(
          regexp_replace(
            (regexp_match(
              COALESCE(w.source_line, w.workplace_name),
              '(L[0-9]+\s*/\s*[0-9]+(?:\s+HF)?|Olovo)\s*$',
              'i'
            ))[1],
            '\s*/\s*',
            '/',
            'g'
          ),
          '\s+HF$',
          ' HF',
          'i'
        )
      )
    END AS line_name
  FROM public.workplaces w
  WHERE w.line_name = 'Neurčeno'
    AND regexp_match(
      COALESCE(w.source_line, w.workplace_name),
      '(L[0-9]+\s*/\s*[0-9]+(?:\s+HF)?|Olovo)\s*$',
      'i'
    ) IS NOT NULL
) parsed
WHERE public.workplaces.id = parsed.id;

-- Keep the workplace sync parser consistent for future imports.
CREATE OR REPLACE FUNCTION public.sync_workplace_from_daily_record_line(p_line text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_match text[];
  v_code text;
  v_remainder text;
  v_area text;
  v_line_name text;
  v_workplace_name text;
BEGIN
  IF p_line IS NULL OR btrim(p_line) = '' THEN
    RETURN;
  END IF;

  v_match := regexp_match(btrim(p_line), '^(\d{3}\.\d{2})\s*-\s*(.+)$', 'i');
  IF v_match IS NULL THEN
    RETURN;
  END IF;

  v_code := v_match[1];
  v_remainder := btrim(v_match[2]);

  IF left(v_code, 3) = '041' THEN
    v_area := 'HA';
  ELSIF left(v_code, 3) = '050' THEN
    v_area := 'TUP';
  ELSE
    RETURN;
  END IF;

  v_match := regexp_match(v_remainder, '(L[0-9]+\s*/\s*[0-9]+(?:\s+HF)?|Olovo)\s*$', 'i');
  IF v_match IS NULL THEN
    v_line_name := 'Neurčeno';
    v_workplace_name := v_remainder;
  ELSE
    IF v_match[1] ~* '^Olovo$' THEN
      v_line_name := 'Olovo';
    ELSE
      v_line_name := upper(regexp_replace(regexp_replace(v_match[1], '\s*/\s*', '/', 'g'), '\s+HF$', ' HF', 'i'));
    END IF;
    v_workplace_name := btrim(left(v_remainder, length(v_remainder) - length(v_match[1])));
  END IF;

  INSERT INTO public.workplaces (
    code, line_name, workplace_name, area, source_line
  )
  VALUES (
    v_code, v_line_name, v_workplace_name, v_area, btrim(p_line)
  )
  ON CONFLICT (code) DO UPDATE
  SET line_name = CASE
        WHEN public.workplaces.line_name = 'Neurčeno'
          THEN EXCLUDED.line_name
        ELSE public.workplaces.line_name
      END,
      area = EXCLUDED.area,
      source_line = EXCLUDED.source_line,
      updated_at = now();
END;
$$;
