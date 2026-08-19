
CREATE TABLE public.employees (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name text NOT NULL,
  personal_no text,
  qual_ha boolean NOT NULL DEFAULT false,
  qual_tup boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  note text,
  is_demo boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.employees TO anon, authenticated;
GRANT ALL ON public.employees TO service_role;
ALTER TABLE public.employees ENABLE ROW LEVEL SECURITY;
CREATE POLICY "employees_all" ON public.employees FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

CREATE TABLE public.daily_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_date date NOT NULL,
  shift text NOT NULL,
  line text NOT NULL,
  product text,
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE RESTRICT,
  position text NOT NULL CHECK (position IN ('HA','TUP')),
  oee numeric(6,2) NOT NULL CHECK (oee >= 0),
  help_score numeric(5,1) NOT NULL DEFAULT 0 CHECK (help_score >= -100 AND help_score <= 100),
  note text,
  is_demo boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (employee_id, work_date, shift, line)
);
CREATE INDEX daily_records_date_idx ON public.daily_records (work_date);
CREATE INDEX daily_records_employee_idx ON public.daily_records (employee_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.daily_records TO anon, authenticated;
GRANT ALL ON public.daily_records TO service_role;
ALTER TABLE public.daily_records ENABLE ROW LEVEL SECURITY;
CREATE POLICY "daily_records_all" ON public.daily_records FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

CREATE TABLE public.daily_record_coworkers (
  record_id uuid NOT NULL REFERENCES public.daily_records(id) ON DELETE CASCADE,
  coworker_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  PRIMARY KEY (record_id, coworker_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.daily_record_coworkers TO anon, authenticated;
GRANT ALL ON public.daily_record_coworkers TO service_role;
ALTER TABLE public.daily_record_coworkers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "daily_record_coworkers_all" ON public.daily_record_coworkers FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

CREATE TABLE public.weekly_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE RESTRICT,
  iso_year integer NOT NULL,
  iso_week integer NOT NULL CHECK (iso_week BETWEEN 1 AND 53),
  yield_pct numeric(6,2) NOT NULL CHECK (yield_pct >= 0 AND yield_pct <= 100),
  auto_quality_score numeric(6,2) GENERATED ALWAYS AS (
    CASE
      WHEN yield_pct >= 90 THEN (yield_pct - 90) * 10
      WHEN yield_pct >= 79 THEN (yield_pct - 89) * 10
      ELSE NULL
    END
  ) STORED,
  is_alert boolean GENERATED ALWAYS AS (yield_pct < 79) STORED,
  alert_cause text,
  alert_note text,
  operator_error boolean,
  final_quality_score numeric(6,2) CHECK (final_quality_score >= -100 AND final_quality_score <= 100),
  alert_resolved boolean NOT NULL DEFAULT false,
  is_demo boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (employee_id, iso_year, iso_week)
);
CREATE INDEX weekly_records_employee_idx ON public.weekly_records (employee_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.weekly_records TO anon, authenticated;
GRANT ALL ON public.weekly_records TO service_role;
ALTER TABLE public.weekly_records ENABLE ROW LEVEL SECURITY;
CREATE POLICY "weekly_records_all" ON public.weekly_records FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.set_updated_at() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

CREATE TRIGGER employees_updated_at BEFORE UPDATE ON public.employees FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER daily_records_updated_at BEFORE UPDATE ON public.daily_records FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER weekly_records_updated_at BEFORE UPDATE ON public.weekly_records FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
