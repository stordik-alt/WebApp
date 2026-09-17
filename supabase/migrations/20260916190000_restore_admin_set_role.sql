-- admin_set_role was defined in 20260817145259 but is missing from the live database
-- (a later schema rebuild dropped it without recreating it). The user role management
-- page (uzivatele.tsx / AccountApprovalQueue.tsx) calls it via supabase.rpc and fails
-- with "function not found" until it exists again.
create or replace function public.admin_set_role(_user_id uuid, _role text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.has_role(auth.uid(), 'admin'::app_role) then
    raise exception 'Forbidden';
  end if;

  delete from public.user_roles where user_id = _user_id;

  if _role is not null and _role <> '' and _role <> 'none' then
    insert into public.user_roles (user_id, role)
    values (_user_id, _role::app_role)
    on conflict (user_id, role) do nothing;
  end if;
end;
$$;

revoke execute on function public.admin_set_role(uuid, text) from anon, public;
grant execute on function public.admin_set_role(uuid, text) to authenticated;
