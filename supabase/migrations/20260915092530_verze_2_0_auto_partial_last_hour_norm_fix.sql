-- Verze 2.0 AUTO
-- Fix: the previous partial-last-hour migration could fail because its
-- helper function was not available after a transactional migration error.
-- This migration is self-contained and recreates the helper before backfill.

create or replace function public.auto_effective_hour_norm(
  p_shift text,
  p_hour integer,
  p_screenshot_time text,
  p_master_norm numeric
)
returns numeric
language plpgsql
immutable
set search_path = public
as $$
declare
  v_clock_hour integer;
  v_elapsed numeric;
begin
  if p_master_norm is null or p_master_norm <= 0 then
    return p_master_norm;
  end if;

  if p_screenshot_time is null
     or p_screenshot_time !~ '^(?:[01][0-9]|2[0-3]):[0-5][0-9]$' then
    return p_master_norm;
  end if;

  v_clock_hour := split_part(p_screenshot_time, ':', 1)::integer;

  -- Only the row belonging to the screenshot clock hour is partial.
  if p_hour is distinct from v_clock_hour then
    return p_master_norm;
  end if;

  v_elapsed := public.auto_shift_productive_minutes(
    p_shift,
    p_hour,
    p_screenshot_time
  );

  return round((p_master_norm * greatest(0, coalesce(v_elapsed, 0)) / 60.0)::numeric, 2);
end;
$$;

grant execute on function public.auto_effective_hour_norm(text, integer, text, numeric) to authenticated;

create or replace function public.sync_partial_last_hour_norm(p_import_item_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item public.import_items%rowtype;
  r record;
  v_master_norm numeric;
  v_effective_norm numeric;
  v_screenshot_time text;
begin
  select * into v_item
  from public.import_items
  where id = p_import_item_id;

  if not found then
    return;
  end if;

  v_screenshot_time := nullif(trim(coalesce(v_item.ocr_data ->> 'screenshot_time', '')), '');

  for r in
    select h.id, h.hour, h.norm_per_hour, h.raw_data
    from public.import_item_hourly h
    where h.import_item_id = p_import_item_id
  loop
    v_master_norm := nullif(r.raw_data -> 'calculation' ->> 'master_norm_per_hour', '')::numeric;
    if v_master_norm is null then
      v_master_norm := r.norm_per_hour;
    end if;

    v_effective_norm := public.auto_effective_hour_norm(
      v_item.shift,
      r.hour,
      v_screenshot_time,
      v_master_norm
    );

    update public.import_item_hourly
    set norm_per_hour = v_effective_norm,
        raw_data = coalesce(raw_data, '{}'::jsonb)
          || jsonb_build_object(
               'calculation',
               coalesce(raw_data -> 'calculation', '{}'::jsonb)
               || jsonb_build_object('master_norm_per_hour', v_master_norm)
             )
    where id = r.id;
  end loop;
end;
$$;

grant execute on function public.sync_partial_last_hour_norm(uuid) to authenticated;

create or replace function public.trg_sync_partial_last_hour_norm()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if pg_trigger_depth() > 1 then
    return new;
  end if;

  if new.status in ('VALIDATING', 'PENDING_APPROVAL', 'AUTO_APPROVED', 'APPROVED') then
    perform public.sync_partial_last_hour_norm(new.id);
  end if;

  return new;
end;
$$;

drop trigger if exists trg_import_items_sync_partial_last_hour_norm on public.import_items;
create trigger trg_import_items_sync_partial_last_hour_norm
after update on public.import_items
for each row
when (new.status in ('VALIDATING', 'PENDING_APPROVAL', 'AUTO_APPROVED', 'APPROVED'))
execute function public.trg_sync_partial_last_hour_norm();

-- Backfill existing imports.
do $$
declare
  r record;
begin
  for r in
    select id
    from public.import_items
    where status in ('VALIDATING', 'PENDING_APPROVAL', 'AUTO_APPROVED', 'APPROVED')
  loop
    perform public.sync_partial_last_hour_norm(r.id);
  end loop;
end $$;
