-- Verze 2.02 "Interaktivní prostředí" — Fáze B: kapacita výroby a výpočet dokončení.
-- Nové doplňkové (iw_) tabulky pro nastavení směny a aktivní výroby. Kapacita a norma
-- se NEUKLÁDAJÍ zde – vždy se dotahují živě přes resolve_product_profile(), aby
-- product_profiles zůstal jediným zdrojem pravdy (zamrznou se až v Fázi D při ZAHÁJIT VÝROBU).

begin;

-- # dělá: jedna připravovaná/zahájená směna (draft -> started -> locked, viz Fáze D)
create table if not exists public.iw_shifts (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.iw_teams(id) on delete cascade,
  work_date date not null,
  shift text not null check (shift in ('Ranní', 'Odpolední', 'Noční')),
  status text not null default 'draft' check (status in ('draft', 'started', 'locked')),
  started_at timestamptz null,
  started_by uuid null,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (team_id, work_date, shift)
);

-- # dělá: jedna aktivní výroba na pracovišti v rámci směny; sequence_no/ended_at umožní
-- zaznamenat změnu produktu uprostřed směny, aniž by se předchozí záznam přepsal
create table if not exists public.iw_shift_productions (
  id uuid primary key default gen_random_uuid(),
  shift_id uuid not null references public.iw_shifts(id) on delete cascade,
  workstation_id uuid not null references public.iw_workstations(id),
  product_code text not null,
  area text not null check (area in ('HA', 'TUP')),
  remaining_pieces integer not null check (remaining_pieces >= 0),
  priority integer null,
  sequence_no integer not null default 1,
  started_at timestamptz not null default now(),
  ended_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists iw_shift_productions_shift_idx on public.iw_shift_productions (shift_id);
create index if not exists iw_shift_productions_active_idx on public.iw_shift_productions (workstation_id) where ended_at is null;

drop trigger if exists iw_shifts_updated_at on public.iw_shifts;
create trigger iw_shifts_updated_at
  before update on public.iw_shifts
  for each row execute function public.set_updated_at();

drop trigger if exists iw_shift_productions_updated_at on public.iw_shift_productions;
create trigger iw_shift_productions_updated_at
  before update on public.iw_shift_productions
  for each row execute function public.set_updated_at();

alter table public.iw_shifts enable row level security;
alter table public.iw_shift_productions enable row level security;

-- Přístup ke směně je odvozen od vlastnictví týmu (admin vždy, TL jen svůj tým) – stejný vzor jako Fáze A.
drop policy if exists iw_shifts_all on public.iw_shifts;
create policy iw_shifts_all
  on public.iw_shifts for all to authenticated
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

drop policy if exists iw_shift_productions_all on public.iw_shift_productions;
create policy iw_shift_productions_all
  on public.iw_shift_productions for all to authenticated
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
