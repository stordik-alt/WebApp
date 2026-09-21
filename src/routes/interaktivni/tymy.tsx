import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Ban, UserMinus, UserPlus, Users } from "lucide-react";
import { useMemo } from "react";
import { Panel, PanelHeader } from "@/components/interaktivni/Panel";
import { useShiftSelection } from "@/components/interaktivni/ShiftSelectionContext";
import { useEmployees } from "@/lib/data";
import { listWorkstations } from "@/lib/floorMap";
import { addTeamMember, listTeamMembers, removeTeamMember } from "@/lib/teams";
import { clearWorkstationRestriction, listRestrictionsForEmployees, setWorkstationRestriction, toExclusionMap } from "@/lib/workstationRestrictions";

export const Route = createFileRoute("/interaktivni/tymy")({
  head: () => ({
    meta: [
      { title: "Týmy – Interaktivní prostředí" },
      { name: "description", content: "Týdenní základní tým Team Leadera - kdo do něj patří a kam nesmí být přiřazen." },
    ],
  }),
  component: TeamsPage,
});

/**
 * Výběr TÝMU (a datum/směna, i když se tu nepoužívá) je sdílený napříč
 * celým modulem - viz SelectionBar v route.tsx. Výjimky pro konkrétní směnu
 * (přidat/odebrat na dnešek) se řeší až v Rozdělení výroby, ne tady - tahle
 * stránka je jen o dlouhodobém týdenním složení vybraného týmu.
 */
function TeamsPage() {
  const { leaderUserId, canManage, teamId, teams } = useShiftSelection();
  const queryClient = useQueryClient();

  const membersQuery = useQuery({ queryKey: ["iw_team_members", teamId], queryFn: () => listTeamMembers(teamId as string), enabled: Boolean(teamId) });
  const employeesQuery = useEmployees();
  const workstationsQuery = useQuery({ queryKey: ["iw_workstations"], queryFn: listWorkstations });
  const secondaryWorkstations = (workstationsQuery.data ?? []).filter((w) => w.is_secondary);

  const members = membersQuery.data ?? [];
  const memberIds = useMemo(() => new Set(members.map((m) => m.employee_id)), [members]);

  const restrictionsQuery = useQuery({
    queryKey: ["iw_workstation_restrictions", [...memberIds].join(",")],
    queryFn: () => listRestrictionsForEmployees([...memberIds]),
    enabled: memberIds.size > 0,
  });
  const exclusionMap = useMemo(() => toExclusionMap(restrictionsQuery.data ?? []), [restrictionsQuery.data]);

  async function toggleRestriction(employeeId: string, workstationId: string, currentlyRestricted: boolean) {
    if (currentlyRestricted) await clearWorkstationRestriction(employeeId, workstationId);
    else await setWorkstationRestriction({ employeeId, workstationId, createdBy: leaderUserId });
    await queryClient.invalidateQueries({ queryKey: ["iw_workstation_restrictions", [...memberIds].join(",")] });
  }

  const employeesById = useMemo(() => new Map((employeesQuery.data ?? []).map((e) => [e.id, e])), [employeesQuery.data]);
  const nonMembers = (employeesQuery.data ?? []).filter((e) => e.active && !memberIds.has(e.id));

  async function invalidateMembers() {
    await queryClient.invalidateQueries({ queryKey: ["iw_team_members", teamId] });
  }

  if (!canManage) {
    return (
      
        <Panel className="p-5 text-sm text-muted-foreground">Tato stránka je určena pro Team Leadery a administrátory.</Panel>
      
    );
  }

  const teamName = teams.find((t) => t.id === teamId)?.name;

  return (
    
      <div className="grid min-w-0 gap-4 sm:gap-6">
        <Panel>
          <PanelHeader icon={<Users className="h-4 w-4" />} title={teamName ? `Tým: ${teamName}` : "Základní tým"} subtitle={`${members.length} členů`} />
          <div className="divide-y divide-border/70">
            {members.map((member) => {
              const employee = employeesById.get(member.employee_id);
              return (
                <div key={member.id} className="flex items-center justify-between gap-3 px-4 py-3 sm:px-5">
                  <span className="iw-mono truncate text-sm text-foreground/85">{employee?.full_name ?? member.employee_id}</span>
                  <button type="button" className="iw-btn iw-btn-danger" onClick={() => void removeTeamMember(member.team_id, member.employee_id).then(invalidateMembers)}>
                    <UserMinus className="h-4 w-4" /> Odebrat
                  </button>
                </div>
              );
            })}
            {members.length === 0 ? <div className="px-4 py-4 text-sm text-muted-foreground sm:px-5">Tento tým zatím nemá žádné členy.</div> : null}
          </div>
          {nonMembers.length > 0 && teamId ? (
            <div className="border-t border-border px-4 py-3 sm:px-5">
              <p className="iw-label mb-2">Přidat do týmu</p>
              <div className="flex flex-wrap gap-2">
                {nonMembers.map((employee) => (
                  <button key={employee.id} type="button" className="iw-btn" onClick={() => void addTeamMember(teamId, employee.id).then(invalidateMembers)}>
                    <UserPlus className="h-4 w-4" /> {employee.full_name}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </Panel>

        {secondaryWorkstations.length > 0 ? (
          <Panel>
            <PanelHeader
              icon={<Ban className="h-4 w-4" />}
              title="Omezení pracovišť"
              subtitle="Zaměstnanec s omezením nesmí být na dané sekundární pracoviště přiřazen"
            />
            <div className="divide-y divide-border/70">
              {[...memberIds].map((employeeId) => {
                const employee = employeesById.get(employeeId);
                const excluded = exclusionMap.get(employeeId) ?? new Set<string>();
                return (
                  <div key={employeeId} className="flex flex-wrap items-center gap-3 px-4 py-3 sm:px-5">
                    <span className="iw-mono min-w-0 flex-1 truncate text-sm text-foreground/85">{employee?.full_name ?? employeeId}</span>
                    <div className="flex flex-wrap gap-2">
                      {secondaryWorkstations.map((workstation) => {
                        const restricted = excluded.has(workstation.id);
                        return (
                          <button
                            key={workstation.id}
                            type="button"
                            className={`iw-btn ${restricted ? "iw-btn-danger" : ""}`}
                            onClick={() => void toggleRestriction(employeeId, workstation.id, restricted)}
                          >
                            {restricted ? "Zakázáno: " : "Povoleno: "}
                            {workstation.display_name}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
              {memberIds.size === 0 ? <div className="px-4 py-4 text-sm text-muted-foreground sm:px-5">Nejprve přidej členy do týmu.</div> : null}
            </div>
          </Panel>
        ) : null}
      </div>
    
  );
}
