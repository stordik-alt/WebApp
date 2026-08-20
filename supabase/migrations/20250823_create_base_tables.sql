-- Základní tabulky pro vaši aplikaci
-- Spusťte tento skript, pokud ještě nemáte tabulky employees, daily_records, weekly_records

-- 1. Vytvoření enum typu pro position_type
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'employee_position_type') THEN
    CREATE TYPE public.employee_position_type AS ENUM ('handler', 'vlnař', 'operator');
  END IF;
END $$;

-- 2. Vytvoření tabulky employees
CREATE TABLE IF NOT EXISTS public.employees (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name text NOT NULL,
  personal_no text,
  qual_ha boolean NOT NULL DEFAULT false,
  qual_tup boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  note text,
  is_demo boolean NOT NULL DEFAULT false,
  position_type_enum public.employee_position_type NOT NULL DEFAULT 'operator',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 3. Vytvoření tabulky daily_records
CREATE TABLE IF NOT EXISTS public.daily_records (
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

-- 4. Vytvoření tabulky daily_record_coworkers
CREATE TABLE IF NOT EXISTS public.daily_record_coworkers (
  record_id uuid NOT NULL REFERENCES public.daily_records(id) ON DELETE CASCADE,
  coworker_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  PRIMARY KEY (record_id, coworker_id)
);

-- 5. Vytvoření tabulky weekly_records
CREATE TABLE IF NOT EXISTS public.weekly_records (
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

-- 6. Vytvoření indexů
CREATE INDEX IF NOT EXISTS daily_records_date_idx ON public.daily_records (work_date);
CREATE INDEX IF NOT EXISTS daily_records_employee_idx ON public.daily_records (employee_id);
CREATE INDEX IF NOT EXISTS weekly_records_employee_idx ON public.employees (employee_id);
CREATE INDEX IF NOT EXISTS idx_employees_position_type ON public.employees(position_type_enum);

-- 7. Vytvoření funkcí a triggerů
CREATE OR REPLACE FUNCTION public.set_updated_at() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

CREATE TRIGGER IF NOT EXISTS employees_updated_at BEFORE UPDATE ON public.employees FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER IF NOT EXISTS daily_records_updated_at BEFORE UPDATE ON public.daily_records FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER IF NOT EXISTS weekly_records_updated_at BEFORE UPDATE ON public.weekly_records FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 8. Vytvoření RLS politik
ALTER TABLE public.employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_record_coworkers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.weekly_records ENABLE ROW LEVEL SECURITY;

-- Odstranění starých politik
DROP POLICY IF EXISTS employees_all ON public.employees;
DROP POLICY IF EXISTS daily_records_all ON public.daily_records;
DROP POLICY IF EXISTS daily_record_coworkers_all ON public.daily_record_coworkers;
DROP POLICY IF EXISTS weekly_records_all ON public.weekly_records;

-- Nové politiky
CREATE POLICY "employees_all" ON public.employees FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "daily_records_all" ON public.daily_records FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "daily_record_coworkers_all" ON public.daily_record_coworkers FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "weekly_records_all" ON public.weekly_records FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

-- 9. Oprava typu position ve daily_records (pokud je jiný)
ALTER TABLE public.daily_records DROP COLUMN IF EXISTS position;
ALTER TABLE public.daily_records ADD COLUMN position text NOT NULL DEFAULT 'HA' CHECK (position IN ('HA','TUP'));
