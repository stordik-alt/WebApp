import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCw, UserPlus, Users2 } from "lucide-react";
import { useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { Panel, PanelHeader } from "@/components/interaktivni/Panel";
import { useAuth } from "@/lib/auth";
import { useEmployees } from "@/lib/data";
import { listWorkstations } from "@/lib/floorMap";
import { getRotationHistory } from "@/lib/rotation";
import { suggestAssignments, type ProductionSlot } from "@/lib/shift-assignment";
import { addTempOperator, clearNonManualAssignments, listAssignments, listTempOperators, saveSuggestedAssignments, setManualAssignment } from "@/lib/shiftAssignments";
import { ensureShift, listActiveProductions, resolveProductProfile } from "@/lib/shiftProductions";
import type { IwShiftName } from "@/lib/shift-windows";
import { ensureTeamForLeader, listShiftExceptions, listTeamMembers, resolveEffectiveRoster } from "@/lib/teams";
import { listRestrictionsForEmployees, toExclusionMap } from "@/lib/workstationRestrictions";

export const Route = createFileRoute("/interaktivni/smena-obsazeni")({
  head: () => ({
    meta: [
      { title: "Obsazení směny – Interaktivní prostředí" },
      { name: "description", content: "Návrh rozdělení operátorů podle kvalifikace, priorit a rotace." },
    ],
  }),
  component: ShiftAssignmentPage,
});

const SHIFTS: IwShiftName[] = ["Ranní", "Odpolední", "Noční"];

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function ShiftAssignmentPage() {
  const { session, isTeamLeader, isAdmin } = useAuth();
  const queryClient = useQueryClient();
  const [workDate, setWorkDate] = useState(todayIso());
  const [shift, setShift] = useState<IwShiftName>("Ranní");

  const leaderUserId = session?.user.id ?? null;
  const canManage = isTeamLeader || isAdmin;

  const teamQuery = useQuery({ queryKey: ["iw_team", leaderUserId], queryFn: () => ensureTeamForLeader(leaderUserId as string), enabled: Boolean(leaderUserId) && canManage });
  const shiftQuery = useQuery({
    queryKey: ["iw_shift", teamQuery.data?.id, workDate, shift],
    queryFn: () => ensureShift({ teamId: teamQuery.data!.id, workDate, shift, createdBy: leaderUserId as string }),
    enabled: Boolean(teamQuery.data) && Boolean(leaderUserId),
  });

  const workstationsQuery = useQuery({ queryKey: ["iw_workstations"], queryFn: listWorkstations });
  const employeesQuery = useEmployees();
  const membersQuery = useQuery({ queryKey: ["iw_team_members", teamQuery.data?.id], queryFn: () => listTeamMembers(teamQuery.data!.id), enabled: Boolean(teamQuery.data) });
  const exceptionsQuery = useQuery({
    queryKey: ["iw_shift_exceptions", teamQuery.data?.id, workDate, shift],
    queryFn: () => listShiftExceptions(teamQuery.data!.id, workDate, shift),
    enabled: Boolean(teamQuery.data),
  });
  const productionsQuery = useQuery({ queryKey: ["iw_shift_productions", shiftQuery.data?.id], queryFn: () => listActiveProductions(shiftQuery.data!.id), enabled: Boolean(shiftQuery.data) });
  const tempOperatorsQuery = useQuery({ queryKey: ["iw_shift_temp_operators", shiftQuery.data?.id], queryFn: () => listTempOperators(shiftQuery.data!.id), enabled: Boolean(shiftQuery.data) });
  const assignmentsQuery = useQuery({ queryKey: ["iw_shift_assignments", shiftQuery.data?.id], queryFn: () => listAssignments(shiftQuery.data!.id), enabled: Boolean(shiftQuery.data) });

  const rosterIds = useMemo(() => resolveEffectiveRoster(membersQuery.data ?? [], exceptionsQuery.data ?? []), [membersQuery.data, exceptionsQuery.data]);
  const restrictionsQuery = useQuery({
    queryKey: ["iw_workstation_restrictions", rosterIds.join(",")],
    queryFn: () => listRestrictionsForEmployees(rosterIds),
    enabled: rosterIds.length > 0,
  });

  const employeesById = useMemo(() => new Map((employeesQuery.data ?? []).map((e) => [e.id, e])), [employeesQuery.data]);
  const workstationsById = useMemo(() => new Map((workstationsQuery.data ?? []).map((w) => [w.id, w])), [workstationsQuery.data]);

  const profilesQuery = useQuery({
    queryKey: ["iw_resolved_profiles_assign", (productionsQuery.data ?? []).map((p) => p.product_code).join(","), workDate],
    queryFn: async () => {
      const entries = await Promise.all((productionsQuery.data ?? []).map(async (p) => [p.product_code, await resolveProductProfile(p.product_code, workDate)] as const));
      return new Map(entries);
    },
    enabled: (productionsQuery.data ?? []).length > 0,
  });

  const rotationQuery = useQuery({
    queryKey: ["iw_rotation_history", rosterIds.join(","), workDate],
    queryFn: () => getRotationHistory({ employeeIds: rosterIds, workDate, workstations: workstationsQuery.data ?? [] }),
    enabled: rosterIds.length > 0 && (workstationsQuery.data ?? []).length > 0,
  });

  async function invalidate() {
    await queryClient.invalidateQueries({ queryKey: ["iw_shift_assignments", shiftQuery.data?.id] });
  }

  // # dělá: seznam cílů pro ruční přesun (aktivní hlavní výroby + sekundární pracoviště TESTY/PREP)
  const reassignmentTargets = useMemo(() => {
    const mainTargets = (productionsQuery.data ?? []).flatMap((p) => {
      const workstation = workstationsById.get(p.workstation_id);
      if (!workstation) return [];
      return [{ workstationId: p.workstation_id, productionId: p.id, assignmentType: "main" as const, label: workstation.display_name }];
    });
    const secondaryTargets = (workstationsQuery.data ?? [])
      .filter((w) => w.is_secondary)
      .map((w) => ({ workstationId: w.id, productionId: null, assignmentType: "secondary" as const, label: w.display_name }));
    return [...mainTargets, ...secondaryTargets];
  }, [productionsQuery.data, workstationsQuery.data, workstationsById]);

  async function reassign(employeeId: string, targetKey: string) {
    if (!shiftQuery.data) return;
    const target = reassignmentTargets.find((t) => t.workstationId === targetKey);
    if (!target) return;
    await setManualAssignment({
      shiftId: shiftQuery.data.id,
      employeeId,
      workstationId: target.workstationId,
      productionId: target.productionId,
      assignmentType: target.assignmentType,
    });
    await invalidate();
  }

  async function recompute() {
    if (!shiftQuery.data || !profilesQuery.data || !rotationQuery.data) return;
    const productions: ProductionSlot[] = (productionsQuery.data ?? []).flatMap((p) => {
      const workstation = workstationsById.get(p.workstation_id);
      const profile = profilesQuery.data!.get(p.product_code);
      const capacity = profile ? (p.area === "TUP" ? profile.t_capacity : profile.h_capacity) : null;
      if (!workstation || !capacity) return [];
      return [{
        productionId: p.id,
        workstationId: p.workstation_id,
        workstationCode: workstation.code,
        productCode: p.product_code,
        area: p.area,
        designedCapacity: capacity,
        priority: p.priority,
        sortOrder: workstation.sort_order,
      }];
    });
    const secondaryWorkstations = (workstationsQuery.data ?? []).filter((w) => w.is_secondary).map((w) => ({ id: w.id, code: w.code }));
    const employees = (employeesQuery.data ?? []).filter((e) => e.active).map((e) => ({ id: e.id, qual_ha: e.qual_ha, qual_tup: e.qual_tup }));
    const tempIds = (tempOperatorsQuery.data ?? []).map((t) => t.employee_id);

    const result = suggestAssignments({
      rosterEmployeeIds: rosterIds,
      tempEmployeeIds: tempIds,
      employees,
      productions,
      secondaryWorkstations,
      restrictions: toExclusionMap(restrictionsQuery.data ?? []),
      rotationHistory: rotationQuery.data,
    });

    await clearNonManualAssignments(shiftQuery.data.id);
    await saveSuggestedAssignments(shiftQuery.data.id, result.assignments);
    await invalidate();
  }

  const assignments = assignmentsQuery.data ?? [];
  const grouped = useMemoGroupByWorkstation(assignments);

  if (!canManage) {
    return (
      <AppShell title="Obsazení směny" subtitle="Návrh rozdělení operátorů.">
        <Panel className="p-5 text-sm text-white/60">Tato stránka je určena pro Team Leadery a administrátory.</Panel>
      </AppShell>
    );
  }

  return (
    <AppShell title="Obsazení směny" subtitle="Kvalifikace určuje KDO, priorita KAM při nedostatku, rotace KTERÝ konkrétní člověk.">
      <div className="grid min-w-0 gap-4 sm:gap-6">
        <Panel className="p-4 sm:p-5">
          <div className="flex flex-wrap items-end gap-3">
            <input type="date" value={workDate} onChange={(e) => setWorkDate(e.target.value)} />
            <select value={shift} onChange={(e) => setShift(e.target.value as IwShiftName)}>
              {SHIFTS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <button type="button" className="iw-btn ml-auto" onClick={() => void recompute()}>
              <RefreshCw className="h-4 w-4" /> Přepočítat
            </button>
          </div>
        </Panel>

        <Panel>
          <PanelHeader icon={<Users2 className="h-4 w-4" />} title="Navržené obsazení" subtitle={`${assignments.length} přiřazení · ruční úpravy "Přepočítat" nezahodí`} />
          <div className="divide-y divide-white/10">
            {[...grouped.entries()].map(([workstationId, group]) => {
              const workstation = workstationId ? workstationsById.get(workstationId) : null;
              return (
                <div key={workstationId ?? "none"} className="px-4 py-3 sm:px-5">
                  <div className="mb-1.5 flex items-center gap-2">
                    <span className="iw-chip">{workstation?.area ?? "?"}</span>
                    <span className="iw-mono text-sm text-white/85">{workstation?.display_name ?? "Bez pracoviště"}</span>
                  </div>
                  <div className="grid gap-1.5">
                    {group.map((a) => (
                      <div key={a.id} className="flex flex-wrap items-center gap-2">
                        <span className={`iw-chip ${a.assignment_type === "temp" ? "iw-chip-temp" : ""}`}>
                          {employeesById.get(a.employee_id)?.full_name ?? a.employee_id}
                          {a.is_manual_override ? " ✎" : ""}
                        </span>
                        <select
                          value={a.workstation_id ?? ""}
                          onChange={(e) => void reassign(a.employee_id, e.target.value)}
                          aria-label={`Přesunout ${employeesById.get(a.employee_id)?.full_name ?? a.employee_id}`}
                        >
                          {a.workstation_id && !reassignmentTargets.some((t) => t.workstationId === a.workstation_id) ? (
                            <option value={a.workstation_id}>{workstation?.display_name ?? "Aktuální"}</option>
                          ) : null}
                          {reassignmentTargets.map((t) => (
                            <option key={t.workstationId} value={t.workstationId}>
                              {t.label}
                            </option>
                          ))}
                        </select>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
            {assignments.length === 0 ? <div className="px-4 py-4 text-sm text-white/45 sm:px-5">Zatím žádný návrh - klikni na "Přepočítat".</div> : null}
          </div>
        </Panel>

        <Panel className="p-4 sm:p-5">
          <p className="iw-label mb-2">Přidat dočasného operátora</p>
          <div className="flex flex-wrap gap-2">
            {(employeesQuery.data ?? [])
              .filter((e) => e.is_temporary && e.active)
              .map((e) => (
                <button
                  key={e.id}
                  type="button"
                  className="iw-btn"
                  onClick={() =>
                    void addTempOperator({ shiftId: shiftQuery.data!.id, employeeId: e.id, addedBy: leaderUserId }).then(() =>
                      queryClient.invalidateQueries({ queryKey: ["iw_shift_temp_operators", shiftQuery.data?.id] }),
                    )
                  }
                >
                  <UserPlus className="h-4 w-4" /> {e.full_name}
                </button>
              ))}
          </div>
        </Panel>
      </div>
    </AppShell>
  );
}

function useMemoGroupByWorkstation(assignments: { id: string; workstation_id: string | null }[]) {
  return useMemo(() => {
    const map = new Map<string | null, typeof assignments>();
    for (const a of assignments) {
      const list = map.get(a.workstation_id) ?? [];
      list.push(a);
      map.set(a.workstation_id, list);
    }
    return map;
  }, [assignments]);
}
