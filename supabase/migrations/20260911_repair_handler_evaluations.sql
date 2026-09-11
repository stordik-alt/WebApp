-- Repair migration for handler/vlnař evaluations.
-- The application expects these tables through PostgREST. Keep this migration
-- idempotent so it is safe if the original migration was partially applied.

CREATE TABLE IF NOT EXISTS public.handler_evaluations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID REFERENCES public.employees(id) NOT NULL,
  work_date DATE NOT NULL,
  shift TEXT NOT NULL CHECK (shift IN ('Ranní', 'Odpolední', 'Noční')),
  score INTEGER NOT NULL CHECK (score >= 0 AND score <= 100),
  note TEXT,
  is_demo BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.weekly_handler_evaluations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID REFERENCES public.employees(id) NOT NULL,
  iso_year INTEGER NOT NULL,
  iso_week INTEGER NOT NULL,
  avg_score INTEGER NOT NULL CHECK (avg_score >= 0 AND avg_score <= 100),
  is_alert BOOLEAN DEFAULT false,
  alert_cause TEXT,
  alert_note TEXT,
  is_demo BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(employee_id, iso_year, iso_week)
);

ALTER TABLE public.handler_evaluations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.weekly_handler_evaluations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own handler evaluations" ON public.handler_evaluations;
DROP POLICY IF EXISTS "Employees can create their own handler evaluations" ON public.handler_evaluations;
DROP POLICY IF EXISTS "Employees can update their own handler evaluations" ON public.handler_evaluations;
DROP POLICY IF EXISTS "Users can view their own weekly handler evaluations" ON public.weekly_handler_evaluations;

CREATE POLICY "Users can view their own handler evaluations"
  ON public.handler_evaluations FOR SELECT
  USING (auth.uid() IN (
    SELECT employee_id FROM public.employees WHERE id = handler_evaluations.employee_id
  ));

CREATE POLICY "Employees can create their own handler evaluations"
  ON public.handler_evaluations FOR INSERT
  WITH CHECK (auth.uid() IN (
    SELECT employee_id FROM public.employees WHERE id = handler_evaluations.employee_id
  ));

CREATE POLICY "Employees can update their own handler evaluations"
  ON public.handler_evaluations FOR UPDATE
  USING (auth.uid() IN (
    SELECT employee_id FROM public.employees WHERE id = handler_evaluations.employee_id
  ))
  WITH CHECK (auth.uid() IN (
    SELECT employee_id FROM public.employees WHERE id = handler_evaluations.employee_id
  ));

CREATE POLICY "Users can view their own weekly handler evaluations"
  ON public.weekly_handler_evaluations FOR SELECT
  USING (auth.uid() IN (
    SELECT employee_id FROM public.employees WHERE id = weekly_handler_evaluations.employee_id
  ));

CREATE INDEX IF NOT EXISTS idx_handler_evaluations_employee
  ON public.handler_evaluations(employee_id);
CREATE INDEX IF NOT EXISTS idx_handler_evaluations_date
  ON public.handler_evaluations(work_date);
CREATE INDEX IF NOT EXISTS idx_weekly_handler_eval_employee
  ON public.weekly_handler_evaluations(employee_id);
CREATE INDEX IF NOT EXISTS idx_weekly_handler_eval_year_week
  ON public.weekly_handler_evaluations(iso_year, iso_week);

-- Force PostgREST to refresh its schema cache after the repair.
NOTIFY pgrst, 'reload schema';
