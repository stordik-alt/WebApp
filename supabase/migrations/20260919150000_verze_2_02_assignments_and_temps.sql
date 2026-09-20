-- Verze 2.02 "Interaktivní prostředí" — Fáze C: přiřazení operátorů + dočasní operátoři.
-- Nové doplňkové (iw_) tabulky. Nic z existujícího schématu se nemění.

begin;

-- # dělá: jedno přiřazení zaměstnance na pracoviště/výrobu v rámci směny (hlavní/sekundární/dočasný)
create table if not exists public.iw_shift_assignments (
  id uuid primary key default gen_random_uuid(),
  shift_id uuid not null references public.iw_shifts(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  workstation_id uuid null references public.iw_workstations(id),
  production_id uuid null references public.iw_shift_productions(id),
  assignment_type text not null default 'main' check (assignment_type in ('main', 'secondary', 'temp')),
  is_manual_override boolean not null default false,
  suggested_workstation_id uuid null references public.iw_workstations(id),
  assigned_at timestamptz not null default now(),
  unique (shift_id, employee_id)
);

create index if not exists iw_shift_assignments_shift_idx on public.iw_shift_assignments (shift_id);
create index if not exists iw_shift_assignments_workstation_idx on public.iw_shift_assignments (workstation_id);

-- # dělá: dočasný operátor přidaný pro tuto směnu (employees.is_temporary=true, jméno nemusí být předem známé)
create table if not exists public.iw_shift_temp_operators (
  id uuid primary key default gen_random_uuid(),
  shift_id uuid not null references public.iw_shifts(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  added_reason text null,
  added_by uuid null,
  added_at timestamptz not null default now(),
  unique (shift_id, employee_id)
);

alter table public.iw_shift_assignments enable row level security;
alter table public.iw_shift_temp_operators enable row level security;

-- Přístup odvozen od vlastnictví týmu, stejný vzor jako iw_shifts/iw_shift_productions.
drop policy if exists iw_shift_assignments_all on public.iw_shift_assignments;
create policy iw_shift_assignments_all
  on public.iw_shift_assignments for all to authenticated
  using (exists (
    select 1 from public.iw_shifts s
    join public.iw_teams t on t.id = s.team_id
    where s.id = shift_id
      and (public.has_role(auth.uid(), 'admin'::public.app_role) or t.team_leader_user_id = auth.uid())
  ))
  with check (exists (
    select 1 from public.iw_shifts s
    join public.iw_teams t on t.id = s.team_id
    where s.id = shift_id
      and (public.has_role(auth.uid(), 'admin'::public.app_role) or t.team_leader_user_id = auth.uid())
  ));

drop policy if exists iw_shift_temp_operators_all on public.iw_shift_temp_operators;
create policy iw_shift_temp_operators_all
  on public.iw_shift_temp_operators for all to authenticated
  using (exists (
    select 1 from public.iw_shifts s
    join public.iw_teams t on t.id = s.team_id
    where s.id = shift_id
      and (public.has_role(auth.uid(), 'admin'::public.app_role) or t.team_leader_user_id = auth.uid())
  ))
  with check (exists (
    select 1 from public.iw_shifts s
    join public.iw_teams t on t.id = s.team_id
    where s.id = shift_id
      and (public.has_role(auth.uid(), 'admin'::public.app_role) or t.team_leader_user_id = auth.uid())
  ));

commit;
