-- Tester role: full application visibility with no INSERT / UPDATE / DELETE rights.
-- The read-only guarantee is enforced in RLS, not only by hiding UI controls.

DO $$
DECLARE
  r record;
BEGIN
  -- Every public table that already uses RLS gets a tester SELECT policy and
  -- restrictive write policies. Existing policies for other roles remain intact.
  FOR r IN
    SELECT n.nspname AS schema_name, c.relname AS table_name
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r', 'p')
      AND c.relrowsecurity = true
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS tester_read_all ON %I.%I', r.schema_name, r.table_name);
    EXECUTE format('CREATE POLICY tester_read_all ON %I.%I FOR SELECT TO authenticated USING (public.has_role(auth.uid(), ''tester''::public.app_role))', r.schema_name, r.table_name);

    EXECUTE format('DROP POLICY IF EXISTS tester_no_insert ON %I.%I', r.schema_name, r.table_name);
    EXECUTE format('CREATE POLICY tester_no_insert ON %I.%I AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (NOT public.has_role(auth.uid(), ''tester''::public.app_role))', r.schema_name, r.table_name);

    EXECUTE format('DROP POLICY IF EXISTS tester_no_update ON %I.%I', r.schema_name, r.table_name);
    EXECUTE format('CREATE POLICY tester_no_update ON %I.%I AS RESTRICTIVE FOR UPDATE TO authenticated USING (NOT public.has_role(auth.uid(), ''tester''::public.app_role)) WITH CHECK (NOT public.has_role(auth.uid(), ''tester''::public.app_role))', r.schema_name, r.table_name);

    EXECUTE format('DROP POLICY IF EXISTS tester_no_delete ON %I.%I', r.schema_name, r.table_name);
    EXECUTE format('CREATE POLICY tester_no_delete ON %I.%I AS RESTRICTIVE FOR DELETE TO authenticated USING (NOT public.has_role(auth.uid(), ''tester''::public.app_role))', r.schema_name, r.table_name);

    EXECUTE format('GRANT SELECT ON TABLE %I.%I TO authenticated', r.schema_name, r.table_name);
  END LOOP;
END $$;

-- Screenshots live in Supabase Storage, outside the public schema.
DROP POLICY IF EXISTS tester_storage_read ON storage.objects;
CREATE POLICY tester_storage_read
  ON storage.objects
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'tester'::public.app_role));

DROP POLICY IF EXISTS tester_storage_no_insert ON storage.objects;
CREATE POLICY tester_storage_no_insert
  ON storage.objects
  AS RESTRICTIVE
  FOR INSERT TO authenticated
  WITH CHECK (NOT public.has_role(auth.uid(), 'tester'::public.app_role));

DROP POLICY IF EXISTS tester_storage_no_update ON storage.objects;
CREATE POLICY tester_storage_no_update
  ON storage.objects
  AS RESTRICTIVE
  FOR UPDATE TO authenticated
  USING (NOT public.has_role(auth.uid(), 'tester'::public.app_role))
  WITH CHECK (NOT public.has_role(auth.uid(), 'tester'::public.app_role));

DROP POLICY IF EXISTS tester_storage_no_delete ON storage.objects;
CREATE POLICY tester_storage_no_delete
  ON storage.objects
  AS RESTRICTIVE
  FOR DELETE TO authenticated
  USING (NOT public.has_role(auth.uid(), 'tester'::public.app_role));

GRANT SELECT ON storage.objects TO authenticated;
