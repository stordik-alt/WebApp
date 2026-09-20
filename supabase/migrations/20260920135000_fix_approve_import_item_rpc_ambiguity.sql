-- Remove the ambiguous two-argument public RPC overload.
-- PostgREST cannot choose deterministically between
-- approve_import_item(uuid,uuid) and approve_import_item(uuid,uuid,boolean)
-- when both are exposed with defaults. Keep a single three-argument API with
-- p_confirm_conflict defaulting to false so both existing frontend call forms
-- remain compatible at the HTTP/RPC level when the complete named argument
-- set is supplied.
drop function if exists public.approve_import_item(uuid, uuid);

create or replace function public.approve_import_item(p_import_item_id uuid, p_actor_id uuid default auth.uid(), p_confirm_conflict boolean default false)
returns jsonb
language plpgsql
set search_path to 'public'
as $function$
declare
  v_item public.import_items%rowtype;
begin
  select * into v_item
  from public.import_items
  where id = p_import_item_id
    and status = 'PENDING_APPROVAL'
  for update;

  if not found then
    raise exception 'Import není ve stavu PENDING_APPROVAL nebo neexistuje.' using errcode = 'P0002';
  end if;

  perform public.recalculate_import_item_kpis(p_import_item_id);

  return public.approve_import_item_legacy(p_import_item_id, p_actor_id, p_confirm_conflict);
end;
$function$;
