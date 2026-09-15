-- Verze 2.0 AUTO
-- Fix: PostgreSQL trigger functions are called without explicit arguments.
-- The import id is taken from NEW.id.

create or replace function public.sync_effective_last_hour_norm(p_import_item_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item public.import_items%rowtype;
  r record;
  v_screenshot_time text;
  v_minutes numeric;
  v_effective numeric;
  v_master numeric;
begin
  select * into v_item from public.import_items where id = p_import_item_id;
  if not found then return; end if;

  v_screenshot_time := nullif(trim(v_item.ocr_data ->> 'screenshot_time'), '');
  if v_screenshot_time is null then return; end if;

  for r in
    select h.id, h.hour, h.norm_per_hour,
           h.raw_data -> 'calculation' ->> 'master_norm_per_hour' as raw_master_norm,
           h.raw_data -> 'calculation' ->> 'productive_minutes' as raw_minutes
    from public.import_item_hourly h
    where h.import_item_id = p_import_item_id
  loop
    v_master := coalesce(nullif(r.raw_master_norm, '')::numeric, r.norm_per_hour);
    v_minutes := nullif(r.raw_minutes, '')::numeric;
    if v_master is null then continue; end if;

    if v_minutes is null then
      v_minutes := public.auto_shift_productive_minutes(v_item.shift, r.hour, v_screenshot_time);
    end if;

    v_effective := case
      when v_minutes > 0 and v_minutes < 60 then v_master * v_minutes / 60.0
      else v_master
    end;

    update public.import_item_hourly
    set norm_per_hour = v_effective,
        raw_data = coalesce(raw_data, '{}'::jsonb)
          || jsonb_build_object(
               'calculation', coalesce(raw_data -> 'calculation', '{}'::jsonb)
                 || jsonb_build_object(
                      'master_norm_per_hour', v_master,
                      'effective_norm_per_hour', v_effective,
                      'productive_minutes', v_minutes
                    )
             )
    where id = r.id;
  end loop;
end;
$$;

grant execute on function public.sync_effective_last_hour_norm(uuid) to authenticated;

-- Trigger wrapper: trigger functions receive NEW automatically and must return NEW.
create or replace function public.sync_effective_last_hour_norm_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.sync_effective_last_hour_norm(new.id);
  return new;
end;
$$;

grant execute on function public.sync_effective_last_hour_norm_trigger() to authenticated;

drop trigger if exists trg_import_items_expose_effective_last_hour_norm on public.import_items;
create trigger trg_import_items_expose_effective_last_hour_norm
after update on public.import_items
for each row
when (new.status = 'VALIDATING')
execute function public.sync_effective_last_hour_norm_trigger();

-- Repair already processed imports without changing master Product Profile norms.
do $$
declare
  r record;
begin
  for r in
    select id
    from public.import_items
    where status in ('VALIDATING','PENDING_APPROVAL','AUTO_APPROVED','APPROVED')
      and ocr_data ->> 'screenshot_time' is not null
  loop
    perform public.sync_effective_last_hour_norm(r.id);
  end loop;
end $$;
