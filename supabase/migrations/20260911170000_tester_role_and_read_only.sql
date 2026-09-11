-- Complete Tester role migration
-- Tester can read the application, but cannot INSERT / UPDATE / DELETE.
-- The restriction is enforced by PostgreSQL RLS, not only by the UI.

ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'tester';

CREATE OR REPLACE FUNCTION public.is_tester(p_user_id uuid DEFAULT auth.uid())
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = p_user_id
      AND ur.role::text = 'tester'
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_tester(uuid) TO authenticated;

DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT n.nspname AS schema_name, c.relname AS table_name
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r', 'p')
      AND c.relrowsecurity = true
  LOOP
    EXECUTE format('GRANT SELECT ON TABLE %I.%I TO authenticated', r.schema_name, r.table_name);

    EXECUTE format('DROP POLICY IF EXISTS tester_read_all ON %I.%I', r.schema_name, r.table_name);
    EXECUTE format('CREATE POLICY tester_read_all ON %I.%I FOR SELECT TO authenticated USING (public.is_tester(auth.uid()))', r.schema_name, r.table_name);

    EXECUTE format('DROP POLICY IF EXISTS tester_no_insert ON %I.%I', r.schema_name, r.table_name);
    EXECUTE format('CREATE POLICY tester_no_insert ON %I.%I AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (NOT public.is_tester(auth.uid()))', r.schema_name, r.table_name);

    EXECUTE format('DROP POLICY IF EXISTS tester_no_update ON %I.%I', r.schema_name, r.table_name);
    EXECUTE format('CREATE POLICY tester_no_update ON %I.%I AS RESTRICTIVE FOR UPDATE TO authenticated USING (NOT public.is_tester(auth.uid())) WITH CHECK (NOT public.is_tester(auth.uid()))', r.schema_name, r.table_name);

    EXECUTE format('DROP POLICY IF EXISTS tester_no_delete ON %I.%I', r.schema_name, r.table_name);
    EXECUTE format('CREATE POLICY tester_no_delete ON %I.%I AS RESTRICTIVE FOR DELETE TO authenticated USING (NOT public.is_tester(auth.uid()))', r.schema_name, r.table_name);
  END LOOP;
END $$;

GRANT SELECT ON TABLE storage.objects TO authenticated;

DROP POLICY IF EXISTS tester_storage_read ON storage.objects;
CREATE POLICY tester_storage_read ON storage.objects FOR SELECT TO authenticated USING (public.is_tester(auth.uid()));

DROP POLICY IF EXISTS tester_storage_no_insert ON storage.objects;
CREATE POLICY tester_storage_no_insert ON storage.objects AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (NOT public.is_tester(auth.uid()));

DROP POLICY IF EXISTS tester_storage_no_update ON storage.objects;
CREATE POLICY tester_storage_no_update ON storage.objects AS RESTRICTIVE FOR UPDATE TO authenticated USING (NOT public.is_tester(auth.uid())) WITH CHECK (NOT public.is_tester(auth.uid()));

DROP POLICY IF EXISTS tester_storage_no_delete ON storage.objects;
CREATE POLICY tester_storage_no_delete ON storage.objects AS RESTRICTIVE FOR DELETE TO authenticated USING (NOT public.is_tester(auth.uid()));

NOTIFY pgrst, 'reload schema';
