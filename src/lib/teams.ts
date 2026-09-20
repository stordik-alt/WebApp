import { supabase } from "@/integrations/supabase/client";

/**
 * Týdenní základní tým Team Leadera + výjimky pro konkrétní směnu.
 * Výjimka nikdy nemění `iw_team_members` – platí jen pro daný work_date+shift.
 */
export type IwShiftName = "Ranní" | "Odpolední" | "Noční";

export type IwTeam = {
  id: string;
  team_leader_user_id: string;
  name: string;
  active: boolean;
  created_at: string;
  updated_at: string;
};

export type IwTeamMember = {
  id: string;
  team_id: string;
  employee_id: string;
  added_at: string;
};

export type IwShiftExceptionType = "add" | "remove";

export type IwShiftException = {
  id: string;
  team_id: string;
  work_date: string;
  shift: IwShiftName;
  employee_id: string;
  exception_type: IwShiftExceptionType;
  reason: string | null;
  created_by: string | null;
  created_at: string;
};

// # dělá: načte všechny aktivní týmy daného TL (TL si jich může předem připravit víc, např. různé osádky)
export async function listTeamsForLeader(teamLeaderUserId: string): Promise<IwTeam[]> {
  const { data, error } = await supabase
    .from("iw_teams")
    .select("*")
    .eq("team_leader_user_id", teamLeaderUserId)
    .eq("active", true)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as IwTeam[];
}

// # dělá: vytvoří nový pojmenovaný tým pro TL (nekontroluje duplicity - unikátní jméno hlídá DB index)
export async function createTeam(teamLeaderUserId: string, name: string): Promise<IwTeam> {
  const { data, error } = await supabase
    .from("iw_teams")
    .insert({ team_leader_user_id: teamLeaderUserId, name })
    .select("*")
    .single();
  if (error) throw error;
  return data as IwTeam;
}

// # dělá: zajistí, že TL má alespoň jeden tým (bootstrap pro nové uživatele); jinak vrátí existující seznam beze změny
export async function ensureAtLeastOneTeam(teamLeaderUserId: string): Promise<IwTeam[]> {
  const existing = await listTeamsForLeader(teamLeaderUserId);
  if (existing.length > 0) return existing;
  const created = await createTeam(teamLeaderUserId, "Tým 1");
  return [created];
}

// # dělá: načte členy základního týdenního týmu
export async function listTeamMembers(teamId: string): Promise<IwTeamMember[]> {
  const { data, error } = await supabase.from("iw_team_members").select("*").eq("team_id", teamId);
  if (error) throw error;
  return (data ?? []) as IwTeamMember[];
}

// # dělá: přidá zaměstnance do základního týmu (administrativní změna, ne výjimka pro směnu)
export async function addTeamMember(teamId: string, employeeId: string): Promise<void> {
  const { error } = await supabase.from("iw_team_members").insert({ team_id: teamId, employee_id: employeeId });
  if (error) throw error;
}

// # dělá: odebere zaměstnance ze základního týmu (administrativní změna, ne výjimka pro směnu)
export async function removeTeamMember(teamId: string, employeeId: string): Promise<void> {
  const { error } = await supabase.from("iw_team_members").delete().eq("team_id", teamId).eq("employee_id", employeeId);
  if (error) throw error;
}

// # dělá: načte výjimky (přidat/odebrat) platné pro konkrétní směnu
export async function listShiftExceptions(teamId: string, workDate: string, shift: IwShiftName): Promise<IwShiftException[]> {
  const { data, error } = await supabase
    .from("iw_shift_exceptions")
    .select("*")
    .eq("team_id", teamId)
    .eq("work_date", workDate)
    .eq("shift", shift);
  if (error) throw error;
  return (data ?? []) as IwShiftException[];
}

// # dělá: zapíše výjimku pro konkrétní směnu; nikdy nezapisuje do iw_team_members
export async function addShiftException(input: {
  teamId: string;
  workDate: string;
  shift: IwShiftName;
  employeeId: string;
  type: IwShiftExceptionType;
  reason?: string | null;
  createdBy?: string | null;
}): Promise<void> {
  const { error } = await supabase.from("iw_shift_exceptions").upsert(
    {
      team_id: input.teamId,
      work_date: input.workDate,
      shift: input.shift,
      employee_id: input.employeeId,
      exception_type: input.type,
      reason: input.reason ?? null,
      created_by: input.createdBy ?? null,
    },
    { onConflict: "team_id,work_date,shift,employee_id" },
  );
  if (error) throw error;
}

// # dělá: odstraní výjimku (zaměstnanec se vrací k výchozímu stavu základního týmu pro danou směnu)
export async function removeShiftException(exceptionId: string): Promise<void> {
  const { error } = await supabase.from("iw_shift_exceptions").delete().eq("id", exceptionId);
  if (error) throw error;
}

/**
 * Slouží základní tým s výjimkami dané směny bez zápisu do iw_team_members.
 * "remove" má přednost před "add" pro stejného zaměstnance (nelze být zároveň odebrán i přidán).
 */
export function resolveEffectiveRoster(members: IwTeamMember[], exceptions: IwShiftException[]): string[] {
  const base = new Set(members.map((m) => m.employee_id));
  const removed = new Set(exceptions.filter((e) => e.exception_type === "remove").map((e) => e.employee_id));
  const added = exceptions.filter((e) => e.exception_type === "add").map((e) => e.employee_id);

  for (const employeeId of removed) base.delete(employeeId);
  for (const employeeId of added) {
    if (!removed.has(employeeId)) base.add(employeeId);
  }
  return [...base];
}
