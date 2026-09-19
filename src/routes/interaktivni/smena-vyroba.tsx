import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Factory } from "lucide-react";
import { useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { Panel, PanelHeader } from "@/components/interaktivni/Panel";
import { useAuth } from "@/lib/auth";
import { listWorkstations, type IwWorkstation } from "@/lib/floorMap";
import { computeExpectedCompletion } from "@/lib/shift-eta";
import { productCapacityFor, productionCapacity } from "@/lib/production-capacity";
import {
  ensureShift,
  listActiveProductions,
  resolveProductProfile,
  startProduction,
  updateProduction,
  type IwShiftProduction,
} from "@/lib/shiftProductions";
import type { IwShiftName } from "@/lib/shift-windows";
import { ensureTeamForLeader } from "@/lib/teams";

export const Route = createFileRoute("/interaktivni/smena-vyroba")({
  head: () => ({
    meta: [
      { title: "Výroba směny – Interaktivní prostředí" },
      { name: "description", content: "Aktuální výroby na pracovištích, kapacita výroby a předpokládané dokončení." },
    ],
  }),
  component: ShiftProductionPage,
});

const SHIFTS: IwShiftName[] = ["Ranní", "Odpolední", "Noční"];

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}
function nowHHMM() {
  return new Date().toISOString().slice(11, 16);
}

function ShiftProductionPage() {
  const { session, isTeamLeader, isAdmin } = useAuth();
  const queryClient = useQueryClient();
  const [workDate, setWorkDate] = useState(todayIso());
  const [shift, setShift] = useState<IwShiftName>("Ranní");
  const [drafts, setDrafts] = useState<Record<string, { code: string; pieces: string; priority: string }>>({});

  const leaderUserId = session?.user.id ?? null;
  const canManage = isTeamLeader || isAdmin;

  const teamQuery = useQuery({
    queryKey: ["iw_team", leaderUserId],
    queryFn: () => ensureTeamForLeader(leaderUserId as string),
    enabled: Boolean(leaderUserId) && canManage,
  });

  const shiftQuery = useQuery({
    queryKey: ["iw_shift", teamQuery.data?.id, workDate, shift],
    queryFn: () => ensureShift({ teamId: teamQuery.data!.id, workDate, shift, createdBy: leaderUserId as string }),
    enabled: Boolean(teamQuery.data) && Boolean(leaderUserId),
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
    const priority = draft.priority.trim() === "" ? null : Number(draft.priority);
    if (priority != null && (!Number.isFinite(priority) || priority < 1)) return;
    const existing = productionByWorkstation.get(workstation.id);
    if (existing) {
      await updateProduction(existing.id, { remaining_pieces: pieces, priority });
    } else {
      await startProduction({
        shiftId: shiftQuery.data!.id,
        workstationId: workstation.id,
        productCode: draft.code.trim(),
        area: workstation.area === "TUP" ? "TUP" : "HA",
        remainingPieces: pieces,
        priority,
      });
    }
    await invalidate();
  }

  if (!canManage) {
    return (
      <AppShell title="Výroba směny" subtitle="Aktuální výroby, kapacita a předpokládané dokončení.">
        <Panel className="p-5 text-sm text-white/60">Tato stránka je určena pro Team Leadery a administrátory.</Panel>
      </AppShell>
    );
  }

  return (
    <AppShell title="Výroba směny" subtitle="Kapacita výroby je součet kapacit produktu přes všechny aktivní výroby této směny.">
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
            <div className="iw-mono ml-auto text-sm text-white/80">
              <span className="text-white/45">Kapacita výroby:</span> <span className="font-semibold text-[hsl(152_65%_58%)]">{totalCapacity} operátorů</span>
            </div>
          </div>
        </Panel>

        <Panel>
          <PanelHeader icon={<Factory className="h-4 w-4" />} title="Hlavní pracoviště" subtitle="Kapacita/dokončení se počítají živě z product_profiles" />
          <div className="divide-y divide-white/10">
            {mainWorkstations.map((workstation) => {
              const production = productionByWorkstation.get(workstation.id);
              const draft = drafts[workstation.id] ?? {
                code: production?.product_code ?? "",
                pieces: production ? String(production.remaining_pieces) : "",
                priority: production?.priority != null ? String(production.priority) : "",
              };
              const profile = production ? profilesQuery.data?.get(production.product_code) : null;
              const capacity = profile ? productCapacityFor({ area: workstation.area === "TUP" ? "TUP" : "HA", h_capacity: profile.h_capacity, t_capacity: profile.t_capacity }) : null;
              const norm = profile ? (workstation.area === "TUP" ? profile.t_norm_per_hour : profile.h_norm_per_hour) : null;
              const eta =
                production && capacity && norm
                  ? computeExpectedCompletion({
                      shift,
                      workDate,
                      fromTime: nowHHMM(),
                      remainingPieces: production.remaining_pieces,
                      normPerHour: norm,
                      designedCapacity: capacity,
                      assignedOperators: capacity, // Fáze C teprve doplní skutečné přiřazení operátorů
                    })
                  : null;

              return (
                <div key={workstation.id} className="grid gap-2 px-4 py-3 sm:grid-cols-[160px_1fr_80px_90px_auto_1fr] sm:items-center sm:px-5">
                  <div className="flex items-center gap-2">
                    <span className="iw-chip">{workstation.area}</span>
                    <span className="iw-mono truncate text-sm text-white/85">{workstation.display_name}</span>
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
                  <input
                    value={draft.priority}
                    onChange={(e) => setDrafts((d) => ({ ...d, [workstation.id]: { ...draft, priority: e.target.value } }))}
                    placeholder="Priorita"
                    inputMode="numeric"
                    aria-label="Priorita (1 = nejvyšší, jen při nedostatku)"
                    title="Priorita 1 = nejvyšší; vyplňuje se jen při nedostatku operátorů"
                  />
                  <button type="button" className="iw-btn" onClick={() => void setProduction(workstation)}>
                    {production ? "Aktualizovat" : "Nastavit"}
                  </button>
                  <div className="iw-mono text-[11px] text-white/45">
                    {capacity ? <span>Kapacita produktu: {capacity}</span> : null}
                    {eta?.status === "WILL_FINISH" ? <span className="ml-2 text-[hsl(152_65%_58%)]">Dokončení: {new Date(eta.expectedCompletionAt).toLocaleTimeString("cs-CZ", { hour: "2-digit", minute: "2-digit" })}</span> : null}
                    {eta?.status === "WONT_FINISH" ? <span className="ml-2 text-[hsl(38_92%_62%)]">Výrobek se během této směny nevyrobí.</span> : null}
                  </div>
                </div>
              );
            })}
          </div>
        </Panel>
      </div>
    </AppShell>
  );
}
