import { Fragment, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ShieldAlert } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const db = supabase as any;

type HourlyAnomalyRow = {
  hourly_id: string;
  import_item_id: string;
  hour: number;
  product_code: string | null;
  actual_output: number | null;
  performance_pct: number | null;
  availability_pct: number | null;
  actual_oee_pct: number | null;
  stat_status: string;
  work_date: string;
  shift: string;
  line: string;
  trace_id: string | null;
  reconstruction_status: string | null;
};

type StatEvent = { id: string; created_at: string; from_status: string | null; to_status: string; reason: string | null; note: string | null };

const STAT_STATUS_LABEL: Record<string, string> = {
  ANOMALY_PENDING_REVIEW: "Čeká na kontrolu",
  MANUALLY_INCLUDED: "Ručně zahrnuto",
  MANUALLY_EXCLUDED: "Ručně vyřazeno",
};

// Master Prompt body 3.5/4-5: admin-facing worklist of every hour flagged
// as an anomaly or already manually excluded, so a teamleader/admin can
// find records needing a decision without hunting through Denní data one
// record at a time. Every decision here calls the same
// set_hourly_stat_status() RPC denni-data.tsx's per-record detail dialog
// uses, so both surfaces stay consistent.
export function HourlyAnomalyReview() {
  const qc = useQueryClient();
  const { isAdmin } = useAuth();
  const [filter, setFilter] = useState<"pending" | "excluded" | "all">("pending");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [dialog, setDialog] = useState<{ row: HourlyAnomalyRow; newStatus: "MANUALLY_INCLUDED" | "MANUALLY_EXCLUDED" } | null>(null);
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");

  const statuses = filter === "pending" ? ["ANOMALY_PENDING_REVIEW"] : filter === "excluded" ? ["MANUALLY_EXCLUDED"] : ["ANOMALY_PENDING_REVIEW", "MANUALLY_EXCLUDED", "MANUALLY_INCLUDED"];

  const query = useQuery({
    queryKey: ["hourly-stat-review", filter],
    queryFn: async (): Promise<HourlyAnomalyRow[]> => {
      const { data, error } = await db.rpc("list_hourly_stat_review", { p_statuses: statuses });
      if (error) throw error;
      return (data ?? []) as HourlyAnomalyRow[];
    },
  });

  const eventsQuery = useQuery({
    queryKey: ["hourly-stat-events", expanded],
    enabled: !!expanded,
    queryFn: async (): Promise<StatEvent[]> => {
      const { data, error } = await db.from("import_item_hourly_stat_events").select("id,created_at,from_status,to_status,reason,note").eq("import_item_hourly_id", expanded).order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as StatEvent[];
    },
  });

  const decide = useMutation({
    mutationFn: async ({ hourlyId, newStatus, reason: r, note: n }: { hourlyId: string; newStatus: "MANUALLY_INCLUDED" | "MANUALLY_EXCLUDED"; reason: string; note: string }) => {
      const { data, error } = await db.rpc("set_hourly_stat_status", { p_hourly_id: hourlyId, p_new_status: newStatus, p_reason: r.trim() || null, p_note: n.trim() || null });
      if (error) throw error;
      return data;
    },
    onSuccess: (_d, { newStatus }) => {
      qc.invalidateQueries({ queryKey: ["hourly-stat-review"] });
      qc.invalidateQueries({ queryKey: ["hourly-stat-events"] });
      qc.invalidateQueries({ queryKey: ["daily"] });
      setDialog(null); setReason(""); setNote("");
      toast.success(newStatus === "MANUALLY_EXCLUDED" ? "Hodina byla vyřazena ze statistik." : "Hodina byla zahrnuta do statistik.");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const rows = query.data ?? [];

  return (
    <Card className="p-4">
      <div className="flex items-center gap-2"><ShieldAlert className="h-4 w-4 text-primary" /><div><h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Hodinové anomálie – ke kontrole</h2><p className="text-xs text-muted-foreground">Hodinový výsledek je anomální, pokud z dostupných hodinových dat nelze spolehlivě určit efektivní čas výroby. Nejde automaticky o chybu - vyřazení je vždy jen na úrovni té konkrétní hodiny, nikdy celého dne/produktu/pracoviště, a výrobní data se nikdy nemažou ani nemění.</p></div></div>
      <div className="mt-3"><Select value={filter} onValueChange={(v) => setFilter(v as typeof filter)}><SelectTrigger className="w-[240px]"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="pending">Čeká na kontrolu</SelectItem><SelectItem value="excluded">Ručně vyřazené</SelectItem><SelectItem value="all">Vše (včetně ručně zahrnutých)</SelectItem></SelectContent></Select></div>
      {query.isLoading ? <p className="mt-4 text-sm text-muted-foreground">Načítám…</p> : query.isError ? <p className="mt-4 text-sm text-destructive">Data se nepodařilo načíst.</p> : rows.length === 0 ? <p className="mt-4 text-sm text-muted-foreground">Žádné hodiny v tomto filtru.</p> : <div className="mt-4 overflow-x-auto"><table className="w-full min-w-[960px] text-xs"><thead><tr className="border-b text-left text-muted-foreground"><th className="px-2 py-2">Datum / směna</th><th className="px-2 py-2">Linka / produkt</th><th className="px-2 py-2">Hodina</th><th className="px-2 py-2 text-right">Výstup</th><th className="px-2 py-2 text-right">Výkon</th><th className="px-2 py-2 text-right">OEE</th><th className="px-2 py-2">Stav</th><th className="px-2 py-2">Import</th><th className="px-2 py-2 text-right">Akce</th></tr></thead><tbody>{rows.map((r) => <Fragment key={r.hourly_id}>
        <tr className="border-b border-border/40">
          <td className="px-2 py-2">{r.work_date} · {r.shift}</td>
          <td className="px-2 py-2">{r.line} · {r.product_code ?? "–"}</td>
          <td className="px-2 py-2 font-medium">{r.hour}:00</td>
          <td className="px-2 py-2 text-right">{r.actual_output ?? "–"}</td>
          <td className="px-2 py-2 text-right font-semibold">{r.performance_pct != null ? `${r.performance_pct.toFixed(1)} %` : "–"}</td>
          <td className="px-2 py-2 text-right font-semibold">{r.actual_oee_pct != null ? `${r.actual_oee_pct.toFixed(1)} %` : "–"}</td>
          <td className="px-2 py-2"><Badge variant="outline" className={r.stat_status === "ANOMALY_PENDING_REVIEW" ? "border-amber-400/40 bg-amber-400/10 text-amber-300" : r.stat_status === "MANUALLY_EXCLUDED" ? "border-rose-400/40 bg-rose-400/10 text-rose-300" : "border-cyan-400/40 bg-cyan-400/10 text-cyan-300"}>{STAT_STATUS_LABEL[r.stat_status] ?? r.stat_status}</Badge></td>
          <td className="px-2 py-2 text-muted-foreground">{r.trace_id ?? "–"}</td>
          <td className="px-2 py-2 text-right">
            <div className="flex justify-end gap-1">
              <Button size="sm" variant="ghost" className="h-7 px-2 text-[11px]" onClick={() => setExpanded(expanded === r.hourly_id ? null : r.hourly_id)}>Historie</Button>
              {isAdmin ? <>
                {r.stat_status !== "MANUALLY_EXCLUDED" ? <Button size="sm" variant="ghost" className="h-7 px-2 text-[11px]" onClick={() => { setDialog({ row: r, newStatus: "MANUALLY_EXCLUDED" }); setReason(r.stat_status === "ANOMALY_PENDING_REVIEW" ? "Nelze spolehlivě určit efektivní čas výroby." : ""); setNote(""); }}>Vyřadit</Button> : null}
                {r.stat_status !== "MANUALLY_INCLUDED" ? <Button size="sm" variant="ghost" className="h-7 px-2 text-[11px]" onClick={() => { setDialog({ row: r, newStatus: "MANUALLY_INCLUDED" }); setReason(""); setNote(""); }}>Zahrnout</Button> : null}
              </> : null}
            </div>
          </td>
        </tr>
        {expanded === r.hourly_id ? <tr className="border-b border-border/40 bg-slate-900/30"><td colSpan={9} className="px-3 py-2">
          {eventsQuery.isLoading ? <p className="text-xs text-muted-foreground">Načítám historii…</p> : !eventsQuery.data?.length ? <p className="text-xs text-muted-foreground">Zatím žádná ruční rozhodnutí.</p> : <ul className="space-y-1 text-[11px] text-muted-foreground">{eventsQuery.data.map((ev) => <li key={ev.id}>{new Date(ev.created_at).toLocaleString("cs-CZ")} · {ev.from_status ?? "?"} → {ev.to_status}{ev.reason ? ` · ${ev.reason}` : ""}{ev.note ? ` (${ev.note})` : ""}</li>)}</ul>}
        </td></tr> : null}
      </Fragment>)}</tbody></table></div>}

      <Dialog open={!!dialog} onOpenChange={(open) => { if (!open) { setDialog(null); setReason(""); setNote(""); } }}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>{dialog?.newStatus === "MANUALLY_EXCLUDED" ? "Vyřadit hodinu ze statistik" : "Zahrnout hodinu do statistik"}</DialogTitle></DialogHeader>
          {dialog ? <div className="space-y-3 text-sm">
            <p className="text-muted-foreground">{dialog.row.work_date} · {dialog.row.shift} · {dialog.row.line} · hodina {dialog.row.hour}:00 · {dialog.row.product_code ?? "bez produktu"}. Vyřazení nemaže ani nemění výrobní data, mění pouze statistický stav.</p>
            <label className="block text-sm"><span className="mb-1 block text-xs text-muted-foreground">Důvod</span><Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Nelze spolehlivě určit efektivní čas výroby." /></label>
            <label className="block text-sm"><span className="mb-1 block text-xs text-muted-foreground">Poznámka (nepovinné)</span><Input value={note} onChange={(e) => setNote(e.target.value)} /></label>
          </div> : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog(null)}>Zrušit</Button>
            <Button disabled={!dialog || !reason.trim() || decide.isPending} onClick={() => dialog && decide.mutate({ hourlyId: dialog.row.hourly_id, newStatus: dialog.newStatus, reason, note })}>{dialog?.newStatus === "MANUALLY_EXCLUDED" ? "Vyřadit" : "Zahrnout"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
