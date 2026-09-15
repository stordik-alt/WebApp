begin;

-- Verze 2.0 AUTO: remove stale MISSING_SHIFT after the shift has been
-- resolved/persisted. This intentionally avoids referring to a SELECT alias
-- from the same query level (which PostgreSQL rejects).

update public.import_items i
set pending_reasons = coalesce(
  (
    select jsonb_agg(x.value order by x.ord)
    from jsonb_array_elements(coalesce(i.pending_reasons, '[]'::jsonb))
      with ordinality as x(value, ord)
    where x.value #>> '{}' <> 'MISSING_SHIFT'
  ),
  '[]'::jsonb
)
where nullif(trim(coalesce(i.shift, '')), '') is not null
  and coalesce(i.pending_reasons, '[]'::jsonb) @> '["MISSING_SHIFT"]'::jsonb;

-- Keep the state synchronized on future saves/validations.
create or replace function public.sync_import_item_shift_blocker()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reasons jsonb := coalesce(new.pending_reasons, '[]'::jsonb);
begin
  if nullif(trim(coalesce(new.shift, '')), '') is not null then
    select coalesce(jsonb_agg(x.value order by x.ord), '[]'::jsonb)
      into v_reasons
    from jsonb_array_elements(v_reasons) with ordinality as x(value, ord)
    where x.value #>> '{}' <> 'MISSING_SHIFT';
  elsif not (v_reasons @> '["MISSING_SHIFT"]'::jsonb) then
    v_reasons := v_reasons || '["MISSING_SHIFT"]'::jsonb;
  end if;

  new.pending_reasons := v_reasons;
  return new;
end;
$$;

drop trigger if exists trg_import_items_sync_shift_blocker on public.import_items;
create trigger trg_import_items_sync_shift_blocker
before insert or update of shift, pending_reasons on public.import_items
for each row
execute function public.sync_import_item_shift_blocker();

grant execute on function public.sync_import_item_shift_blocker() to authenticated;

commit;
