-- Verze 2.02 "Interaktivní prostředí" — podpora více pojmenovaných týmů na Team Leadera.
-- TL si dopředu připraví víc týmů (např. různé směnové osádky) a pro konkrétní
-- směnu si vybere, který použije. Nahrazuje dřívější omezení "jeden aktivní tým na TL".

begin;

drop index if exists public.iw_teams_one_active_per_leader;

-- Název týmu musí být v rámci jednoho TL unikátní (ne globálně) - pomáhá při výběru v UI.
create unique index if not exists iw_teams_unique_name_per_leader
  on public.iw_teams (team_leader_user_id, name)
  where active;

commit;
