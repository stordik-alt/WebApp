import { createFileRoute, Link } from "@tanstack/react-router";
import { localDateKey } from "@/lib/metrics";
import { useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useEmployees, useShiftAggregates, useWeeklyRecords } from "@/lib/data";
import { aggregateShifts } from "@/lib/shifts";
import {
  MIN_SHIFTS_QUARTER,
  computePerformance,
  fmt,
  halfOf,
  isoWeekMonday,
  quarterOf,
} from "@/lib/metrics";
import { FlaskConical } from "lucide-react";
import { EmptyState } from "@/components/EmptyState";

export const Route = createFileRoute("/analyza")({
  head: () => ({
    meta: [
      { title: "Analýza a IPI – Výkonnost operátorů" },
      { name: "description", content: "Čtvrtletní předběžná individuální výkonnost a půlroční celková výkonnost pracovníků včetně modulu IPI." },
      { property: "og:title", content: "Analýza a IPI – Výkonnost operátorů" },
      { property: "og:description", content: "Analytický modul IPI pro hodnocení výkonnosti ve výrobě DPS." },
    ],
  }),
  component: AnalysisPage,
});

function AnalysisPage() {
  const { data: employees = [] } = useEmployees();
  const { records: daily, evaluations, links } = useShiftAggregates();
  const { data: weekly = [] } = useWeeklyRecords();
  const [mode, setMode] = useState<"quarter" | "half">("quarter");

  const periods = useMemo(() => {
    const keys = new Set(daily.map((d) => (mode === "quarter" ? quarterOf(d.work_date) : halfOf(d.work_date))));
    return [...keys].sort().reverse();
  }, [daily, mode]);

  const [period, setPeriod] = useState<string>("");
  const active = period && periods.includes(period) ? period : (periods[0] ?? "");
  const minShifts = mode === "quarter" ? MIN_SHIFTS_QUARTER : MIN_SHIFTS_QUARTER * 2;

  const rows = useMemo(() => {
    if (!active) return [];
    return employees
      .map((e) => {
        const d = daily.filter(
          (r) =>
            r.employee_id === e.id &&
            (mode === "quarter" ? quarterOf(r.work_date) : halfOf(r.work_date)) === active,
        );
        const w = weekly.filter((r) => {
          if (r.employee_id !== e.id) return false;
          const monday = localDateKey(isoWeekMonday(r.iso_year, r.iso_week));
          return (mode === "quarter" ? quarterOf(monday) : halfOf(monday)) === active;
        });
        const shifts = aggregateShifts(d, evaluations, links);
        return { employee: e, perf: computePerformance(shifts, w, minShifts) };
      })
      .filter((r) => r.perf.shifts > 0)
      .sort((a, b) => (b.perf.ipi ?? 0) - (a.perf.ipi ?? 0));
  }, [employees, daily, evaluations, links, weekly, active, mode, minShifts]);

  return (
    <AppShell
      title="Analýza výkonnosti"
      subtitle={
        mode === "quarter"
          ? "Čtvrtletní předběžná individuální výkonnost"
          : "Půlroční celková výkonnost"
      }
    >
      <Card className="mb-6 border-l-4 border-l-warning p-4 shadow-[var(--shadow-card)]">
        <div className="flex items-start gap-3">
          <FlaskConical className="mt-0.5 h-5 w-5 text-warning" />
          <div className="text-sm">
            <p className="font-semibold">IPI je zatím samostatný, předběžný analytický modul</p>
            <p className="mt-1 text-muted-foreground">
              Aktuální návrh: IPI = 0,60 × Ø OEE + 0,25 × normalizované Quality Score + 0,15 ×
              normalizovaná výpomoc (škály -100…+100 se převádějí na 0…100; váhy se dopočítávají
              podle dostupných složek). Přesný matematický model doladíme na reálných datech –
              hodnoty berte jako orientační. Dostatek dat = alespoň {minShifts} směn v období.
            </p>
          </div>
        </div>
      </Card>

      <Card className="mb-6 grid gap-3 p-5 shadow-[var(--shadow-card)] md:grid-cols-3">
        <div className="grid gap-1.5">
          <Label>Typ období</Label>
          <Select value={mode} onValueChange={(v) => setMode(v as "quarter" | "half")}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="quarter">Čtvrtletí</SelectItem>
              <SelectItem value="half">Půlrok</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-1.5">
          <Label>Období</Label>
          <Select value={active} onValueChange={setPeriod}>
            <SelectTrigger>
              <SelectValue placeholder="Žádná data" />
            </SelectTrigger>
            <SelectContent>
              {periods.map((p) => (
                <SelectItem key={p} value={p}>
                  {p}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </Card>

      <div className="rounded-lg border border-border bg-card shadow-[var(--shadow-card)]">
        <div className="hidden md:block">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Zaměstnanec</TableHead>
                <TableHead className="text-right">Směny</TableHead>
                <TableHead>Dostatek dat</TableHead>
                <TableHead className="text-right">Ø OEE</TableHead>
                <TableHead className="text-right">Ø Quality</TableHead>
                <TableHead className="text-right">Ø Výpomoc</TableHead>
                <TableHead className="text-right">IPI (předběžné)</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7}>
                    <EmptyState icon={FlaskConical} title="Pro zvolené období nejsou data." description="Zkuste zvolit jiné období nebo vyčkejte na další záznamy." />
                  </TableCell>
                </TableRow>
              ) : (
                rows.map(({ employee, perf }) => (
                  <TableRow key={employee.id}>
                    <TableCell className="font-medium">
                      <Link
                        to="/zamestnanec/$id"
                        params={{ id: employee.id }}
                        className="hover:underline"
                      >
                        {employee.full_name}
                      </Link>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{perf.shifts}</TableCell>
                    <TableCell>
                      {perf.enoughData ? (
                        <Badge className="bg-success text-success-foreground">Dostatečné</Badge>
                      ) : (
                        <Badge variant="outline" className="border-warning text-warning">
                          Málo dat
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{fmt(perf.avgOee)} %</TableCell>
                    <TableCell className="text-right tabular-nums">{fmt(perf.avgQuality)}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmt(perf.avgHelp, 0)}</TableCell>
                    <TableCell className="text-right font-semibold tabular-nums">
                      {fmt(perf.ipi)}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
        <div className="space-y-2 p-3 md:hidden">
          {rows.length === 0 ? (
            <EmptyState icon={FlaskConical} title="Pro zvolené období nejsou data." description="Zkuste zvolit jiné období nebo vyčkejte na další záznamy." />
          ) : (
            rows.map(({ employee, perf }) => (
              <div key={employee.id} className="rounded-[var(--radius-md)] border border-border bg-muted/25 p-3">
                <div className="flex items-center justify-between gap-2">
                  <Link to="/zamestnanec/$id" params={{ id: employee.id }} className="truncate font-medium hover:underline">{employee.full_name}</Link>
                  {perf.enoughData ? <Badge className="shrink-0 bg-success text-success-foreground">Dostatečné</Badge> : <Badge variant="outline" className="shrink-0 border-warning text-warning">Málo dat</Badge>}
                </div>
                <div className="mt-2.5 grid grid-cols-2 gap-2 border-t border-border pt-2.5 text-center sm:grid-cols-4">
                  <div><p className="text-[10px] uppercase tracking-[0.1em] text-muted-foreground">Směny</p><p className="text-sm font-semibold tabular-nums">{perf.shifts}</p></div>
                  <div><p className="text-[10px] uppercase tracking-[0.1em] text-muted-foreground">OEE</p><p className="text-sm font-semibold tabular-nums">{fmt(perf.avgOee)} %</p></div>
                  <div><p className="text-[10px] uppercase tracking-[0.1em] text-muted-foreground">Quality</p><p className="text-sm font-semibold tabular-nums">{fmt(perf.avgQuality)}</p></div>
                  <div><p className="text-[10px] uppercase tracking-[0.1em] text-muted-foreground">IPI</p><p className="text-sm font-semibold tabular-nums">{fmt(perf.ipi)}</p></div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </AppShell>
  );
}
