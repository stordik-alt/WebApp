import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { KpiCard } from "@/components/Kpi";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
import { aggregateShifts, avgValid } from "@/lib/shifts";
import { avg, effectiveQuality, fmt, isoWeekMonday } from "@/lib/metrics";

export const Route = createFileRoute("/reporty")({
  head: () => ({
    meta: [
      { title: "Reporty – Výkonnost operátorů" },
      { name: "description", content: "Detailní report OEE, Quality Score, výpomoci a týmové spolupráce podle zaměstnance a období." },
      { property: "og:title", content: "Reporty – Výkonnost operátorů" },
      { property: "og:description", content: "Filtrovatelné reporty výkonnosti pracovníků výroby DPS." },
    ],
  }),
  component: ReportsPage,
});

function ReportsPage() {
  const { data: employees = [] } = useEmployees();
  const { records: daily, evaluations, links } = useShiftAggregates();
  const { data: weekly = [] } = useWeeklyRecords();

  const defFrom = new Date();
  defFrom.setMonth(defFrom.getMonth() - 3);
  const [from, setFrom] = useState(defFrom.toISOString().slice(0, 10));
  const [to, setTo] = useState(new Date().toISOString().slice(0, 10));
  const [employeeId, setEmployeeId] = useState("all");
  const [line, setLine] = useState("all");
  const [position, setPosition] = useState("all");

  const lines = [...new Set(daily.map((d) => d.line))].sort();
  const empName = (id: string) => employees.find((e) => e.id === id)?.full_name ?? "?";

  const filteredDaily = useMemo(
    () =>
      daily.filter(
        (d) =>
          d.work_date >= from &&
          d.work_date <= to &&
          (employeeId === "all" || d.employee_id === employeeId) &&
          (line === "all" || d.line === line) &&
          (position === "all" || d.position === position),
      ),
    [daily, from, to, employeeId, line, position],
  );

  /** Směnové agregáty – jednotka denního výkonu (průměr přes linky pracovníka). */
  const filteredShifts = useMemo(
    () => aggregateShifts(filteredDaily, evaluations, links),
    [filteredDaily, evaluations, links],
  );

  const filteredWeekly = useMemo(
    () =>
      weekly.filter((w) => {
        const monday = isoWeekMonday(w.iso_year, w.iso_week).toISOString().slice(0, 10);
        return (
          monday >= from && monday <= to && (employeeId === "all" || w.employee_id === employeeId)
        );
      }),
    [weekly, from, to, employeeId],
  );

  const perEmployee = useMemo(() => {
    const ids = [...new Set(filteredShifts.map((d) => d.employee_id))];
    return ids
      .map((id) => {
        const shifts = filteredShifts.filter((d) => d.employee_id === id);
        const rows = shifts.flatMap((s2) => s2.records);
        const q = filteredWeekly
          .filter((w) => w.employee_id === id)
          .map(effectiveQuality)
          .filter((v): v is number => v !== null);
        const teamIds = new Set<string>();
        shifts.forEach((s2) => s2.coworkerIds.forEach((c) => teamIds.add(c)));
        return {
          id,
          name: empName(id),
          shifts: shifts.length,
          lineRecords: rows.length,
          ha: rows.filter((r) => r.position === "HA").length,
          tup: rows.filter((r) => r.position === "TUP").length,
          oee: avgValid(shifts.map((s2) => s2.oee)),
          help: avgValid(shifts.map((s2) => s2.help)),
          quality: avg(q),
          alerts: filteredWeekly.filter((w) => w.employee_id === id && w.is_alert).length,
          team: [...teamIds].map(empName),
        };
      })
      .sort((a, b) => (b.oee ?? 0) - (a.oee ?? 0));
  }, [filteredShifts, filteredWeekly, employees]);

  return (
    <AppShell
      title="Reporty"
      subtitle="Detailní přehled OEE, Quality, výpomoci a týmů za zvolené období"
      actions={
        <Button variant="outline" disabled title="Export bude doplněn v dalším kroku">
          Export (připravujeme)
        </Button>
      }
    >
      <Card className="mb-6 grid gap-3 p-5 shadow-[var(--shadow-card)] md:grid-cols-5">
        <div className="grid gap-1.5">
          <Label>Od</Label>
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div className="grid gap-1.5">
          <Label>Do</Label>
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
        <div className="grid gap-1.5">
          <Label>Zaměstnanec</Label>
          <Select value={employeeId} onValueChange={setEmployeeId}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Všichni</SelectItem>
              {employees.map((e) => (
                <SelectItem key={e.id} value={e.id}>
                  {e.full_name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-1.5">
          <Label>Linka</Label>
          <Select value={line} onValueChange={setLine}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Všechny</SelectItem>
              {lines.map((l) => (
                <SelectItem key={l} value={l}>
                  {l}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-1.5">
          <Label>Pozice</Label>
          <Select value={position} onValueChange={setPosition}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Obě</SelectItem>
              <SelectItem value="HA">HA</SelectItem>
              <SelectItem value="TUP">TUP</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </Card>

      <div className="grid gap-4 md:grid-cols-4">
        <KpiCard label="Směn v období" value={filteredDaily.length} />
        <KpiCard label="Průměrné OEE" value={fmt(avgValid(filteredShifts.map((d) => d.oee)))} unit="%" />
        <KpiCard
          label="Průměrná výpomoc"
          value={fmt(avgValid(filteredShifts.map((d) => d.help)), 0)}
        />
        <KpiCard
          label="Quality Alerty"
          value={filteredWeekly.filter((w) => w.is_alert).length}
          tone={filteredWeekly.some((w) => w.is_alert) ? "danger" : "default"}
        />
      </div>

      <div className="mt-6 rounded-lg border border-border bg-card shadow-[var(--shadow-card)]">
        <div className="border-b border-border px-4 py-3 text-sm font-semibold">
          Souhrn podle zaměstnance
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Zaměstnanec</TableHead>
              <TableHead className="text-right">Směny</TableHead>
              <TableHead className="text-right">HA / TUP</TableHead>
              <TableHead className="text-right">Linek</TableHead>
              <TableHead className="text-right">Ø OEE (směnové)</TableHead>
              <TableHead className="text-right">Ø Quality</TableHead>
              <TableHead className="text-right">Ø Výpomoc</TableHead>
              <TableHead className="text-right">Alerty</TableHead>
              <TableHead>Spolupracoval s</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {perEmployee.length === 0 ? (
              <TableRow>
                <TableCell colSpan={9} className="text-muted-foreground">
                  Pro zvolené filtry nejsou žádná data.
                </TableCell>
              </TableRow>
            ) : (
              perEmployee.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-medium">{r.name}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.shifts}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {r.ha} / {r.tup}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{r.lineRecords}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmt(r.oee)} %</TableCell>
                  <TableCell className="text-right tabular-nums">{fmt(r.quality)}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmt(r.help, 0)}</TableCell>
                  <TableCell className="text-right">
                    {r.alerts > 0 ? (
                      <Badge variant="destructive">{r.alerts}</Badge>
                    ) : (
                      <span className="text-muted-foreground">0</span>
                    )}
                  </TableCell>
                  <TableCell className="max-w-[240px] truncate text-xs text-muted-foreground">
                    {r.team.join(", ") || "–"}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <div className="mt-6 rounded-lg border border-border bg-card shadow-[var(--shadow-card)]">
        <div className="border-b border-border px-4 py-3 text-sm font-semibold">
          Detail linkových záznamů ({filteredDaily.length}) – auditní zdroj
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Datum</TableHead>
              <TableHead>Směna</TableHead>
              <TableHead>Linka</TableHead>
              <TableHead>Výrobek</TableHead>
              <TableHead>Zaměstnanec</TableHead>
              <TableHead>Pozice</TableHead>
              <TableHead className="text-right">OEE</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredDaily.slice(0, 200).map((d) => (
              <TableRow key={d.id}>
                <TableCell>{d.work_date}</TableCell>
                <TableCell>{d.shift}</TableCell>
                <TableCell>{d.line}</TableCell>
                <TableCell>{d.product ?? "–"}</TableCell>
                <TableCell>{empName(d.employee_id)}</TableCell>
                <TableCell>{d.position}</TableCell>
                <TableCell className="text-right tabular-nums">{fmt(d.oee)} %</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </AppShell>
  );
}
