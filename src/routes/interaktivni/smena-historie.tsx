import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { History } from "lucide-react";
import { useMemo } from "react";
import { Panel, PanelHeader } from "@/components/interaktivni/Panel";
import { useShiftSelection } from "@/components/interaktivni/ShiftSelectionContext";
import { useEmployees } from "@/lib/data";
import { listWorkstations } from "@/lib/floorMap";
import { getShiftSnapshot, listHistorySegments } from "@/lib/shiftHistory";
import { ensureShift } from "@/lib/shiftProductions";
import type { IwShiftName } from "@/lib/shift-windows";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/interaktivni/smena-historie")({
  head: () => ({
    meta: [
      { title: "Historie směny – Interaktivní prostředí" },
      { name: "description", content: "Srovnání plánovaného stavu (ZAHÁJIT VÝROBU) se skutečnými importy - jen pro přehled." },
    ],
  }),
  component: ShiftHistoryPage,
});

type ActualRecord = { employee_id: string; line: string; product: string | null; oee: number | null };

function useActualRecords(workDate: string, shift: IwShiftName, employeeIds: string[]) {
  return useQuery({
    queryKey: ["daily_records_reconciliation", workDate, shift, employeeIds.join(",")],
    queryFn: async (): Promise<ActualRecord[]> => {
      if (employeeIds.length === 0) return [];
      const { data, error } = await supabase.from("daily_records").select("employee_id, line, product, oee").eq("work_date", workDate).eq("shift", shift).in("employee_id", employeeIds);
      if (error) throw error;
      return (data ?? []) as ActualRecord[];
    },
    enabled: employeeIds.length > 0,
  });
}

/**
 * Čistě informativní srovnání: co modul naplánoval (iw_shift_history_segments
 * z okamžiku ZAHÁJIT VÝROBU) vedle toho, co OCR import skutečně potvrdil
 * (daily_records). Nikdy nic nezapisuje ani neopravuje - schvalovací
 * pipeline OCR importu zůstává jediným zdrojem pravdy pro skutečné výsledky.
 */
function ShiftHistoryPage() {
  const { leaderUserId, canManage, teamId, workDate, shift } = useShiftSelection();

  const shiftQuery = useQuery({
    queryKey: ["iw_shift", teamId, workDate, shift],
    queryFn: () => ensureShift({ teamId: teamId as string, workDate, shift, createdBy: leaderUserId as string }),
    enabled: Boolean(teamId) && Boolean(leaderUserId),
  });

  const employeesQuery = useEmployees();
  const workstationsQuery = useQuery({ queryKey: ["iw_workstations"], queryFn: listWorkstations });
  const workstationsById = useMemo(() => new Map((workstationsQuery.data ?? []).map((w) => [w.id, w])), [workstationsQuery.data]);
  const employeesById = useMemo(() => new Map((employeesQuery.data ?? []).map((e) => [e.id, e])), [employeesQuery.data]);

  const snapshotQuery = useQuery({ queryKey: ["iw_shift_snapshot", shiftQuery.data?.id], queryFn: () => getShiftSnapshot(shiftQuery.data!.id), enabled: Boolean(shiftQuery.data) });
  const segmentsQuery = useQuery({ queryKey: ["iw_shift_history_segments", shiftQuery.data?.id], queryFn: () => listHistorySegments(shiftQuery.data!.id), enabled: Boolean(shiftQuery.data) });

  const segments = segmentsQuery.data ?? [];
  const employeeIds = useMemo(() => [...new Set(segments.map((s) => s.employee_id))], [segments]);
  const actualQuery = useActualRecords(workDate, shift, employeeIds);
  const actualByEmployee = useMemo(() => {
    const map = new Map<string, ActualRecord[]>();
    for (const record of actualQuery.data ?? []) {
      const list = map.get(record.employee_id) ?? [];
      list.push(record);
      map.set(record.employee_id, list);
    }
    return map;
  }, [actualQuery.data]);

  if (!canManage) {
    return (
      
        <Panel className="p-5 text-sm text-muted-foreground">Tato stránka je určena pro Team Leadery a administrátory.</Panel>
      
    );
  }

  const hasSnapshot = Boolean(snapshotQuery.data);

  return (
    
      <div className="grid min-w-0 gap-4 sm:gap-6">
        <div className="iw-mono px-1 text-xs text-muted-foreground">Stav směny: {shiftQuery.data?.status ?? "…"}</div>

        <Panel>
          <PanelHeader icon={<History className="h-4 w-4" />} title="Časové úseky" subtitle="PERSON → ČAS → PRACOVIŠTĚ → VÝROBEK → KOLEGOVÉ → VÝSLEDEK" />
          {!hasSnapshot ? (
            <div className="px-4 py-4 text-sm text-muted-foreground sm:px-5">Tato směna ještě nebyla zahájena (ZAHÁJIT VÝROBU) - historie zatím neexistuje.</div>
          ) : (
            <div className="divide-y divide-border/70">
              {segments.map((segment) => {
                const workstation = workstationsById.get(segment.workstation_id);
                const employee = employeesById.get(segment.employee_id);
                const actuals = actualByEmployee.get(segment.employee_id) ?? [];
                return (
                  <div key={segment.id} className="grid gap-2 px-4 py-3 sm:grid-cols-2 sm:px-5">
                    <div>
                      <p className="iw-label mb-1">Plán (od {new Date(segment.segment_start_at).toLocaleTimeString("cs-CZ", { hour: "2-digit", minute: "2-digit" })}{segment.segment_end_at ? ` do ${new Date(segment.segment_end_at).toLocaleTimeString("cs-CZ", { hour: "2-digit", minute: "2-digit" })}` : ""})</p>
                      <p className="iw-mono text-sm text-foreground/85">{employee?.full_name ?? segment.employee_id}</p>
                      <p className="iw-mono text-xs text-muted-foreground">{workstation?.display_name ?? segment.workstation_id}{segment.product_code ? ` · ${segment.product_code}` : ""}</p>
                    </div>
                    <div>
                      <p className="iw-label mb-1">Skutečnost (daily_records)</p>
                      {actuals.length === 0 ? (
                        <p className="text-xs text-muted-foreground">Zatím nepotvrzeno importem.</p>
                      ) : (
                        actuals.map((record, index) => (
                          <p key={index} className="iw-mono text-xs text-foreground/70">
                            {record.line} · {record.product ?? "?"} {record.oee != null ? `· OEE ${Number(record.oee).toFixed(0)}%` : ""}
                          </p>
                        ))
                      )}
                    </div>
                  </div>
                );
              })}
              {segments.length === 0 ? <div className="px-4 py-4 text-sm text-muted-foreground sm:px-5">Žádné historické segmenty.</div> : null}
            </div>
          )}
        </Panel>
      </div>
    
  );
}
