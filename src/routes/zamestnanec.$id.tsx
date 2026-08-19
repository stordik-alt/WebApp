import { createFileRoute } from "@tanstack/react-router";
import { tooltipStyle } from "@/lib/chart-theme";
import { useEffect, useMemo, useState } from "react";
import { Search, Filter, Star, X, Trash2 } from "lucide-react";
import {
  type AlertFilterPreset,
  type AlertFilterState,
  EMPTY_ALERT_FILTERS,
  isEmptyFilters,
  loadPresets,
  savePresets,
} from "@/lib/alert-filter-presets";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { AppShell } from "@/components/AppShell";
import { KpiCard } from "@/components/Kpi";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { QualityAlertDialog } from "@/components/QualityAlertDialog";
import { useEmployees, useShiftAggregates, useWeeklyRecords } from "@/lib/data";
import type { WeeklyRecord } from "@/lib/metrics";
import {
  computePerformance,
  effectiveQuality,
  fmt,
  halfOf,
  isoWeekMonday,
  quarterOf,
} from "@/lib/metrics";
import { AlertTriangle, TrendingDown, TrendingUp } from "lucide-react";

export const Route = createFileRoute("/zamestnanec/$id")({
  head: () => ({
    meta: [
      { title: "Profil zaměstnance – Výkonnost operátorů" },
      { name: "description", content: "Profil pracovníka: vývoj OEE, Quality Score a Yieldu, výpomoc v čase, čtvrtletní a půlroční výkonnost a trend." },
      { property: "og:title", content: "Profil zaměstnance – Výkonnost operátorů" },
      { property: "og:description", content: "Detailní výkonnostní profil pracovníka výroby DPS." },
    ],
  }),
  component: EmployeeProfile,
  errorComponent: ({ error }) => (
    <div className="p-8 text-sm text-destructive" role="alert">
      {error.message}
    </div>
  ),
  notFoundComponent: () => <div className="p-8 text-sm">Zaměstnanec nenalezen.</div>,
});

function EmployeeProfile() {
  const { id } = Route.useParams();
  const [alertRow, setAlertRow] = useState<WeeklyRecord | null>(null);
  const { data: employees = [] } = useEmployees();
  const { shifts: allShifts } = useShiftAggregates();
  const { data: weekly = [] } = useWeeklyRecords();

  const employee = employees.find((e) => e.id === id);
  // Denní jednotkou profilu je směnový agregát (průměr přes všechny linky ve směně).
  const myDaily = useMemo(
    () =>
      allShifts
        .filter((d) => d.employee_id === id)
        .sort((a, b) => a.work_date.localeCompare(b.work_date)),
    [allShifts, id],
  );
  const myWeekly = useMemo(
    () =>
      weekly
        .filter((w) => w.employee_id === id)
        .sort((a, b) => a.iso_year - b.iso_year || a.iso_week - b.iso_week),
    [weekly, id],
  );

  const myAlerts = useMemo(() => myWeekly.filter((w) => w.is_alert), [myWeekly]);

  const [alertSearch, setAlertSearch] = useState("");
  const [operatorErrorFilter, setOperatorErrorFilter] = useState<"all" | "yes" | "no">("all");
  const [alertStatusFilter, setAlertStatusFilter] = useState<"all" | "resolved" | "unresolved">("all");
  const [weekFilter, setWeekFilter] = useState("");

  const currentFilters: AlertFilterState = {
    search: alertSearch,
    week: weekFilter,
    operatorError: operatorErrorFilter,
    status: alertStatusFilter,
  };
  const filtersActive = !isEmptyFilters(currentFilters);

  const [presets, setPresets] = useState<AlertFilterPreset[]>([]);
  const [presetName, setPresetName] = useState("");
  const [presetOpen, setPresetOpen] = useState(false);
  useEffect(() => {
    setPresets(loadPresets());
  }, []);

  const applyFilters = (f: AlertFilterState) => {
    setAlertSearch(f.search);
    setWeekFilter(f.week);
    setOperatorErrorFilter(f.operatorError);
    setAlertStatusFilter(f.status);
  };

  const resetFilters = () => applyFilters(EMPTY_ALERT_FILTERS);

  const addPreset = () => {
    const name = presetName.trim();
    if (!name) return;
    const next = [
      ...presets.filter((p) => p.name !== name),
      { id: crypto.randomUUID(), name, filters: currentFilters },
    ];
    setPresets(next);
    savePresets(next);
    setPresetName("");
    setPresetOpen(false);
  };

  const removePreset = (pid: string) => {
    const next = presets.filter((p) => p.id !== pid);
    setPresets(next);
    savePresets(next);
  };


  const filteredAlerts = useMemo(() => {
    const q = alertSearch.trim().toLowerCase();
    const wk = weekFilter.trim().toLowerCase();
    return myAlerts.filter((w) => {
      if (q) {
        const hay = `${w.alert_cause ?? ""} ${w.alert_note ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (operatorErrorFilter !== "all") {
        const isOp = w.operator_error === true;
        if (operatorErrorFilter === "yes" && !isOp) return false;
        if (operatorErrorFilter === "no" && isOp) return false;
      }
      if (alertStatusFilter !== "all") {
        if (alertStatusFilter === "resolved" && !w.alert_resolved) return false;
        if (alertStatusFilter === "unresolved" && w.alert_resolved) return false;
      }
      if (wk) {
        const label = `${w.iso_year}/T${w.iso_week}`.toLowerCase();
        const label2 = `${w.iso_year} T${w.iso_week}`.toLowerCase();
        if (!label.includes(wk) && !label2.includes(wk)) return false;
      }
      return true;
    });
  }, [myAlerts, alertSearch, operatorErrorFilter, alertStatusFilter, weekFilter]);

  const overall = computePerformance(myDaily, myWeekly);

  const oeeSeries = myDaily.map((d) => ({ date: d.work_date.slice(5), oee: d.oee }));
  const helpSeries = myDaily.map((d) => ({ date: d.work_date.slice(5), help: d.help }));
  const qualitySeries = myWeekly.map((w) => ({
    week: `T${w.iso_week}`,
    yield: w.yield_pct,
    score: effectiveQuality(w),
  }));

  const byPeriod = (fn: (s: string) => string) => {
    const keys = [...new Set(myDaily.map((d) => fn(d.work_date)))].sort();
    return keys.map((k) => {
      const d = myDaily.filter((r) => fn(r.work_date) === k);
      const w = myWeekly.filter(
        (r) => fn(isoWeekMonday(r.iso_year, r.iso_week).toISOString().slice(0, 10)) === k,
      );
      return { key: k, perf: computePerformance(d, w) };
    });
  };

  const quarters = byPeriod(quarterOf);
  const halves = byPeriod(halfOf);

  const trend =
    quarters.length >= 2
      ? (quarters[quarters.length - 1]?.perf.ipi ?? 0) -
        (quarters[quarters.length - 2]?.perf.ipi ?? 0)
      : null;

  if (!employee) {
    return (
      <AppShell title="Profil zaměstnance">
        <p className="text-sm text-muted-foreground">Načítání nebo zaměstnanec neexistuje…</p>
      </AppShell>
    );
  }

  return (
    <AppShell
      title={employee.full_name}
      subtitle={`${employee.personal_no ? `Os. č. ${employee.personal_no} · ` : ""}${employee.active ? "Aktivní" : "Neaktivní"}`}
      actions={
        <>
          {employee.qual_ha ? <Badge variant="secondary">HA</Badge> : null}
          {employee.qual_tup ? <Badge variant="secondary">TUP</Badge> : null}
        </>
      }
    >
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        <KpiCard label="Směny celkem" value={overall.shifts} />
        <KpiCard label="Ø OEE" value={fmt(overall.avgOee)} unit="%" />
        <KpiCard
          label="Ø Quality Score"
          value={fmt(overall.avgQuality)}
          tone={overall.avgQuality !== null && overall.avgQuality < 0 ? "danger" : "default"}
        />
        <KpiCard label="Ø Výpomoc" value={fmt(overall.avgHelp, 0)} />
        <KpiCard
          label="Trend (posl. čtvrtletí)"
          value={trend === null ? "–" : `${trend > 0 ? "+" : ""}${fmt(trend)}`}
          tone={trend === null ? "default" : trend >= 0 ? "success" : "danger"}
          icon={trend !== null && trend < 0 ? <TrendingDown className="h-4 w-4" /> : <TrendingUp className="h-4 w-4" />}
        />
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-2">
        <Card className="gap-4 p-5 shadow-[var(--shadow-card)]">
          <h2 className="text-sm font-semibold">OEE v čase</h2>
          <div className="h-60">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={oeeSeries}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="date" fontSize={12} stroke="var(--muted-foreground)" />
                <YAxis fontSize={12} stroke="var(--muted-foreground)" />
                <Tooltip {...tooltipStyle} />
                <Line type="monotone" dataKey="oee" stroke="var(--chart-1)" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card className="gap-4 p-5 shadow-[var(--shadow-card)]">
          <h2 className="text-sm font-semibold">Yield a Quality Score v čase</h2>
          <div className="h-60">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={qualitySeries}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="week" fontSize={12} stroke="var(--muted-foreground)" />
                <YAxis fontSize={12} stroke="var(--muted-foreground)" />
                <Tooltip {...tooltipStyle} />
                <ReferenceLine y={79} stroke="var(--destructive)" strokeDasharray="4 4" />
                <Line type="monotone" dataKey="yield" stroke="var(--chart-2)" strokeWidth={2} />
                <Line type="monotone" dataKey="score" stroke="var(--chart-3)" strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card className="gap-4 p-5 shadow-[var(--shadow-card)]">
          <h2 className="text-sm font-semibold">Výpomoc v čase</h2>
          <div className="h-60">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={helpSeries}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="date" fontSize={12} stroke="var(--muted-foreground)" />
                <YAxis domain={[-100, 100]} fontSize={12} stroke="var(--muted-foreground)" />
                <Tooltip {...tooltipStyle} />
                <ReferenceLine y={0} stroke="var(--border)" />
                <Bar dataKey="help" fill="var(--chart-5)" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card className="gap-4 p-5 shadow-[var(--shadow-card)]">
          <h2 className="text-sm font-semibold">Čtvrtletní a půlroční výkonnost</h2>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Období</TableHead>
                <TableHead className="text-right">Směny</TableHead>
                <TableHead className="text-right">Ø OEE</TableHead>
                <TableHead className="text-right">Ø Quality</TableHead>
                <TableHead className="text-right">IPI</TableHead>
                <TableHead>Data</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {[...quarters, ...halves].length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-muted-foreground">
                    Zatím žádná data.
                  </TableCell>
                </TableRow>
              ) : (
                [...quarters, ...halves].map(({ key, perf }) => (
                  <TableRow key={key}>
                    <TableCell className="font-medium">{key}</TableCell>
                    <TableCell className="text-right tabular-nums">{perf.shifts}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmt(perf.avgOee)} %</TableCell>
                    <TableCell className="text-right tabular-nums">{fmt(perf.avgQuality)}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmt(perf.ipi)}</TableCell>
                    <TableCell>
                      {perf.enoughData ? (
                        <Badge className="bg-success text-success-foreground">Dostatečná</Badge>
                      ) : (
                        <Badge variant="outline" className="border-warning text-warning">
                          Málo dat
                        </Badge>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </Card>
      </div>

      <Card className="mt-6 gap-0 p-0 shadow-[var(--shadow-card)]">
        <div className="border-b border-border px-4 py-3 text-sm font-semibold">
          Týdenní Quality záznamy
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Týden</TableHead>
              <TableHead className="text-right">Yield</TableHead>
              <TableHead className="text-right">Auto skóre</TableHead>
              <TableHead className="text-right">Finální skóre</TableHead>
              <TableHead>Stav / příčina</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {myWeekly.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-muted-foreground">
                  Zatím žádné týdenní záznamy.
                </TableCell>
              </TableRow>
            ) : (
              myWeekly.map((w) => (
                <TableRow key={w.id}>
                  <TableCell>
                    {w.iso_year}/T{w.iso_week}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{fmt(w.yield_pct)} %</TableCell>
                  <TableCell className="text-right tabular-nums">{fmt(w.auto_quality_score)}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmt(w.final_quality_score)}</TableCell>
                  <TableCell className="text-xs">
                    {w.is_alert ? (
                      <span className="text-destructive">
                        QUALITY ALERT{w.alert_cause ? ` – ${w.alert_cause}` : ""}
                        {w.operator_error ? " (chyba operátora)" : ""}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">OK</span>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>

      <Card className="mt-6 gap-0 p-0 shadow-[var(--shadow-card)]">
        <div className="flex items-center gap-2 border-b border-border px-4 py-3 text-sm font-semibold">
          <AlertTriangle className="h-4 w-4 text-destructive" />
          Quality Alerty
          {myAlerts.filter((w) => !w.alert_resolved).length > 0 ? (
            <Badge variant="destructive">
              {myAlerts.filter((w) => !w.alert_resolved).length} nevyřešeno
            </Badge>
          ) : null}
        </div>
        <div className="grid gap-2 border-b border-border px-4 py-3 md:grid-cols-2 xl:grid-cols-4">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Hledat příčinu / poznámku…"
              value={alertSearch}
              onChange={(e) => setAlertSearch(e.target.value)}
              className="pl-8"
            />
          </div>
          <Input
            placeholder="Rok/Týden (např. 2026/T12)"
            value={weekFilter}
            onChange={(e) => setWeekFilter(e.target.value)}
          />
          <Select value={operatorErrorFilter} onValueChange={(v) => setOperatorErrorFilter(v as "all" | "yes" | "no")}>
            <SelectTrigger>
              <Filter className="mr-1 h-4 w-4 text-muted-foreground" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Chyba operátora: všechny</SelectItem>
              <SelectItem value="yes">Chyba operátora: ano</SelectItem>
              <SelectItem value="no">Chyba operátora: ne</SelectItem>
            </SelectContent>
          </Select>
          <Select value={alertStatusFilter} onValueChange={(v) => setAlertStatusFilter(v as "all" | "resolved" | "unresolved")}>
            <SelectTrigger>
              <Filter className="mr-1 h-4 w-4 text-muted-foreground" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Stav: všechny</SelectItem>
              <SelectItem value="resolved">Stav: vyřešeno</SelectItem>
              <SelectItem value="unresolved">Stav: nevyřešeno</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
          <Button
            size="sm"
            variant="outline"
            onClick={resetFilters}
            disabled={!filtersActive}
          >
            <X className="mr-1 h-4 w-4" />
            Vymazat filtry
          </Button>

          <Popover open={presetOpen} onOpenChange={setPresetOpen}>
            <PopoverTrigger asChild>
              <Button size="sm" variant="outline" disabled={!filtersActive}>
                <Star className="mr-1 h-4 w-4" />
                Uložit filtr
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-64 space-y-2" align="start">
              <p className="text-sm font-medium">Uložit oblíbenou kombinaci</p>
              <Input
                placeholder="Název filtru"
                value={presetName}
                onChange={(e) => setPresetName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") addPreset();
                }}
              />
              <Button size="sm" className="w-full" onClick={addPreset} disabled={!presetName.trim()}>
                Uložit
              </Button>
            </PopoverContent>
          </Popover>

          {presets.length > 0 ? (
            <div className="flex flex-wrap items-center gap-1">
              {presets.map((p) => (
                <span
                  key={p.id}
                  className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/40 py-0.5 pl-2 pr-1 text-xs"
                >
                  <button
                    type="button"
                    className="font-medium hover:underline"
                    onClick={() => applyFilters(p.filters)}
                  >
                    {p.name}
                  </button>
                  <button
                    type="button"
                    aria-label={`Smazat filtr ${p.name}`}
                    className="rounded-full p-0.5 text-muted-foreground hover:text-destructive"
                    onClick={() => removePreset(p.id)}
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </span>
              ))}
            </div>
          ) : (
            <span className="text-xs text-muted-foreground">
              Žádné uložené filtry
            </span>
          )}
        </div>

        <Table>
          <TableHeader>
            <TableRow>
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
            {filteredAlerts.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="text-muted-foreground">
                  {myAlerts.length === 0
                    ? "Žádné Quality Alerty."
                    : "Žádné alerty neodpovídají filtrům."}
                </TableCell>
              </TableRow>
            ) : (
              filteredAlerts.map((w) => (
                <TableRow key={w.id} className={w.alert_resolved ? "" : "bg-destructive/5"}>
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
                    <Button size="sm" variant="outline" onClick={() => setAlertRow(w)}>
                      {w.alert_resolved ? "Upravit" : "Vyšetřit"}
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>

      <QualityAlertDialog
        row={alertRow}
        employeeName={employee.full_name}
        onClose={() => setAlertRow(null)}
      />
    </AppShell>
  );
}
