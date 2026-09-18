import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertOctagon } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";

const db = supabase as any;

type AnomalyRow = {
  record_id: string;
  employee_name: string;
  work_date: string;
  shift: string;
  line: string;
  product: string | null;
  performance: number | null;
  oee: number | null;
  available_time: number | null;
  employee_avg_performance: number | null;
  employee_avg_oee: number | null;
  reason: string;
};

export function PerformanceAnomalyReport() {
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [threshold, setThreshold] = useState("30");

  const query = useQuery({
    queryKey: ["performance-anomalies", dateFrom, dateTo, threshold],
    queryFn: async (): Promise<AnomalyRow[]> => {
      const t = threshold.trim() ? Number(threshold) : 30;
      const { data, error } = await db.rpc("detect_performance_anomalies", { p_work_date_from: dateFrom || null, p_work_date_to: dateTo || null, p_deviation_threshold: t });
      if (error) throw error;
      return (data ?? []).map((r: any) => ({
        record_id: String(r.record_id), employee_name: String(r.employee_name), work_date: String(r.work_date), shift: String(r.shift), line: String(r.line), product: r.product ?? null,
        performance: r.performance != null ? Number(r.performance) : null, oee: r.oee != null ? Number(r.oee) : null, available_time: r.available_time != null ? Number(r.available_time) : null,
        employee_avg_performance: r.employee_avg_performance != null ? Number(r.employee_avg_performance) : null, employee_avg_oee: r.employee_avg_oee != null ? Number(r.employee_avg_oee) : null,
        reason: String(r.reason),
      }));
    },
  });

  const rows = query.data ?? [];

  return (
    <Card className="p-4">
      <div className="flex items-center gap-2"><AlertOctagon className="h-4 w-4 text-primary" /><div><h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Kontrola datových anomálií</h2><p className="text-xs text-muted-foreground">Záznamy s implausibilní hodnotou nebo výraznou odchylkou od vlastní historie zaměstnance – možná chyba OCR, ne automatický blokátor. Nejde o rozhodnutí, jen doporučení ke kontrole.</p></div></div>
      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <div className="grid gap-1.5"><Label>Datum od (nepovinné)</Label><Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} /></div>
        <div className="grid gap-1.5"><Label>Datum do (nepovinné)</Label><Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} /></div>
        <div className="grid gap-1.5"><Label>Práh odchylky (procentní body)</Label><Input type="number" min="1" value={threshold} onChange={(e) => setThreshold(e.target.value)} /></div>
      </div>
      {query.isLoading ? <p className="mt-4 text-sm text-muted-foreground">Načítám…</p> : query.isError ? <p className="mt-4 text-sm text-destructive">Data se nepodařilo načíst.</p> : rows.length === 0 ? <p className="mt-4 text-sm text-muted-foreground">V daném období nebyly nalezeny žádné podezřelé záznamy.</p> : <div className="mt-4 overflow-x-auto"><table className="w-full min-w-[820px] text-xs"><thead><tr className="border-b text-left text-muted-foreground"><th className="px-2 py-2">Zaměstnanec</th><th className="px-2 py-2">Datum / směna</th><th className="px-2 py-2">Linka / produkt</th><th className="px-2 py-2 text-right">Výkon</th><th className="px-2 py-2 text-right">Vlastní průměr</th><th className="px-2 py-2 text-right">OEE</th><th className="px-2 py-2 text-right">Vlastní průměr</th><th className="px-2 py-2">Důvod</th></tr></thead><tbody>{rows.map((r) => <tr key={r.record_id} className="border-b border-border/40"><td className="px-2 py-2 font-medium">{r.employee_name}</td><td className="px-2 py-2">{r.work_date} · {r.shift}</td><td className="px-2 py-2">{r.line} · {r.product ?? "–"}</td><td className="px-2 py-2 text-right font-semibold">{r.performance != null ? `${r.performance.toFixed(1)} %` : "–"}</td><td className="px-2 py-2 text-right text-muted-foreground">{r.employee_avg_performance != null ? `${r.employee_avg_performance.toFixed(1)} %` : "–"}</td><td className="px-2 py-2 text-right font-semibold">{r.oee != null ? `${r.oee.toFixed(1)} %` : "–"}</td><td className="px-2 py-2 text-right text-muted-foreground">{r.employee_avg_oee != null ? `${r.employee_avg_oee.toFixed(1)} %` : "–"}</td><td className="px-2 py-2"><Badge variant="outline" className="border-amber-400/40 bg-amber-400/10 text-amber-300">{r.reason}</Badge></td></tr>)}</tbody></table></div>}
    </Card>
  );
}
