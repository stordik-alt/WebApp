import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { PlayCircle } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { FloorMap, type FloorMapWorkstationView } from "@/components/interaktivni/FloorMap";
import { useAuth } from "@/lib/auth";
import { listWorkstations } from "@/lib/floorMap";
import { computeExpectedCompletion } from "@/lib/shift-eta";
import { listAssignments, listTempOperators } from "@/lib/shiftAssignments";
import { startShiftProduction } from "@/lib/shiftHistory";
import { ensureShift, listActiveProductions, resolveProductProfile } from "@/lib/shiftProductions";
import type { IwShiftName } from "@/lib/shift-windows";
import { ensureTeamForLeader } from "@/lib/teams";

export const Route = createFileRoute("/interaktivni/mapa")({
  head: () => ({
    meta: [
      { title: "Mapa haly – Interaktivní prostředí" },
      { name: "description", content: "Aktuální stav výrobní haly, kapacita a ZAHÁJIT VÝROBU." },
    ],
  }),
  component: FloorMapPage,
});

const SHIFTS: IwShiftName[] = ["Ranní", "Odpolední", "Noční"];

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}
function nowHHMM() {
  return new Date().toISOString().slice(11, 16);
}

function FloorMapPage() {
  const { session, isTeamLeader, isAdmin } = useAuth();
  const queryClient = useQueryClient();
  const [workDate, setWorkDate] = useState(todayIso());
  const [shift, setShift] = useState<IwShiftName>("Ranní");
  const [starting, setStarting] = useState(false);

  const leaderUserId = session?.user.id ?? null;
  const canManage = isTeamLeader || isAdmin;

  const teamQuery = useQuery({ queryKey: ["iw_team", leaderUserId], queryFn: () => ensureTeamForLeader(leaderUserId as string), enabled: Boolean(leaderUserId) && canManage });
  const shiftQuery = useQuery({
    queryKey: ["iw_shift", teamQuery.data?.id, workDate, shift],
    queryFn: () => ensureShift({ teamId: teamQuery.data!.id, workDate, shift, createdBy: leaderUserId as string }),
    enabled: Boolean(teamQuery.data) && Boolean(leaderUserId),
  });

  const workstationsQuery = useQuery({ queryKey: ["iw_workstations"], queryFn: listWorkstations });
  const productionsQuery = useQuery({ queryKey: ["iw_shift_productions", shiftQuery.data?.id], queryFn: () => listActiveProductions(shiftQuery.data!.id), enabled: Boolean(shiftQuery.data) });
  const assignmentsQuery = useQuery({ queryKey: ["iw_shift_assignments", shiftQuery.data?.id], queryFn: () => listAssignments(shiftQuery.data!.id), enabled: Boolean(shiftQuery.data) });
  const tempOperatorsQuery = useQuery({ queryKey: ["iw_shift_temp_operators", shiftQuery.data?.id], queryFn: () => listTempOperators(shiftQuery.data!.id), enabled: Boolean(shiftQuery.data) });

  const profilesQuery = useQuery({
    queryKey: ["iw_resolved_profiles_map", (productionsQuery.data ?? []).map((p) => p.product_code).join(","), workDate],
    queryFn: async () => {
      const entries = await Promise.all((productionsQuery.data ?? []).map(async (p) => [p.product_code, await resolveProductProfile(p.product_code, workDate)] as const));
      return new Map(entries);
    },
    enabled: (productionsQuery.data ?? []).length > 0,
  });

  const groups = useMemo(() => {
    const workstations = workstationsQuery.data ?? [];
    const productionByWorkstation = new Map((productionsQuery.data ?? []).map((p) => [p.workstation_id, p]));
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
      if (production && capacity && norm) {
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
    // # dělá: seskupí view podle group_name ve stejném pořadí, v jakém jsou pracoviště seřazená (sort_order)
    const result = new Map<string, FloorMapWorkstationView[]>();
    for (const view of views) {
      const list = result.get(view.workstation.group_name) ?? [];
      list.push(view);
      result.set(view.workstation.group_name, list);
    }
    return result;
  }, [workstationsQuery.data, productionsQuery.data, assignmentsQuery.data, profilesQuery.data, shift, workDate]);

  async function handleStart() {
    if (!shiftQuery.data) return;
    setStarting(true);
    try {
      await startShiftProduction(shiftQuery.data.id);
      toast.success("Výroba zahájena, výchozí stav směny byl uložen.");
      await queryClient.invalidateQueries({ queryKey: ["iw_shift", teamQuery.data?.id, workDate, shift] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Zahájení výroby selhalo.");
    } finally {
      setStarting(false);
    }
  }

  if (!canManage) {
    return (
      <AppShell title="Mapa haly" subtitle="Aktuální stav výrobní haly.">
        <Card className="p-5 text-sm text-muted-foreground">Tato stránka je určena pro Team Leadery a administrátory.</Card>
      </AppShell>
    );
  }

  const isDraft = shiftQuery.data?.status === "draft";

  return (
    <AppShell title="Mapa haly" subtitle="Nedostatek operátorů nikdy neblokuje zahájení výroby.">
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
            <span className="text-xs text-muted-foreground">Stav směny: {shiftQuery.data?.status ?? "…"}</span>
            <Button className="ml-auto" disabled={!isDraft || starting} onClick={() => void handleStart()}>
              <PlayCircle className="mr-1 h-4 w-4" /> ZAHÁJIT VÝROBU
            </Button>
          </div>
        </Card>

        <FloorMap groups={groups} />
      </div>
    </AppShell>
  );
}
