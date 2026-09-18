import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { GitMerge } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";

const db = supabase as any;

type LinkageRow = {
  work_date: string;
  shift: string;
  tup_product_code: string;
  ha_product_code: string | null;
  allocation_fraction: number | null;
  hours_linked: number;
  hours_capped: number;
  tup_actual_output: number;
  ha_available_output: number | null;
};

export function HaTupLinkageReport() {
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const query = useQuery({
    queryKey: ["ha-tup-linkage-report", dateFrom, dateTo],
    queryFn: async (): Promise<LinkageRow[]> => {
      const { data, error } = await db.rpc("ha_tup_linkage_report", { p_work_date_from: dateFrom || null, p_work_date_to: dateTo || null });
      if (error) throw error;
      return (data ?? []).map((r: any) => ({
        work_date: String(r.work_date), shift: String(r.shift), tup_product_code: String(r.tup_product_code), ha_product_code: r.ha_product_code ?? null,
        allocation_fraction: r.allocation_fraction != null ? Number(r.allocation_fraction) : null,
        hours_linked: Number(r.hours_linked) || 0, hours_capped: Number(r.hours_capped) || 0,
        tup_actual_output: Number(r.tup_actual_output) || 0, ha_available_output: r.ha_available_output != null ? Number(r.ha_available_output) : null,
      }));
    },
  });

  const rows = query.data ?? [];
  // Group rows sharing the same (work_date, shift, ha_product_code) so a 2-way
  // split (Master Prompt Problem 6) visually shows both TUP allocations together.
  const groups = new Map<string, LinkageRow[]>();
  for (const r of rows) {
    const key = `${r.work_date}|${r.shift}|${r.ha_product_code ?? ""}`;
    const list = groups.get(key) ?? [];
    list.push(r);
    groups.set(key, list);
  }

  return (
    <Card className="p-4">
      <div className="flex items-center gap-2"><GitMerge className="h-4 w-4 text-primary" /><div><h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">HA → TUP vazby</h2><p className="text-xs text-muted-foreground">Které HA linky reálně zásobují které TUP linky, s jakou alokací a jak často byl výstup limitován dostupnou HA produkcí.</p></div></div>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div className="grid gap-1.5"><Label>Datum od (nepovinné)</Label><Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} /></div>
        <div className="grid gap-1.5"><Label>Datum do (nepovinné)</Label><Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} /></div>
      </div>
      {query.isLoading ? <p className="mt-4 text-sm text-muted-foreground">Načítám…</p> : query.isError ? <p className="mt-4 text-sm text-destructive">Data se nepodařilo načíst.</p> : groups.size === 0 ? <p className="mt-4 text-sm text-muted-foreground">V daném období nebyla vyhodnocena žádná HA → TUP vazba.</p> : <div className="mt-4 grid gap-3">
        {[...groups.entries()].map(([key, groupRows]) => {
          const [workDate, shift, haCode] = key.split("|");
          const isSplit = groupRows.length > 1;
          return <div key={key} className="rounded-lg border bg-background p-3">
            <div className="flex flex-wrap items-center justify-between gap-2"><div className="text-sm font-medium">{workDate} · {shift}</div>{isSplit ? <Badge variant="outline" className="border-amber-400/40 bg-amber-400/10 text-amber-300">2-way split</Badge> : null}</div>
            <div className="mt-1 text-xs text-muted-foreground">HA zdroj: <span className="font-medium text-foreground">{haCode || "?"}</span> · dostupné {groupRows[0]?.ha_available_output ?? "–"} ks</div>
            <div className="mt-2 grid gap-2">{groupRows.map((r) => <div key={r.tup_product_code} className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-muted/20 px-3 py-2 text-xs"><div className="font-medium">{r.tup_product_code}</div><div className="flex flex-wrap items-center gap-3"><span>Alokace: <strong>{r.allocation_fraction != null ? `${Math.round(r.allocation_fraction * 100)} %` : "–"}</strong></span><span>Vyrobeno: <strong>{r.tup_actual_output}</strong> ks</span><span>Hodin: {r.hours_linked}</span>{r.hours_capped > 0 ? <Badge variant="destructive" className="text-[10px]">limitováno {r.hours_capped}×</Badge> : null}</div></div>)}</div>
          </div>;
        })}
      </div>}
    </Card>
  );
}
