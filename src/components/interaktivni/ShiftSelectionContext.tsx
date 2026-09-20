import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useAuth } from "@/lib/auth";
import { localDateKey } from "@/lib/metrics";
import { createTeam, ensureAtLeastOneTeam, type IwShiftName, type IwTeam } from "@/lib/teams";

export type ShiftSelectionValue = {
  leaderUserId: string | null;
  canManage: boolean;
  teams: IwTeam[];
  teamsLoading: boolean;
  teamId: string | null;
  setTeamId: (id: string) => void;
  workDate: string;
  setWorkDate: (value: string) => void;
  shift: IwShiftName;
  setShift: (value: IwShiftName) => void;
  addTeam: (name: string) => Promise<void>;
};

const ShiftSelectionContext = createContext<ShiftSelectionValue | null>(null);

function todayIso() {
  return localDateKey();
}

/**
 * Sdílený výběr týmu/data/směny napříč celým modulem (Mapa haly, Týmy,
 * Rozdělení výroby) - dřív měla každá stránka vlastní lokální stav a přepnutí
 * karty ho zahodilo. Teď se vybírá jednou nahoře a platí všude.
 */
export function ShiftSelectionProvider({ children }: { children: ReactNode }) {
  const { session, isTeamLeader, isAdmin } = useAuth();
  const queryClient = useQueryClient();
  const leaderUserId = session?.user.id ?? null;
  const canManage = isTeamLeader || isAdmin;

  const teamsQuery = useQuery({
    queryKey: ["iw_teams_list", leaderUserId],
    queryFn: () => ensureAtLeastOneTeam(leaderUserId as string),
    enabled: Boolean(leaderUserId) && canManage,
  });

  const [teamId, setTeamId] = useState<string | null>(null);
  const [workDate, setWorkDate] = useState(todayIso());
  const [shift, setShift] = useState<IwShiftName>("Ranní");

  const teams = teamsQuery.data ?? [];

  // # dělá: jakmile se načte seznam týmů, automaticky vybere první, pokud ještě žádný není zvolený
  useEffect(() => {
    if (!teamId && teams.length > 0) setTeamId(teams[0].id);
  }, [teams, teamId]);

  async function addTeam(name: string) {
    if (!leaderUserId) return;
    const trimmed = name.trim();
    if (!trimmed) return;
    const created = await createTeam(leaderUserId, trimmed);
    await queryClient.invalidateQueries({ queryKey: ["iw_teams_list", leaderUserId] });
    setTeamId(created.id);
  }

  const value = useMemo<ShiftSelectionValue>(
    () => ({ leaderUserId, canManage, teams, teamsLoading: teamsQuery.isLoading, teamId, setTeamId, workDate, setWorkDate, shift, setShift, addTeam }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [leaderUserId, canManage, teams, teamsQuery.isLoading, teamId, workDate, shift],
  );

  return <ShiftSelectionContext.Provider value={value}>{children}</ShiftSelectionContext.Provider>;
}

export function useShiftSelection(): ShiftSelectionValue {
  const ctx = useContext(ShiftSelectionContext);
  if (!ctx) throw new Error("useShiftSelection musí být uvnitř ShiftSelectionProvider");
  return ctx;
}
