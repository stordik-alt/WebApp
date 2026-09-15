-- Verze 2.0 AUTO correction
-- Do not derive the master norm from import_item_hourly.norm_per_hour because
-- that column may already contain an effective partial-hour norm after a prior
-- backfill. Resolve the master norm from Product Profile first.
-- The last listed hourly row is the partial row; its effective norm is based
-- on the screenshot clock and the canonical productive-minute calculation.

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
  v_last_hour_id uuid;
  v_last_hour integer;
  v_screenshot_time text;
begin
  select * into v_item
  from public.import_items
  where id = p_import_item_id;

  if not found then
    return;
  end if;

  v_screenshot_time := nullif(trim(coalesce(v_item.ocr_data ->> 'screenshot_time', '')), '');

  -- Determine the last listed row using the same shift-aware order as the
  -- canonical KPI calculation. This also works for Noční across midnight.
  select h.id, h.hour
    into v_last_hour_id, v_last_hour
  from public.import_item_hourly h
  where h.import_item_id = p_import_item_id
  order by
    case
      when lower(trim(coalesce(v_item.shift, ''))) like 'ra%' and h.hour >= 6 then h.hour - 6
      when lower(trim(coalesce(v_item.shift, ''))) like 'od%' and h.hour >= 14 then h.hour - 14
      when lower(trim(coalesce(v_item.shift, ''))) like 'no%' and h.hour >= 22 then h.hour - 22
      when lower(trim(coalesce(v_item.shift, ''))) like 'no%' then h.hour + 2
      else h.hour
    end desc,
    h.id desc
  limit 1;

  if v_last_hour_id is null then
    return;
  end if;

  for r in
    select h.id, h.hour, h.product_code, h.role, h.norm_per_hour, h.raw_data
    from public.import_item_hourly h
    where h.import_item_id = p_import_item_id
  loop
    -- Always resolve the master norm from the Product Profile. Never use a
    -- previously effective norm as the new master value.
    select case
      when upper(coalesce(r.role, '')) = 'HA'
           and lower(regexp_replace(coalesce(pp.ha_subassy, ''), '\s+', '', 'g')) = lower(regexp_replace(coalesce(r.product_code, ''), '\s+', '', 'g')) then pp.h_norm_per_hour
      when upper(coalesce(r.role, '')) = 'TUP'
           and lower(regexp_replace(coalesce(pp.tup_subassy, ''), '\s+', '', 'g')) = lower(regexp_replace(coalesce(r.product_code, ''), '\s+', '', 'g')) then pp.t_norm_per_hour
      when lower(regexp_replace(coalesce(pp.ha_subassy, ''), '\s+', '', 'g')) = lower(regexp_replace(coalesce(r.product_code, ''), '\s+', '', 'g'))
           and lower(regexp_replace(coalesce(pp.tup_subassy, ''), '\s+', '', 'g')) <> lower(regexp_replace(coalesce(r.product_code, ''), '\s+', '', 'g')) then pp.h_norm_per_hour
      when lower(regexp_replace(coalesce(pp.tup_subassy, ''), '\s+', '', 'g')) = lower(regexp_replace(coalesce(r.product_code, ''), '\s+', '', 'g'))
           and lower(regexp_replace(coalesce(pp.ha_subassy, ''), '\s+', '', 'g')) <> lower(regexp_replace(coalesce(r.product_code, ''), '\s+', '', 'g')) then pp.t_norm_per_hour
      else null
    end
    into v_master_norm
    from public.product_profiles pp
    where lower(regexp_replace(coalesce(pp.ha_subassy, ''), '\s+', '', 'g')) = lower(regexp_replace(coalesce(r.product_code, ''), '\s+', '', 'g'))
       or lower(regexp_replace(coalesce(pp.tup_subassy, ''), '\s+', '', 'g')) = lower(regexp_replace(coalesce(r.product_code, ''), '\s+', '', 'g'))
    order by pp.valid_to is null desc, pp.valid_from desc nulls last, pp.version_no desc nulls last
    limit 1;

    if v_master_norm is null then
      v_master_norm := nullif(r.raw_data -> 'calculation' ->> 'master_norm_per_hour', '')::numeric;
    end if;

    if r.id = v_last_hour_id and v_screenshot_time is not null then
      v_effective_norm := public.auto_effective_hour_norm(
        v_item.shift,
        r.hour,
        v_screenshot_time,
        v_master_norm
      );
    else
      v_effective_norm := v_master_norm;
    end if;

    update public.import_item_hourly
    set norm_per_hour = v_effective_norm,
        raw_data = coalesce(raw_data, '{}'::jsonb)
          || jsonb_build_object(
               'calculation', coalesce(raw_data -> 'calculation', '{}'::jsonb)
                 || jsonb_build_object('master_norm_per_hour', v_master_norm)
             )
    where id = r.id;
  end loop;
end;
$$;

grant execute on function public.sync_partial_last_hour_norm(uuid) to authenticated;

-- Re-apply to existing imports using the corrected master-norm source.
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
