-- Roles
CREATE TYPE public.app_role AS ENUM ('admin', 'user');

CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  role public.app_role NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);

GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;

ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own roles"
ON public.user_roles FOR SELECT TO authenticated
USING (user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  )
$$;

-- Seed existing account as admin
INSERT INTO public.user_roles (user_id, role)
VALUES ('9f6edfd8-2010-4a7d-8140-fdbae9e295e8', 'admin')
ON CONFLICT DO NOTHING;

-- Restrict business tables to admins
DROP POLICY IF EXISTS employees_authenticated_all ON public.employees;
CREATE POLICY employees_admin_all ON public.employees FOR ALL TO authenticated
USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS daily_records_authenticated_all ON public.daily_records;
CREATE POLICY daily_records_admin_all ON public.daily_records FOR ALL TO authenticated
USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS daily_record_coworkers_authenticated_all ON public.daily_record_coworkers;
CREATE POLICY daily_record_coworkers_admin_all ON public.daily_record_coworkers FOR ALL TO authenticated
USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS weekly_records_authenticated_all ON public.weekly_records;
CREATE POLICY weekly_records_admin_all ON public.weekly_records FOR ALL TO authenticated
USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS products_authenticated_all ON public.products;
CREATE POLICY products_admin_all ON public.products FOR ALL TO authenticated
USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS product_norms_authenticated_all ON public.product_norms;
CREATE POLICY product_norms_admin_all ON public.product_norms FOR ALL TO authenticated
USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS shift_evaluations_authenticated_all ON public.shift_evaluations;
CREATE POLICY shift_evaluations_admin_all ON public.shift_evaluations FOR ALL TO authenticated
USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Storage: screenshots bucket admin-only, scoped to daily/ prefix
DROP POLICY IF EXISTS screenshots_auth_select ON storage.objects;
DROP POLICY IF EXISTS screenshots_auth_insert ON storage.objects;
DROP POLICY IF EXISTS screenshots_auth_update ON storage.objects;
DROP POLICY IF EXISTS screenshots_auth_delete ON storage.objects;

CREATE POLICY screenshots_admin_select ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'screenshots' AND (storage.foldername(name))[1] = 'daily' AND public.has_role(auth.uid(), 'admin'));

CREATE POLICY screenshots_admin_insert ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'screenshots' AND (storage.foldername(name))[1] = 'daily' AND public.has_role(auth.uid(), 'admin'));

CREATE POLICY screenshots_admin_update ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id = 'screenshots' AND (storage.foldername(name))[1] = 'daily' AND public.has_role(auth.uid(), 'admin'))
WITH CHECK (bucket_id = 'screenshots' AND (storage.foldername(name))[1] = 'daily' AND public.has_role(auth.uid(), 'admin'));

CREATE POLICY screenshots_admin_delete ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'screenshots' AND (storage.foldername(name))[1] = 'daily' AND public.has_role(auth.uid(), 'admin'));