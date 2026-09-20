-- Master Prompt section 11 (Import Trace ID): a human-readable identifier
-- per import, so an admin can reference/search a specific import ("IMPORT
-- 20260919-A1B2C3D4") instead of a bare UUID, and a way to see which
-- pipeline step an import last reached - built on the existing
-- import_item_events audit table (already logs VALIDATION_BLOCKED,
-- AUTO_APPROVED, ADMIN_APPROVED, ADMIN_REJECTED, ERROR,
-- RECOMPUTE_NEEDS_REVIEW with timestamps) rather than a new table, since it
-- already captures every major lifecycle transition with a timestamp - the
-- gap was purely on the display side.
alter table public.import_items
  add column if not exists trace_id text;

update public.import_items
set trace_id = 'IMPORT-' || to_char(created_at, 'YYYYMMDD') || '-' || upper(left(id::text, 8))
where trace_id is null;

alter table public.import_items
  alter column trace_id set default null;

create or replace function public.set_import_item_trace_id()
 returns trigger
 language plpgsql
as $function$
begin
  if new.trace_id is null then
    new.trace_id := 'IMPORT-' || to_char(coalesce(new.created_at, now()), 'YYYYMMDD') || '-' || upper(left(new.id::text, 8));
  end if;
  return new;
end;
$function$;

drop trigger if exists trg_import_items_set_trace_id on public.import_items;
create trigger trg_import_items_set_trace_id
  before insert on public.import_items
  for each row execute function public.set_import_item_trace_id();

create unique index if not exists idx_import_items_trace_id on public.import_items(trace_id);
