import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Factory } from "lucide-react";
import { useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { FloorMap, type FloorMapWorkstationView } from "@/components/interaktivni/FloorMap";
import { Panel, PanelHeader } from "@/components/interaktivni/Panel";
import { useShiftSelection } from "@/components/interaktivni/ShiftSelectionContext";
import { listWorkstations, type IwWorkstation } from "@/lib/floorMap";
import { computeExpectedCompletion } from "@/lib/shift-eta";
import { productCapacityFor, productionCapacity } from "@/lib/production-capacity";
import { listAssignments } from "@/lib/shiftAssignments";
import { ensureShift, listActiveProductions, resolveProductProfile, startProduction, updateProduction } from "@/lib/shiftProductions";

export const Route = createFileRoute("/interaktivni/mapa")({
  head: () => ({
    meta: [
      { title: "Mapa haly – Interaktivní prostředí" },
      { name: "description", content: "Zadání výroby a zbývajících kusů na každou linku + aktuální stav haly." },
    ],
  }),
  component: FloorMapPage,
});

function nowHHMM() {
  return new Date().toISOString().slice(11, 16);
}

function FloorMapPage() {
  const { leaderUserId, canManage, teamId, workDate, shift } = useShiftSelection();
  const queryClient = useQueryClient();
  const [drafts, setDrafts] = useState<Record<string, { code: string; pieces: string }>>({});

  const shiftQuery = useQuery({
    queryKey: ["iw_shift", teamId, workDate, shift],
    queryFn: () => ensureShift({ teamId: teamId as string, workDate, shift, createdBy: leaderUserId as string }),
    enabled: Boolean(teamId) && Boolean(leaderUserId),
  });

  const workstationsQuery = useQuery({ queryKey: ["iw_workstations"], queryFn: listWorkstations });
  const mainWorkstations = (workstationsQuery.data ?? []).filter((w) => !w.is_secondary);

  const productionsQuery = useQuery({
    queryKey: ["iw_shift_productions", shiftQuery.data?.id],
    queryFn: () => listActiveProductions(shiftQuery.data!.id),
    enabled: Boolean(shiftQuery.data),
  });
  const productions = productionsQuery.data ?? [];
  const productionByWorkstation = useMemo(() => new Map(productions.map((p) => [p.workstation_id, p])), [productions]);

  const assignmentsQuery = useQuery({ queryKey: ["iw_shift_assignments", shiftQuery.data?.id], queryFn: () => listAssignments(shiftQuery.data!.id), enabled: Boolean(shiftQuery.data) });

  const profilesQuery = useQuery({
    queryKey: ["iw_resolved_profiles", productions.map((p) => p.product_code).join(","), workDate],
    queryFn: async () => {
      const entries = await Promise.all(productions.map(async (p) => [p.product_code, await resolveProductProfile(p.product_code, workDate)] as const));
      return new Map(entries);
    },
    enabled: productions.length > 0,
  });

  const totalCapacity = useMemo(() => {
    if (!profilesQuery.data) return 0;
    return productionCapacity(
      productions.map((p) => {
        const profile = profilesQuery.data!.get(p.product_code);
        return { area: p.area, h_capacity: profile?.h_capacity ?? null, t_capacity: profile?.t_capacity ?? null };
      }),
    );
  }, [productions, profilesQuery.data]);

  async function invalidate() {
    await queryClient.invalidateQueries({ queryKey: ["iw_shift_productions", shiftQuery.data?.id] });
  }

  async function setProduction(workstation: IwWorkstation) {
    const draft = drafts[workstation.id];
    if (!draft?.code.trim()) return;
    const pieces = Number(draft.pieces);
    if (!Number.isFinite(pieces) || pieces < 0) return;
    const existing = productionByWorkstation.get(workstation.id);
    if (existing) {
      await updateProduction(existing.id, { remaining_pieces: pieces });
    } else {
      await startProduction({
        shiftId: shiftQuery.data!.id,
        workstationId: workstation.id,
        productCode: draft.code.trim(),
        area: workstation.area === "TUP" ? "TUP" : "HA",
        remainingPieces: pieces,
      });
    }
    await invalidate();
  }

  const groups = useMemo(() => {
    const workstations = workstationsQuery.data ?? [];
    const assignmentsByWorkstation = new Map<string, { count: number; hasTemp: boolean }>();
    for (const a of assignmentsQuery.data ?? []) {
      if (!a.workstation_id) continue;
      const current = assignmentsByWorkstation.get(a.workstation_id) ?? { count: 0, hasTemp: false };
      current.count += 1;
      if (a.assignment_type === "temp") current.hasTemp = true;
      assignmentsByWorkstation.set(a.workstation_id, current);
    }

    const views: FloorMapWorkstationView[] = workstations.map((workstation) => {
      const production = productionByWorkstation.get(workstation.id);
      const assignment = assignmentsByWorkstation.get(workstation.id) ?? { count: 0, hasTemp: false };
      const profile = production ? profilesQuery.data?.get(production.product_code) : null;
      const capacity = profile ? (workstation.area === "TUP" ? profile.t_capacity : profile.h_capacity) : null;
      const norm = profile ? (workstation.area === "TUP" ? profile.t_norm_per_hour : profile.h_norm_per_hour) : null;
      let expectedCompletionLabel: string | null = null;
      if (production && capacity && norm && assignment.count > 0) {
        const eta = computeExpectedCompletion({
          shift,
          workDate,
          fromTime: nowHHMM(),
          remainingPieces: production.remaining_pieces,
          normPerHour: norm,
          designedCapacity: capacity,
          assignedOperators: assignment.count,
        });
        if (eta.status === "WILL_FINISH") expectedCompletionLabel = `Dokončení: ${new Date(eta.expectedCompletionAt).toLocaleTimeString("cs-CZ", { hour: "2-digit", minute: "2-digit" })}`;
        if (eta.status === "WONT_FINISH") expectedCompletionLabel = "Výrobek se během této směny nevyrobí.";
      }
      return {
        workstation,
        productCode: production?.product_code ?? null,
        remainingPieces: production?.remaining_pieces ?? null,
        designedCapacity: capacity,
        assignedCount: assignment.count,
        hasTemp: assignment.hasTemp,
        expectedCompletionLabel,
      };
    });
    const result = new Map<string, FloorMapWorkstationView[]>();
    for (const view of views) {
      const list = result.get(view.workstation.group_name) ?? [];
      list.push(view);
      result.set(view.workstation.group_name, list);
    }
    return result;
  }, [workstationsQuery.data, productionByWorkstation, assignmentsQuery.data, profilesQuery.data, shift, workDate]);

  if (!canManage) {
    return (
      <AppShell title="Mapa haly" subtitle="Aktuální stav výrobní haly.">
        <Panel className="p-5 text-sm text-muted-foreground">Tato stránka je určena pro Team Leadery a administrátory.</Panel>
      </AppShell>
    );
  }

  return (
    <AppShell title="Mapa haly" subtitle="Zadej výrobu a zbývající kusy na každou linku - kapacita a dokončení se počítají živě.">
      <div className="grid min-w-0 gap-4 sm:gap-6">
        <Panel>
          <PanelHeader icon={<Factory className="h-4 w-4" />} title="Výroba na lince" subtitle="Kód produktu + zbývající kusy; priorita se nastavuje až v Rozdělení výroby" />
          <div className="divide-y divide-white/10">
            {mainWorkstations.map((workstation) => {
              const production = productionByWorkstation.get(workstation.id);
              const draft = drafts[workstation.id] ?? { code: production?.product_code ?? "", pieces: production ? String(production.remaining_pieces) : "" };
              const profile = production ? profilesQuery.data?.get(production.product_code) : null;
              const capacity = profile ? productCapacityFor({ area: workstation.area === "TUP" ? "TUP" : "HA", h_capacity: profile.h_capacity, t_capacity: profile.t_capacity }) : null;

              return (
                <div key={workstation.id} className="grid gap-2 px-4 py-3 sm:grid-cols-[160px_1fr_80px_auto_1fr] sm:items-center sm:px-5">
                  <div className="flex items-center gap-2">
                    <span className="iw-chip">{workstation.area}</span>
                    <span className="iw-mono truncate text-sm text-foreground/85">{workstation.display_name}</span>
                  </div>
                  <input
                    value={draft.code}
                    onChange={(e) => setDrafts((d) => ({ ...d, [workstation.id]: { ...draft, code: e.target.value } }))}
                    placeholder="Kód produktu"
                    aria-label="Kód produktu"
                  />
                  <input
                    value={draft.pieces}
                    onChange={(e) => setDrafts((d) => ({ ...d, [workstation.id]: { ...draft, pieces: e.target.value } }))}
                    placeholder="Ks"
                    inputMode="numeric"
                    aria-label="Zbývající kusy"
                  />
                  <button type="button" className="iw-btn" onClick={() => void setProduction(workstation)}>
                    {production ? "Aktualizovat" : "Uložit"}
                  </button>
                  <div className="iw-mono text-[11px] text-muted-foreground">{capacity ? <span>Kapacita produktu: {capacity}</span> : null}</div>
                </div>
              );
            })}
          </div>
        </Panel>

        <div className="iw-mono px-1 text-sm text-foreground/80">
          <span className="text-muted-foreground">Kapacita výroby (součet přes všechny aktivní linky):</span> <span className="font-semibold text-[hsl(152_65%_58%)]">{totalCapacity} operátorů</span>
        </div>

        <FloorMap groups={groups} />
      </div>
    </AppShell>
  );
}
