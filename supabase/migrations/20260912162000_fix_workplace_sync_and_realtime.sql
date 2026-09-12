-- Fix workplace synchronization parsing and enable live updates for the Pracoviště section.
-- The previous migration contained escaped regex backslashes that could prevent
-- existing daily_records.line values from being recognized.

CREATE OR REPLACE FUNCTION public.sync_workplace_from_daily_record_line(p_line text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  normalized text := btrim(coalesce(p_line, ''));
  code_value text;
  rest text;
  area_value text;
  line_value text;
  workplace_value text;
BEGIN
  IF normalized = '' THEN RETURN; END IF;

  code_value := substring(normalized FROM '^(041\.[0-9]{2}|050\.[0-9]{2})\s*-');
  IF code_value IS NULL THEN RETURN; END IF;

  area_value := CASE WHEN left(code_value, 3) = '050' THEN 'TUP' ELSE 'HA' END;
  rest := btrim(substring(normalized FROM '^\d{3}\.[0-9]{2}\s*-\s*(.*)$'));
  IF rest IS NULL OR rest = '' THEN RETURN; END IF;

  IF rest ~* '(^|[-\s])OLOVO\s*$' THEN
    line_value := 'Olovo';
    workplace_value := btrim(regexp_replace(rest, '\s*-\s*OLOVO\s*$', '', 'i'));
  ELSE
    line_value := substring(rest FROM '(L[0-9]+/[0-9]+(?:\s+HF)?)\s*$');
    IF line_value IS NULL THEN RETURN; END IF;
    line_value := upper(btrim(line_value));
    workplace_value := btrim(left(rest, length(rest) - length(line_value)));
  END IF;

  workplace_value := btrim(regexp_replace(workplace_value, '-\s*$', ''));
  IF workplace_value = '' THEN RETURN; END IF;

  INSERT INTO public.workplaces (code, line_name, workplace_name, area, source_line)
  VALUES (code_value, line_value, workplace_value, area_value, normalized)
  ON CONFLICT (code) DO UPDATE SET
    line_name = EXCLUDED.line_name,
    area = EXCLUDED.area,
    source_line = EXCLUDED.source_line,
    updated_at = now();
END;
$$;

-- Rebuild the master list from all historical daily records.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT DISTINCT line FROM public.daily_records WHERE line IS NOT NULL LOOP
    PERFORM public.sync_workplace_from_daily_record_line(r.line);
  END LOOP;
END;
$$;

-- Let the Pracoviště page receive a live change when a workplace is created/updated.
DO $$
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.workplaces;
  EXCEPTION WHEN duplicate_object THEN
    NULL;
  END;
END;
$$;
