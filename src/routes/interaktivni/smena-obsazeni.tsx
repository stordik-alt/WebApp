import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCw, UserPlus, Users2 } from "lucide-react";
import { useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useAuth } from "@/lib/auth";
import { useEmployees } from "@/lib/data";
import { listWorkstations } from "@/lib/floorMap";
import { getRotationHistory } from "@/lib/rotation";
import { suggestAssignments, type ProductionSlot } from "@/lib/shift-assignment";
import { addTempOperator, clearNonManualAssignments, listAssignments, listTempOperators, saveSuggestedAssignments } from "@/lib/shiftAssignments";
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
        <Card className="p-5 text-sm text-muted-foreground">Tato stránka je určena pro Team Leadery a administrátory.</Card>
      </AppShell>
    );
  }

  return (
    <AppShell title="Obsazení směny" subtitle="Kvalifikace určuje KDO, priorita KAM při nedostatku, rotace KTERÝ konkrétní člověk.">
      <div className="grid min-w-0 gap-4 sm:gap-6">
        <Card className="p-4 sm:p-5">
          <div className="flex flex-wrap items-end gap-3">
            <input type="date" className="block h-9 rounded-md border border-input bg-background px-2 text-sm" value={workDate} onChange={(e) => setWorkDate(e.target.value)} />
            <select className="block h-9 rounded-md border border-input bg-background px-2 text-sm" value={shift} onChange={(e) => setShift(e.target.value as IwShiftName)}>
              {SHIFTS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <Button className="ml-auto" onClick={() => void recompute()}>
              <RefreshCw className="mr-1 h-4 w-4" /> Přepočítat
            </Button>
          </div>
        </Card>

        <Card className="overflow-hidden p-0">
          <div className="flex items-center gap-3 border-b border-border px-4 py-4 sm:px-5">
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-primary/10 text-primary">
              <Users2 className="h-5 w-5" />
            </span>
            <div>
              <h2 className="text-lg font-semibold">Navržené obsazení</h2>
              <p className="text-xs text-muted-foreground">{assignments.length} přiřazení · ruční úpravy "Přepočítat" nezahodí</p>
            </div>
          </div>
          <div className="divide-y divide-border">
            {[...grouped.entries()].map(([workstationId, group]) => {
              const workstation = workstationId ? workstationsById.get(workstationId) : null;
              return (
                <div key={workstationId ?? "none"} className="px-4 py-3 sm:px-5">
                  <div className="mb-1 flex items-center gap-2">
                    <Badge variant={workstation?.is_secondary ? "outline" : "secondary"}>{workstation?.area ?? "?"}</Badge>
                    <span className="font-medium">{workstation?.display_name ?? "Bez pracoviště"}</span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {group.map((a) => (
                      <Badge key={a.id} variant={a.assignment_type === "temp" ? "destructive" : "default"}>
                        {employeesById.get(a.employee_id)?.full_name ?? a.employee_id}
                        {a.is_manual_override ? " ✎" : ""}
                      </Badge>
                    ))}
                  </div>
                </div>
              );
            })}
            {assignments.length === 0 ? <div className="px-4 py-4 text-sm text-muted-foreground sm:px-5">Zatím žádný návrh - klikni na "Přepočítat".</div> : null}
          </div>
        </Card>

        <Card className="p-4 sm:p-5">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Přidat dočasného operátora</p>
          <div className="flex flex-wrap gap-2">
            {(employeesQuery.data ?? [])
              .filter((e) => e.is_temporary && e.active)
              .map((e) => (
                <Button
                  key={e.id}
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    void addTempOperator({ shiftId: shiftQuery.data!.id, employeeId: e.id, addedBy: leaderUserId }).then(() =>
                      queryClient.invalidateQueries({ queryKey: ["iw_shift_temp_operators", shiftQuery.data?.id] }),
                    )
                  }
                >
                  <UserPlus className="mr-1 h-4 w-4" /> {e.full_name}
                </Button>
              ))}
          </div>
        </Card>
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
