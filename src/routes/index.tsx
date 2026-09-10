import { createFileRoute, Link } from "@tanstack/react-router";
import { tooltipStyle } from "@/lib/chart-theme";
import { useMemo, useState } from "react";
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
import {
  AlertTriangle,
  ArrowUpRight,
  Gauge,
  HeartHandshake,
  ShieldCheck,
  Sparkles,
  Users,
  Activity,
  CalendarDays,
  Boxes,
  CircleCheck,
} from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { KpiCard } from "@/components/Kpi";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useEmployees, useShiftAggregates, useWeeklyRecords } from "@/lib/data";
import { avg, effectiveQuality, fmt, isoWeekMonday } from "@/lib/metrics";

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

  const today = new Date();
  const defaultTo = today.toISOString().slice(0, 10);
  const defaultFromDate = new Date(today);
  defaultFromDate.setDate(defaultFromDate.getDate() - 29);
  const defaultFrom = defaultFromDate.toISOString().slice(0, 10);
  const [fromDate, setFromDate] = useState(defaultFrom);
  const [toDate, setToDate] = useState(defaultTo);

  const last30 = useMemo(() => {
    if (!fromDate && !toDate) return allShifts;
    return allShifts.filter((d) => {
      if (fromDate && d.work_date < fromDate) return false;
      if (toDate && d.work_date > toDate) return false;
      return true;
    });
  }, [allShifts, fromDate, toDate]);

  const weeklyInRange = useMemo(() => {
    if (!fromDate && !toDate) return weekly;
    return weekly.filter((w) => {
      const monday = isoWeekMonday(w.iso_year, w.iso_week).toISOString().slice(0, 10);
      if (fromDate && monday < fromDate) return false;
      if (toDate && monday > toDate) return false;
      return true;
    });
  }, [weekly, fromDate, toDate]);

  const avgOee = avg(last30.map((d) => d.oee).filter((v): v is number => v !== null));
  const avgHelp = avg(last30.map((d) => d.help).filter((v): v is number => v !== null));
  const qualityValues = weeklyInRange.map(effectiveQuality).filter((v): v is number => v !== null);
  const avgQuality = avg(qualityValues);
  const openAlerts = weeklyInRange.filter((w) => w.is_alert && !w.alert_resolved);
  const activeEmployees = employees.filter((e) => e.active);

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

  const shiftPerformance = useMemo(() => {
    const buckets = new Map<string, number[]>();
    last30.forEach((d) => {
      const key = d.shift_name ?? "Směna";
      if (d.oee !== null) buckets.set(key, [...(buckets.get(key) ?? []), d.oee]);
    });
    return [...buckets.entries()].map(([shift, values]) => ({
      shift,
      oee: Number(avg(values)?.toFixed(1) ?? 0),
    }));
  }, [last30]);

  const periodLabel = useMemo(() => {
    if (!last30.length) return "Vyberte období";
    const dates = last30.map((d) => d.work_date).sort();
    const from = dates[0]?.slice(5).replace("-", ". ") ?? "";
    const to = dates.at(-1)?.slice(5).replace("-", ". ") ?? "";
    return `${from} – ${to}`;
  }, [last30]);

  const empName = (id: string) => employees.find((e) => e.id === id)?.full_name ?? "?";

  const resetPeriod = () => {
    setFromDate(defaultFrom);
    setToDate(defaultTo);
  };

  return (
    <AppShell
      title="Dashboard"
      subtitle="Řídicí centrum výrobního výkonu"
      actions={
        <div className="flex flex-wrap items-center justify-end gap-2">
          <div className="flex items-center gap-2 rounded-xl border border-border/80 bg-card/55 px-2.5 py-1.5 shadow-sm">
            <CalendarDays className="h-4 w-4 shrink-0 text-primary" />
            <label className="sr-only" htmlFor="dashboard-from-date">Datum od</label>
            <input
              id="dashboard-from-date"
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              className="w-[118px] bg-transparent text-xs font-medium text-foreground outline-none"
              aria-label="Datum od"
            />
            <span className="text-xs text-muted-foreground">–</span>
            <label className="sr-only" htmlFor="dashboard-to-date">Datum do</label>
            <input
              id="dashboard-to-date"
              type="date"
              value={toDate}
              min={fromDate || undefined}
              onChange={(e) => setToDate(e.target.value)}
              className="w-[118px] bg-transparent text-xs font-medium text-foreground outline-none"
              aria-label="Datum do"
            />
            <button
              type="button"
              onClick={resetPeriod}
              className="rounded-lg px-2 py-1 text-[10px] font-semibold text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              30 dní
            </button>
          </div>
          <Button asChild variant="outline">
            <Link to="/denni-data">Zadat denní data</Link>
          </Button>
          <Button asChild>
            <Link to="/tydenni-data">Zadat týdenní data</Link>
          </Button>
        </div>
      }
    >
      <div className="relative overflow-hidden rounded-[1.35rem] border border-primary/15 bg-[radial-gradient(circle_at_90%_10%,hsl(var(--primary)/0.17),transparent_28%),radial-gradient(circle_at_15%_100%,hsl(var(--chart-4)/0.12),transparent_32%),hsl(var(--card)/0.9)] p-4 shadow-[var(--shadow-card)] backdrop-blur sm:p-5">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-[linear-gradient(90deg,transparent,hsl(var(--primary)/0.75),transparent)]" />
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="max-w-2xl">
            <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-primary">
              <Sparkles className="h-3 w-3" /> Live overview
            </div>
            <h2 className="text-xl font-semibold tracking-tight sm:text-2xl">Výkon je pod kontrolou.</h2>
            <p className="mt-1 text-sm text-muted-foreground">Jedním pohledem vidíte OEE, kvalitu, lidi i signály, které vyžadují pozornost.</p>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:min-w-[420px]">
            <MiniSignal icon={<CircleCheck className="h-4 w-4" />} label="Provoz" value={`${last30.length} směn`} tone="success" />
            <MiniSignal icon={<AlertTriangle className="h-4 w-4" />} label="Quality alerty" value={openAlerts.length} tone={openAlerts.length ? "warning" : "success"} />
            <MiniSignal icon={<Boxes className="h-4 w-4" />} label="Produkty" value="Aktivní" />
            <MiniSignal icon={<Users className="h-4 w-4" />} label="Lidé" value={activeEmployees.length} />
          </div>
        </div>
      </div>

      {openAlerts.length > 0 ? (
        <div className="mt-4 rounded-2xl border border-destructive/45 bg-destructive/5 p-4 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-5 w-5" />
              <div>
                <div className="text-sm font-semibold">Pozornost vyžaduje {openAlerts.length} Quality Alert{openAlerts.length === 1 ? "" : "y"}</div>
                <div className="text-xs text-muted-foreground">Neuzavřené záznamy čekají na vyřešení.</div>
              </div>
            </div>
            <Button asChild size="sm" variant="destructive">
              <Link to="/tydenni-data">Otevřít alerty</Link>
            </Button>
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {openAlerts.slice(0, 6).map((w) => (
              <div key={w.id} className="flex items-center justify-between gap-3 rounded-xl border border-destructive/15 bg-card/70 px-3 py-2">
                <span className="truncate text-xs font-medium">{empName(w.employee_id)}</span>
                <Badge variant="outline" className="shrink-0 border-destructive/35 text-destructive">T{w.iso_week}</Badge>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Průměrné OEE (30 dní)" value={fmt(avgOee)} unit="%" hint={`${last30.length} směn v období`} icon={<Gauge className="h-4 w-4" />} />
        <KpiCard label="Průměrné Quality Score" value={fmt(avgQuality)} hint={`${qualityValues.length} hodnocených týdnů`} tone={avgQuality !== null && avgQuality < 0 ? "danger" : "success"} icon={<ShieldCheck className="h-4 w-4" />} />
        <KpiCard label="Průměrná výpomoc" value={fmt(avgHelp, 0)} hint="Škála -100 až +100" icon={<HeartHandshake className="h-4 w-4" />} />
        <KpiCard label="Aktivní zaměstnanci" value={activeEmployees.length} hint={`${employees.length} celkem v evidenci`} icon={<Users className="h-4 w-4" />} />
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-[1.55fr_1fr_0.78fr]">
        <Card className="relative overflow-hidden p-5 shadow-[var(--shadow-card)]">
          <CardHeaderRow title="Vývoj průměrného OEE" icon={<Activity className="h-4 w-4" />} action={periodLabel} />
          <div className="mt-4 h-72">
            {oeeTrend.length === 0 ? (
              <EmptyChart />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={oeeTrend} margin={{ left: 0, right: 8, top: 8, bottom: 2 }}>
                  <defs>
                    <linearGradient id="dashboardOeeLine" x1="0" y1="0" x2="1" y2="0">
                      <stop offset="0%" stopColor="hsl(var(--chart-1))" />
                      <stop offset="55%" stopColor="hsl(var(--primary))" />
                      <stop offset="100%" stopColor="hsl(var(--chart-3))" />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.45} vertical={false} />
                  <XAxis dataKey="date" fontSize={11} stroke="hsl(var(--muted-foreground))" tickLine={false} axisLine={false} />
                  <YAxis fontSize={11} stroke="hsl(var(--muted-foreground))" tickLine={false} axisLine={false} width={28} />
                  <Tooltip {...tooltipStyle} />
                  <Line type="monotone" dataKey="oee" stroke="url(#dashboardOeeLine)" strokeWidth={3} dot={{ r: 3.5, fill: "hsl(var(--primary))", strokeWidth: 0 }} activeDot={{ r: 5 }} />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
          <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
            <span>Trend výkonu za vybrané období</span>
            <span className="inline-flex items-center gap-1 text-primary"><ArrowUpRight className="h-3.5 w-3.5" /> stabilní signál</span>
          </div>
        </Card>

        <Card className="p-5 shadow-[var(--shadow-card)]">
          <CardHeaderRow title="TOP 10 – OEE" icon={<Users className="h-4 w-4" />} action="Nejlepší výkon" />
          <div className="mt-4 h-72">
            {perEmployee.length === 0 ? (
              <EmptyChart />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={perEmployee} margin={{ left: -18, right: 4, top: 8, bottom: 2 }}>
                  <defs>
                    <linearGradient id="dashboardOeeBars" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="hsl(var(--chart-1))" />
                      <stop offset="100%" stopColor="hsl(var(--chart-3))" />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.35} vertical={false} />
                  <XAxis dataKey="name" fontSize={10} stroke="hsl(var(--muted-foreground))" tickLine={false} axisLine={false} />
                  <YAxis fontSize={10} stroke="hsl(var(--muted-foreground))" tickLine={false} axisLine={false} width={28} />
                  <Tooltip {...tooltipStyle} />
                  <Bar dataKey="oee" fill="url(#dashboardOeeBars)" radius={[6, 6, 2, 2]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </Card>

        <Card className="p-5 shadow-[var(--shadow-card)]">
          <CardHeaderRow title="Rychlý přehled" icon={<Sparkles className="h-4 w-4" />} action="Stav systému" />
          <div className="mt-4 space-y-2.5">
            <InsightRow icon={<CircleCheck className="h-4 w-4" />} title="Výrobní linky" value={`${last30.length ? "V provozu" : "Čekají"}`} tone="success" />
            <InsightRow icon={<AlertTriangle className="h-4 w-4" />} title="Quality alerty" value={String(openAlerts.length)} tone={openAlerts.length ? "warning" : "success"} />
            <InsightRow icon={<Boxes className="h-4 w-4" />} title="Produkty / normy" value="Aktivní" />
            <InsightRow icon={<Users className="h-4 w-4" />} title="Zaměstnanci" value={`${activeEmployees.length} aktivních`} />
            <div className="mt-4 rounded-xl border border-primary/15 bg-primary/5 p-3">
              <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-primary">Doporučení</div>
              <div className="mt-1 text-sm font-medium">Sledujte OEE a Quality společně.</div>
              <div className="mt-1 text-xs leading-relaxed text-muted-foreground">Výkon má smysl hodnotit až v kontextu kvality a stabilních dat.</div>
            </div>
          </div>
        </Card>
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-[0.8fr_1.35fr]">
        <Card className="p-5 shadow-[var(--shadow-card)]">
          <CardHeaderRow title="OEE podle směn" icon={<Gauge className="h-4 w-4" />} action="Srovnání" />
          <div className="mt-4 space-y-3">
            {shiftPerformance.length === 0 ? (
              <p className="text-sm text-muted-foreground">Zatím žádná data.</p>
            ) : (
              shiftPerformance.map((row) => (
                <div key={row.shift}>
                  <div className="mb-1.5 flex items-center justify-between text-xs">
                    <span className="font-medium">{row.shift}</span>
                    <span className="font-semibold text-primary">{fmt(row.oee)} %</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-muted/70">
                    <div className="h-full rounded-full bg-[linear-gradient(90deg,hsl(var(--chart-4)),hsl(var(--primary)),hsl(var(--chart-1)))]" style={{ width: `${Math.max(4, Math.min(100, row.oee))}%` }} />
                  </div>
                </div>
              ))
            )}
          </div>
        </Card>

        <Card className="p-5 shadow-[var(--shadow-card)]">
          <CardHeaderRow title="Poslední signály" icon={<AlertTriangle className="h-4 w-4" />} action="Aktivita" />
          <div className="mt-4 divide-y divide-border/70">
            {openAlerts.slice(0, 5).map((w) => (
              <div key={w.id} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
                <div className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-destructive/10 text-destructive"><AlertTriangle className="h-4 w-4" /></div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">Quality alert · {empName(w.employee_id)}</div>
                  <div className="text-xs text-muted-foreground">Týden {w.iso_week} · výnos {fmt(w.yield_pct)} %</div>
                </div>
                <Badge variant="outline" className="border-destructive/25 text-destructive">Otevřeno</Badge>
              </div>
            ))}
            {openAlerts.length === 0 ? (
              <div className="flex items-center gap-3 py-2 text-sm text-muted-foreground"><CircleCheck className="h-5 w-5 text-success" /> Žádné otevřené Quality Alerty.</div>
            ) : null}
          </div>
        </Card>
      </div>
    </AppShell>
  );
}

function MiniSignal({ icon, label, value, tone = "default" }: { icon: React.ReactNode; label: string; value: React.ReactNode; tone?: "default" | "success" | "warning" }) {
  const toneClass = tone === "success" ? "text-success" : tone === "warning" ? "text-warning" : "text-primary";
  return (
    <div className="rounded-xl border border-border/70 bg-background/30 px-3 py-2.5">
      <div className={`flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] ${toneClass}`}>
        {icon}{label}
      </div>
      <div className="mt-1 text-sm font-semibold text-foreground">{value}</div>
    </div>
  );
}

function CardHeaderRow({ title, icon, action }: { title: string; icon: React.ReactNode; action: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex items-center gap-2 text-sm font-semibold"><span className="text-primary">{icon}</span>{title}</div>
      <span className="rounded-full border border-border/70 bg-background/20 px-2.5 py-1 text-[10px] font-medium text-muted-foreground">{action}</span>
    </div>
  );
}

function InsightRow({ icon, title, value, tone = "default" }: { icon: React.ReactNode; title: string; value: React.ReactNode; tone?: "default" | "success" | "warning" }) {
  const toneClass = tone === "success" ? "bg-success/10 text-success" : tone === "warning" ? "bg-warning/10 text-warning" : "bg-primary/10 text-primary";
  return (
    <div className="flex items-center gap-3 rounded-xl border border-border/65 bg-background/20 px-3 py-2.5">
      <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg ${toneClass}`}>{icon}</span>
      <span className="min-w-0 flex-1 truncate text-sm font-medium">{title}</span>
      <span className="shrink-0 text-xs font-semibold text-muted-foreground">{value}</span>
    </div>
  );
}

function EmptyChart() {
  return <div className="grid h-full place-items-center rounded-xl border border-dashed border-border/70 bg-background/15 text-sm text-muted-foreground">Zatím žádná data.</div>;
}
