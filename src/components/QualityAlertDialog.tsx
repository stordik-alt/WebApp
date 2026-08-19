import { useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, History } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useQualityAlertHistory } from "@/lib/data";
import { fmt } from "@/lib/metrics";
import { diffAlert, isDuplicateSave, type AlertSnapshot } from "@/lib/alert-diff";
import type { WeeklyRecord } from "@/lib/metrics";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useApprovalFields, useAuth } from "@/lib/auth";

export function QualityAlertDialog({
  row,
  employeeName,
  onClose,
}: {
  row: WeeklyRecord | null;
  employeeName?: string | undefined;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const approval = useApprovalFields();
  const { isAdmin } = useAuth();
  const { data: history = [] } = useQualityAlertHistory(row?.id);
  const [cause, setCause] = useState("");
  const [note, setNote] = useState("");
  const [operatorError, setOperatorError] = useState<"yes" | "no">("no");
  const [finalScore, setFinalScore] = useState("0");
  const [conflict, setConflict] = useState<string | null>(null);

  useEffect(() => {
    if (!row) return;
    setCause(row.alert_cause ?? "");
    setNote(row.alert_note ?? "");
    setOperatorError(row.operator_error ? "yes" : "no");
    setFinalScore(row.final_quality_score !== null ? String(row.final_quality_score) : "0");
    setConflict(null);
  }, [row]);

  const nextSnapshot: AlertSnapshot = useMemo(
    () => ({
      alert_cause: cause.trim() || null,
      alert_note: note.trim() || null,
      operator_error: operatorError === "yes",
      final_quality_score: Number(finalScore),
    }),
    [cause, note, operatorError, finalScore],
  );

  const lastEntry = history[0] ?? null;
  const baseline: AlertSnapshot | null = lastEntry
    ? lastEntry
    : row
      ? {
          alert_cause: row.alert_cause ?? null,
          alert_note: row.alert_note ?? null,
          operator_error: row.operator_error ?? null,
          final_quality_score: row.final_quality_score ?? null,
        }
      : null;
  const pendingDiff = diffAlert(baseline, nextSnapshot);

  const resolve = useMutation({
    mutationFn: async () => {
      if (!row) return;
      if (isDuplicateSave(lastEntry, nextSnapshot)) {
        throw new Error("Stejná příčina i poznámka už byly uloženy před chvílí – duplicitní záznam nevznikl.");
      }
      if (lastEntry && pendingDiff.length === 0) {
        throw new Error("Žádná změna k uložení – obsah je shodný s poslední verzí.");
      }
      const payload = {
        ...nextSnapshot,
        alert_resolved: true,
      };
      if (isAdmin) {
        const { error } = await supabase.from("weekly_records").update(payload).eq("id", row.id);
        if (error) throw error;
      }

      const { data: auth } = await supabase.auth.getUser();
      const { error: histError } = await supabase.from("quality_alert_history").insert({
        weekly_record_id: row.id,
        ...payload,
        changed_by: auth.user?.id ?? null,
        changed_by_email: auth.user?.email ?? null,
        ...approval(),
      });
      if (histError) {
        if (histError.message.includes("DUPLICATE_QUALITY_ALERT_HISTORY") || histError.code === "23505") {
          const conflictError = new Error(
            "Server odmítl zápis – tento obsah už byl uložen (možná souběžně z jiného zařízení).",
          );
          conflictError.name = "ConflictError";
          throw conflictError;
        }
        throw histError;
      }
    },
    onSuccess: () => {
      setConflict(null);
      qc.invalidateQueries({ queryKey: ["weekly"] });
      qc.invalidateQueries({ queryKey: ["quality_alert_history"] });
      onClose();
      toast.success("Alert vyřešen, finální Quality Score uloženo");
    },
    onError: async (e: Error) => {
      if (e.name === "ConflictError") {
        setConflict(e.message);
        await Promise.all([
          qc.invalidateQueries({ queryKey: ["quality_alert_history"] }),
          qc.invalidateQueries({ queryKey: ["weekly"] }),
        ]);
        toast.error("Načetl jsem poslední verzi alertu – porovnejte změny níže.");
        return;
      }
      toast.error(e.message);
    },
  });

  const min = operatorError === "yes" ? -100 : 0;
  const max = operatorError === "yes" ? 0 : 100;

  return (
    <Dialog open={!!row} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="h-5 w-5" /> Vyšetření Quality Alertu
          </DialogTitle>
        </DialogHeader>
        {row ? (
          <div className="grid gap-4">
            <div className="rounded-md bg-muted px-3 py-2 text-sm">
              {employeeName ? `${employeeName} · ` : ""}
              {row.iso_year}/T{row.iso_week} · Původní Yield{" "}
              <span className="font-semibold">{fmt(row.yield_pct)} %</span> (zůstává vždy zachován)
            </div>
            <div className="grid gap-1.5">
              <Label>Příčina</Label>
              <Input value={cause} onChange={(e) => setCause(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label>Poznámka</Label>
              <Textarea value={note} onChange={(e) => setNote(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label>Šlo o chybu operátora?</Label>
              <Select
                value={operatorError}
                onValueChange={(v) => {
                  setOperatorError(v as "yes" | "no");
                  setFinalScore("0");
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="no">Ne – příčina mimo operátora</SelectItem>
                  <SelectItem value="yes">Ano – chyba operátora</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label>
                Finální Quality Score ({min} až {max}): <strong>{finalScore}</strong>
              </Label>
              <Input
                type="range"
                min={min}
                max={max}
                step={5}
                value={finalScore}
                onChange={(e) => setFinalScore(e.target.value)}
                className="cursor-pointer p-0"
              />
            </div>

            {conflict ? (
              <div className="grid gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs">
                <div className="flex items-center gap-2 text-sm font-semibold text-destructive">
                  <AlertTriangle className="h-4 w-4" /> Souběžné uložení
                </div>
                <p className="text-muted-foreground">
                  {conflict} Níže vidíte porovnání vaší verze s poslední verzí ze serveru.
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      if (!baseline) return;
                      setCause(baseline.alert_cause ?? "");
                      setNote(baseline.alert_note ?? "");
                      setOperatorError(baseline.operator_error ? "yes" : "no");
                      setFinalScore(
                        baseline.final_quality_score !== null ? String(baseline.final_quality_score) : "0",
                      );
                      setConflict(null);
                    }}
                  >
                    Převzít poslední verzi
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => resolve.mutate()}
                    disabled={resolve.isPending || pendingDiff.length === 0}
                  >
                    Uložit znovu
                  </Button>
                </div>
              </div>
            ) : null}

            <div className="grid gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-xs">
              <div className="text-sm font-semibold">Změny oproti poslední verzi (server)</div>
              {pendingDiff.length === 0 ? (
                <p className="text-muted-foreground">Žádné změny – uložení nevytvoří nový záznam historie.</p>
              ) : (
                pendingDiff.map((c) => (
                  <div key={c.label} className="flex flex-wrap items-baseline gap-1">
                    <span className="font-medium">{c.label}:</span>
                    <span className="rounded bg-destructive/10 px-1 text-destructive line-through">{c.before}</span>
                    <span aria-hidden>→</span>
                    <span className="rounded bg-primary/10 px-1 text-primary">{c.after}</span>
                  </div>
                ))
              )}
            </div>

            <div className="grid gap-2 border-t border-border pt-3">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <History className="h-4 w-4 text-muted-foreground" /> Historie úprav
              </div>
              {history.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  Zatím žádné úpravy – uložením vyšetření vznikne první záznam historie.
                </p>
              ) : (
                <ul className="max-h-48 space-y-2 overflow-y-auto pr-1">
                  {history.map((h, i) => {
                    const changes = diffAlert(history[i + 1] ?? null, h);
                    return (
                    <li key={h.id} className="rounded-md border border-border px-3 py-2 text-xs">
                      <div className="font-medium">
                        {new Date(h.created_at).toLocaleString("cs-CZ")}
                        {h.changed_by_email ? ` · ${h.changed_by_email}` : ""}
                      </div>
                      <div className="mt-1 text-muted-foreground">
                        Finální skóre: <span className="tabular-nums">{fmt(h.final_quality_score)}</span>
                        {" · "}Chyba operátora:{" "}
                        {h.operator_error === null ? "–" : h.operator_error ? "Ano" : "Ne"}
                      </div>
                      <div className="text-muted-foreground">Příčina: {h.alert_cause ?? "–"}</div>
                      <div className="text-muted-foreground">Poznámka: {h.alert_note ?? "–"}</div>
                      {changes.length > 0 ? (
                        <div className="mt-1.5 space-y-1 border-t border-border/60 pt-1.5">
                          {changes.map((c) => (
                            <div key={c.label} className="flex flex-wrap items-baseline gap-1">
                              <span className="font-medium">{c.label}:</span>
                              <span className="rounded bg-destructive/10 px-1 text-destructive line-through">
                                {c.before}
                              </span>
                              <span aria-hidden>→</span>
                              <span className="rounded bg-primary/10 px-1 text-primary">{c.after}</span>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="mt-1.5 text-muted-foreground">Beze změn oproti předchozí verzi.</div>
                      )}
                    </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
        ) : null}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Zrušit
          </Button>
          <Button
            onClick={() => resolve.mutate()}
            disabled={resolve.isPending || (!!lastEntry && pendingDiff.length === 0)}
          >
            Uložit vyšetření
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
