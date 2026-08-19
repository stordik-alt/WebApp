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
  head: () => ({
    meta: [
      { title: "Ke schválení – Výkonnost operátorů" },
      {
        name: "description",
        content: "Kontrola a schvalování záznamů zadaných Team Leaderem před zápisem do statistik.",
      },
      { property: "og:title", content: "Ke schválení" },
      { property: "og:description", content: "Fronta návrhů čekajících na kontrolu správcem." },
    ],
  }),
  component: ApprovalPage,
});

type PendingTable =
  | "daily_records"
  | "shift_evaluations"
  | "weekly_records"
  | "products"
  | "product_norms"
  | "quality_alert_history";

const TABLE_LABEL: Record<PendingTable, string> = {
  daily_records: "Denní záznam",
  shift_evaluations: "Výpomoc (směna)",
  weekly_records: "Týdenní Yield",
  products: "Produkt",
  product_norms: "Norma",
  quality_alert_history: "Vyšetření Quality Alertu",
};

type PendingRow = { table: PendingTable; id: string; created_at: string; data: Record<string, unknown> };

function usePending() {
  return useQuery({
    queryKey: ["pending"],
    queryFn: async (): Promise<PendingRow[]> => {
      const tables: PendingTable[] = [
        "daily_records",
        "shift_evaluations",
        "weekly_records",
        "products",
        "product_norms",
        "quality_alert_history",
      ];
      const out: PendingRow[] = [];
      for (const t of tables) {
        const { data, error } = await supabase
          .from(t)
          .select("*")
          .eq("approval_status", "pending")
          .order("created_at", { ascending: false });
        if (error) throw error;
        for (const row of data ?? []) {
          const r = row as Record<string, unknown>;
          out.push({ table: t, id: String(r['id']), created_at: String(r['created_at']), data: r });
        }
      }
      return out.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
    },
  });
}

function summary(row: PendingRow, empName: (id: unknown) => string) {
  const d = row.data;
  switch (row.table) {
    case "daily_records":
      return `${d['work_date']} · směna ${d['shift']} · linka ${d['line']} · ${empName(d['employee_id'])} · OEE ${d['oee'] ?? "–"}`;
    case "shift_evaluations":
      return `${d['work_date']} · směna ${d['shift']} · ${empName(d['employee_id'])} · výpomoc ${d['help_score']}`;
    case "weekly_records":
      return `${d['iso_year']}/T${d['iso_week']} · ${empName(d['employee_id'])} · Yield ${d['yield_pct']} %`;
    case "products":
      return `${d['code']} ${d['name'] ? `– ${d['name']}` : ""}`;
    case "product_norms":
      return `${d['operation']} · ${d['norm_per_hour']} ks/h · platnost od ${d['valid_from']}`;
    case "quality_alert_history":
      return `Příčina: ${d['alert_cause'] ?? "–"} · finální score ${d['final_quality_score'] ?? "–"}`;
  }
}

function ApprovalPage() {
  const qc = useQueryClient();
  const { session } = useAuth();
  const { data: rows = [], isLoading } = usePending();
  const { data: employees = [] } = useEmployees();
  const empName = (id: unknown) => employees.find((e) => e.id === id)?.full_name ?? "?";

  const decide = useMutation({
    mutationFn: async ({ row, approve }: { row: PendingRow; approve: boolean }) => {
      const { error } = await supabase
        .from(row.table)
        .update({
          approval_status: approve ? "approved" : "rejected",
          approved_by: session?.user.id ?? null,
          approved_at: new Date().toISOString(),
        })
        .eq("id", row.id);
      if (error) throw error;

      // Schválené vyšetření alertu se propíše do týdenního záznamu.
      if (approve && row.table === "quality_alert_history") {
        const d = row.data;
        const { error: we } = await supabase
          .from("weekly_records")
          .update({
            alert_cause: (d['alert_cause'] as string | null) ?? null,
            alert_note: (d['alert_note'] as string | null) ?? null,
            operator_error: (d['operator_error'] as boolean | null) ?? null,
            final_quality_score: (d['final_quality_score'] as number | null) ?? null,
            alert_resolved: Boolean(d['alert_resolved']),
          })
          .eq("id", d['weekly_record_id'] as string);
        if (we) throw we;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries();
      toast.success("Uloženo");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <AppShell
      title="Ke schválení"
      subtitle="Záznamy od Team Leaderů se do statistik zapíšou až po vaší kontrole"
    >
      <div className="grid gap-3">
        {isLoading ? (
          <Card className="p-4 text-sm text-muted-foreground">Načítám…</Card>
        ) : rows.length === 0 ? (
          <Card className="p-6 text-center text-sm text-muted-foreground">
            Nic nečeká na schválení.
          </Card>
        ) : (
          rows.map((row) => (
            <Card key={`${row.table}-${row.id}`} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <Badge variant="outline">{TABLE_LABEL[row.table]}</Badge>
                <div className="mt-2 text-sm text-foreground">{summary(row, empName)}</div>
                <div className="mt-1 text-xs text-muted-foreground">
                  Vloženo {new Date(row.created_at).toLocaleString("cs-CZ")}
                </div>
              </div>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  disabled={decide.isPending}
                  onClick={() => decide.mutate({ row, approve: true })}
                >
                  Schválit
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={decide.isPending}
                  onClick={() => decide.mutate({ row, approve: false })}
                >
                  Zamítnout
                </Button>
              </div>
            </Card>
          ))
        )}
      </div>
    </AppShell>
  );
}
