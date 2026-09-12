CREATE TABLE IF NOT EXISTS public.workplaces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  line_name text NOT NULL,
  workplace_name text NOT NULL,
  area text NOT NULL CHECK (area IN ('HA', 'TUP', 'BOTH')),
  source_line text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS workplaces_area_idx ON public.workplaces (area);
CREATE INDEX IF NOT EXISTS workplaces_line_name_idx ON public.workplaces (line_name);

ALTER TABLE public.workplaces ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS workplaces_select_authenticated ON public.workplaces;
CREATE POLICY workplaces_select_authenticated
  ON public.workplaces FOR SELECT TO authenticated USING (true);

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

DROP TRIGGER IF EXISTS workplaces_updated_at ON public.workplaces;
CREATE TRIGGER workplaces_updated_at
  BEFORE UPDATE ON public.workplaces
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
