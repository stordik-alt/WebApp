begin;

-- Product Profiles are the authoritative model for H/T pairing, norms and capacity.
-- Legacy product_families and product_norms are retained only as compatibility
-- storage for older screens/workflows until their consumers are retired.

create or replace function public.resolve_product_id_by_code(p_code text)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select p.id
  from public.products p
  where lower(regexp_replace(coalesce(p.code, ''), '\\s+', '', 'g')) =
        lower(regexp_replace(coalesce(p_code, ''), '\\s+', '', 'g'))
  order by p.created_at asc
  limit 1
$$;

create or replace function public.sync_profile_from_legacy_norm()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text;
  v_variant text;
  v_profile public.product_profiles%rowtype;
  v_profile_id uuid;
begin
  if pg_trigger_depth() > 1 then
    return new;
  end if;

  select p.code, p.variant_type
    into v_code, v_variant
  from public.products p
  where p.id = new.product_id;

  if v_code is null then
    return new;
  end if;

  if v_variant = 'H' then
    select pp.* into v_profile
    from public.product_profiles pp
    where lower(regexp_replace(coalesce(pp.ha_subassy, ''), '\\s+', '', 'g')) =
          lower(regexp_replace(v_code, '\\s+', '', 'g'))
      and pp.valid_to is null
    order by pp.valid_from desc, pp.version_no desc nulls last, pp.created_at desc
    limit 1;

    if found then
      update public.product_profiles
      set h_norm_per_hour = new.norm_per_hour
      where id = v_profile.id;
    end if;
  elsif v_variant = 'T' then
    select pp.* into v_profile
    from public.product_profiles pp
    where lower(regexp_replace(coalesce(pp.tup_subassy, ''), '\\s+', '', 'g')) =
          lower(regexp_replace(v_code, '\\s+', '', 'g'))
      and pp.valid_to is null
    order by pp.valid_from desc, pp.version_no desc nulls last, pp.created_at desc
    limit 1;

    if found then
      update public.product_profiles
      set t_norm_per_hour = new.norm_per_hour
      where id = v_profile.id;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_profile_from_legacy_norm on public.product_norms;
create trigger trg_profile_from_legacy_norm
after insert or update of norm_per_hour, product_id, operation, valid_from, valid_to
on public.product_norms
for each row
execute function public.sync_profile_from_legacy_norm();

create or replace function public.sync_legacy_norm_from_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_h_id uuid;
  v_t_id uuid;
  v_date date;
begin
  if pg_trigger_depth() > 1 then
    return new;
  end if;

  v_date := coalesce(new.valid_from, current_date);
  v_h_id := public.resolve_product_id_by_code(new.ha_subassy);
  v_t_id := public.resolve_product_id_by_code(new.tup_subassy);

  if v_h_id is not null and new.h_norm_per_hour is not null then
    update public.products
    set employees_per_product = coalesce(new.h_capacity, employees_per_product),
        variant_type = 'H'
    where id = v_h_id;

    update public.product_norms
    set valid_to = v_date
    where product_id = v_h_id
      and operation = 'HA'
      and valid_to is null
      and id <> coalesce((select pn.id from public.product_norms pn where pn.product_id = v_h_id and pn.operation = 'HA' and pn.valid_from = v_date order by pn.created_at desc limit 1), gen_random_uuid());

    insert into public.product_norms (
      product_id, operation, norm_per_hour, valid_from, valid_to,
      source, confirmed, note, approval_status
    ) values (
      v_h_id, 'HA', new.h_norm_per_hour, v_date, null,
      'product_profile', true, 'Odvozeno z Product Profile', 'approved'
    );
  end if;

  if v_t_id is not null and new.t_norm_per_hour is not null then
    update public.products
    set employees_per_product = coalesce(new.t_capacity, employees_per_product),
        variant_type = 'T'
    where id = v_t_id;

    update public.product_norms
    set valid_to = v_date
    where product_id = v_t_id
      and operation = 'TUP'
      and valid_to is null
      and id <> coalesce((select pn.id from public.product_norms pn where pn.product_id = v_t_id and pn.operation = 'TUP' and pn.valid_from = v_date order by pn.created_at desc limit 1), gen_random_uuid());

    insert into public.product_norms (
      product_id, operation, norm_per_hour, valid_from, valid_to,
      source, confirmed, note, approval_status
    ) values (
      v_t_id, 'TUP', new.t_norm_per_hour, v_date, null,
      'product_profile', true, 'Odvozeno z Product Profile', 'approved'
    );
  end if;

  return new;
end;
$$;

drop trigger if exists trg_legacy_norm_from_profile on public.product_profiles;
create trigger trg_legacy_norm_from_profile
after insert or update of ha_subassy, h_capacity, h_norm_per_hour, tup_subassy, t_capacity, t_norm_per_hour, valid_from, valid_to
on public.product_profiles
for each row
execute function public.sync_legacy_norm_from_profile();

create or replace function public.sync_profile_from_legacy_family()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_h_code text;
  v_t_code text;
  v_h_capacity integer;
  v_t_capacity integer;
  v_h_norm numeric;
  v_t_norm numeric;
begin
  if pg_trigger_depth() > 1 then
    return new;
  end if;

  select code, employees_per_product, (
    select pn.norm_per_hour from public.product_norms pn
    where pn.product_id = new.h_product_id and pn.operation = 'HA'
    order by pn.valid_from desc, pn.created_at desc limit 1
  ) into v_h_code, v_h_capacity, v_h_norm
  from public.products where id = new.h_product_id;

  select code, employees_per_product, (
    select pn.norm_per_hour from public.product_norms pn
    where pn.product_id = new.t_product_id and pn.operation = 'TUP'
    order by pn.valid_from desc, pn.created_at desc limit 1
  ) into v_t_code, v_t_capacity, v_t_norm
  from public.products where id = new.t_product_id;

  if v_h_code is null and v_t_code is null then
    return new;
  end if;

  insert into public.product_profiles (
    profile_name, ha_subassy, h_capacity, h_norm_per_hour,
    tup_subassy, t_capacity, t_norm_per_hour,
    valid_from, valid_to, version_no
  ) values (
    new.name, v_h_code, v_h_capacity, v_h_norm,
    v_t_code, v_t_capacity, v_t_norm,
    current_date, null, 1
  )
  on conflict (profile_key) where valid_to is null
  do update set
    profile_name = excluded.profile_name,
    h_capacity = coalesce(excluded.h_capacity, public.product_profiles.h_capacity),
    h_norm_per_hour = coalesce(excluded.h_norm_per_hour, public.product_profiles.h_norm_per_hour),
    t_capacity = coalesce(excluded.t_capacity, public.product_profiles.t_capacity),
    t_norm_per_hour = coalesce(excluded.t_norm_per_hour, public.product_profiles.t_norm_per_hour);

  return new;
end;
$$;

drop trigger if exists trg_profile_from_legacy_family on public.product_families;
create trigger trg_profile_from_legacy_family
after insert or update of name, h_product_id, t_product_id
on public.product_families
for each row
execute function public.sync_profile_from_legacy_family();

-- One-time reconciliation: any existing H/T pair in the legacy family model
-- gets represented in Product Profiles. Existing Product Profile values win
-- over NULL legacy values.
do $$
declare
  r record;
begin
  for r in
    select pf.id, pf.name, pf.h_product_id, pf.t_product_id
    from public.product_families pf
  loop
    perform public.sync_profile_from_legacy_family(
      (select pf from public.product_families pf where pf.id = r.id)
    );
  end loop;
end;
$$;

commit;
