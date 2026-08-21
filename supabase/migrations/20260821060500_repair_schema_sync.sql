-- Idempotent repair migration for environments where part of the migration history
-- was not applied. Does not delete existing data.

-- Ensure the shift evaluation table exists before adding its approval columns.
CREATE TABLE IF NOT EXISTS public.shift_evaluations (
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

-- Product tables are expected by the screenshot import.
CREATE TABLE IF NOT EXISTS public.products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL,
  name text,
  active boolean NOT NULL DEFAULT true,
  first_seen_date date NOT NULL DEFAULT current_date,
  note text,
  is_demo boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS products_code_unique
  ON public.products (lower(code));

CREATE TABLE IF NOT EXISTS public.product_norms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  operation text NOT NULL,
  norm_per_hour numeric NOT NULL,
  valid_from date NOT NULL DEFAULT current_date,
  valid_to date,
  source text NOT NULL DEFAULT 'manual',
  confirmed boolean NOT NULL DEFAULT false,
  note text,
  is_demo boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS product_norms_product_idx
  ON public.product_norms (product_id, operation, valid_from DESC);

-- Columns required by the current application.
ALTER TABLE public.daily_records
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS screenshot_path text,
  ADD COLUMN IF NOT EXISTS import_batch_id uuid,
  ADD COLUMN IF NOT EXISTS product_id uuid REFERENCES public.products(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS performance numeric,
  ADD COLUMN IF NOT EXISTS available_time numeric,
  ADD COLUMN IF NOT EXISTS approval_status text NOT NULL DEFAULT 'approved',
  ADD COLUMN IF NOT EXISTS submitted_by uuid,
  ADD COLUMN IF NOT EXISTS approved_by uuid,
  ADD COLUMN IF NOT EXISTS approved_at timestamptz;

ALTER TABLE public.shift_evaluations
  ADD COLUMN IF NOT EXISTS approval_status text NOT NULL DEFAULT 'approved',
  ADD COLUMN IF NOT EXISTS submitted_by uuid,
  ADD COLUMN IF NOT EXISTS approved_by uuid,
  ADD COLUMN IF NOT EXISTS approved_at timestamptz;

ALTER TABLE public.weekly_records
  ADD COLUMN IF NOT EXISTS approval_status text NOT NULL DEFAULT 'approved',
  ADD COLUMN IF NOT EXISTS submitted_by uuid,
  ADD COLUMN IF NOT EXISTS approved_by uuid,
  ADD COLUMN IF NOT EXISTS approved_at timestamptz;

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS approval_status text NOT NULL DEFAULT 'approved',
  ADD COLUMN IF NOT EXISTS submitted_by uuid,
  ADD COLUMN IF NOT EXISTS approved_by uuid,
  ADD COLUMN IF NOT EXISTS approved_at timestamptz;

ALTER TABLE public.product_norms
  ADD COLUMN IF NOT EXISTS approval_status text NOT NULL DEFAULT 'approved',
  ADD COLUMN IF NOT EXISTS submitted_by uuid,
  ADD COLUMN IF NOT EXISTS approved_by uuid,
  ADD COLUMN IF NOT EXISTS approved_at timestamptz;

-- Grants expected by the application.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.products TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.product_norms TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.shift_evaluations TO authenticated;
GRANT ALL ON public.products TO service_role;
GRANT ALL ON public.product_norms TO service_role;
GRANT ALL ON public.shift_evaluations TO service_role;

ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_norms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shift_evaluations ENABLE ROW LEVEL SECURITY;

-- Keep existing policies if present; only add a safe authenticated fallback when
-- no INSERT policy exists. This avoids silently weakening an existing policy.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'products'
      AND cmd = 'INSERT'
  ) THEN
    CREATE POLICY products_import_insert
      ON public.products
      FOR INSERT TO authenticated
      WITH CHECK (true);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'product_norms'
      AND cmd = 'INSERT'
  ) THEN
    CREATE POLICY product_norms_import_insert
      ON public.product_norms
      FOR INSERT TO authenticated
      WITH CHECK (true);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'shift_evaluations'
      AND cmd = 'ALL'
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'shift_evaluations'
      AND cmd = 'INSERT'
  ) THEN
    CREATE POLICY shift_evaluations_import_all
      ON public.shift_evaluations
      FOR ALL TO authenticated
      USING (true)
      WITH CHECK (true);
  END IF;
END $$;

-- User profiles/RPC used by the current authentication flow.
CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid PRIMARY KEY,
  email text,
  first_name text NOT NULL DEFAULT '',
  last_name text NOT NULL DEFAULT '',
  employee_id uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.current_employee_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT employee_id FROM public.profiles WHERE id = auth.uid()
$$;

CREATE OR REPLACE FUNCTION public.ensure_profile(_first_name text, _last_name text)
RETURNS public.profiles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  result public.profiles%ROWTYPE;
  guess uuid;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT * INTO result FROM public.profiles WHERE id = uid;
  IF FOUND THEN
    RETURN result;
  END IF;

  SELECT e.id INTO guess
  FROM public.employees e
  WHERE lower(btrim(e.full_name)) = lower(btrim(coalesce(_first_name,'') || ' ' || coalesce(_last_name,'')))
     OR lower(btrim(e.full_name)) = lower(btrim(coalesce(_last_name,'') || ' ' || coalesce(_first_name,'')))
  ORDER BY e.active DESC
  LIMIT 1;

  INSERT INTO public.profiles (id, email, first_name, last_name, employee_id)
  VALUES (
    uid,
    auth.jwt() ->> 'email',
    coalesce(_first_name, ''),
    coalesce(_last_name, ''),
    guess
  )
  RETURNING * INTO result;

  RETURN result;
END;
$$;

-- Refresh PostgREST's schema cache after the repair.
NOTIFY pgrst, 'reload schema';
