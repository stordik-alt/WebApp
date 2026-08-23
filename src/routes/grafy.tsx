import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { AppShell } from "@/components/AppShell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { useDailyRecords, useEmployees, useProducts } from "@/lib/data";

export const Route = createFileRoute("/grafy")({
  head: () => ({
    meta: [
      { title: "Grafy – Výkonnost operátorů" },
      { name: "description", content: "Porovnávací grafy výkonu, dostupnosti a OEE zaměstnanců v čase." },
    ],
  }),
  component: ChartsPage,
});

type Metric = "performance" | "available_time" | "oee";

const METRICS: { key: Metric; label: string; unit: string }[] = [
  { key: "performance", label: "Výkon", unit: "%" },
  { key: "available_time", label: "Dostupnost", unit: "%" },
  { key: "oee", label: "OEE", unit: "%" },
];

const SERIES_COLORS = [
  "#2563eb", "#16a34a", "#dc2626", "#9333ea", "#ea580c", "#0891b2", "#db2777", "#65a30d",
];

function isoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function defaultFrom() {
  const d = new Date();
  d.setDate(d.getDate() - 30);
  return isoDate(d);
}

function ChartsPage() {
  const [from, setFrom] = useState(defaultFrom);
  const [to, setTo] = useState(() => isoDate(new Date()));
  const [productId, setProductId] = useState("all");
  const [selectedEmployees, setSelectedEmployees] = useState<string[]>([]);
  const [selectedMetrics, setSelectedMetrics] = useState<Metric[]>(["oee"]);

  const { data: employees = [] } = useEmployees();
  const { data: products = [] } = useProducts();
  const { data: daily = [], isLoading, error } = useDailyRecords(from, to);

  const visibleEmployees = useMemo(
    () => employees.filter((e) => e.active),
    [employees],
  );

  const effectiveEmployees = useMemo(() => {
    if (selectedEmployees.length) return selectedEmployees;
    return visibleEmployees.slice(0, 3).map((e) => e.id);
  }, [selectedEmployees, visibleEmployees]);

  const chartData = useMemo(() => {
    const employeeIds = new Set(effectiveEmployees);
    const grouped = new Map<string, Record<string, number | string | null>>();

    daily
      .filter((r) => employeeIds.has(r.employee_id))
      .filter((r) => productId === "all" || r.product_id === productId)
      .forEach((r) => {
        const row = grouped.get(r.work_date) ?? { date: r.work_date };
        const existingCount = Number(row.__count ?? 0);
        row.__count = existingCount + 1;
        for (const metric of selectedMetrics) {
          const value = r[metric];
          const key = `${r.employee_id}__${metric}`;
          if (typeof value === "number" && Number.isFinite(value)) {
            const sum = Number(row[`${key}__sum`] ?? 0) + value;
            row[`${key}__sum`] = sum;
            row[`${key}__count`] = Number(row[`${key}__count`] ?? 0) + 1;
          }
        }
        grouped.set(r.work_date, row);
      });

    return [...grouped.values()]
      .sort((a, b) => String(a.date).localeCompare(String(b.date)))
      .map((row) => {
        const out: Record<string, number | string | null> = { date: row.date };
        for (const employeeId of effectiveEmployees) {
          for (const metric of selectedMetrics) {
            const key = `${employeeId}__${metric}`;
            const count = Number(row[`${key}__count`] ?? 0);
            out[key] = count ? Number(row[`${key}__sum`]) / count : null;
          }
        }
        return out;
      });
  }, [daily, effectiveEmployees, productId, selectedMetrics]);

  const toggleEmployee = (id: string) => {
    setSelectedEmployees((current) =>
      current.includes(id) ? current.filter((x) => x !== id) : [...current, id],
    );
  };

  const toggleMetric = (metric: Metric) => {
    setSelectedMetrics((current) =>
      current.includes(metric)
        ? current.length === 1 ? current : current.filter((x) => x !== metric)
        : [...current, metric],
    );
  };

  const resetEmployees = () => setSelectedEmployees([]);
  const clearEmployees = () => setSelectedEmployees([]);

  return (
    <AppShell title="Grafy" subtitle="Porovnání zaměstnanců, metrik a produktů v čase">
      <div className="space-y-6">
        <Card className="grid gap-5 p-5 shadow-[var(--shadow-card)] lg:grid-cols-[1.1fr_1fr_1fr_1fr]">
          <div className="space-y-2">
            <Label>Zaměstnanci</Label>
            <div className="max-h-48 space-y-1 overflow-y-auto rounded-xl border p-2">
              {visibleEmployees.map((employee) => {
                const selected = effectiveEmployees.includes(employee.id);
                return (
                  <button
                    key={employee.id}
                    type="button"
                    onClick={() => toggleEmployee(employee.id)}
                    className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm transition ${selected ? "bg-primary/10 font-medium text-primary" : "hover:bg-muted"}`}
                  >
                    <span className="truncate">{employee.full_name}</span>
                    {selected && <span className="text-xs">✓</span>}
                  </button>
                );
              })}
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={resetEmployees}>Výchozí 3</Button>
              <Button size="sm" variant="ghost" onClick={clearEmployees}>Zrušit výběr</Button>
            </div>
            <p className="text-xs text-muted-foreground">Vybráno: {effectiveEmployees.length}</p>
          </div>

          <div className="space-y-2">
            <Label>Data v grafu</Label>
            <div className="space-y-2">
              {METRICS.map((metric) => {
                const selected = selectedMetrics.includes(metric.key);
                return (
                  <button
                    key={metric.key}
                    type="button"
                    onClick={() => toggleMetric(metric.key)}
                    className={`flex w-full items-center justify-between rounded-xl border px-3 py-2.5 text-sm transition ${selected ? "border-primary bg-primary/10 text-primary" : "hover:bg-muted"}`}
                  >
                    <span>{metric.label}</span>
                    <span>{selected ? "✓" : ""}</span>
                  </button>
                );
              })}
            </div>
            <p className="text-xs text-muted-foreground">Metriky lze kdykoliv přidat nebo odebrat.</p>
          </div>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Produkt</Label>
              <Select value={productId} onValueChange={setProductId}>
                <SelectTrigger><SelectValue placeholder="Všechny produkty" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Všechny produkty</SelectItem>
                  {products.map((product) => (
                    <SelectItem key={product.id} value={product.id}>{product.code} – {product.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Rychlý výběr období</Label>
              <div className="flex flex-wrap gap-2">
                {[7, 30, 90].map((days) => (
                  <Button key={days} size="sm" variant="outline" onClick={() => { const d = new Date(); d.setDate(d.getDate() - days); setFrom(isoDate(d)); setTo(isoDate(new Date())); }}>
                    {days} dní
                  </Button>
                ))}
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2"><Label>Od</Label><input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} className="h-10 w-full rounded-md border bg-background px-3 text-sm" /></div>
              <div className="space-y-2"><Label>Do</Label><input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} className="h-10 w-full rounded-md border bg-background px-3 text-sm" /></div>
            </div>
            <div className="rounded-xl bg-muted/50 p-3 text-sm">
              <div className="font-medium">Aktuální porovnání</div>
              <div className="mt-1 text-muted-foreground">{effectiveEmployees.length} zaměstnanců · {selectedMetrics.length} metrik · {from} → {to}</div>
            </div>
          </div>
        </Card>

        <Card className="p-4 shadow-[var(--shadow-card)] sm:p-6">
          <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-lg font-semibold">Porovnávací graf</h2>
              <p className="text-sm text-muted-foreground">Denní průměr hodnot podle vybraných zaměstnanců a metrik.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              {effectiveEmployees.map((id, index) => {
                const employee = employees.find((e) => e.id === id);
                return <Badge key={id} variant="outline">{employee?.full_name ?? "?"} · {SERIES_COLORS[index % SERIES_COLORS.length]}</Badge>;
              })}
            </div>
          </div>

          {error ? (
            <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-5 text-sm text-destructive">Nepodařilo se načíst data: {error.message}</div>
          ) : isLoading ? (
            <div className="flex h-[420px] items-center justify-center text-sm text-muted-foreground">Načítám data…</div>
          ) : chartData.length === 0 ? (
            <div className="flex h-[420px] items-center justify-center rounded-xl border border-dashed text-sm text-muted-foreground">Pro zvolenou kombinaci nejsou žádná schválená data.</div>
          ) : (
            <div className="h-[420px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{ top: 10, right: 24, left: 0, bottom: 10 }}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.25} />
                  <XAxis dataKey="date" tickFormatter={(v) => new Date(v).toLocaleDateString("cs-CZ", { day: "2-digit", month: "2-digit" })} minTickGap={28} />
                  <YAxis domain={[0, "auto"]} tickFormatter={(v) => `${v}%`} />
                  <Tooltip labelFormatter={(v) => new Date(v).toLocaleDateString("cs-CZ")} formatter={(value, name) => [value == null ? "–" : `${Number(value).toFixed(1)} %`, String(name)]} />
                  <Legend />
                  {effectiveEmployees.flatMap((employeeId, employeeIndex) => selectedMetrics.map((metric) => {
                    const employee = employees.find((e) => e.id === employeeId);
                    const metricLabel = METRICS.find((m) => m.key === metric)?.label ?? metric;
                    return <Line key={`${employeeId}-${metric}`} type="monotone" dataKey={`${employeeId}__${metric}`} name={`${employee?.full_name ?? "?"} · ${metricLabel}`} stroke={SERIES_COLORS[(employeeIndex + selectedMetrics.indexOf(metric) * 3) % SERIES_COLORS.length]} strokeWidth={2.2} dot={false} connectNulls />;
                  }))}
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>
      </div>
    </AppShell>
  );
}
