REVOKE EXECUTE ON FUNCTION public.has_app_role(uuid, text) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.current_employee_id() FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.ensure_profile(text, text) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.admin_set_role(uuid, text) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM anon, public;

GRANT EXECUTE ON FUNCTION public.has_app_role(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_employee_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.ensure_profile(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_role(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated;