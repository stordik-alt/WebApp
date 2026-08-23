import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/AppShell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useEmployees } from "@/lib/data";
import { useAuth } from "@/lib/auth";

export const Route = createFileRoute("/ke-schvaleni")({
  head: () => ({ meta: [{ title: "Ke schválení – Výkonnost operátorů" }, { name: "description", content: "Kontrola a schvalování záznamů před zápisem do statistik." }] }),
  component: ApprovalPage,
});

type PendingTable = "daily_records" | "shift_evaluations" | "weekly_records" | "products" | "product_norms" | "quality_alert_history";
const TABLE_LABEL: Record<PendingTable, string> = { daily_records: "Denní záznam", shift_evaluations: "Výpomoc (směna)", weekly_records: "Týdenní Yield", products: "Produkt", product_norms: "Norma", quality_alert_history: "Vyšetření Quality Alertu" };
type PendingRow = { table: PendingTable; id: string; created_at: string; data: Record<string, unknown> };

function usePending() {
  return useQuery({
    queryKey: ["pending"],
    queryFn: async (): Promise<PendingRow[]> => {
      const tables: PendingTable[] = ["daily_records", "shift_evaluations", "weekly_records", "products", "product_norms", "quality_alert_history"];
      const out: PendingRow[] = [];
      for (const t of tables) {
        const { data, error } = await supabase.from(t).select("*").eq("approval_status", "pending").order("created_at", { ascending: false });
        if (error) throw error;
        for (const row of data ?? []) {
          const r = row as Record<string, unknown>;
          out.push({ table: t, id: String(r.id), created_at: String(r.created_at), data: r });
        }
      }
      return out.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
    },
  });
}

function summary(row: PendingRow, empName: (id: unknown) => string) {
  const d = row.data;
  switch (row.table) {
    case "daily_records": return `${d.work_date} · směna ${d.shift} · linka ${d.line} · ${empName(d.employee_id)} · OEE ${d.oee ?? "–"}`;
    case "shift_evaluations": return `${d.work_date} · směna ${d.shift} · ${empName(d.employee_id)} · výpomoc ${d.help_score}`;
    case "weekly_records": return `${d.iso_year}/T${d.iso_week} · ${empName(d.employee_id)} · Yield ${d.yield_pct} %`;
    case "products": return `${d.code} ${d.name ? `– ${d.name}` : ""}`;
    case "product_norms": return `${d.operation} · ${d.norm_per_hour} ks/h · platnost od ${d.valid_from}`;
    case "quality_alert_history": return `Příčina: ${d.alert_cause ?? "–"} · finální score ${d.final_quality_score ?? "–"}`;
  }
}

function ApprovalPage() {
  const qc = useQueryClient();
  const { session, isAdmin } = useAuth();
  const { data: rows = [], isLoading, error } = usePending();
  const { data: employees = [] } = useEmployees();
  const [selected, setSelected] = useState<PendingRow | null>(null);
  const [rejectionReason, setRejectionReason] = useState("");
  const empName = (id: unknown) => employees.find((e) => e.id === id)?.full_name ?? "?";

  const decide = useMutation({
    mutationFn: async ({ row, approve, reason }: { row: PendingRow; approve: boolean; reason?: string }) => {
      if (!isAdmin) throw new Error("Schvalovat záznamy může pouze správce.");
      if (!approve && !reason?.trim()) throw new Error("Při zamítnutí je nutné uvést důvod.");
      const userId = session?.user.id;
      if (!userId) throw new Error("Uživatel není přihlášen.");
      const newStatus = approve ? "approved" : "rejected";
      const updatePayload: Record<string, unknown> = { approval_status: newStatus, approved_by: approve ? userId : null, approved_at: approve ? new Date().toISOString() : null, rejection_reason: approve ? null : reason!.trim() };
      const { error: updateError } = await (supabase.from(row.table) as any).update(updatePayload).eq("id", row.id).eq("approval_status", "pending");
      if (updateError) throw updateError;
      const { error: auditError } = await supabase.from("approval_audit_log").insert({ table_name: row.table, record_id: row.id, previous_status: "pending", new_status: newStatus, rejection_reason: approve ? null : reason!.trim(), changed_by: userId });
      if (auditError) throw auditError;
      if (approve && row.table === "quality_alert_history") {
        const d = row.data;
        const { error: we } = await supabase.from("weekly_records").update({ alert_cause: (d.alert_cause as string | null) ?? null, alert_note: (d.alert_note as string | null) ?? null, operator_error: (d.operator_error as boolean | null) ?? null, final_quality_score: (d.final_quality_score as number | null) ?? null, alert_resolved: Boolean(d.alert_resolved) }).eq("id", d.weekly_record_id as string);
        if (we) throw we;
      }
    },
    onSuccess: (_, variables) => { setSelected(null); setRejectionReason(""); qc.invalidateQueries({ queryKey: ["pending"] }); qc.invalidateQueries(); toast.success(variables.approve ? "Záznam byl schválen a zařazen do statistik." : "Záznam byl zamítnut."); },
    onError: (e: Error) => toast.error(e.message),
  });

  const reject = (row: PendingRow) => {
    const reason = window.prompt("Uveďte důvod zamítnutí:", "");
    if (!reason?.trim()) return;
    setRejectionReason(reason.trim());
    decide.mutate({ row, approve: false, reason: reason.trim() });
  };

  return <AppShell title="Ke schválení" subtitle="Záznamy před schválením zkontrolujte a potom schvalte nebo zamítněte">
    {!isAdmin ? <Card className="p-6 text-center"><div className="text-base font-semibold">Přístup pouze pro správce</div><div className="mt-1 text-sm text-muted-foreground">Rozhodovat o záznamech může pouze administrátor.</div></Card> : <div className="grid gap-3">
      <Card className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between"><div><div className="font-semibold">Schvalovací fronta</div><div className="text-sm text-muted-foreground">{rows.length} {rows.length === 1 ? "položka čeká" : "položek čeká"} na kontrolu</div></div><Badge variant={rows.length ? "default" : "outline"}>{rows.length ? "Čeká na kontrolu" : "Vše vyřízeno"}</Badge></Card>
      {isLoading ? <Card className="p-4 text-sm text-muted-foreground">Načítám…</Card> : error ? <Card className="p-4 text-sm text-destructive">Nepodařilo se načíst schvalovací frontu: {(error as Error).message}</Card> : rows.length === 0 ? <Card className="p-6 text-center text-sm text-muted-foreground">Nic nečeká na schválení.</Card> : rows.map(row => <Card key={`${row.table}-${row.id}`} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><Badge variant="outline">{TABLE_LABEL[row.table]}</Badge><Badge variant="secondary">PENDING</Badge></div><div className="mt-2 text-sm">{summary(row, empName)}</div><div className="mt-1 text-xs text-muted-foreground">Importováno {new Date(row.created_at).toLocaleString("cs-CZ")}</div></div><div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" onClick={() => setSelected(row)}>Zobrazit detail</Button><Button size="sm" disabled={decide.isPending} onClick={() => decide.mutate({ row, approve: true })}>Schválit</Button><Button size="sm" variant="destructive" disabled={decide.isPending} onClick={() => reject(row)}>Zamítnout</Button></div></Card>)}
      {selected && <Card className="p-5"><div className="flex items-start justify-between gap-4"><div><div className="flex flex-wrap items-center gap-2"><Badge>{TABLE_LABEL[selected.table]}</Badge><Badge variant="secondary">PENDING</Badge></div><h2 className="mt-2 text-lg font-semibold">Detail čekajícího záznamu</h2><p className="text-sm text-muted-foreground">ID: {selected.id}</p></div><Button size="sm" variant="ghost" onClick={() => setSelected(null)}>Zavřít</Button></div><div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{Object.entries(selected.data).map(([key, value]) => <div key={key} className="rounded-lg border bg-muted/30 p-3"><div className="text-xs font-medium text-muted-foreground">{key}</div><div className="mt-1 break-words text-sm">{value == null || value === "" ? "–" : String(value)}</div></div>)}</div><div className="mt-5 flex flex-wrap justify-end gap-2"><Button variant="destructive" disabled={decide.isPending} onClick={() => reject(selected)}>Zamítnout</Button><Button disabled={decide.isPending} onClick={() => decide.mutate({ row: selected, approve: true })}>Schválit a zařadit do statistik</Button></div></Card>}
    </div>}
  </AppShell>;
}
