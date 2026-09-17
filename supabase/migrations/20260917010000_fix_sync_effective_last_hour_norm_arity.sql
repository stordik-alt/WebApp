-- Regression fix #2 for the same import pipeline: sync_effective_last_hour_norm
-- still called auto_shift_productive_minutes with the old 3-argument signature
-- (text, integer, text); only the 4-argument version (with p_is_last_hour)
-- exists today, so the call raised "function ... does not exist". This was
-- latent before today (unrelated to this session's V19 changes) and only
-- surfaced now because the earlier recalculate_import_item_kpis regression
-- was aborting the same VALIDATING-transition transaction before this
-- trigger got a chance to run.
--
-- This function's own norm_per_hour write is superseded by
-- reconstruct_import_item_hourly (V19), which runs later in the same
-- trigger cascade (trg_import_items_expose_effective_last_hour_norm sorts
-- before zz_import_items_reconstruct_2_01) and unconditionally resets
-- norm_per_hour to the canonical Product Profile master norm — so fixing
-- the call signature here is sufficient; no output of this function survives
-- the cascade uncorrected.
create or replace function public.sync_effective_last_hour_norm(p_import_item_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item public.import_items%rowtype;
  v_last_hour integer;
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

  select max(h.hour) into v_last_hour
  from public.import_item_hourly h
  where h.import_item_id = p_import_item_id;

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
      v_minutes := public.auto_shift_productive_minutes(v_item.shift, r.hour, v_screenshot_time, r.hour = v_last_hour);
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
