begin;

-- 2.01 AUTO: the import validator reads active Product Profiles.  Historical
-- family profiles can legitimately exist without a concrete H/T variant alias,
-- which previously caused a false PRODUCT_PROFILE_MISSING blocker even though
-- the product had a valid profile family and usable norm/capacity.
--
-- Before the product-identity repair trigger runs, create the missing active
-- variant alias from the authoritative family profile.  Do not overwrite an
-- existing profile and do not fabricate a profile when no authoritative family
-- profile exists.
create or replace function public.ensure_import_item_product_profiles(p_import_item_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  i record;
  p record;
  f record;
  base_pp record;
  v_norm numeric;
  v_capacity integer;
  v_existing uuid;
  v_version integer;
  v_work_date date;
begin
  select id, product_id, product_code, work_date
    into i
  from public.import_items
  where id = p_import_item_id;

  if i.id is null then
    return;
  end if;

  v_work_date := coalesce(i.work_date, current_date);

  for p in
    select distinct pr.id, pr.code, pr.family_id, pr.variant_type,
           pr.employees_per_product
    from public.import_item_hourly h
    join public.products pr
      on lower(regexp_replace(trim(pr.code), '\\s+', '', 'g')) =
         lower(regexp_replace(trim(h.product_code), '\\s+', '', 'g'))
    where h.import_item_id = p_import_item_id
      and nullif(trim(h.product_code), '') is not null
  loop
    if p.family_id is null then
      continue;
    end if;

    -- Only the authoritative family profile is allowed to seed an alias.
    select id, h_subassy, h_capacity, h_norm_per_hour,
           tup_subassy, t_capacity, t_norm_per_hour,
           profile_name
      into base_pp
    from public.product_profiles
    where id = p.family_id
      and h_norm_per_hour > 0
      and h_capacity >= 1
      and t_norm_per_hour > 0
      and t_capacity >= 1
    order by valid_to is null desc, valid_from desc nulls last, version_no desc nulls last
    limit 1;

    -- Some databases use family_id only as a relationship and the profile id
    -- is not identical. Fall back to the latest profile containing the family
    -- subassemblies when the id-based lookup is unavailable.
    if base_pp.id is null then
      select pp.id, pp.ha_subassy as h_subassy, pp.h_capacity,
             pp.h_norm_per_hour, pp.tup_subassy, pp.t_capacity,
             pp.t_norm_per_hour, pp.profile_name
        into base_pp
      from public.product_profiles pp
      where pp.h_norm_per_hour > 0
        and pp.h_capacity >= 1
        and pp.t_norm_per_hour > 0
        and pp.t_capacity >= 1
        and (
          lower(regexp_replace(coalesce(pp.ha_subassy, ''), '\\s+', '', 'g')) =
            lower(regexp_replace(coalesce((select code from public.products where id = (select h_product_id from public.product_families where id = p.family_id)), ''), '\\s+', '', 'g'))
          or lower(regexp_replace(coalesce(pp.tup_subassy, ''), '\\s+', '', 'g')) =
            lower(regexp_replace(coalesce((select code from public.products where id = (select t_product_id from public.product_families where id = p.family_id)), ''), '\\s+', '', 'g'))
        )
        and pp.valid_from <= v_work_date
        and (pp.valid_to is null or pp.valid_to >= v_work_date)
      order by pp.valid_to is null desc, pp.valid_from desc nulls last, pp.version_no desc nulls last
      limit 1;
    end if;

    if base_pp.id is null then
      continue;
    end if;

    if upper(coalesce(p.variant_type, '')) = 'H' then
      -- An active profile matching this concrete H product already exists.
      select id into v_existing
      from public.product_profiles
      where valid_to is null
        and lower(regexp_replace(coalesce(ha_subassy, ''), '\\s+', '', 'g')) =
            lower(regexp_replace(coalesce(p.code, ''), '\\s+', '', 'g'))
      limit 1;

      if v_existing is null then
        select pn.norm_per_hour into v_norm
        from public.product_norms pn
        where pn.product_id = p.id
          and upper(pn.operation) = 'HA'
          and pn.valid_from <= v_work_date
          and (pn.valid_to is null or pn.valid_to >= v_work_date)
          and pn.norm_per_hour > 0
        order by pn.valid_from desc, pn.created_at desc
        limit 1;

        v_norm := coalesce(v_norm, base_pp.h_norm_per_hour);
        v_capacity := greatest(coalesce(p.employees_per_product, base_pp.h_capacity, 1), 1);

        select coalesce(max(version_no), 0) + 1 into v_version
        from public.product_profiles
        where lower(regexp_replace(coalesce(tup_subassy, ''), '\\s+', '', 'g')) =
              lower(regexp_replace(coalesce(base_pp.tup_subassy, ''), '\\s+', '', 'g'));

        insert into public.product_profiles (
          profile_name, ha_subassy, h_capacity, h_norm_per_hour,
          tup_subassy, t_capacity, t_norm_per_hour,
          valid_from, valid_to, version_no
        ) values (
          coalesce(base_pp.profile_name, p.code),
          p.code, v_capacity, v_norm,
          base_pp.tup_subassy, base_pp.t_capacity, base_pp.t_norm_per_hour,
          v_work_date, null, greatest(v_version, 1)
        );
      end if;

    elsif upper(coalesce(p.variant_type, '')) = 'T' then
      select id into v_existing
      from public.product_profiles
      where valid_to is null
        and lower(regexp_replace(coalesce(tup_subassy, ''), '\\s+', '', 'g')) =
            lower(regexp_replace(coalesce(p.code, ''), '\\s+', '', 'g'))
      limit 1;

      if v_existing is null then
        select pn.norm_per_hour into v_norm
        from public.product_norms pn
        where pn.product_id = p.id
          and upper(pn.operation) = 'TUP'
          and pn.valid_from <= v_work_date
          and (pn.valid_to is null or pn.valid_to >= v_work_date)
          and pn.norm_per_hour > 0
        order by pn.valid_from desc, pn.created_at desc
        limit 1;

        v_norm := coalesce(v_norm, base_pp.t_norm_per_hour);
        v_capacity := greatest(coalesce(p.employees_per_product, base_pp.t_capacity, 1), 1);

        select coalesce(max(version_no), 0) + 1 into v_version
        from public.product_profiles
        where lower(regexp_replace(coalesce(ha_subassy, ''), '\\s+', '', 'g')) =
              lower(regexp_replace(coalesce(base_pp.ha_subassy, ''), '\\s+', '', 'g'));

        insert into public.product_profiles (
          profile_name, ha_subassy, h_capacity, h_norm_per_hour,
          tup_subassy, t_capacity, t_norm_per_hour,
          valid_from, valid_to, version_no
        ) values (
          coalesce(base_pp.profile_name, p.code),
          base_pp.ha_subassy, base_pp.h_capacity, base_pp.h_norm_per_hour,
          p.code, v_capacity, v_norm,
          v_work_date, null, greatest(v_version, 1)
        );
      end if;
    end if;
  end loop;
end;
$$;

grant execute on function public.ensure_import_item_product_profiles(uuid) to authenticated;

create or replace function public.ensure_import_item_product_profiles_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if pg_trigger_depth() > 1 then
    return new;
  end if;
  if new.status = 'VALIDATING' then
    perform public.ensure_import_item_product_profiles(new.id);
  end if;
  return new;
end;
$$;

grant execute on function public.ensure_import_item_product_profiles_trigger() to authenticated;

drop trigger if exists aaa_import_items_ensure_product_profiles on public.import_items;
create trigger aaa_import_items_ensure_product_profiles
after update on public.import_items
for each row
when (new.status = 'VALIDATING')
execute function public.ensure_import_item_product_profiles_trigger();

-- Repair existing imports that are still blocked solely by a stale profile
-- status. Other blockers remain untouched.
do $$
declare
  r record;
begin
  for r in
    select id
    from public.import_items
    where status in ('VALIDATING','PENDING_APPROVAL')
      and product_id is not null
  loop
    perform public.ensure_import_item_product_profiles(r.id);
  end loop;
end $$;

notify pgrst, 'reload schema';
commit;