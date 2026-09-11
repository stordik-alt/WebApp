-- Repair migration for monitoring tables that may be missing from the live Supabase database.
-- Safe to run after the original feature migrations: every operation is idempotent.

-- Handler / vlnař evaluations -------------------------------------------------
CREATE TABLE IF NOT EXISTS public.handler_evaluations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE RESTRICT,
  work_date date NOT NULL,
  shift text NOT NULL CHECK (shift IN ('Ranní', 'Odpolední', 'Noční')),
  score integer NOT NULL CHECK (score >= 0 AND score <= 100),
  note text,
  is_demo boolean NOT NULL DEFAULT false,
  approval_status text NOT NULL DEFAULT 'approved',
  submitted_by uuid,
  approved_by uuid,
  approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.handler_evaluations
  ADD COLUMN IF NOT EXISTS approval_status text NOT NULL DEFAULT 'approved',
  ADD COLUMN IF NOT EXISTS submitted_by uuid,
  ADD COLUMN IF NOT EXISTS approved_by uuid,
  ADD COLUMN IF NOT EXISTS approved_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_handler_evaluations_employee
  ON public.handler_evaluations(employee_id);
CREATE INDEX IF NOT EXISTS idx_handler_evaluations_date
  ON public.handler_evaluations(work_date);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.handler_evaluations TO authenticated;
GRANT ALL ON public.handler_evaluations TO service_role;

ALTER TABLE public.handler_evaluations ENABLE ROW LEVEL SECURITY;

-- The page is an administrative workflow: admins may evaluate any handler/vlnař.
-- Keep the existing employee-self policies as well for installations that use them.
DROP POLICY IF EXISTS handler_evaluations_admin_all ON public.handler_evaluations;
CREATE POLICY handler_evaluations_admin_all
  ON public.handler_evaluations
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

-- Norm remeasurements ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.norm_remeasurements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid REFERENCES public.products(id) ON DELETE SET NULL,
  product_code text NOT NULL,
  trigger_key text NOT NULL UNIQUE,
  shifts jsonb NOT NULL DEFAULT '[]'::jsonb,
  avg_oee numeric,
  current_norm_ha numeric,
  current_norm_tup numeric,
  status text NOT NULL DEFAULT 'pending',
  decided_at timestamptz,
  decided_by text,
  result_norm_ha numeric,
  result_norm_tup numeric,
  result_valid_from date,
  result_note text,
  confirmed_by text,
  result_applied_at timestamptz,
  is_demo boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT norm_remeasurements_status_check CHECK (status IN ('pending', 'accepted', 'rejected'))
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.norm_remeasurements TO authenticated;
GRANT ALL ON public.norm_remeasurements TO service_role;

ALTER TABLE public.norm_remeasurements ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS norm_remeasurements_admin_all ON public.norm_remeasurements;
CREATE POLICY norm_remeasurements_admin_all
  ON public.norm_remeasurements
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

-- Refresh PostgREST so newly created/altered tables become visible immediately.
NOTIFY pgrst, 'reload schema';
