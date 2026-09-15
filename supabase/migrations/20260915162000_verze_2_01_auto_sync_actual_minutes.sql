-- Verze 2.01 AUTO: keep import_item_hourly.actual_minutes synchronized
-- with the canonical KPI calculation stored in raw_data.calculation.productive_minutes.
-- This prevents the approval UI from falling back to stale 60-minute values.

create or replace function public.sync_import_item_actual_minutes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_minutes double precision;
begin
  if pg_trigger_depth() > 1 then
    return new;
  end if;

  v_minutes := nullif(trim(coalesce(new.raw_data -> 'calculation' ->> 'productive_minutes', '')), '')::double precision;

  if v_minutes is not null and v_minutes >= 0 then
    update public.import_item_hourly
    set actual_minutes = least(60.0, greatest(0.0, v_minutes))
    where id = new.id
      and actual_minutes is distinct from least(60.0, greatest(0.0, v_minutes));
  end if;

  return new;
end;
$$;

drop trigger if exists trg_sync_import_item_actual_minutes on public.import_item_hourly;

create trigger trg_sync_import_item_actual_minutes
after insert or update of raw_data on public.import_item_hourly
for each row
execute function public.sync_import_item_actual_minutes();

-- Backfill existing imports after the canonical KPI function has already calculated them.
do $$
declare
  r record;
begin
  for r in
    select id
    from public.import_items
    where status in ('VALIDATING', 'PENDING_APPROVAL', 'AUTO_APPROVED', 'APPROVED', 'REJECTED')
  loop
    perform public.recalculate_import_item_kpis(r.id);
  end loop;

  update public.import_item_hourly
  set actual_minutes = least(60.0, greatest(0.0,
    nullif(trim(coalesce(raw_data -> 'calculation' ->> 'productive_minutes', '')), '')::double precision
  ))
  where raw_data -> 'calculation' ? 'productive_minutes';
end;
$$;
