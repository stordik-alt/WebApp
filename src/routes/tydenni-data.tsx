import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useEmployees, useWeeklyRecords } from "@/lib/data";
import { fmt, isoWeek, previewAutoScore } from "@/lib/metrics";
import type { WeeklyRecord } from "@/lib/metrics";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { AlertTriangle, Save, Trash2 } from "lucide-react";
import { useApprovalFields } from "@/lib/auth";

export const Route = createFileRoute("/tydenni-data")({
  head: () => ({
    meta: [
      { title: "Týdenní data a Quality Alerty – Výkonnost operátorů" },
      { name: "description", content: "Zadávání týdenního Yieldu, automatický výpočet Quality Score a řešení Quality Alertů pod 79 %." },
      { property: "og:title", content: "Týdenní data a Quality Alerty – Výkonnost operátorů" },
      { property: "og:description", content: "Yield, Quality Score a vyšetřování Quality Alertů ve výrobě DPS." },
    ],
  }),
  component: WeeklyPage,
});

function WeeklyPage() {
  const qc = useQueryClient();
  const approval = useApprovalFields();
  const { data: employees = [] } = useEmployees();
  const { data: weekly = [] } = useWeeklyRecords();

  const now = isoWeek(new Date());
  const [employeeId, setEmployeeId] = useState("");
  const [year, setYear] = useState(String(now.year));
  const [week, setWeek] = useState(String(now.week));
  const [yieldPct, setYieldPct] = useState("");
  const [weeklyFilterText, setWeeklyFilterText] = useState("");
  const [weeklyFilterStatus, setWeeklyFilterStatus] = useState("all");
  const [weeklySort, setWeeklySort] = useState<"employee" | "week" | "yield" | "score">("week");
  const [weeklySortDir, setWeeklySortDir] = useState<"asc" | "desc">("desc");

  const [alertRow, setAlertRow] = useState<WeeklyRecord | null>(null);
  const [cause, setCause] = useState("");
  const [alertNote, setAlertNote] = useState("");
  const [operatorError, setOperatorError] = useState<"yes" | "no">("no");
  const [finalScore, setFinalScore] = useState("0");

  const empName = (id: string) => employees.find((e) => e.id === id)?.full_name ?? "?";
  const yieldNum = Number(yieldPct);
  const preview = yieldPct === "" ? null : previewAutoScore(yieldNum);
  const willAlert = yieldPct !== "" && yieldNum < 79;

  const create = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("weekly_records").insert({
        employee_id: employeeId,
        iso_year: Number(year),
        iso_week: Number(week),
        yield_pct: yieldNum,
        ...approval(),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["weekly"] });
      setYieldPct("");
      toast.success("Týdenní záznam uložen");
    },
    onError: (e: Error) =>
      toast.error(
        e.message.includes("duplicate")
          ? "Pro tohoto zaměstnance už existuje záznam pro daný týden."
          : e.message,
      ),
  });

  const resolve = useMutation({
    mutationFn: async () => {
      if (!alertRow) return;
      const { error } = await supabase
        .from("weekly_records")
        .update({
          alert_cause: cause.trim() || null,
          alert_note: alertNote.trim() || null,
          operator_error: operatorError === "yes",
          final_quality_score: Number(finalScore),
          alert_resolved: true,
        })
        .eq("id", alertRow.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["weekly"] });
      setAlertRow(null);
      toast.success("Alert vyřešen, finální Quality Score uloženo");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("weekly_records").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["weekly"] });
      toast.success("Záznam smazán");
    },
  });

  function openAlert(row: WeeklyRecord) {
    setAlertRow(row);
    setCause(row.alert_cause ?? "");
    setAlertNote(row.alert_note ?? "");
    setOperatorError(row.operator_error ? "yes" : "no");
    setFinalScore(row.final_quality_score !== null ? String(row.final_quality_score) : "0");
  }

  const openAlerts = weekly.filter((w) => w.is_alert && !w.alert_resolved);
  const filteredWeekly = useMemo(() => {
    const text = weeklyFilterText.trim().toLowerCase();
    const rows = weekly.filter((w) => {
      if (weeklyFilterStatus === "alert" && !w.is_alert) return false;
      if (weeklyFilterStatus === "ok" && w.is_alert) return false;
      if (text && !empName(w.employee_id).toLowerCase().includes(text)) return false;
      return true;
    });
    const value = (w: WeeklyRecord) => weeklySort === "employee" ? empName(w.employee_id).toLowerCase() : weeklySort === "week" ? `${w.iso_year}-${String(w.iso_week).padStart(2, "0")}` : Number(weeklySort === "yield" ? w.yield_pct : w.final_quality_score ?? w.auto_quality_score ?? -Infinity);
    rows.sort((a, b) => { const av = value(a), bv = value(b); const cmp = av < bv ? -1 : av > bv ? 1 : 0; return weeklySortDir === "asc" ? cmp : -cmp; });
    return rows;
  }, [weekly, weeklyFilterText, weeklyFilterStatus, weeklySort, weeklySortDir, employees]);
  const min = operatorError === "yes" ? -100 : 0;
  const max = operatorError === "yes" ? 0 : 100;

  return (
    <AppShell
      title="Týdenní data / Quality"
      subtitle="Yield 90–100 % → (Yield-90)×10 · Yield 79–89 % → (Yield-89)×10 · pod 79 % → QUALITY ALERT"
    >
      {openAlerts.length > 0 ? (
        <div className="mb-6 rounded-lg border-2 border-destructive bg-destructive/5 p-4">
          <div className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="h-5 w-5" />
            <span className="text-sm font-semibold uppercase tracking-wide">
              Quality Alert – {openAlerts.length} nevyřešeno
            </span>
          </div>
          <div className="mt-3 grid gap-2">
            {openAlerts.map((w) => (
              <div
                key={w.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-destructive/40 bg-card px-3 py-2"
              >
                <div className="text-sm">
                  <span className="font-medium">{empName(w.employee_id)}</span>
                  <span className="text-muted-foreground">
                    {" "}
                    · {w.iso_year}/T{w.iso_week} · Yield {fmt(w.yield_pct)} %
                  </span>
                </div>
                <Button size="sm" variant="destructive" onClick={() => openAlert(w)}>
                  Vyšetřit a nastavit skóre
                </Button>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div className="grid min-w-0 grid-cols-1 gap-6 xl:grid-cols-[380px_1fr]">
        <Card className="h-fit min-w-0 overflow-hidden gap-4 p-5 shadow-[var(--shadow-card)]">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Nový týdenní záznam
          </h2>
          <div className="grid gap-3">
            <div className="grid gap-1.5">
              <Label>Zaměstnanec</Label>
              <Select value={employeeId} onValueChange={setEmployeeId}>
                <SelectTrigger>
                  <SelectValue placeholder="Vyberte zaměstnance" />
                </SelectTrigger>
                <SelectContent>
                  {employees
                    .filter((e) => e.active)
                    .map((e) => (
                      <SelectItem key={e.id} value={e.id}>
                        {e.full_name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label>Rok</Label>
                <Input type="number" value={year} onChange={(e) => setYear(e.target.value)} />
              </div>
              <div className="grid gap-1.5">
                <Label>Týden</Label>
                <Input
                  type="number"
                  min={1}
                  max={53}
                  value={week}
                  onChange={(e) => setWeek(e.target.value)}
                />
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label>Yield (%)</Label>
              <Input
                type="number"
                step="0.01"
                min="0"
                max="100"
                value={yieldPct}
                onChange={(e) => setYieldPct(e.target.value)}
              />
            </div>
            {yieldPct !== "" ? (
              willAlert ? (
                <div className="rounded-md border-2 border-destructive bg-destructive/10 px-3 py-2 text-sm font-medium text-destructive">
                  QUALITY ALERT – Yield pod 79 %. Automatické skóre se nepoužije, záznam bude
                  vyžadovat vyšetření.
                </div>
              ) : (
                <div className="rounded-md bg-muted px-3 py-2 text-sm">
                  Automatické Quality Score:{" "}
                  <span className="font-semibold tabular-nums">{fmt(preview)}</span>
                </div>
              )
            ) : null}
          </div>
          <Button
            onClick={() => create.mutate()}
            disabled={!employeeId || yieldPct === "" || create.isPending}
          >
            <Save className="h-4 w-4" /> Uložit
          </Button>
        </Card>

        <div className="min-w-0 overflow-hidden rounded-xl border !border-primary/40 bg-card shadow-[0_0_18px_hsl(var(--primary)/0.10),0_0_34px_hsl(var(--chart-4)/0.06),var(--shadow-card)] !ring-1 !ring-primary/15">
          <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
            <Input className="h-9 w-[180px]" placeholder="Hledat zaměstnance" value={weeklyFilterText} onChange={(e) => setWeeklyFilterText(e.target.value)} />
            <Select value={weeklyFilterStatus} onValueChange={setWeeklyFilterStatus}>
              <SelectTrigger className="h-9 w-[150px]"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="all">Všechny stavy</SelectItem><SelectItem value="ok">OK</SelectItem><SelectItem value="alert">Quality Alert</SelectItem></SelectContent>
            </Select>
            <Select value={weeklySort} onValueChange={(v) => setWeeklySort(v as typeof weeklySort)}>
              <SelectTrigger className="h-9 w-[140px]"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="week">Týden</SelectItem><SelectItem value="employee">Zaměstnanec</SelectItem><SelectItem value="yield">Yield</SelectItem><SelectItem value="score">Quality skóre</SelectItem></SelectContent>
            </Select>
            <Button size="sm" variant="outline" onClick={() => setWeeklySortDir((d) => d === "asc" ? "desc" : "asc")}>{weeklySortDir === "asc" ? "↑" : "↓"}</Button>
            <Button size="sm" variant="ghost" onClick={() => { setWeeklyFilterText(""); setWeeklyFilterStatus("all"); }}>Zrušit filtry</Button>
            <span className="ml-auto text-xs text-muted-foreground">{filteredWeekly.length} záznamů</span>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Zaměstnanec</TableHead>
                <TableHead>Týden</TableHead>
                <TableHead className="text-right">Yield</TableHead>
                <TableHead className="text-right">Auto skóre</TableHead>
                <TableHead className="text-right">Finální skóre</TableHead>
                <TableHead>Stav</TableHead>
                <TableHead>Příčina</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {weekly.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-muted-foreground">
                    Zatím žádné týdenní záznamy.
                  </TableCell>
                </TableRow>
              ) : (
                filteredWeekly.map((w) => (
                  <TableRow key={w.id} className={w.is_alert && !w.alert_resolved ? "bg-destructive/5" : ""}>
                    <TableCell className="font-medium">{empName(w.employee_id)}</TableCell>
                    <TableCell>
                      {w.iso_year}/T{w.iso_week}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{fmt(w.yield_pct)} %</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {fmt(w.auto_quality_score)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {fmt(w.final_quality_score)}
                    </TableCell>
                    <TableCell>
                      {w.is_alert ? (
                        w.alert_resolved ? (
                          <Badge variant="outline">Alert vyřešen</Badge>
                        ) : (
                          <Badge variant="destructive">QUALITY ALERT</Badge>
                        )
                      ) : (
                        <Badge className="bg-success text-success-foreground">OK</Badge>
                      )}
                    </TableCell>
                    <TableCell className="max-w-[200px] truncate text-xs text-muted-foreground">
                      {w.alert_cause ?? "–"}
                      {w.operator_error === true ? " (chyba operátora)" : ""}
                    </TableCell>
                    <TableCell className="space-x-1 text-right">
                      {w.is_alert ? (
                        <Button size="sm" variant="outline" onClick={() => openAlert(w)}>
                          Vyšetřit
                        </Button>
                      ) : null}
                      <Button size="sm" variant="ghost" onClick={() => remove.mutate(w.id)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      <Dialog open={!!alertRow} onOpenChange={(o) => !o && setAlertRow(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-5 w-5" /> Vyšetření Quality Alertu
            </DialogTitle>
          </DialogHeader>
          {alertRow ? (
            <div className="grid gap-4">
              <div className="rounded-md bg-muted px-3 py-2 text-sm">
                {empName(alertRow.employee_id)} · {alertRow.iso_year}/T{alertRow.iso_week} ·
                Původní Yield <span className="font-semibold">{fmt(alertRow.yield_pct)} %</span>{" "}
                (zůstává vždy zachován)
              </div>
              <div className="grid gap-1.5">
                <Label>Příčina</Label>
                <Input value={cause} onChange={(e) => setCause(e.target.value)} />
              </div>
              <div className="grid gap-1.5">
                <Label>Poznámka</Label>
                <Textarea value={alertNote} onChange={(e) => setAlertNote(e.target.value)} />
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
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setAlertRow(null)}>
              Zrušit
            </Button>
            <Button onClick={() => resolve.mutate()} disabled={resolve.isPending}>
              Uložit vyšetření
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
