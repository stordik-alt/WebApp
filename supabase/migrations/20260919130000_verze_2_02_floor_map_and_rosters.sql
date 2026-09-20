-- Verze 2.02 "Interaktivní prostředí" — Fáze A: fixní mapa haly, týdenní tým TL, omezení pracovišť.
-- Toto jsou zcela nové, doplňkové (iw_) tabulky. Nic z existujícího schématu se nemění.
-- iw_workstations je best-effort rekonstrukce reálného rozložení haly (audit workplaces/daily_records),
-- protože žádná Delta/Ersa/Olovo mapa v databázi dosud neexistovala — je adminem editovatelná a opravitelná.

begin;

-- # dělá: fixní mapa pracovišť (HA/TUP/sekundární), seskupená podle reálné linky
create table if not exists public.iw_workstations (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  workplace_id uuid null references public.workplaces(id) on delete set null,
  area text not null check (area in ('HA', 'TUP', 'BOTH', 'SECONDARY')),
  group_name text not null,
  display_name text not null,
  sort_order int not null default 0,
  requires_ha_qual boolean not null default false,
  requires_tup_qual boolean not null default false,
  is_secondary boolean not null default false,
  active boolean not null default true,
  note text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists iw_workstations_group_idx on public.iw_workstations (group_name);
create index if not exists iw_workstations_area_idx on public.iw_workstations (area);

-- # dělá: týdenní základní tým jednoho Team Leadera (jeden aktivní tým na TL)
create table if not exists public.iw_teams (
  id uuid primary key default gen_random_uuid(),
  team_leader_user_id uuid not null,
  name text not null default 'Základní tým',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists iw_teams_one_active_per_leader
  on public.iw_teams (team_leader_user_id)
  where active;

-- # dělá: členové základního týdenního týmu (mění se jen administrativně, ne za jednotlivou směnu)
create table if not exists public.iw_team_members (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.iw_teams(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  added_at timestamptz not null default now(),
  unique (team_id, employee_id)
);

-- # dělá: výjimka pro KONKRÉTNÍ směnu (přidat/odebrat); nikdy nezapisuje do iw_team_members
create table if not exists public.iw_shift_exceptions (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.iw_teams(id) on delete cascade,
  work_date date not null,
  shift text not null check (shift in ('Ranní', 'Odpolední', 'Noční')),
  employee_id uuid not null references public.employees(id) on delete cascade,
  exception_type text not null check (exception_type in ('add', 'remove')),
  reason text null,
  created_by uuid null,
  created_at timestamptz not null default now(),
  unique (team_id, work_date, shift, employee_id)
);

-- # dělá: per-zaměstnanec zákaz konkrétního pracoviště (např. TESTY ze zdravotních důvodů); důvod se neeviduje
create table if not exists public.iw_workstation_restrictions (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  workstation_id uuid not null references public.iw_workstations(id) on delete cascade,
  restriction_type text not null default 'excluded',
  reason text null,
  created_by uuid null,
  created_at timestamptz not null default now(),
  unique (employee_id, workstation_id)
);

-- Sdílená updated_at trigger funkce už existuje (public.set_updated_at) — znovu použít, nevytvářet duplicitní.
drop trigger if exists iw_workstations_updated_at on public.iw_workstations;
create trigger iw_workstations_updated_at
  before update on public.iw_workstations
  for each row execute function public.set_updated_at();

drop trigger if exists iw_teams_updated_at on public.iw_teams;
create trigger iw_teams_updated_at
  before update on public.iw_teams
  for each row execute function public.set_updated_at();

-- RLS: čtení pro všechny přihlášené (floor mapa je referenční), zápis podle role/vlastnictví.
alter table public.iw_workstations enable row level security;
alter table public.iw_teams enable row level security;
alter table public.iw_team_members enable row level security;
alter table public.iw_shift_exceptions enable row level security;
alter table public.iw_workstation_restrictions enable row level security;

drop policy if exists iw_workstations_select_authenticated on public.iw_workstations;
create policy iw_workstations_select_authenticated
  on public.iw_workstations for select to authenticated using (true);

drop policy if exists iw_workstations_insert_admin on public.iw_workstations;
create policy iw_workstations_insert_admin
  on public.iw_workstations for insert to authenticated
  with check (public.has_role(auth.uid(), 'admin'::public.app_role));

drop policy if exists iw_workstations_update_admin on public.iw_workstations;
create policy iw_workstations_update_admin
  on public.iw_workstations for update to authenticated
  using (public.has_role(auth.uid(), 'admin'::public.app_role))
  with check (public.has_role(auth.uid(), 'admin'::public.app_role));

drop policy if exists iw_workstations_delete_admin on public.iw_workstations;
create policy iw_workstations_delete_admin
  on public.iw_workstations for delete to authenticated
  using (public.has_role(auth.uid(), 'admin'::public.app_role));

-- iw_teams: admin vidí/spravuje vše, team_leader jen svůj vlastní tým.
drop policy if exists iw_teams_select on public.iw_teams;
create policy iw_teams_select
  on public.iw_teams for select to authenticated
  using (public.has_role(auth.uid(), 'admin'::public.app_role) or team_leader_user_id = auth.uid());

drop policy if exists iw_teams_insert on public.iw_teams;
create policy iw_teams_insert
  on public.iw_teams for insert to authenticated
  with check (public.has_role(auth.uid(), 'admin'::public.app_role) or team_leader_user_id = auth.uid());

drop policy if exists iw_teams_update on public.iw_teams;
create policy iw_teams_update
  on public.iw_teams for update to authenticated
  using (public.has_role(auth.uid(), 'admin'::public.app_role) or team_leader_user_id = auth.uid())
  with check (public.has_role(auth.uid(), 'admin'::public.app_role) or team_leader_user_id = auth.uid());

drop policy if exists iw_teams_delete on public.iw_teams;
create policy iw_teams_delete
  on public.iw_teams for delete to authenticated
  using (public.has_role(auth.uid(), 'admin'::public.app_role) or team_leader_user_id = auth.uid());

-- iw_team_members / iw_shift_exceptions: přístup odvozen od vlastnictví rodičovského týmu.
drop policy if exists iw_team_members_all on public.iw_team_members;
create policy iw_team_members_all
  on public.iw_team_members for all to authenticated
  using (exists (
    select 1 from public.iw_teams t
    where t.id = team_id
      and (public.has_role(auth.uid(), 'admin'::public.app_role) or t.team_leader_user_id = auth.uid())
  ))
  with check (exists (
    select 1 from public.iw_teams t
    where t.id = team_id
      and (public.has_role(auth.uid(), 'admin'::public.app_role) or t.team_leader_user_id = auth.uid())
  ));

drop policy if exists iw_shift_exceptions_all on public.iw_shift_exceptions;
create policy iw_shift_exceptions_all
  on public.iw_shift_exceptions for all to authenticated
  using (exists (
    select 1 from public.iw_teams t
    where t.id = team_id
      and (public.has_role(auth.uid(), 'admin'::public.app_role) or t.team_leader_user_id = auth.uid())
  ))
  with check (exists (
    select 1 from public.iw_teams t
    where t.id = team_id
      and (public.has_role(auth.uid(), 'admin'::public.app_role) or t.team_leader_user_id = auth.uid())
  ));

-- iw_workstation_restrictions: admin nebo team_leader (operativní správa způsobilosti pro TESTY/PREP).
drop policy if exists iw_workstation_restrictions_select on public.iw_workstation_restrictions;
create policy iw_workstation_restrictions_select
  on public.iw_workstation_restrictions for select to authenticated
  using (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    or public.has_role(auth.uid(), 'team_leader'::public.app_role)
  );

drop policy if exists iw_workstation_restrictions_write on public.iw_workstation_restrictions;
create policy iw_workstation_restrictions_write
  on public.iw_workstation_restrictions for all to authenticated
  using (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    or public.has_role(auth.uid(), 'team_leader'::public.app_role)
  )
  with check (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    or public.has_role(auth.uid(), 'team_leader'::public.app_role)
  );

-- Best-effort seed dat mapy haly, rekonstruováno z reálných workplaces/daily_records (viz audit).
-- Skutečná Delta/Ersa/Olovo mapa v databázi předtím neexistovala; skupiny L1≈Delta a L3≈Ersa jsou
-- pracovní pojmenování dokud je administrátor přes UI (Fáze A) nepotvrdí/neopraví.
insert into public.iw_workstations
  (code, workplace_id, area, group_name, display_name, sort_order, requires_ha_qual, requires_tup_qual, is_secondary, note)
values
  ('041.01', (select id from public.workplaces where code = '041.01'), 'HA', 'L1 (Delta)', 'L1/4 HF (HA)', 10, true, false, false, null),
  ('050.15', (select id from public.workplaces where code = '050.15'), 'TUP', 'L1 (Delta)', 'L1/4 HF (TUP)', 11, false, true, false, null),
  ('041.02', (select id from public.workplaces where code = '041.02'), 'HA', 'L1 (Delta)', 'L1/1_1 OPF (HA)', 12, true, false, false, null),
  ('SYN.TUP.L1_1_1', null, 'TUP', 'L1 (Delta)', 'L1/1_1 OPF (TUP)', 13, false, true, false,
    'Odvozeno z nezmapovaného řádku "TouchUp L1 /1_1 - OPF" v daily_records — nemá dosud vlastní workplaces.code, ověřit a doplnit skutečný kód produktu.'),
  ('041.04', (select id from public.workplaces where code = '041.04'), 'HA', 'L1 (Delta)', 'L1/3 (HA)', 14, true, false, false,
    'V reálných datech nemá párový TUP záznam — ověřit u team leadera, zda je to očekávané.'),
  ('041.06', (select id from public.workplaces where code = '041.06'), 'HA', 'L3 (Ersa)', 'L3/1 el.WI (HA)', 20, true, false, false, null),
  ('050.13', (select id from public.workplaces where code = '050.13'), 'TUP', 'L3 (Ersa)', 'L3/1 (TUP)', 21, false, true, false, null),
  ('041.07', (select id from public.workplaces where code = '041.07'), 'HA', 'L3 (Ersa)', 'L3/2 el.WI (HA)', 22, true, false, false,
    'V reálných datech nemá párový TUP záznam — ověřit u team leadera, zda je to očekávané.'),
  ('041.08', (select id from public.workplaces where code = '041.08'), 'HA', 'L3 (Ersa)', 'L3/3 (HA)', 23, true, false, false,
    'V reálných datech nemá párový TUP záznam — ověřit u team leadera, zda je to očekávané.'),
  ('041.09', (select id from public.workplaces where code = '041.09'), 'HA', 'L3 (Ersa)', 'L3/4 el.WI (HA)', 24, true, false, false, null),
  ('050.02', (select id from public.workplaces where code = '050.02'), 'TUP', 'L3 (Ersa)', 'L3/4 (TUP)', 25, false, true, false, null),
  ('041.05', (select id from public.workplaces where code = '041.05'), 'HA', 'Olovo', 'Olovo (HA)', 30, true, false, false, null),
  ('SYN.TUP.OLOVO1', null, 'TUP', 'Olovo', 'Olovo TUP 1 (krátká linka 1)', 31, false, true, false,
    'Odvozeno z nezmapovaného řádku "kratka linka 1" v daily_records — ověřit skutečný kód produktu; spolu s 050.10 tvoří Olovo 1×HA+2×TUP dle zadání.'),
  ('050.10', (select id from public.workplaces where code = '050.10'), 'TUP', 'Olovo', 'Olovo TUP 2 (krátká linka 2)', 32, false, true, false, null),
  ('SEC.TESTY', null, 'SECONDARY', 'Sekundární', 'TESTY', 90, false, false, true, null),
  ('SEC.PREP', null, 'SECONDARY', 'Sekundární', 'PREP', 91, false, false, true, null)
on conflict (code) do nothing;

commit;
