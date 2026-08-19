import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
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
import { computePerformance, fmt, isoWeekMonday } from "@/lib/metrics";

export const Route = createFileRoute("/zebricek")({
  head: () => ({
    meta: [
      { title: "Žebříček pracovníků – Výkonnost operátorů" },
      { name: "description", content: "Pořadí pracovníků výroby DPS podle celkového výsledku za zvolené období s filtry na linku a pozici." },
      { property: "og:title", content: "Žebříček pracovníků – Výkonnost operátorů" },
      { property: "og:description", content: "Pořadí pracovníků podle celkového výsledku za zvolené období." },
    ],
  }),
  component: RankingPage,
});

function RankingPage() {
  const { data: employees = [] } = useEmployees();
  const { records: daily, evaluations, links } = useShiftAggregates();
  const { data: weekly = [] } = useWeeklyRecords();

  const defFrom = new Date();
  defFrom.setMonth(defFrom.getMonth() - 3);
  const [from, setFrom] = useState(defFrom.toISOString().slice(0, 10));
  const [to, setTo] = useState(new Date().toISOString().slice(0, 10));
  const [line, setLine] = useState("all");
  const [position, setPosition] = useState("all");
  const [onlyActive, setOnlyActive] = useState(true);
  const [minShifts, setMinShifts] = useState("5");

  const lines = [...new Set(daily.map((d) => d.line))].sort();

  const rows = useMemo(() => {
    return employees
      .filter((e) => !onlyActive || e.active)
      .map((e) => {
        const d = daily.filter(
          (r) =>
            r.employee_id === e.id &&
            r.work_date >= from &&
            r.work_date <= to &&
            (line === "all" || r.line === line) &&
            (position === "all" || r.position === position),
        );
        const w = weekly.filter((r) => {
          if (r.employee_id !== e.id) return false;
          const monday = isoWeekMonday(r.iso_year, r.iso_week).toISOString().slice(0, 10);
          return monday >= from && monday <= to;
        });
        const shifts = aggregateShifts(d, evaluations, links);
        return { employee: e, perf: computePerformance(shifts, w, Number(minShifts) || 0) };
      })
      .filter((r) => r.perf.shifts >= (Number(minShifts) || 0) && r.perf.ipi !== null)
      .sort((a, b) => (b.perf.ipi ?? 0) - (a.perf.ipi ?? 0));
  }, [employees, daily, evaluations, links, weekly, from, to, line, position, onlyActive, minShifts]);

  const medal = (i: number) => (i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `${i + 1}.`);

  return (
    <AppShell
      title="Žebříček"
      subtitle="Pořadí podle celkového výsledku (předběžný IPI) za zvolené období"
    >
      <Card className="mb-6 grid gap-3 p-5 shadow-[var(--shadow-card)] md:grid-cols-6">
        <div className="grid gap-1.5">
          <Label>Od</Label>
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div className="grid gap-1.5">
          <Label>Do</Label>
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
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
        <div className="grid gap-1.5">
          <Label>Min. počet směn</Label>
          <Input
            type="number"
            min={0}
            value={minShifts}
            onChange={(e) => setMinShifts(e.target.value)}
          />
        </div>
        <label className="flex items-end gap-2 pb-2 text-sm text-muted-foreground">
          <Switch checked={onlyActive} onCheckedChange={setOnlyActive} />
          Jen aktivní
        </label>
      </Card>

      <div className="rounded-lg border border-border bg-card shadow-[var(--shadow-card)]">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-16">Pořadí</TableHead>
              <TableHead>Zaměstnanec</TableHead>
              <TableHead className="text-right">Směny</TableHead>
              <TableHead className="text-right">Ø OEE</TableHead>
              <TableHead className="text-right">Ø Quality</TableHead>
              <TableHead className="text-right">Ø Výpomoc</TableHead>
              <TableHead className="text-right">Celkový výsledek</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-muted-foreground">
                  Pro zvolené filtry nejsou žádná data.
                </TableCell>
              </TableRow>
            ) : (
              rows.map(({ employee, perf }, i) => (
                <TableRow key={employee.id}>
                  <TableCell className="text-lg">{medal(i)}</TableCell>
                  <TableCell className="font-medium">
                    <Link
                      to="/zamestnanec/$id"
                      params={{ id: employee.id }}
                      className="hover:underline"
                    >
                      {employee.full_name}
                    </Link>
                    {!perf.enoughData ? (
                      <Badge variant="outline" className="ml-2 border-warning text-warning">
                        málo dat
                      </Badge>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{perf.shifts}</TableCell>
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
    </AppShell>
  );
}
