-- 1) Rozšíření rolí
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'team_leader';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'operator';

-- 2) Pomocná funkce nezávislá na enum literálech
CREATE OR REPLACE FUNCTION public.has_app_role(_user_id uuid, _role text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role::text = _role
  )
$$;

-- 3) Profily uživatelů
CREATE TABLE public.profiles (
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

CREATE POLICY profiles_admin_all ON public.profiles
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY profiles_select_own ON public.profiles
  FOR SELECT TO authenticated
  USING (id = auth.uid());

CREATE POLICY profiles_insert_own ON public.profiles
  FOR INSERT TO authenticated
  WITH CHECK (id = auth.uid());

CREATE POLICY profiles_update_own ON public.profiles
  FOR UPDATE TO authenticated
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

CREATE TRIGGER profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 4) Zaměstnanec přiřazený přihlášenému uživateli
CREATE OR REPLACE FUNCTION public.current_employee_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT employee_id FROM public.profiles WHERE id = auth.uid()
$$;

-- 5) Registrace: vytvoření profilu + automatické spárování podle jména
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
    (auth.jwt() ->> 'email'),
    coalesce(_first_name, ''),
    coalesce(_last_name, ''),
    guess
  )
  RETURNING * INTO result;

  RETURN result;
END;
$$;

-- 6) Správa rolí správcem
CREATE OR REPLACE FUNCTION public.admin_set_role(_user_id uuid, _role text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  DELETE FROM public.user_roles WHERE user_id = _user_id;

  IF _role IS NOT NULL AND _role <> '' AND _role <> 'none' THEN
    INSERT INTO public.user_roles (user_id, role)
    VALUES (_user_id, _role::app_role)
    ON CONFLICT (user_id, role) DO NOTHING;
  END IF;
END;
$$;

CREATE POLICY user_roles_admin_all ON public.user_roles
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

-- 7) Schvalovací sloupce
ALTER TABLE public.daily_records
  ADD COLUMN approval_status text NOT NULL DEFAULT 'approved',
  ADD COLUMN submitted_by uuid,
  ADD COLUMN approved_by uuid,
  ADD COLUMN approved_at timestamptz;

ALTER TABLE public.shift_evaluations
  ADD COLUMN approval_status text NOT NULL DEFAULT 'approved',
  ADD COLUMN submitted_by uuid,
  ADD COLUMN approved_by uuid,
  ADD COLUMN approved_at timestamptz;

ALTER TABLE public.weekly_records
  ADD COLUMN approval_status text NOT NULL DEFAULT 'approved',
  ADD COLUMN submitted_by uuid,
  ADD COLUMN approved_by uuid,
  ADD COLUMN approved_at timestamptz;

ALTER TABLE public.products
  ADD COLUMN approval_status text NOT NULL DEFAULT 'approved',
  ADD COLUMN submitted_by uuid,
  ADD COLUMN approved_by uuid,
  ADD COLUMN approved_at timestamptz;

ALTER TABLE public.product_norms
  ADD COLUMN approval_status text NOT NULL DEFAULT 'approved',
  ADD COLUMN submitted_by uuid,
  ADD COLUMN approved_by uuid,
  ADD COLUMN approved_at timestamptz;

ALTER TABLE public.quality_alert_history
  ADD COLUMN approval_status text NOT NULL DEFAULT 'approved',
  ADD COLUMN submitted_by uuid,
  ADD COLUMN approved_by uuid,
  ADD COLUMN approved_at timestamptz;

-- 8) Politiky pro Team Leadera a Operátora
-- daily_records
CREATE POLICY daily_records_tl_select ON public.daily_records
  FOR SELECT TO authenticated
  USING (public.has_app_role(auth.uid(), 'team_leader'));

CREATE POLICY daily_records_tl_insert ON public.daily_records
  FOR INSERT TO authenticated
  WITH CHECK (
    public.has_app_role(auth.uid(), 'team_leader')
    AND approval_status = 'pending'
    AND submitted_by = auth.uid()
  );

CREATE POLICY daily_records_operator_select ON public.daily_records
  FOR SELECT TO authenticated
  USING (
    public.has_app_role(auth.uid(), 'operator')
    AND approval_status = 'approved'
    AND employee_id = public.current_employee_id()
  );

-- shift_evaluations
CREATE POLICY shift_eval_tl_select ON public.shift_evaluations
  FOR SELECT TO authenticated
  USING (public.has_app_role(auth.uid(), 'team_leader'));

CREATE POLICY shift_eval_tl_insert ON public.shift_evaluations
  FOR INSERT TO authenticated
  WITH CHECK (
    public.has_app_role(auth.uid(), 'team_leader')
    AND approval_status = 'pending'
    AND submitted_by = auth.uid()
  );

CREATE POLICY shift_eval_operator_select ON public.shift_evaluations
  FOR SELECT TO authenticated
  USING (
    public.has_app_role(auth.uid(), 'operator')
    AND approval_status = 'approved'
    AND employee_id = public.current_employee_id()
  );

-- weekly_records
CREATE POLICY weekly_tl_select ON public.weekly_records
  FOR SELECT TO authenticated
  USING (public.has_app_role(auth.uid(), 'team_leader'));

CREATE POLICY weekly_tl_insert ON public.weekly_records
  FOR INSERT TO authenticated
  WITH CHECK (
    public.has_app_role(auth.uid(), 'team_leader')
    AND approval_status = 'pending'
    AND submitted_by = auth.uid()
  );

CREATE POLICY weekly_operator_select ON public.weekly_records
  FOR SELECT TO authenticated
  USING (
    public.has_app_role(auth.uid(), 'operator')
    AND approval_status = 'approved'
    AND employee_id = public.current_employee_id()
  );

-- employees (čtení pro TL i operátora, zápis jen správce)
CREATE POLICY employees_tl_select ON public.employees
  FOR SELECT TO authenticated
  USING (public.has_app_role(auth.uid(), 'team_leader'));

CREATE POLICY employees_operator_select ON public.employees
  FOR SELECT TO authenticated
  USING (
    public.has_app_role(auth.uid(), 'operator')
    AND id = public.current_employee_id()
  );

-- products / product_norms
CREATE POLICY products_tl_select ON public.products
  FOR SELECT TO authenticated
  USING (
    public.has_app_role(auth.uid(), 'team_leader')
    OR (public.has_app_role(auth.uid(), 'operator') AND approval_status = 'approved')
  );

CREATE POLICY products_tl_insert ON public.products
  FOR INSERT TO authenticated
  WITH CHECK (
    public.has_app_role(auth.uid(), 'team_leader')
    AND approval_status = 'pending'
    AND submitted_by = auth.uid()
  );

CREATE POLICY product_norms_tl_select ON public.product_norms
  FOR SELECT TO authenticated
  USING (
    public.has_app_role(auth.uid(), 'team_leader')
    OR (public.has_app_role(auth.uid(), 'operator') AND approval_status = 'approved')
  );

CREATE POLICY product_norms_tl_insert ON public.product_norms
  FOR INSERT TO authenticated
  WITH CHECK (
    public.has_app_role(auth.uid(), 'team_leader')
    AND approval_status = 'pending'
    AND submitted_by = auth.uid()
  );

-- spolupracovníci u denního záznamu
CREATE POLICY daily_coworkers_tl_select ON public.daily_record_coworkers
  FOR SELECT TO authenticated
  USING (public.has_app_role(auth.uid(), 'team_leader'));

CREATE POLICY daily_coworkers_tl_insert ON public.daily_record_coworkers
  FOR INSERT TO authenticated
  WITH CHECK (public.has_app_role(auth.uid(), 'team_leader'));

CREATE POLICY daily_coworkers_operator_select ON public.daily_record_coworkers
  FOR SELECT TO authenticated
  USING (
    public.has_app_role(auth.uid(), 'operator')
    AND (
      coworker_id = public.current_employee_id()
      OR EXISTS (
        SELECT 1 FROM public.daily_records d
        WHERE d.id = record_id AND d.employee_id = public.current_employee_id()
      )
    )
  );

-- historie Quality Alertů
CREATE POLICY qa_history_tl_select ON public.quality_alert_history
  FOR SELECT TO authenticated
  USING (public.has_app_role(auth.uid(), 'team_leader'));

CREATE POLICY qa_history_tl_insert ON public.quality_alert_history
  FOR INSERT TO authenticated
  WITH CHECK (
    public.has_app_role(auth.uid(), 'team_leader')
    AND approval_status = 'pending'
    AND submitted_by = auth.uid()
  );