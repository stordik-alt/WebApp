-- Simplified product profile model for HA/TUP subassemblies.
-- A subassembly code is independent of the HA/TUP role; both sides may use the same code.

create table if not exists public.product_profiles (
  id uuid primary key default gen_random_uuid(),
  ha_subassy text,
  h_capacity numeric not null default 0,
  h_norm_per_hour numeric not null default 0,
  tup_subassy text,
  t_capacity numeric not null default 0,
  t_norm_per_hour numeric not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists product_profiles_ha_subassy_idx
  on public.product_profiles (ha_subassy);

create index if not exists product_profiles_tup_subassy_idx
  on public.product_profiles (tup_subassy);

alter table public.product_profiles enable row level security;

-- Authenticated users can manage product profiles used by the application.
drop policy if exists "product_profiles_select_authenticated" on public.product_profiles;
create policy "product_profiles_select_authenticated"
  on public.product_profiles for select
  to authenticated
  using (true);

drop policy if exists "product_profiles_insert_authenticated" on public.product_profiles;
create policy "product_profiles_insert_authenticated"
  on public.product_profiles for insert
  to authenticated
  with check (true);

drop policy if exists "product_profiles_update_authenticated" on public.product_profiles;
create policy "product_profiles_update_authenticated"
  on public.product_profiles for update
  to authenticated
  using (true)
  with check (true);

drop policy if exists "product_profiles_delete_authenticated" on public.product_profiles;
create policy "product_profiles_delete_authenticated"
  on public.product_profiles for delete
  to authenticated
  using (true);

-- Keep updated_at current when a profile is edited.
create or replace function public.set_product_profiles_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists product_profiles_updated_at on public.product_profiles;
create trigger product_profiles_updated_at
before update on public.product_profiles
for each row execute function public.set_product_profiles_updated_at();
