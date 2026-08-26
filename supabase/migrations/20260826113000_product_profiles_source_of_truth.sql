begin;

-- Product Profile is the single source of truth for the 3rd OCR sequence.
-- The table intentionally stores both sides of one product profile in one row.
create table if not exists public.product_profiles (
  id uuid primary key default gen_random_uuid(),
  ha_subassy text,
  h_capacity integer,
  h_norm_per_hour numeric(12, 3),
  tup_subassy text,
  t_capacity integer,
  t_norm_per_hour numeric(12, 3),
  constraint product_profiles_h_capacity_positive check (h_capacity is null or h_capacity > 0),
  constraint product_profiles_t_capacity_positive check (t_capacity is null or t_capacity > 0),
  constraint product_profiles_h_norm_positive check (h_norm_per_hour is null or h_norm_per_hour > 0),
  constraint product_profiles_t_norm_positive check (t_norm_per_hour is null or t_norm_per_hour > 0)
);

-- Keep the exposed table readable only to signed-in users. The 3rd sequence
-- also reads it server-side through the service role.
alter table public.product_profiles enable row level security;

drop policy if exists "Authenticated users can read product profiles" on public.product_profiles;
create policy "Authenticated users can read product profiles"
  on public.product_profiles
  for select
  to authenticated
  using (true);

grant select on table public.product_profiles to authenticated;

-- Synchronize one profile row from the existing product/product_families and
-- product_norms model. This keeps the legacy tables compatible while making
-- product_profiles authoritative for hourly OCR.
create or replace function public.sync_product_profile(p_product_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_family_id uuid;
  v_variant text;
  v_code text;
  v_h_id uuid;
  v_t_id uuid;
  v_h_code text;
  v_t_code text;
  v_h_capacity integer;
  v_t_capacity integer;
  v_h_norm numeric;
  v_t_norm numeric;
begin
  select family_id, variant_type, code
    into v_family_id, v_variant, v_code
  from public.products
  where id = p_product_id;

  if not found then
    return;
  end if;

  if v_family_id is not null then
    select h_product_id, t_product_id
      into v_h_id, v_t_id
    from public.product_families
    where id = v_family_id;

    select code, employees_per_product
      into v_h_code, v_h_capacity
    from public.products
    where id = v_h_id;

    select code, employees_per_product
      into v_t_code, v_t_capacity
    from public.products
    where id = v_t_id;

    select pn.norm_per_hour
      into v_h_norm
    from public.product_norms pn
    where pn.product_id = v_h_id
      and pn.operation = 'HA'
      and pn.valid_from <= current_date
      and (pn.valid_to is null or pn.valid_to >= current_date)
    order by pn.valid_from desc, pn.created_at desc
    limit 1;

    select pn.norm_per_hour
      into v_t_norm
    from public.product_norms pn
    where pn.product_id = v_t_id
      and pn.operation = 'TUP'
      and pn.valid_from <= current_date
      and (pn.valid_to is null or pn.valid_to >= current_date)
    order by pn.valid_from desc, pn.created_at desc
    limit 1;

    insert into public.product_profiles (
      id, ha_subassy, h_capacity, h_norm_per_hour,
      tup_subassy, t_capacity, t_norm_per_hour
    ) values (
      v_family_id, v_h_code, v_h_capacity, v_h_norm,
      v_t_code, v_t_capacity, v_t_norm
    )
    on conflict (id) do update set
      ha_subassy = excluded.ha_subassy,
      h_capacity = excluded.h_capacity,
      h_norm_per_hour = excluded.h_norm_per_hour,
      tup_subassy = excluded.tup_subassy,
      t_capacity = excluded.t_capacity,
      t_norm_per_hour = excluded.t_norm_per_hour;

    return;
  end if;

  -- Standalone products are still represented as a profile row. The variant
  -- column is authoritative here; a code prefix is deliberately not used.
  if v_variant = 'T' then
    select v_code, employees_per_product
      into v_t_code, v_t_capacity
    from public.products
    where id = p_product_id;

    select pn.norm_per_hour
      into v_t_norm
    from public.product_norms pn
    where pn.product_id = p_product_id
      and pn.operation = 'TUP'
      and pn.valid_from <= current_date
      and (pn.valid_to is null or pn.valid_to >= current_date)
    order by pn.valid_from desc, pn.created_at desc
    limit 1;
  else
    select v_code, employees_per_product
      into v_h_code, v_h_capacity
    from public.products
    where id = p_product_id;

    select pn.norm_per_hour
      into v_h_norm
    from public.product_norms pn
    where pn.product_id = p_product_id
      and pn.operation = 'HA'
      and pn.valid_from <= current_date
      and (pn.valid_to is null or pn.valid_to >= current_date)
    order by pn.valid_from desc, pn.created_at desc
    limit 1;
  end if;

  insert into public.product_profiles (
    id, ha_subassy, h_capacity, h_norm_per_hour,
    tup_subassy, t_capacity, t_norm_per_hour
  ) values (
    p_product_id, v_h_code, v_h_capacity, v_h_norm,
    v_t_code, v_t_capacity, v_t_norm
  )
  on conflict (id) do update set
    ha_subassy = excluded.ha_subassy,
    h_capacity = excluded.h_capacity,
    h_norm_per_hour = excluded.h_norm_per_hour,
    tup_subassy = excluded.tup_subassy,
    t_capacity = excluded.t_capacity,
    t_norm_per_hour = excluded.t_norm_per_hour;
end;
$$;

-- Product changes update codes/capacities in the profile.
drop trigger if exists trg_sync_product_profile_products on public.products;
create trigger trg_sync_product_profile_products
after insert or update of code, employees_per_product, family_id, variant_type
on public.products
for each row
execute function public.sync_product_profile(new.id);

-- Norm changes update the corresponding profile norm.
drop trigger if exists trg_sync_product_profile_norms on public.product_norms;
create trigger trg_sync_product_profile_norms
after insert or update of product_id, operation, norm_per_hour, valid_from, valid_to
on public.product_norms
for each row
execute function public.sync_product_profile(new.product_id);

-- Family creation/re-linking can change both sides of the profile.
create or replace function public.sync_product_profile_family()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.h_product_id is not null then
    perform public.sync_product_profile(new.h_product_id);
  end if;
  if new.t_product_id is not null then
    perform public.sync_product_profile(new.t_product_id);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_sync_product_profile_families on public.product_families;
create trigger trg_sync_product_profile_families
after insert or update of h_product_id, t_product_id
on public.product_families
for each row
execute function public.sync_product_profile_family();

-- Backfill existing profiles from the current Product ID + norm data. This
-- intentionally replaces stale profile values (for example an old OCR value
-- of 83) with the currently stored Product Profile norm (for example 96).
do $$
declare
  r record;
begin
  for r in select id, h_product_id, t_product_id from public.product_families loop
    if r.h_product_id is not null then
      perform public.sync_product_profile(r.h_product_id);
    end if;
    if r.t_product_id is not null then
      perform public.sync_product_profile(r.t_product_id);
    end if;
  end loop;
end;
$$;

commit;
