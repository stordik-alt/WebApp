-- Verze 2.0 AUTO
-- Keep the master hourly norm separate from the effective norm used for a
-- partial final hour. The UI-facing import_item_hourly.norm_per_hour must show
-- the effective norm for the final OCR hour, while raw_data.calculation keeps
-- the master norm and productive minutes for auditability.

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
  select * into v_item
  from public.import_items
  where id = p_import_item_id;

  if not found then
    return;
  end if;

  v_screenshot_time := nullif(trim(v_item.ocr_data ->> 'screenshot_time'), '');
  if v_screenshot_time is null then
    return;
  end if;

  for r in
    select h.id, h.hour, h.norm_per_hour,
           h.raw_data -> 'calculation' ->> 'master_norm_per_hour' as raw_master_norm,
           h.raw_data -> 'calculation' ->> 'productive_minutes' as raw_minutes
    from public.import_item_hourly h
    where h.import_item_id = p_import_item_id
  loop
    -- Prefer the calculation metadata written by the canonical KPI function.
    v_master := coalesce(nullif(r.raw_master_norm, '')::numeric, r.norm_per_hour);
    v_minutes := nullif(r.raw_minutes, '')::numeric;

    if v_master is null then
      continue;
    end if;

    -- If metadata is available, use it directly. Otherwise derive the minutes
    -- from the authoritative shift clock helper.
    if v_minutes is null then
      v_minutes := public.auto_shift_productive_minutes(v_item.shift, r.hour, v_screenshot_time);
    end if;

    v_effective := case
      when v_minutes is not null and v_minutes > 0 and v_minutes < 60
        then v_master * v_minutes / 60.0
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

-- Run after the canonical KPI trigger. PostgreSQL fires AFTER triggers of the
-- same event in name order, so this sees the freshly calculated raw metadata.
drop trigger if exists trg_import_items_expose_effective_last_hour_norm on public.import_items;
create trigger trg_import_items_expose_effective_last_hour_norm
after update on public.import_items
for each row
when (new.status = 'VALIDATING')
execute function public.sync_effective_last_hour_norm(new.id);

grant execute on function public.sync_effective_last_hour_norm(uuid) to authenticated;

-- Repair already validated/pending imports without changing master norms.
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
