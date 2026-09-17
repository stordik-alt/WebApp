import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { BarChart3 } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Line, ComposedChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";

const db = supabase as any;

type ParetoRow = { reason_label: string; category: string; total_minutes: number; occurrences: number };

const CATEGORY_LABEL: Record<string, string> = { controllable: "Ovlivnitelná", uncontrollable: "Neovlivnitelná", unclassified: "Nezařazeno", none: "Bez důvodu" };
const CATEGORY_BADGE: Record<string, string> = {
  controllable: "border-amber-400/40 bg-amber-400/10 text-amber-300",
  uncontrollable: "border-red-400/40 bg-red-400/10 text-red-300",
  unclassified: "border-slate-400/40 bg-slate-400/10 text-slate-300",
  none: "border-slate-400/40 bg-slate-400/10 text-slate-300",
};

export function DowntimeParetoAnalysis() {
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const query = useQuery({
    queryKey: ["downtime-pareto", dateFrom, dateTo],
    queryFn: async (): Promise<ParetoRow[]> => {
      const { data, error } = await db.rpc("downtime_pareto", { p_work_date_from: dateFrom || null, p_work_date_to: dateTo || null });
      if (error) throw error;
      return (data ?? []).map((r: any) => ({ reason_label: String(r.reason_label), category: String(r.category), total_minutes: Number(r.total_minutes) || 0, occurrences: Number(r.occurrences) || 0 }));
    },
  });

  const rows = query.data ?? [];
  const totalMinutes = rows.reduce((sum, r) => sum + r.total_minutes, 0);

  const chartData = useMemo(() => {
    let cumulative = 0;
    return rows.map((r) => {
      cumulative += r.total_minutes;
      return { name: r.reason_label.length > 18 ? `${r.reason_label.slice(0, 18)}…` : r.reason_label, fullName: r.reason_label, minutes: r.total_minutes, cumulativePct: totalMinutes > 0 ? (cumulative / totalMinutes) * 100 : 0 };
    });
  }, [rows, totalMinutes]);

  return (
    <Card className="p-4">
      <div className="flex items-center gap-2"><BarChart3 className="h-4 w-4 text-primary" /><div><h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Pareto analýza odstávek</h2><p className="text-xs text-muted-foreground">Které důvody odstávek stojí nejvíc minut výroby. Seřazeno sestupně, s kumulativním podílem.</p></div></div>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div className="grid gap-1.5"><Label>Datum od (nepovinné)</Label><Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} /></div>
        <div className="grid gap-1.5"><Label>Datum do (nepovinné)</Label><Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} /></div>
      </div>
      {query.isLoading ? <p className="mt-4 text-sm text-muted-foreground">Načítám…</p> : query.isError ? <p className="mt-4 text-sm text-destructive">Data se nepodařilo načíst.</p> : rows.length === 0 ? <p className="mt-4 text-sm text-muted-foreground">V daném období nejsou žádné evidované odstávky.</p> : <>
        <div className="mt-4 h-[280px] w-full"><ResponsiveContainer width="100%" height="100%"><ComposedChart data={chartData} margin={{ top: 8, right: 30, left: 0, bottom: 40 }}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="name" angle={-30} textAnchor="end" height={70} interval={0} tick={{ fontSize: 11 }} /><YAxis yAxisId="left" tickFormatter={(v) => `${v} min`} /><YAxis yAxisId="right" orientation="right" domain={[0, 100]} tickFormatter={(v) => `${v}%`} /><Tooltip formatter={((value: unknown, name: unknown) => { const n = typeof value === "number" ? value : Number(value); return name === "cumulativePct" ? [`${n.toFixed(1)} %`, "Kumulativně"] : [`${n.toFixed(0)} min`, "Minuty"]; }) as any} labelFormatter={((_: unknown, payload: any) => payload?.[0]?.payload?.fullName ?? "") as any} /><Bar yAxisId="left" dataKey="minutes" name="Minuty" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} /><Line yAxisId="right" dataKey="cumulativePct" name="Kumulativně" stroke="hsl(var(--chart-2))" strokeWidth={2} dot={{ r: 3 }} /></ComposedChart></ResponsiveContainer></div>
        <div className="mt-4 overflow-x-auto"><table className="w-full text-xs"><thead><tr className="border-b text-left text-muted-foreground"><th className="px-2 py-2">Důvod</th><th className="px-2 py-2">Kategorie</th><th className="px-2 py-2 text-right">Minuty</th><th className="px-2 py-2 text-right">Výskytů</th><th className="px-2 py-2 text-right">Podíl</th></tr></thead><tbody>{rows.map((r) => <tr key={r.reason_label} className="border-b border-border/40"><td className="px-2 py-2 font-medium">{r.reason_label}</td><td className="px-2 py-2"><Badge variant="outline" className={CATEGORY_BADGE[r.category] ?? ""}>{CATEGORY_LABEL[r.category] ?? r.category}</Badge></td><td className="px-2 py-2 text-right">{r.total_minutes.toFixed(0)}</td><td className="px-2 py-2 text-right">{r.occurrences}</td><td className="px-2 py-2 text-right">{totalMinutes > 0 ? `${((r.total_minutes / totalMinutes) * 100).toFixed(1)} %` : "–"}</td></tr>)}</tbody></table></div>
      </>}
    </Card>
  );
}
