begin;

-- Product Profiles are the authoritative source for active HA/TUP profile data.
-- Existing historical/incomplete rows are tolerated during migration, while all
-- new rows and updates are required to contain complete positive values.
alter table public.product_profiles
  add constraint product_profiles_active_complete_check
  check (
    valid_to is not null
    or (
      nullif(trim(coalesce(ha_subassy, '')), '') is not null
      and nullif(trim(coalesce(tup_subassy, '')), '') is not null
      and h_capacity is not null and h_capacity >= 1
      and t_capacity is not null and t_capacity >= 1
      and h_norm_per_hour is not null and h_norm_per_hour > 0
      and t_norm_per_hour is not null and t_norm_per_hour > 0
    )
  ) not valid;

-- Product Profiles are configuration/master data. Keep them readable by all
-- authenticated users, but restrict mutations to administrators.
alter table public.product_profiles enable row level security;

drop policy if exists "Authenticated users can insert product profiles" on public.product_profiles;
drop policy if exists "Authenticated users can update product profiles" on public.product_profiles;
drop policy if exists "Authenticated users can delete product profiles" on public.product_profiles;
drop policy if exists "product_profiles_insert_authenticated" on public.product_profiles;
drop policy if exists "product_profiles_update_authenticated" on public.product_profiles;
drop policy if exists "product_profiles_delete_authenticated" on public.product_profiles;

create policy "Administrators can insert product profiles"
  on public.product_profiles for insert
  to authenticated
  with check (public.has_role(auth.uid(), 'admin'::public.app_role));

create policy "Administrators can update product profiles"
  on public.product_profiles for update
  to authenticated
  using (public.has_role(auth.uid(), 'admin'::public.app_role))
  with check (public.has_role(auth.uid(), 'admin'::public.app_role));

create policy "Administrators can delete product profiles"
  on public.product_profiles for delete
  to authenticated
  using (public.has_role(auth.uid(), 'admin'::public.app_role));

commit;
