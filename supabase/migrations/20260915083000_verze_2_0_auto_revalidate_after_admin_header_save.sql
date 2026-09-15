begin;

-- 2.0 AUTO: the admin "Uložit opravy a znovu validovat" path previously only
-- updated header fields and recomputed blocker labels in the browser. It did
-- not run the canonical KPI recalculation, so existing NULL OEE/performance
-- stayed NULL and a stale PRODUCT_PROFILE_MISSING could survive the save.
--
-- Keep the database as the source of truth: whenever an admin saves the
-- header of a pending import, resolve the active Product Profile by product
-- code, run the canonical KPI calculation, then rebuild the blocker list from
-- the persisted rows.
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
  if new.status <> 'PENDING_APPROVAL' then
    return new;
  end if;

  -- Only react to actual header edits. The internal updates below change KPI
  -- and blocker columns, not these header fields, so they do not recurse.
  if not (
    new.work_date is distinct from old.work_date
    or new.shift is distinct from old.shift
    or new.line is distinct from old.line
    or new.product_code is distinct from old.product_code
    or new.product_name is distinct from old.product_name
    or new.norm_per_hour is distinct from old.norm_per_hour
  ) then
    return new;
  end if;

  -- Product Profile is identified by the product code, using the active
  -- profile as the canonical runtime source. This deliberately does not
  -- attach a product to another family merely because the work date is old.
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
        when v_profile.ha_subassy is null
          or v_profile.tup_subassy is null
          or coalesce(v_profile.h_norm_per_hour, 0) <= 0
          or coalesce(v_profile.h_capacity, 0) < 1
          or coalesce(v_profile.t_norm_per_hour, 0) <= 0
          or coalesce(v_profile.t_capacity, 0) < 1
          then 'INCOMPLETE'
        else 'VALID'
      end
  where id = new.id;

  -- Canonical KPI calculation reads the resolved active Product Profile and
  -- writes performance/availability/OEE into import_item_rows.
  perform public.recalculate_import_item_kpis(new.id);

  select exists(
    select 1 from public.import_item_rows r where r.import_item_id = new.id
  ) into v_has_rows;

  if not coalesce(v_has_rows, false) then
    v_reasons := array_append(v_reasons, 'EMPLOYEE_UNMATCHED');
  end if;

  if new.work_date is null then v_reasons := array_append(v_reasons, 'MISSING_DATE'); end if;
  if new.shift is null or btrim(new.shift) = '' then v_reasons := array_append(v_reasons, 'MISSING_SHIFT'); end if;
  if new.line is null or btrim(new.line) = '' then v_reasons := array_append(v_reasons, 'MISSING_LINE'); end if;
  if new.product_id is null then v_reasons := array_append(v_reasons, 'PRODUCT_NOT_FOUND'); end if;

  if v_profile.id is null then
    v_reasons := array_append(v_reasons, 'PRODUCT_PROFILE_MISSING');
  elsif v_profile.ha_subassy is null
     or v_profile.tup_subassy is null
     or coalesce(v_profile.h_norm_per_hour, 0) <= 0
     or coalesce(v_profile.h_capacity, 0) < 1
     or coalesce(v_profile.t_norm_per_hour, 0) <= 0
     or coalesce(v_profile.t_capacity, 0) < 1 then
    v_reasons := array_append(v_reasons, 'PRODUCT_PROFILE_INCOMPLETE');
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

  -- Preserve any non-KPI/non-profile blockers already present on the item.
  select coalesce(array_agg(reason order by reason), '{}'::text[])
    into v_reasons
  from (
    select distinct jsonb_array_elements_text(coalesce(new.pending_reasons, '[]'::jsonb)) as reason
    where reason not in (
      'PRODUCT_PROFILE_MISSING','PRODUCT_PROFILE_INCOMPLETE',
      'OEE_MISSING','PERFORMANCE_MISSING','AVAILABILITY_MISSING',
      'HOURLY_KPI_MISSING','HOURLY_DATA_MISSING'
    )
    union
    select unnest(v_reasons)
  ) x;

  update public.import_items
  set pending_reasons = to_jsonb(v_reasons),
      product_profile_status = case
        when v_profile.id is null then 'MISSING'
        when v_profile.ha_subassy is null
          or v_profile.tup_subassy is null
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
when (
  new.status = 'PENDING_APPROVAL'
  and (
    new.work_date is distinct from old.work_date
    or new.shift is distinct from old.shift
    or new.line is distinct from old.line
    or new.product_code is distinct from old.product_code
    or new.product_name is distinct from old.product_name
    or new.norm_per_hour is distinct from old.norm_per_hour
  )
)
execute function public.revalidate_import_item_after_admin_header_save();

grant execute on function public.revalidate_import_item_after_admin_header_save() to authenticated;

commit;
