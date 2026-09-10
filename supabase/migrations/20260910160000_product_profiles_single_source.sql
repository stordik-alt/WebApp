begin;

-- Product Profiles replace product_families as the application-level pairing model.
-- One row represents one HA/TUP profile version. Existing columns keep the
-- imported Product ID values, while the added fields provide a real profile
-- name and versioned validity/history.
alter table public.product_profiles
  add column if not exists profile_name text,
  add column if not exists valid_from date,
  add column if not exists valid_to date,
  add column if not exists version_no integer;

update public.product_profiles
set valid_from = coalesce(valid_from, current_date),
    version_no = coalesce(version_no, 1)
where valid_from is null or version_no is null;

alter table public.product_profiles
  alter column valid_from set default current_date,
  alter column version_no set default 1;

-- Stable lookup key for the pair, independent of spaces and letter case.
-- History is kept by valid_from/version_no, so multiple versions may exist.
alter table public.product_profiles
  add column if not exists profile_key text generated always as (
    lower(regexp_replace(coalesce(ha_subassy, ''), '\\s+', '', 'g')) || '|' ||
    lower(regexp_replace(coalesce(tup_subassy, ''), '\\s+', '', 'g'))
  ) stored;

create index if not exists product_profiles_key_idx
  on public.product_profiles (profile_key);

create index if not exists product_profiles_validity_idx
  on public.product_profiles (valid_from desc, valid_to);

-- Populate the new source-of-truth table from the legacy family model once.
-- After this migration the frontend no longer depends on product_families.
insert into public.product_profiles (
  id,
  profile_name,
  ha_subassy,
  h_capacity,
  h_norm_per_hour,
  tup_subassy,
  t_capacity,
  t_norm_per_hour,
  valid_from,
  valid_to,
  version_no
)
select
  gen_random_uuid(),
  pf.name,
  hp.code,
  hp.employees_per_product,
  (
    select pn.norm_per_hour
    from public.product_norms pn
    where pn.product_id = hp.id and pn.operation = 'HA'
    order by pn.valid_from desc, pn.created_at desc
    limit 1
  ),
  tp.code,
  tp.employees_per_product,
  (
    select pn.norm_per_hour
    from public.product_norms pn
    where pn.product_id = tp.id and pn.operation = 'TUP'
    order by pn.valid_from desc, pn.created_at desc
    limit 1
  ),
  current_date,
  null,
  1
from public.product_families pf
join public.products hp on hp.id = pf.h_product_id
join public.products tp on tp.id = pf.t_product_id
where not exists (
  select 1
  from public.product_profiles pp
  where lower(regexp_replace(coalesce(pp.ha_subassy, ''), '\\s+', '', 'g')) = lower(regexp_replace(coalesce(hp.code, ''), '\\s+', '', 'g'))
    and lower(regexp_replace(coalesce(pp.tup_subassy, ''), '\\s+', '', 'g')) = lower(regexp_replace(coalesce(tp.code, ''), '\\s+', '', 'g'))
    and pp.valid_to is null
);

-- Ensure the existing profile rows have a useful display name when possible.
update public.product_profiles pp
set profile_name = coalesce(
  pp.profile_name,
  hp.name,
  tp.name,
  nullif(pp.ha_subassy, ''),
  nullif(pp.tup_subassy, '')
)
from public.products hp
left join public.products tp
  on lower(regexp_replace(coalesce(tp.code, ''), '\\s+', '', 'g')) = lower(regexp_replace(coalesce(pp.tup_subassy, ''), '\\s+', '', 'g'))
where lower(regexp_replace(coalesce(hp.code, ''), '\\s+', '', 'g')) = lower(regexp_replace(coalesce(pp.ha_subassy, ''), '\\s+', '', 'g'))
  and pp.profile_name is null;

-- Keep Product Profiles readable to authenticated users. The application now
-- treats this table as the source of truth for HA/TUP pairing, both norms and capacities.
alter table public.product_profiles enable row level security;
drop policy if exists "Authenticated users can read product profiles" on public.product_profiles;
create policy "Authenticated users can read product profiles"
  on public.product_profiles for select
  to authenticated
  using (true);

drop policy if exists "Authenticated users can insert product profiles" on public.product_profiles;
create policy "Authenticated users can insert product profiles"
  on public.product_profiles for insert
  to authenticated
  with check (true);

drop policy if exists "Authenticated users can update product profiles" on public.product_profiles;
create policy "Authenticated users can update product profiles"
  on public.product_profiles for update
  to authenticated
  using (true)
  with check (true);

drop policy if exists "Authenticated users can delete product profiles" on public.product_profiles;
create policy "Authenticated users can delete product profiles"
  on public.product_profiles for delete
  to authenticated
  using (true);

grant select, insert, update, delete on table public.product_profiles to authenticated;

commit;
