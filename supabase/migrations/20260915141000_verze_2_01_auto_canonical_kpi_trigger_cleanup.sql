-- Verze 2.01 AUTO: canonical KPI trigger cleanup.
-- The older reconstruction trigger was created after the canonical KPI trigger
-- and could overwrite the teff/downtime calculation with the legacy model.
-- From this migration onward, recalculate_import_item_kpis() is the only
-- authoritative hourly KPI calculation for AUTO imports.

-- Keep the reconstruction worker available for historical compatibility,
-- but do not execute it automatically on VALIDATING.
drop trigger if exists zz_import_items_reconstruct_2_01 on public.import_items;

-- The approval/detail UI can use the same effective production time that the
-- canonical KPI function used for each hourly row. This must not replace OCR
-- norm or Product Profile norm; it is only the weighting duration.
alter table public.import_item_hourly
  add column if not exists actual_minutes numeric;

create or replace function public.sync_import_item_hourly_actual_minutes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_minutes numeric;
begin
  v_minutes := coalesce(
    nullif(trim(coalesce(new.raw_data -> 'calculation' ->> 'productive_minutes', '')), '')::numeric,
    nullif(trim(coalesce(new.raw_data -> 'calculation' ->> 'reconstructed_productive_minutes', '')), '')::numeric
  );

  if v_minutes is not null
     and new.actual_minutes is distinct from v_minutes then
    update public.import_item_hourly
       set actual_minutes = v_minutes
     where id = new.id;
  end if;

  return new;
end;
$$;

grant execute on function public.sync_import_item_hourly_actual_minutes() to authenticated;

drop trigger if exists trg_import_item_hourly_sync_actual_minutes on public.import_item_hourly;
create trigger trg_import_item_hourly_sync_actual_minutes
after insert or update of raw_data on public.import_item_hourly
for each row
execute function public.sync_import_item_hourly_actual_minutes();

-- Recalculate existing AUTO imports immediately with the canonical 2.01 model.
do $$
declare
  r record;
begin
  for r in
    select distinct i.id
    from public.import_items i
    join public.import_item_hourly h on h.import_item_id = i.id
    where i.status in ('VALIDATING', 'PENDING_APPROVAL', 'AUTO_APPROVED', 'APPROVED', 'REJECTED')
  loop
    perform public.recalculate_import_item_kpis(r.id);
  end loop;
end;
$$;
