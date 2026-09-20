-- Verze 2.02 "Interaktivní prostředí" — Fáze D: needitovatelná historie směny + ZAHÁJIT VÝROBU.
-- Nové doplňkové (iw_) tabulky. Nic z existujícího schématu se nemění.

begin;

-- # dělá: jeden needitovatelný záznam počátečního stavu směny (jen insert, nikdy update/delete)
create table if not exists public.iw_shift_snapshots (
  id uuid primary key default gen_random_uuid(),
  shift_id uuid not null references public.iw_shifts(id),
  snapshot_at timestamptz not null default now(),
  confirmed_by uuid not null,
  payload jsonb not null,
  created_at timestamptz not null default now()
);

-- # dělá: časové úseky PERSON->ČAS->PRACOVIŠTĚ->VÝROBEK->KOLEGOVÉ->VÝSLEDEK; append-only, uzavření je jediná povolená mutace
create table if not exists public.iw_shift_history_segments (
  id uuid primary key default gen_random_uuid(),
  shift_id uuid not null references public.iw_shifts(id),
  employee_id uuid not null references public.employees(id),
  workstation_id uuid not null references public.iw_workstations(id),
  production_id uuid null references public.iw_shift_productions(id),
  product_code text null,
  segment_start_at timestamptz not null,
  segment_end_at timestamptz null,
  coworker_employee_ids uuid[] not null default '{}',
  result_snapshot jsonb null,
  created_at timestamptz not null default now()
);

create index if not exists iw_shift_history_segments_shift_idx on public.iw_shift_history_segments (shift_id);
create index if not exists iw_shift_history_segments_open_idx on public.iw_shift_history_segments (shift_id, workstation_id) where segment_end_at is null;

-- Neměnnost jako druhá pojistka nezávislá na RLS: DELETE je vždy zakázáno; UPDATE smí
-- pouze uzavřít dosud otevřený segment (nastavit segment_end_at), nic jiného se měnit nesmí.
create or replace function public.iw_prevent_history_mutation()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'iw_shift_history_segments je needitovatelná historie – řádky nelze mazat';
  end if;
  if old.segment_end_at is not null then
    raise exception 'Uzavřený historický segment nelze dále měnit';
  end if;
  if new.id <> old.id or new.shift_id <> old.shift_id or new.employee_id <> old.employee_id
     or new.workstation_id <> old.workstation_id or new.segment_start_at <> old.segment_start_at
     or coalesce(new.production_id::text,'') <> coalesce(old.production_id::text,'')
     or coalesce(new.product_code,'') <> coalesce(old.product_code,'') then
    raise exception 'Historický segment lze pouze uzavřít (segment_end_at) - jiná úprava není povolena';
  end if;
  return new;
end;
$$;

drop trigger if exists iw_shift_history_segments_immutable on public.iw_shift_history_segments;
create trigger iw_shift_history_segments_immutable
  before update or delete on public.iw_shift_history_segments
  for each row execute function public.iw_prevent_history_mutation();

create or replace function public.iw_prevent_snapshot_mutation()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'iw_shift_snapshots je needitovatelná historie – řádky nelze měnit ani mazat';
end;
$$;

drop trigger if exists iw_shift_snapshots_immutable on public.iw_shift_snapshots;
create trigger iw_shift_snapshots_immutable
  before update or delete on public.iw_shift_snapshots
  for each row execute function public.iw_prevent_snapshot_mutation();

alter table public.iw_shift_snapshots enable row level security;
alter table public.iw_shift_history_segments enable row level security;

-- Jen SELECT/INSERT politiky existují - žádná UPDATE/DELETE politika = Postgres tyto příkazy
-- už sám o sobě zamítne pro všechny role (default-deny), trigger výše je druhá nezávislá pojistka.
drop policy if exists iw_shift_snapshots_select on public.iw_shift_snapshots;
create policy iw_shift_snapshots_select
  on public.iw_shift_snapshots for select to authenticated
  using (exists (
    select 1 from public.iw_shifts s join public.iw_teams t on t.id = s.team_id
    where s.id = shift_id and (public.has_role(auth.uid(), 'admin'::public.app_role) or t.team_leader_user_id = auth.uid())
  ));

drop policy if exists iw_shift_snapshots_insert on public.iw_shift_snapshots;
create policy iw_shift_snapshots_insert
  on public.iw_shift_snapshots for insert to authenticated
  with check (exists (
    select 1 from public.iw_shifts s join public.iw_teams t on t.id = s.team_id
    where s.id = shift_id and (public.has_role(auth.uid(), 'admin'::public.app_role) or t.team_leader_user_id = auth.uid())
  ));

drop policy if exists iw_shift_history_segments_select on public.iw_shift_history_segments;
create policy iw_shift_history_segments_select
  on public.iw_shift_history_segments for select to authenticated
  using (exists (
    select 1 from public.iw_shifts s join public.iw_teams t on t.id = s.team_id
    where s.id = shift_id and (public.has_role(auth.uid(), 'admin'::public.app_role) or t.team_leader_user_id = auth.uid())
  ));

drop policy if exists iw_shift_history_segments_insert on public.iw_shift_history_segments;
create policy iw_shift_history_segments_insert
  on public.iw_shift_history_segments for insert to authenticated
  with check (exists (
    select 1 from public.iw_shifts s join public.iw_teams t on t.id = s.team_id
    where s.id = shift_id and (public.has_role(auth.uid(), 'admin'::public.app_role) or t.team_leader_user_id = auth.uid())
  ));

-- # dělá: jediná sankcionovaná mutace historie - uzavře otevřený segment (pro změnu produktu uprostřed směny)
-- SECURITY DEFINER obchází RLS, proto se oprávnění k danému shift_id ověřuje explicitně uvnitř funkce.
create or replace function public.close_history_segment(p_segment_id uuid, p_ended_at timestamptz default now())
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1
    from public.iw_shift_history_segments seg
    join public.iw_shifts s on s.id = seg.shift_id
    join public.iw_teams t on t.id = s.team_id
    where seg.id = p_segment_id
      and (public.has_role(auth.uid(), 'admin'::public.app_role) or t.team_leader_user_id = auth.uid())
  ) then
    raise exception 'Nemáte oprávnění uzavřít tento historický segment';
  end if;

  update public.iw_shift_history_segments
  set segment_end_at = p_ended_at
  where id = p_segment_id and segment_end_at is null;
end;
$$;

grant execute on function public.close_history_segment(uuid, timestamptz) to authenticated;

-- # dělá: "ZAHÁJIT VÝROBU" - jedna transakce, žádná kontrola dostatečnosti obsazení, nikdy neblokuje
-- SECURITY DEFINER obchází RLS, proto se oprávnění k danému shift_id ověřuje explicitně uvnitř funkce.
create or replace function public.start_shift_production(p_shift_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
  v_confirmed_by uuid := auth.uid();
  v_payload jsonb;
  v_snapshot_id uuid;
begin
  select s.status into v_status
  from public.iw_shifts s
  join public.iw_teams t on t.id = s.team_id
  where s.id = p_shift_id
    and (public.has_role(auth.uid(), 'admin'::public.app_role) or t.team_leader_user_id = auth.uid())
  for update of s;
  if not found then
    raise exception 'Směna nenalezena nebo nemáte oprávnění ji zahájit';
  end if;
  if v_status <> 'draft' then
    raise exception 'Směnu lze zahájit pouze ze stavu draft (aktuální stav: %)', v_status;
  end if;

  select jsonb_build_object(
    'productions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'production_id', sp.id,
        'workstation_id', sp.workstation_id,
        'product_code', sp.product_code,
        'area', sp.area,
        'remaining_pieces', sp.remaining_pieces,
        'priority', sp.priority,
        'sequence_no', sp.sequence_no,
        'resolved_profile', (select to_jsonb(rp) from public.resolve_product_profile(sp.product_code, s.work_date) rp limit 1)
      ))
      from public.iw_shift_productions sp
      where sp.shift_id = p_shift_id and sp.ended_at is null
    ), '[]'::jsonb),
    'assignments', coalesce((
      select jsonb_agg(jsonb_build_object(
        'employee_id', a.employee_id, 'workstation_id', a.workstation_id, 'production_id', a.production_id,
        'assignment_type', a.assignment_type, 'is_manual_override', a.is_manual_override
      ))
      from public.iw_shift_assignments a where a.shift_id = p_shift_id
    ), '[]'::jsonb),
    'temp_operators', coalesce((
      select jsonb_agg(jsonb_build_object('employee_id', t.employee_id, 'added_reason', t.added_reason))
      from public.iw_shift_temp_operators t where t.shift_id = p_shift_id
    ), '[]'::jsonb),
    'confirmed_by', v_confirmed_by,
    'snapshot_at', now()
  )
  into v_payload
  from public.iw_shifts s
  where s.id = p_shift_id;

  insert into public.iw_shift_snapshots (shift_id, confirmed_by, payload)
  values (p_shift_id, v_confirmed_by, v_payload)
  returning id into v_snapshot_id;

  insert into public.iw_shift_history_segments (shift_id, employee_id, workstation_id, production_id, product_code, segment_start_at, coworker_employee_ids)
  select
    a.shift_id, a.employee_id, a.workstation_id, a.production_id, sp.product_code, now(),
    coalesce((
      select array_agg(a2.employee_id) from public.iw_shift_assignments a2
      where a2.shift_id = a.shift_id and a2.workstation_id = a.workstation_id and a2.employee_id <> a.employee_id
    ), '{}'::uuid[])
  from public.iw_shift_assignments a
  left join public.iw_shift_productions sp on sp.id = a.production_id
  where a.shift_id = p_shift_id and a.workstation_id is not null;

  update public.iw_shifts set status = 'started', started_at = now(), started_by = v_confirmed_by where id = p_shift_id;

  return jsonb_build_object('snapshot_id', v_snapshot_id, 'shift_id', p_shift_id);
end;
$$;

grant execute on function public.start_shift_production(uuid) to authenticated;

commit;
