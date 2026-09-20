import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ClipboardList, PlayCircle, RefreshCw, UserPlus, Users2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { Panel, PanelHeader } from "@/components/interaktivni/Panel";
import { useShiftSelection } from "@/components/interaktivni/ShiftSelectionContext";
import { useEmployees } from "@/lib/data";
import { listWorkstations } from "@/lib/floorMap";
import { priorityMapFromOrder, toggleProductionSelection } from "@/lib/production-priority";
import { getRotationHistory } from "@/lib/rotation";
import { suggestAssignments, type ProductionSlot } from "@/lib/shift-assignment";
import {
  addTempOperator,
  clearNonManualAssignments,
  listAssignments,
  listTempOperators,
  saveSuggestedAssignments,
  setManualAssignment,
} from "@/lib/shiftAssignments";
import { startShiftProduction } from "@/lib/shiftHistory";
import { ensureShift, listActiveProductions, resolveProductProfile, updateProduction, type IwShiftProduction } from "@/lib/shiftProductions";
import { addShiftException, listShiftExceptions, listTeamMembers, removeShiftException, resolveEffectiveRoster } from "@/lib/teams";
import { listRestrictionsForEmployees, toExclusionMap } from "@/lib/workstationRestrictions";

export const Route = createFileRoute("/interaktivni/rozdeleni-vyroby")({
  head: () => ({
    meta: [
      { title: "Rozdělení výroby – Interaktivní prostředí" },
      { name: "description", content: "Potvrď obsazení, vyber výroby podle priority a nech si navrhnout rozdělení operátorů." },
    ],
  }),
  component: ProductionAssignmentPage,
});

function ProductionAssignmentPage() {
  const { leaderUserId, canManage, teamId, workDate, shift } = useShiftSelection();
  const queryClient = useQueryClient();
  const [selectedOrder, setSelectedOrder] = useState<string[]>([]);
  const [productionsSaved, setProductionsSaved] = useState(false);
  const [starting, setStarting] = useState(false);

  const shiftQuery = useQuery({
    queryKey: ["iw_shift", teamId, workDate, shift],
    queryFn: () => ensureShift({ teamId: teamId as string, workDate, shift, createdBy: leaderUserId as string }),
    enabled: Boolean(teamId) && Boolean(leaderUserId),
  });

  const workstationsQuery = useQuery({ queryKey: ["iw_workstations"], queryFn: listWorkstations });
  const employeesQuery = useEmployees();
  const membersQuery = useQuery({ queryKey: ["iw_team_members", teamId], queryFn: () => listTeamMembers(teamId as string), enabled: Boolean(teamId) });
  const exceptionsQuery = useQuery({
    queryKey: ["iw_shift_exceptions", teamId, workDate, shift],
    queryFn: () => listShiftExceptions(teamId as string, workDate, shift),
    enabled: Boolean(teamId),
  });
  const tempOperatorsQuery = useQuery({ queryKey: ["iw_shift_temp_operators", shiftQuery.data?.id], queryFn: () => listTempOperators(shiftQuery.data!.id), enabled: Boolean(shiftQuery.data) });
  const productionsQuery = useQuery({ queryKey: ["iw_shift_productions", shiftQuery.data?.id], queryFn: () => listActiveProductions(shiftQuery.data!.id), enabled: Boolean(shiftQuery.data) });
  const assignmentsQuery = useQuery({ queryKey: ["iw_shift_assignments", shiftQuery.data?.id], queryFn: () => listAssignments(shiftQuery.data!.id), enabled: Boolean(shiftQuery.data) });

  const rosterIds = useMemo(() => resolveEffectiveRoster(membersQuery.data ?? [], exceptionsQuery.data ?? []), [membersQuery.data, exceptionsQuery.data]);
  const restrictionsQuery = useQuery({
    queryKey: ["iw_workstation_restrictions", rosterIds.join(",")],
    queryFn: () => listRestrictionsForEmployees(rosterIds),
    enabled: rosterIds.length > 0,
  });

  const employeesById = useMemo(() => new Map((employeesQuery.data ?? []).map((e) => [e.id, e])), [employeesQuery.data]);
  const workstationsById = useMemo(() => new Map((workstationsQuery.data ?? []).map((w) => [w.id, w])), [workstationsQuery.data]);

  // # dělá: při načtení výrob předvyplní pořadí kliknutí z už uložených priorit (obnova rozpracovaného stavu)
  useEffect(() => {
    if (!productionsQuery.data) return;
    const alreadyPrioritized = productionsQuery.data
      .filter((p) => p.priority != null)
      .sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0))
      .map((p) => p.id);
    if (alreadyPrioritized.length > 0) setSelectedOrder(alreadyPrioritized);
  }, [productionsQuery.data]);

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

  async function invalidateExceptions() {
    await queryClient.invalidateQueries({ queryKey: ["iw_shift_exceptions", teamId, workDate, shift] });
  }
  async function invalidateAssignments() {
    await queryClient.invalidateQueries({ queryKey: ["iw_shift_assignments", shiftQuery.data?.id] });
  }

  // # dělá: uloží pořadí kliknutí jako prioritu (vybrané 1..N, nevybrané null = neběží tuto směnu)
  async function saveProductionSelection() {
    if (!productionsQuery.data) return;
    const priorityMap = priorityMapFromOrder(selectedOrder);
    await Promise.all(
      productionsQuery.data.map((production: IwShiftProduction) => updateProduction(production.id, { priority: priorityMap.get(production.id) ?? null })),
    );
    setProductionsSaved(true);
    await queryClient.invalidateQueries({ queryKey: ["iw_shift_productions", shiftQuery.data?.id] });
  }

  // # dělá: seznam cílů pro ruční přesun (aktivní hlavní výroby + sekundární pracoviště TESTY/PREP)
  const reassignmentTargets = useMemo(() => {
    const mainTargets = (productionsQuery.data ?? [])
      .filter((p) => selectedOrder.includes(p.id))
      .flatMap((p) => {
        const workstation = workstationsById.get(p.workstation_id);
        if (!workstation) return [];
        return [{ workstationId: p.workstation_id, productionId: p.id, assignmentType: "main" as const, label: workstation.display_name }];
      });
    const secondaryTargets = (workstationsQuery.data ?? [])
      .filter((w) => w.is_secondary)
      .map((w) => ({ workstationId: w.id, productionId: null, assignmentType: "secondary" as const, label: w.display_name }));
    return [...mainTargets, ...secondaryTargets];
  }, [productionsQuery.data, selectedOrder, workstationsQuery.data, workstationsById]);

  async function reassign(employeeId: string, targetKey: string) {
    if (!shiftQuery.data) return;
    const target = reassignmentTargets.find((t) => t.workstationId === targetKey);
    if (!target) return;
    await setManualAssignment({ shiftId: shiftQuery.data.id, employeeId, workstationId: target.workstationId, productionId: target.productionId, assignmentType: target.assignmentType });
    await invalidateAssignments();
  }

  async function recompute() {
    if (!shiftQuery.data || !profilesQuery.data || !rotationQuery.data) return;
    // Jen výroby VYBRANÉ v kroku 2 (priorita != null) se považují za běžící tuto směnu.
    const selected = (productionsQuery.data ?? []).filter((p) => selectedOrder.includes(p.id));
    const productions: ProductionSlot[] = selected.flatMap((p) => {
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
    await invalidateAssignments();
  }

  async function handleStart() {
    if (!shiftQuery.data) return;
    setStarting(true);
    try {
      await startShiftProduction(shiftQuery.data.id);
      toast.success("Výroba zahájena, výchozí stav směny byl uložen.");
      await queryClient.invalidateQueries({ queryKey: ["iw_shift", teamId, workDate, shift] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Zahájení výroby selhalo.");
    } finally {
      setStarting(false);
    }
  }

  const assignments = assignmentsQuery.data ?? [];
  const grouped = useMemo(() => {
    const map = new Map<string | null, typeof assignments>();
    for (const a of assignments) {
      const list = map.get(a.workstation_id) ?? [];
      list.push(a);
      map.set(a.workstation_id, list);
    }
    return map;
  }, [assignments]);

  if (!canManage) {
    return (
      <AppShell title="Rozdělení výroby" subtitle="Obsazení, výběr výrob a návrh rozdělení operátorů.">
        <Panel className="p-5 text-sm text-muted-foreground">Tato stránka je určena pro Team Leadery a administrátory.</Panel>
      </AppShell>
    );
  }

  const productions = productionsQuery.data ?? [];
  const isDraft = shiftQuery.data?.status === "draft";

  return (
    <AppShell title="Rozdělení výroby" subtitle="Kvalifikace určuje KDO, priorita KAM při nedostatku, rotace KTERÝ konkrétní člověk.">
      <div className="grid min-w-0 gap-4 sm:gap-6">
        <Panel>
          <PanelHeader icon={<Users2 className="h-4 w-4" />} title="Krok 1 · Obsazení pro tuto směnu" subtitle="Základní tým se výjimkou nemění - platí jen pro dnešek" />
          <div className="px-4 py-4 sm:px-5">
            <p className="iw-label mb-2">Efektivní obsazení ({[...new Set(rosterIds)].length + (tempOperatorsQuery.data?.length ?? 0)})</p>
            <div className="flex flex-wrap gap-2">
              {rosterIds.map((employeeId) => {
                const isException = (exceptionsQuery.data ?? []).some((e) => e.employee_id === employeeId && e.exception_type === "add");
                return (
                  <span key={employeeId} className={`iw-chip ${isException ? "iw-chip-temp" : ""}`}>
                    {employeesById.get(employeeId)?.full_name ?? employeeId}
                  </span>
                );
              })}
              {(tempOperatorsQuery.data ?? []).map((t) => (
                <span key={t.id} className="iw-chip iw-chip-temp">
                  {employeesById.get(t.employee_id)?.full_name ?? t.employee_id} (dočasný)
                </span>
              ))}
            </div>
          </div>
          <div className="border-t border-border px-4 py-4 sm:px-5">
            <p className="iw-label mb-2">Přidat / odebrat pro dnešek</p>
            <div className="flex flex-wrap gap-2">
              {(employeesQuery.data ?? [])
                .filter((e) => e.active)
                .map((employee) => {
                  const inRoster = rosterIds.includes(employee.id);
                  return (
                    <button
                      key={employee.id}
                      type="button"
                      className="iw-btn"
                      onClick={() =>
                        void addShiftException({ teamId: teamId as string, workDate, shift, employeeId: employee.id, type: inRoster ? "remove" : "add", createdBy: leaderUserId }).then(
                          invalidateExceptions,
                        )
                      }
                    >
                      {employee.full_name}
                    </button>
                  );
                })}
            </div>
          </div>
          {(exceptionsQuery.data ?? []).length > 0 ? (
            <div className="border-t border-border px-4 py-4 sm:px-5">
              <div className="space-y-2">
                {(exceptionsQuery.data ?? []).map((exception) => (
                  <div key={exception.id} className="flex items-center justify-between gap-3 text-sm">
                    <span className="iw-mono">
                      {exception.exception_type === "add" ? "+ přidán" : "− odebrán"} {employeesById.get(exception.employee_id)?.full_name ?? exception.employee_id}
                    </span>
                    <button type="button" className="iw-btn" onClick={() => void removeShiftException(exception.id).then(invalidateExceptions)}>
                      Zrušit
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
          <div className="border-t border-border px-4 py-4 sm:px-5">
            <p className="iw-label mb-2">Dočasní operátoři</p>
            <div className="flex flex-wrap gap-2">
              {(employeesQuery.data ?? [])
                .filter((e) => e.is_temporary && e.active)
                .map((e) => (
                  <button
                    key={e.id}
                    type="button"
                    className="iw-btn"
                    onClick={() => void addTempOperator({ shiftId: shiftQuery.data!.id, employeeId: e.id, addedBy: leaderUserId }).then(() => queryClient.invalidateQueries({ queryKey: ["iw_shift_temp_operators", shiftQuery.data?.id] }))}
                  >
                    <UserPlus className="h-4 w-4" /> {e.full_name}
                  </button>
                ))}
            </div>
          </div>
        </Panel>

        <Panel>
          <PanelHeader icon={<ClipboardList className="h-4 w-4" />} title="Krok 2 · Vyberte výroby" subtitle="Klikněte na produkty v pořadí priority (1. klik = nejvyšší priorita)" />
          <div className="flex flex-wrap gap-2 px-4 py-4 sm:px-5">
            {productions.length === 0 ? (
              <p className="text-sm text-muted-foreground">Zatím není zadaná žádná výroba - vyplň ji na kartě Mapa haly.</p>
            ) : (
              productions.map((production) => {
                const workstation = workstationsById.get(production.workstation_id);
                const rank = selectedOrder.indexOf(production.id);
                const selected = rank >= 0;
                return (
                  <button
                    key={production.id}
                    type="button"
                    className={`iw-btn ${selected ? "iw-btn-active" : ""}`}
                    onClick={() => setSelectedOrder((order) => toggleProductionSelection(order, production.id))}
                  >
                    {selected ? `#${rank + 1} ` : ""}
                    {workstation?.display_name ?? production.workstation_id} · {production.product_code}
                  </button>
                );
              })
            )}
          </div>
          <div className="border-t border-border px-4 py-3 sm:px-5">
            <button type="button" className="iw-btn iw-btn-active w-full justify-center sm:w-auto" disabled={productions.length === 0} onClick={() => void saveProductionSelection()}>
              Uložit výběr a priority
            </button>
          </div>
        </Panel>

        {productionsSaved || assignments.length > 0 ? (
          <Panel>
            <PanelHeader icon={<Users2 className="h-4 w-4" />} title="Krok 3 · Návrh rozdělení" subtitle={`${assignments.length} přiřazení · ruční úpravy "Přepočítat" nezahodí`} />
            <div className="flex justify-end px-4 pt-4 sm:px-5">
              <button type="button" className="iw-btn" onClick={() => void recompute()}>
                <RefreshCw className="h-4 w-4" /> Přepočítat
              </button>
            </div>
            <div className="divide-y divide-border/70">
              {[...grouped.entries()].map(([workstationId, group]) => {
                const workstation = workstationId ? workstationsById.get(workstationId) : null;
                return (
                  <div key={workstationId ?? "none"} className="px-4 py-3 sm:px-5">
                    <div className="mb-1.5 flex items-center gap-2">
                      <span className="iw-chip">{workstation?.area ?? "?"}</span>
                      <span className="iw-mono text-sm text-foreground/85">{workstation?.display_name ?? "Bez pracoviště"}</span>
                    </div>
                    <div className="grid gap-1.5">
                      {group.map((a) => (
                        <div key={a.id} className="flex flex-wrap items-center gap-2">
                          <span className={`iw-chip ${a.assignment_type === "temp" ? "iw-chip-temp" : ""}`}>
                            {employeesById.get(a.employee_id)?.full_name ?? a.employee_id}
                            {a.is_manual_override ? " ✎" : ""}
                          </span>
                          <select className="min-w-[9rem] flex-1 sm:flex-none" value={a.workstation_id ?? ""} onChange={(e) => void reassign(a.employee_id, e.target.value)} aria-label={`Přesunout ${employeesById.get(a.employee_id)?.full_name ?? a.employee_id}`}>
                            {a.workstation_id && !reassignmentTargets.some((t) => t.workstationId === a.workstation_id) ? <option value={a.workstation_id}>{workstation?.display_name ?? "Aktuální"}</option> : null}
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
              {assignments.length === 0 ? <div className="px-4 py-4 text-sm text-muted-foreground sm:px-5">Zatím žádný návrh - klikni na "Přepočítat".</div> : null}
            </div>
            <div className="border-t border-border px-4 py-4 sm:px-5">
              <span className="iw-label mr-3">Stav směny: {shiftQuery.data?.status ?? "…"}</span>
              <button type="button" className="iw-cta mt-3 w-full justify-center sm:mt-0 sm:w-auto" disabled={!isDraft || starting} onClick={() => void handleStart()}>
                <PlayCircle className="h-4 w-4" /> ZAHÁJIT VÝROBU
              </button>
            </div>
          </Panel>
        ) : null}
      </div>
    </AppShell>
  );
}
