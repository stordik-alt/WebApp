-- Master list of workplaces is derived from the line value stored in daily_records.
-- The workplace name can be edited by the application and is therefore only
-- filled from daily_records when a workplace does not exist yet.

CREATE TABLE IF NOT EXISTS public.workplaces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  line_name text NOT NULL,
  workplace_name text NOT NULL,
  area text NOT NULL CHECK (area IN ('HA', 'TUP')),
  source_line text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS workplaces_line_name_idx ON public.workplaces (line_name);
CREATE INDEX IF NOT EXISTS workplaces_area_idx ON public.workplaces (area);

ALTER TABLE public.workplaces ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS workplaces_select_authenticated ON public.workplaces;
CREATE POLICY workplaces_select_authenticated
  ON public.workplaces FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS workplaces_insert_admin ON public.workplaces;
CREATE POLICY workplaces_insert_admin
  ON public.workplaces FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

DROP POLICY IF EXISTS workplaces_update_admin ON public.workplaces;
CREATE POLICY workplaces_update_admin
  ON public.workplaces FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

DROP POLICY IF EXISTS workplaces_delete_admin ON public.workplaces;
CREATE POLICY workplaces_delete_admin
  ON public.workplaces FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role));

GRANT SELECT ON public.workplaces TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.workplaces TO authenticated;
GRANT ALL ON public.workplaces TO service_role;

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

  -- Expected forms include for example:
  -- 041.08 - HandAssy L3/3
  -- 041.04 - HandAssy L1/3
  -- 041.01 - HandAssy L1/4 HF
  -- 041.05 - HandAssy krátká linka - OLOVO
  -- 050.15 - TouchUp L1/4 HF
  code_value := substring(normalized FROM '^(041\\.[0-9]{2}|050\\.[0-9]{2})\\s*-');
  IF code_value IS NULL THEN RETURN; END IF;

  area_value := CASE WHEN left(code_value, 3) = '050' THEN 'TUP' ELSE 'HA' END;
  rest := btrim(substring(normalized FROM '^041\\.[0-9]{2}\\s*-\\s*(.*)$'));
  IF rest = '' THEN
    rest := btrim(substring(normalized FROM '^050\\.[0-9]{2}\\s*-\\s*(.*)$'));
  END IF;
  IF rest = '' THEN RETURN; END IF;

  -- Olovo is a line name. It may occur at the end of the imported text.
  IF rest ~* '(^|[-\\s])OLOVO\\s*$' THEN
    line_value := 'Olovo';
    workplace_value := btrim(regexp_replace(rest, '\\s*-\\s*OLOVO\\s*$', '', 'i'));
  ELSE
    -- Line names are Lx/y, optionally followed by HF. Keep the whole line token.
    line_value := substring(rest FROM '(L[0-9]+/[0-9]+(?:\\s+HF)?)\\s*$');
    IF line_value IS NULL THEN RETURN; END IF;
    line_value := upper(btrim(line_value));
    workplace_value := btrim(left(rest, length(rest) - length(line_value)));
  END IF;

  workplace_value := btrim(regexp_replace(workplace_value, '-\\s*$', ''));
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

GRANT EXECUTE ON FUNCTION public.sync_workplace_from_daily_record_line(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sync_workplace_from_daily_record_line(text) TO service_role;

CREATE OR REPLACE FUNCTION public.trg_sync_workplace_from_daily_record()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.sync_workplace_from_daily_record_line(NEW.line);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS daily_records_sync_workplace ON public.daily_records;
CREATE TRIGGER daily_records_sync_workplace
  AFTER INSERT OR UPDATE OF line ON public.daily_records
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_sync_workplace_from_daily_record();

-- Initial backfill from all already imported daily records.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT DISTINCT line FROM public.daily_records WHERE line IS NOT NULL LOOP
    PERFORM public.sync_workplace_from_daily_record_line(r.line);
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_workplaces_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS workplaces_updated_at ON public.workplaces;
CREATE TRIGGER workplaces_updated_at
  BEFORE UPDATE ON public.workplaces
  FOR EACH ROW
  EXECUTE FUNCTION public.set_workplaces_updated_at();
