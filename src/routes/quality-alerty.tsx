import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { AlertTriangle, ShieldCheck } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { EmptyState } from "@/components/EmptyState";
import { KpiCard } from "@/components/Kpi";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { QualityAlertDialog } from "@/components/QualityAlertDialog";
import { useEmployees, useWeeklyRecords } from "@/lib/data";
import { fmt } from "@/lib/metrics";
import type { WeeklyRecord } from "@/lib/metrics";

export const Route = createFileRoute("/quality-alerty")({
  head: () => ({
    meta: [
      { title: "Quality Alerty – Výkonnost operátorů" },
      {
        name: "description",
        content:
          "Přehled Quality Alertů (Yield pod 79 %) s příčinou, poznámkou, chybou operátora a nastavením finálního Quality Score.",
      },
      { property: "og:title", content: "Quality Alerty – Výkonnost operátorů" },
      {
        property: "og:description",
        content: "Vyšetřování Quality Alertů a finální Quality Score ve výrobě DPS.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: QualityAlertsPage,
});

function QualityAlertsPage() {
  const { data: employees = [] } = useEmployees();
  const { data: weekly = [] } = useWeeklyRecords();
  const [row, setRow] = useState<WeeklyRecord | null>(null);

  const empName = (id: string) => employees.find((e) => e.id === id)?.full_name ?? "?";
  const alerts = useMemo(() => weekly.filter((w) => w.is_alert), [weekly]);
  const open = alerts.filter((w) => !w.alert_resolved);
  const resolved = alerts.filter((w) => w.alert_resolved);

  return (
    <AppShell
      title="Quality Alerty"
      subtitle="Yield pod 79 % · automatické skóre se nepoužije, alert vyžaduje vyšetření"
    >
      <div className="grid gap-4 sm:grid-cols-3">
        <KpiCard label="Alertů celkem" value={alerts.length} />
        <KpiCard
          label="Nevyřešeno"
          value={open.length}
          tone={open.length > 0 ? "danger" : "success"}
          icon={<AlertTriangle className="h-4 w-4" />}
        />
        <KpiCard label="Vyřešeno" value={resolved.length} tone="success" />
      </div>

      <div className="mt-6 min-w-0 overflow-hidden rounded-lg border border-border bg-card shadow-[var(--shadow-card)]">
        <div className="border-b border-border px-4 py-3 text-sm font-semibold">
          Přehled Quality Alertů
        </div>
        <div className="hidden md:block">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Zaměstnanec</TableHead>
                <TableHead>Týden</TableHead>
                <TableHead className="text-right">Yield</TableHead>
                <TableHead>Příčina</TableHead>
                <TableHead>Poznámka</TableHead>
                <TableHead>Chyba operátora</TableHead>
                <TableHead className="text-right">Finální skóre</TableHead>
                <TableHead>Stav</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {alerts.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={9}>
                    <EmptyState icon={ShieldCheck} title="Žádné Quality Alerty." description="Všechny týdenní záznamy jsou v pořádku." />
                  </TableCell>
                </TableRow>
              ) : (
                alerts.map((w) => (
                  <TableRow key={w.id} className={w.alert_resolved ? "" : "bg-destructive/5"}>
                    <TableCell className="font-medium">{empName(w.employee_id)}</TableCell>
                    <TableCell>
                      {w.iso_year}/T{w.iso_week}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{fmt(w.yield_pct)} %</TableCell>
                    <TableCell className="max-w-[180px] truncate text-xs">
                      {w.alert_cause ?? "–"}
                    </TableCell>
                    <TableCell className="max-w-[220px] truncate text-xs text-muted-foreground">
                      {w.alert_note ?? "–"}
                    </TableCell>
                    <TableCell className="text-xs">
                      {w.operator_error === null || w.operator_error === undefined
                        ? "–"
                        : w.operator_error
                          ? "Ano"
                          : "Ne"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {fmt(w.final_quality_score)}
                    </TableCell>
                    <TableCell>
                      {w.alert_resolved ? (
                        <Badge variant="outline">Vyřešeno</Badge>
                      ) : (
                        <Badge variant="destructive">Nevyřešeno</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button size="sm" variant="outline" onClick={() => setRow(w)}>
                        {w.alert_resolved ? "Upravit" : "Vyšetřit"}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
        <div className="space-y-2 p-3 md:hidden">
          {alerts.length === 0 ? (
            <EmptyState icon={ShieldCheck} title="Žádné Quality Alerty." description="Všechny týdenní záznamy jsou v pořádku." />
          ) : (
            alerts.map((w) => (
              <div key={w.id} className={`rounded-[var(--radius-md)] border p-3 ${w.alert_resolved ? "border-border bg-muted/25" : "border-destructive/30 bg-destructive/5"}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0"><p className="truncate font-medium">{empName(w.employee_id)}</p><p className="mt-0.5 text-xs text-muted-foreground">{w.iso_year}/T{w.iso_week} · {w.alert_cause ?? "Bez příčiny"}</p></div>
                  {w.alert_resolved ? <Badge variant="outline" className="shrink-0">Vyřešeno</Badge> : <Badge variant="destructive" className="shrink-0">Nevyřešeno</Badge>}
                </div>
                {w.alert_note ? <p className="mt-2 truncate text-xs text-muted-foreground">{w.alert_note}</p> : null}
                <div className="mt-2.5 grid grid-cols-2 gap-2 border-t border-border pt-2.5 text-center sm:grid-cols-3">
                  <div><p className="text-[10px] uppercase tracking-[0.1em] text-muted-foreground">Yield</p><p className="text-sm font-semibold tabular-nums">{fmt(w.yield_pct)} %</p></div>
                  <div><p className="text-[10px] uppercase tracking-[0.1em] text-muted-foreground">Skóre</p><p className="text-sm font-semibold tabular-nums">{fmt(w.final_quality_score)}</p></div>
                  <div><p className="text-[10px] uppercase tracking-[0.1em] text-muted-foreground">Chyba op.</p><p className="text-sm font-semibold">{w.operator_error === null || w.operator_error === undefined ? "–" : w.operator_error ? "Ano" : "Ne"}</p></div>
                </div>
                <div className="mt-3 flex justify-end border-t border-border pt-2"><Button size="sm" variant="outline" onClick={() => setRow(w)}>{w.alert_resolved ? "Upravit" : "Vyšetřit"}</Button></div>
              </div>
            ))
          )}
        </div>
      </div>

      <QualityAlertDialog
        row={row}
        employeeName={row ? empName(row.employee_id) : undefined}
        onClose={() => setRow(null)}
      />
    </AppShell>
  );
}
