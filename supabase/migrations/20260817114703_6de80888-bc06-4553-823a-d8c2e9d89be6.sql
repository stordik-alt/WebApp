DROP POLICY IF EXISTS employees_all ON public.employees;
DROP POLICY IF EXISTS daily_records_all ON public.daily_records;
DROP POLICY IF EXISTS daily_record_coworkers_all ON public.daily_record_coworkers;
DROP POLICY IF EXISTS weekly_records_all ON public.weekly_records;

REVOKE ALL ON public.employees FROM anon;
REVOKE ALL ON public.daily_records FROM anon;
REVOKE ALL ON public.daily_record_coworkers FROM anon;
REVOKE ALL ON public.weekly_records FROM anon;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.employees TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.daily_records TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.daily_record_coworkers TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.weekly_records TO authenticated;
GRANT ALL ON public.employees TO service_role;
GRANT ALL ON public.daily_records TO service_role;
GRANT ALL ON public.daily_record_coworkers TO service_role;
GRANT ALL ON public.weekly_records TO service_role;

CREATE POLICY employees_authenticated_all ON public.employees FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY daily_records_authenticated_all ON public.daily_records FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY daily_record_coworkers_authenticated_all ON public.daily_record_coworkers FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY weekly_records_authenticated_all ON public.weekly_records FOR ALL TO authenticated USING (true) WITH CHECK (true);