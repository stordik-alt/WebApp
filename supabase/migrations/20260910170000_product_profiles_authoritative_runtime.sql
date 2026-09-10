begin;

-- Product Profiles are the authoritative application model for H/T pairing,
-- norms, capacities and version metadata. Legacy tables remain only as a
-- compatibility bridge for code paths that have not yet been retired.

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

create or replace function public.sync_profile_pair(
  p_name text,
  p_ha_code text,
  p_h_capacity integer,
  p_h_norm numeric,
  p_tup_code text,
  p_t_capacity integer,
  p_t_norm numeric
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing_id uuid;
begin
  select id into v_existing_id
  from public.product_profiles
  where lower(regexp_replace(coalesce(ha_subassy, ''), '\\s+', '', 'g')) = lower(regexp_replace(coalesce(p_ha_code, ''), '\\s+', '', 'g'))
    and lower(regexp_replace(coalesce(tup_subassy, ''), '\\s+', '', 'g')) = lower(regexp_replace(coalesce(p_tup_code, ''), '\\s+', '', 'g'))
    and valid_to is null
  order by valid_from desc nulls last, version_no desc nulls last, created_at desc
  limit 1;

  if v_existing_id is null then
    insert into public.product_profiles (
      profile_name, ha_subassy, h_capacity, h_norm_per_hour,
      tup_subassy, t_capacity, t_norm_per_hour,
      valid_from, valid_to, version_no
    ) values (
      p_name, p_ha_code, p_h_capacity, p_h_norm,
      p_tup_code, p_t_capacity, p_t_norm,
      current_date, null, 1
    );
  else
    update public.product_profiles
    set profile_name = coalesce(p_name, profile_name),
        h_capacity = coalesce(p_h_capacity, h_capacity),
        h_norm_per_hour = coalesce(p_h_norm, h_norm_per_hour),
        t_capacity = coalesce(p_t_capacity, t_capacity),
        t_norm_per_hour = coalesce(p_t_norm, t_norm_per_hour)
    where id = v_existing_id;
  end if;
end;
$$;

-- Legacy product_families writes are mirrored into Product Profiles so older
-- imports remain functional without becoming the source of truth.
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

  select code, employees_per_product into v_h_code, v_h_capacity
  from public.products where id = new.h_product_id;
  select code, employees_per_product into v_t_code, v_t_capacity
  from public.products where id = new.t_product_id;

  select pn.norm_per_hour into v_h_norm
  from public.product_norms pn
  where pn.product_id = new.h_product_id and pn.operation = 'HA'
  order by pn.valid_from desc, pn.created_at desc limit 1;

  select pn.norm_per_hour into v_t_norm
  from public.product_norms pn
  where pn.product_id = new.t_product_id and pn.operation = 'TUP'
  order by pn.valid_from desc, pn.created_at desc limit 1;

  perform public.sync_profile_pair(new.name, v_h_code, v_h_capacity, v_h_norm, v_t_code, v_t_capacity, v_t_norm);
  return new;
end;
$$;

drop trigger if exists trg_profile_from_legacy_family on public.product_families;
create trigger trg_profile_from_legacy_family
after insert or update of name, h_product_id, t_product_id
on public.product_families
for each row
execute function public.sync_profile_from_legacy_family();

-- Legacy product_norms writes are reflected into the corresponding current
-- Product Profile. Product Profiles remain the canonical UI/API source.
create or replace function public.sync_profile_from_legacy_norm()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text;
  v_variant text;
  v_profile_id uuid;
begin
  if pg_trigger_depth() > 1 then
    return new;
  end if;

  select code, variant_type into v_code, v_variant
  from public.products where id = new.product_id;

  if v_code is null then return new; end if;

  if v_variant = 'H' or new.operation = 'HA' then
    select id into v_profile_id
    from public.product_profiles
    where lower(regexp_replace(coalesce(ha_subassy, ''), '\\s+', '', 'g')) = lower(regexp_replace(v_code, '\\s+', '', 'g'))
      and valid_to is null
    order by valid_from desc nulls last, version_no desc nulls last, created_at desc
    limit 1;
    if v_profile_id is not null then
      update public.product_profiles set h_norm_per_hour = new.norm_per_hour where id = v_profile_id;
    end if;
  elsif v_variant = 'T' or new.operation = 'TUP' then
    select id into v_profile_id
    from public.product_profiles
    where lower(regexp_replace(coalesce(tup_subassy, ''), '\\s+', '', 'g')) = lower(regexp_replace(v_code, '\\s+', '', 'g'))
      and valid_to is null
    order by valid_from desc nulls last, version_no desc nulls last, created_at desc
    limit 1;
    if v_profile_id is not null then
      update public.product_profiles set t_norm_per_hour = new.norm_per_hour where id = v_profile_id;
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

-- Existing family records are reconciled into Product Profiles.
do $$
declare
  r record;
  h_code text;
  t_code text;
  h_cap integer;
  t_cap integer;
  h_norm numeric;
  t_norm numeric;
begin
  for r in select pf.name, pf.h_product_id, pf.t_product_id from public.product_families pf loop
    select code, employees_per_product into h_code, h_cap from public.products where id = r.h_product_id;
    select code, employees_per_product into t_code, t_cap from public.products where id = r.t_product_id;
    select pn.norm_per_hour into h_norm from public.product_norms pn where pn.product_id = r.h_product_id and pn.operation = 'HA' order by pn.valid_from desc, pn.created_at desc limit 1;
    select pn.norm_per_hour into t_norm from public.product_norms pn where pn.product_id = r.t_product_id and pn.operation = 'TUP' order by pn.valid_from desc, pn.created_at desc limit 1;
    perform public.sync_profile_pair(r.name, h_code, h_cap, h_norm, t_code, t_cap, t_norm);
  end loop;
end;
$$;

commit;
