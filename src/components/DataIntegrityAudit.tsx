import { useMutation } from "@tanstack/react-query";
import { ShieldCheck } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

const db = supabase as any;

type AuditRow = { check_name: string; severity: "critical" | "warning" | "info"; violation_count: number; sample_ids: string[] };

// Master Prompt sections 13-14: admin-triggered surface for
// run_data_integrity_audit() (see migration 20260919110000). Each row is an
// invariant this project actually found broken once (V4014's false-VALID
// status, the confirm-conflict UPSERT-vs-INSERT bug) or a class of
// corruption the data model must never allow - not a periodic background
// job, since a manufacturing-shift-tracking app this size doesn't need one
// and an admin-triggered check is easier to reason about.
const checkLabels: Record<string, string> = {
  V4014_FALSE_VALID_PROFILE: "Product Profile VALID bez navázaného produktu",
  DAILY_RECORD_ORPHAN_PRODUCT: "Denní záznam s neexistujícím produktem",
  DUPLICATE_DAILY_RECORD_NATURAL_KEY: "Duplicitní denní záznam (zaměstnanec/datum/směna/linka/produkt)",
  APPROVED_RECORD_MISSING_KPI: "Schválený záznam bez OEE/Výkonu/Dostupnosti",
  STUCK_IMPORT: "Zaseknutý import (>30 min ve zpracování)",
  OVERLAPPING_ACTIVE_PROFILE_KEY: "Dva současně platné Product Profily se stejným HA/TUP párem",
  DANGLING_CONFLICT_REFERENCE: "Odkaz na konfliktní záznam, který již neexistuje",
  REIMPORT_OF_NOT_REJECTED: "Reimport odkazuje na originál, který není zamítnutý",
  PENDING_APPROVAL_STALE: "Import čeká na schválení déle než 7 dní",
  IMPLAUSIBLE_PERFORMANCE_PCT: "Nereálně vysoký Výkon/OEE (> 200 %)",
};
const severityLabel: Record<string, string> = { critical: "Kritické", warning: "Varování", info: "Info" };

export function DataIntegrityAudit() {
  const audit = useMutation({
    mutationFn: async () => {
      const { data, error } = await db.rpc("run_data_integrity_audit");
      if (error) throw error;
      return (data ?? []) as AuditRow[];
    },
  });
  const rows = audit.data ?? [];
  const totalViolations = rows.reduce((sum, r) => sum + (r.severity !== "info" ? r.violation_count : 0), 0);

  return <Card className="p-4">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-2"><ShieldCheck className="h-5 w-5 text-muted-foreground" /><div><div className="font-semibold">Audit integrity dat</div><div className="text-sm text-muted-foreground">Kontrola konzistence importů, Product Profilů a denních záznamů.</div></div></div>
      <Button variant="outline" disabled={audit.isPending} onClick={() => audit.mutate()}>{audit.isPending ? "Kontroluji…" : "Spustit audit"}</Button>
    </div>
    {audit.error ? <div className="mt-3 text-sm text-destructive">Audit se nepodařilo spustit: {(audit.error as Error).message}</div> : null}
    {audit.isSuccess ? <>
      <div className="mt-3"><Badge variant={totalViolations ? "destructive" : "default"}>{totalViolations ? `${totalViolations} nalezených problémů` : "Bez nalezených problémů"}</Badge></div>
      <div className="mt-3 grid gap-2">{rows.map(r => <div key={r.check_name} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm"><span>{checkLabels[r.check_name] ?? r.check_name}</span><Badge variant={r.violation_count === 0 ? "outline" : r.severity === "critical" ? "destructive" : "secondary"}>{severityLabel[r.severity] ?? r.severity} · {r.violation_count}</Badge></div>)}</div>
    </> : null}
  </Card>;
}
