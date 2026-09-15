begin;

-- 2.0 AUTO: the admin "Uložit opravy a znovu validovat" path must execute
-- canonical profile/KPI validation even when the administrator only clicks
-- save without changing a header value. The UI previously recalculated only
-- its local blocker list and left NULL OEE/performance untouched.
create or replace function public.revalidate_import_item_after_admin_header_save()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile public.product_profiles%rowtype;
  v_reasons text[] := '{}'::text[];
  v_has_rows boolean;
  r record;
begin
  if new.status <> 'PENDING_APPROVAL' or pg_trigger_depth() > 1 then
    return new;
  end if;

  -- Resolve only the exact Product ID against an active Product Profile.
  -- Never infer another family/product just because the work date is old.
  if new.product_code is not null then
    select pp.* into v_profile
    from public.product_profiles pp
    where pp.valid_to is null
      and (
        lower(regexp_replace(coalesce(pp.ha_subassy, ''), '\s+', '', 'g')) = lower(regexp_replace(new.product_code, '\s+', '', 'g'))
        or lower(regexp_replace(coalesce(pp.tup_subassy, ''), '\s+', '', 'g')) = lower(regexp_replace(new.product_code, '\s+', '', 'g'))
      )
    order by pp.valid_from desc nulls last, pp.version_no desc nulls last
    limit 1;
  end if;

  update public.import_items
  set product_profile_status = case
        when v_profile.id is null then 'MISSING'
        when v_profile.ha_subassy is null or v_profile.tup_subassy is null
          or coalesce(v_profile.h_norm_per_hour, 0) <= 0
          or coalesce(v_profile.h_capacity, 0) < 1
          or coalesce(v_profile.t_norm_per_hour, 0) <= 0
          or coalesce(v_profile.t_capacity, 0) < 1
          then 'INCOMPLETE'
        else 'VALID'
      end
  where id = new.id;

  -- Canonical KPI calculation reads the resolved active profile and writes
  -- performance/availability/OEE into import_item_rows.
  perform public.recalculate_import_item_kpis(new.id);

  if new.work_date is null then v_reasons := array_append(v_reasons, 'MISSING_DATE'); end if;
  if new.shift is null or btrim(new.shift) = '' then v_reasons := array_append(v_reasons, 'MISSING_SHIFT'); end if;
  if new.line is null or btrim(new.line) = '' then v_reasons := array_append(v_reasons, 'MISSING_LINE'); end if;
  if new.product_id is null then v_reasons := array_append(v_reasons, 'PRODUCT_NOT_FOUND'); end if;

  if v_profile.id is null then
    v_reasons := array_append(v_reasons, 'PRODUCT_PROFILE_MISSING');
  elsif v_profile.ha_subassy is null or v_profile.tup_subassy is null
     or coalesce(v_profile.h_norm_per_hour, 0) <= 0
     or coalesce(v_profile.h_capacity, 0) < 1
     or coalesce(v_profile.t_norm_per_hour, 0) <= 0
     or coalesce(v_profile.t_capacity, 0) < 1 then
    v_reasons := array_append(v_reasons, 'PRODUCT_PROFILE_INCOMPLETE');
  end if;

  select exists(select 1 from public.import_item_rows where import_item_id = new.id) into v_has_rows;
  if not coalesce(v_has_rows, false) then
    v_reasons := array_append(v_reasons, 'EMPLOYEE_UNMATCHED');
  end if;

  for r in
    select employee_id, position, oee, performance, available_time
    from public.import_item_rows
    where import_item_id = new.id
  loop
    if r.employee_id is null then v_reasons := array_append(v_reasons, 'EMPLOYEE_UNMATCHED'); end if;
    if r.position not in ('HA', 'TUP') then v_reasons := array_append(v_reasons, 'POSITION_MISSING'); end if;
    if r.performance is null then v_reasons := array_append(v_reasons, 'PERFORMANCE_MISSING'); end if;
    if r.available_time is null then v_reasons := array_append(v_reasons, 'AVAILABILITY_MISSING'); end if;
    if r.oee is null then v_reasons := array_append(v_reasons, 'OEE_MISSING'); end if;
  end loop;

  -- Preserve blockers unrelated to profile/KPI validation.
  select coalesce(array_agg(reason order by reason), '{}'::text[])
    into v_reasons
  from (
    select distinct jsonb_array_elements_text(coalesce(new.pending_reasons, '[]'::jsonb)) as reason
    where reason not in ('PRODUCT_PROFILE_MISSING','PRODUCT_PROFILE_INCOMPLETE','OEE_MISSING','PERFORMANCE_MISSING','AVAILABILITY_MISSING','HOURLY_KPI_MISSING','HOURLY_DATA_MISSING')
    union
    select unnest(v_reasons)
  ) x;

  update public.import_items
  set pending_reasons = to_jsonb(v_reasons),
      product_profile_status = case
        when v_profile.id is null then 'MISSING'
        when v_profile.ha_subassy is null or v_profile.tup_subassy is null
          or coalesce(v_profile.h_norm_per_hour, 0) <= 0
          or coalesce(v_profile.h_capacity, 0) < 1
          or coalesce(v_profile.t_norm_per_hour, 0) <= 0
          or coalesce(v_profile.t_capacity, 0) < 1
          then 'INCOMPLETE'
        else 'VALID'
      end
  where id = new.id;

  return new;
end;
$$;

drop trigger if exists trg_import_items_admin_header_revalidate on public.import_items;
create trigger trg_import_items_admin_header_revalidate
after update on public.import_items
for each row
when (new.status = 'PENDING_APPROVAL')
execute function public.revalidate_import_item_after_admin_header_save();

grant execute on function public.revalidate_import_item_after_admin_header_save() to authenticated;

commit;
