ALTER TABLE public.daily_records ALTER COLUMN oee DROP NOT NULL;

CREATE TABLE public.shift_evaluations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE RESTRICT,
  work_date date NOT NULL,
  shift text NOT NULL,
  help_score numeric NOT NULL DEFAULT 0 CHECK (help_score >= -100 AND help_score <= 100),
  note text,
  is_demo boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (employee_id, work_date, shift)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.shift_evaluations TO authenticated;
GRANT ALL ON public.shift_evaluations TO service_role;

ALTER TABLE public.shift_evaluations ENABLE ROW LEVEL SECURITY;

CREATE POLICY shift_evaluations_authenticated_all ON public.shift_evaluations
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE TRIGGER shift_evaluations_updated_at BEFORE UPDATE ON public.shift_evaluations
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

INSERT INTO public.shift_evaluations (employee_id, work_date, shift, help_score, is_demo)
SELECT employee_id, work_date, shift, round(avg(help_score), 2), bool_or(is_demo)
FROM public.daily_records
GROUP BY employee_id, work_date, shift
ON CONFLICT DO NOTHING;
