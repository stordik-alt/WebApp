import { createFileRoute, Link } from "@tanstack/react-router";
import { tooltipStyle } from "@/lib/chart-theme";
import { useMemo } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { AlertTriangle, Gauge, HeartHandshake, Users } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { KpiCard } from "@/components/Kpi";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useEmployees, useShiftAggregates, useWeeklyRecords } from "@/lib/data";
import { avg, effectiveQuality, fmt } from "@/lib/metrics";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Dashboard – Výkonnost operátorů" },
      { name: "description", content: "Přehled výkonnosti pracovníků výroby DPS: OEE, Quality Score, výpomoc a otevřené Quality Alerty." },
      { property: "og:title", content: "Dashboard – Výkonnost operátorů" },
      { property: "og:description", content: "Interní nástroj pro hodnocení pracovníků ve výrobě DPS." },
    ],
  }),
  component: Dashboard,
});

function Dashboard() {
  const { data: employees = [] } = useEmployees();
  const { shifts: allShifts } = useShiftAggregates();
  const { data: weekly = [] } = useWeeklyRecords();

  const last30 = useMemo(() => {
    const limit = new Date();
    limit.setDate(limit.getDate() - 30);
    const iso = limit.toISOString().slice(0, 10);
    return allShifts.filter((d) => d.work_date >= iso);
  }, [allShifts]);

  // Denní jednotkou je směnový agregát pracovníka (průměr přes všechny jeho linky).
  const avgOee = avg(last30.map((d) => d.oee).filter((v): v is number => v !== null));
  const avgHelp = avg(last30.map((d) => d.help).filter((v): v is number => v !== null));
  const qualityValues = weekly
    .map(effectiveQuality)
    .filter((v): v is number => v !== null);
  const avgQuality = avg(qualityValues);
  const openAlerts = weekly.filter((w) => w.is_alert && !w.alert_resolved);

  const oeeTrend = useMemo(() => {
    const map = new Map<string, number[]>();
    last30.forEach((d) => {
      if (d.oee !== null) map.set(d.work_date, [...(map.get(d.work_date) ?? []), d.oee]);
    });
    return [...map.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, values]) => ({ date: date.slice(5), oee: Number(avg(values)?.toFixed(1)) }));
  }, [last30]);

  const perEmployee = useMemo(() => {
    return employees
      .filter((e) => e.active)
      .map((e) => ({
        name: e.full_name.split(" ").slice(-1)[0],
        oee: Number(
          avg(
            last30
              .filter((d) => d.employee_id === e.id)
              .map((d) => d.oee)
              .filter((v): v is number => v !== null),
          )?.toFixed(1) ?? 0,
        ),
      }))
      .filter((r) => r.oee > 0)
      .sort((a, b) => b.oee - a.oee)
      .slice(0, 10);
  }, [employees, last30]);

  const empName = (id: string) => employees.find((e) => e.id === id)?.full_name ?? "?";

  return (
    <AppShell
      title="Dashboard"
      subtitle="Souhrn za posledních 30 dní"
      actions={
        <>
          <Button asChild variant="outline">
            <Link to="/denni-data">Zadat denní data</Link>
          </Button>
          <Button asChild>
            <Link to="/tydenni-data">Zadat týdenní data</Link>
          </Button>
        </>
      }
    >
      {openAlerts.length > 0 ? (
        <div className="mb-6 rounded-lg border-2 border-destructive bg-destructive/5 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-5 w-5" />
              <span className="text-sm font-semibold uppercase tracking-wide">
                {openAlerts.length}× nevyřešený Quality Alert
              </span>
            </div>
            <Button asChild size="sm" variant="destructive">
              <Link to="/tydenni-data">Řešit alerty</Link>
            </Button>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {openAlerts.slice(0, 6).map((w) => (
              <Badge key={w.id} variant="outline" className="border-destructive/50">
                {empName(w.employee_id)} · T{w.iso_week} · {fmt(w.yield_pct)} %
              </Badge>
            ))}
          </div>
        </div>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="Průměrné OEE (30 dní)"
          value={fmt(avgOee)}
          unit="%"
          hint={`${last30.length} směn v období`}
          icon={<Gauge className="h-4 w-4" />}
        />
        <KpiCard
          label="Průměrné Quality Score"
          value={fmt(avgQuality)}
          hint={`${qualityValues.length} hodnocených týdnů`}
          tone={avgQuality !== null && avgQuality < 0 ? "danger" : "success"}
        />
        <KpiCard
          label="Průměrná výpomoc"
          value={fmt(avgHelp, 0)}
          hint="Škála -100 až +100"
          icon={<HeartHandshake className="h-4 w-4" />}
        />
        <KpiCard
          label="Aktivní zaměstnanci"
          value={employees.filter((e) => e.active).length}
          hint={`${employees.length} celkem v evidenci`}
          icon={<Users className="h-4 w-4" />}
        />
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-2">
        <Card className="gap-4 p-5 shadow-[var(--shadow-card)]">
          <h2 className="text-sm font-semibold">Vývoj průměrného OEE</h2>
          <div className="h-64">
            {oeeTrend.length === 0 ? (
              <p className="text-sm text-muted-foreground">Zatím žádná data.</p>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={oeeTrend}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis dataKey="date" fontSize={12} stroke="var(--muted-foreground)" />
                  <YAxis fontSize={12} stroke="var(--muted-foreground)" />
                  <Tooltip {...tooltipStyle} />
                  <Line type="monotone" dataKey="oee" stroke="var(--chart-1)" strokeWidth={2} />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
        </Card>

        <Card className="gap-4 p-5 shadow-[var(--shadow-card)]">
          <h2 className="text-sm font-semibold">TOP 10 – průměrné OEE podle zaměstnance</h2>
          <div className="h-64">
            {perEmployee.length === 0 ? (
              <p className="text-sm text-muted-foreground">Zatím žádná data.</p>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={perEmployee}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis dataKey="name" fontSize={12} stroke="var(--muted-foreground)" />
                  <YAxis fontSize={12} stroke="var(--muted-foreground)" />
                  <Tooltip {...tooltipStyle} />
                  <Bar dataKey="oee" fill="var(--chart-1)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </Card>
      </div>
    </AppShell>
  );
}
