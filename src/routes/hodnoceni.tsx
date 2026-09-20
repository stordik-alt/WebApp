import { createFileRoute } from "@tanstack/react-router";
import { localDateKey } from "@/lib/metrics";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useEmployees, useHandlerEvaluations } from "@/lib/data";
import type { HandlerEvaluation } from "@/lib/handler-eval";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Plus, Pencil, Trash2, ClipboardCheck } from "lucide-react";
import { TableRowSkeleton, CardSkeletonList } from "@/components/TableSkeleton";
import { EmptyState } from "@/components/EmptyState";

export const Route = createFileRoute("/hodnoceni")({
  head: () => ({
    meta: [
      { title: "Hodnocení handlerů a vlnařů" },
      {
        name: "description",
        content: "Denní a týdenní hodnocení práce handlerů a vlnařů bez OEE/norem.",
      },
      { property: "og:title", content: "Hodnocení handlerů a vlnařů" },
    ],
  }),
  component: HandlerEvaluationPage,
});

type FormState = {
  employee_id: string;
  work_date: string;
  shift: string;
  score: string;
  note: string;
};

const EMPTY: FormState = {
  employee_id: "",
  work_date: localDateKey(),
  shift: "Ranní",
  score: "50",
  note: "",
};

function HandlerEvaluationPage() {
  const { data: employees = [] } = useEmployees();
  const { data: evaluations = [], isLoading } = useHandlerEvaluations();
  const [showInactive, setShowInactive] = useState(false);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<HandlerEvaluation | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY);
  const qc = useQueryClient();

  const filteredEmployees = employees.filter(
    (e) => showInactive || e.active,
  );

  const save = useMutation({
    mutationFn: async () => {
      if (!form.employee_id) return;
      const payload = {
        employee_id: form.employee_id,
        work_date: form.work_date,
        shift: form.shift,
        score: Number(form.score),
        note: form.note.trim() || null,
      };
      if (editing) {
        const { error } = await supabase
          .from("handler_evaluations")
          .update(payload)
          .eq("id", editing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("handler_evaluations").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["handler_evaluations"] });
      setOpen(false);
      toast.success(editing ? "Hodnocení upraveno" : "Hodnocení přidáno");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const del = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("handler_evaluations").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["handler_evaluations"] });
      toast.success("Hodnocení smazáno");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function openNew() {
    setEditing(null);
    setForm(EMPTY);
    setOpen(true);
  }

  function openEdit(ev: HandlerEvaluation) {
    setEditing(ev);
    setForm({
      employee_id: ev.employee_id,
      work_date: ev.work_date,
      shift: ev.shift,
      score: String(ev.score),
      note: ev.note ?? "",
    });
    setOpen(true);
  }

  const avgScore = evaluations.length
    ? Math.round(
        evaluations.reduce((acc, e) => acc + e.score, 0) / evaluations.length,
      )
    : null;

  const employeeNames = new Map(
    employees.map((e) => [e.id, e.full_name]),
  );

  return (
    <AppShell
      title="Hodnocení handlerů a vlnařů"
      subtitle="Denní a týdenní hodnocení práce bez OEE/norem."
      actions={
        <>
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            <Switch checked={showInactive} onCheckedChange={setShowInactive} />
            Zobrazit neaktivní
          </label>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button onClick={openNew}>
                <Plus className="h-4 w-4" /> Nové hodnocení
              </Button>
            </DialogTrigger>
            <DialogContent className="max-h-[92vh] w-[calc(100%-1rem)] overflow-y-auto sm:w-[calc(100%-3rem)]">
              <DialogHeader>
                <DialogTitle>
                  {editing ? "Upravit hodnocení" : "Nové hodnocení"}
                </DialogTitle>
              </DialogHeader>
              <div className="grid gap-4">
                <div className="grid gap-2">
                  <Label htmlFor="employee">Zaměstnanec</Label>
                  <select
                    id="employee"
                    className="flex h-11 w-full rounded-md border border-border bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring"
                    value={form.employee_id}
                    onChange={(e) =>
                      setForm({ ...form, employee_id: e.target.value })
                    }
                  >
                    {filteredEmployees.map((emp) => (
                      <option key={emp.id} value={emp.id}>
                        {emp.full_name}
                        {emp.position_type !== "standard" && (
                          <span className="ml-2 text-xs text-muted-foreground">
                            ({emp.position_type})
                          </span>
                        )}
                      </option>
                    ))}
                  </select>
                  <p className="text-[10px] text-muted-foreground">
                    Možno vybrat pouze zaměstnance s typem pozice handler/vlnař.
                  </p>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="date">Datum</Label>
                  <Input
                    id="date"
                    type="date"
                    value={form.work_date}
                    onChange={(e) => setForm({ ...form, work_date: e.target.value })}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="shift">Směna</Label>
                  <select
                    id="shift"
                    className="flex h-11 w-full rounded-md border border-border bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring"
                    value={form.shift}
                    onChange={(e) => setForm({ ...form, shift: e.target.value })}
                  >
                    <option value="Ranní">Ranní</option>
                    <option value="Odpolední">Odpolední</option>
                    <option value="Noční">Noční</option>
                  </select>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="score">Skóre (0-100)</Label>
                  <Input
                    id="score"
                    type="number"
                    min={0}
                    max={100}
                    value={form.score}
                    onChange={(e) => setForm({ ...form, score: e.target.value })}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="note">Poznámka</Label>
                  <Input
                    id="note"
                    value={form.note}
                    onChange={(e) => setForm({ ...form, note: e.target.value })}
                  />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setOpen(false)}>
                  Zrušit
                </Button>
                <Button
                  onClick={() => save.mutate()}
                  disabled={!form.employee_id || !form.score || save.isPending}
                >
                  Uložit
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </>
      }
    >
      <div className="mb-4 rounded-lg border border-border bg-card p-4 shadow-[var(--shadow-card)]">
        <div className="flex items-center justify-between gap-6">
          <div>
            <span className="text-sm font-medium text-muted-foreground">Průměrné skóre</span>
            <div className="mt-1 flex items-baseline gap-3">
              <span className="text-2xl font-bold tabular-nums">
                {avgScore !== null ? avgScore : "–"}
              </span>
              <span className="rounded-full border border-border bg-muted/55 px-3 py-1 text-xs font-medium text-muted-foreground">
                {evaluations.length ? `${evaluations.length} hodnocení` : "Bez dat"}
              </span>
            </div>
            {!evaluations.length ? (
              <p className="mt-1 text-xs text-muted-foreground">Zatím nejsou k dispozici žádná hodnocení.</p>
            ) : null}
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card shadow-[var(--shadow-card)]">
        <div className="hidden md:block">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Datum</TableHead>
                <TableHead>Zaměstnanec</TableHead>
                <TableHead>Směna</TableHead>
                <TableHead>Skóre</TableHead>
                <TableHead>Poznámka</TableHead>
                <TableHead className="text-right">Akce</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRowSkeleton columns={6} />
              ) : evaluations.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6}>
                    <EmptyState icon={ClipboardCheck} title="Zatím žádné hodnocení." description="Hodnocení se zde objeví po prvním záznamu." />
                  </TableCell>
                </TableRow>
              ) : (
                evaluations.map((ev) => (
                  <TableRow key={ev.id}>
                    <TableCell>{ev.work_date}</TableCell>
                    <TableCell>
                      {employeeNames.get(ev.employee_id) || "Neznámý"}
                    </TableCell>
                    <TableCell>{ev.shift}</TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          ev.score >= 80
                            ? "default"
                            : ev.score >= 60
                            ? "secondary"
                            : "destructive"
                        }
                      >
                        {ev.score}
                      </Badge>
                    </TableCell>
                    <TableCell className="max-w-[200px] truncate text-muted-foreground">
                      {ev.note ?? "–"}
                    </TableCell>
                    <TableCell className="space-x-2 text-right">
                      <Button size="sm" variant="ghost" onClick={() => openEdit(ev)}>
                        <Pencil className="h-3.5 w-3.5" /> Upravit
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => del.mutate(ev.id)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
        <div className="space-y-2 p-3 md:hidden">
          {isLoading ? (
            <CardSkeletonList count={4} />
          ) : evaluations.length === 0 ? (
            <EmptyState icon={ClipboardCheck} title="Zatím žádné hodnocení." description="Hodnocení se zde objeví po prvním záznamu." />
          ) : (
            evaluations.map((ev) => (
              <div key={ev.id} className="rounded-[var(--radius-md)] border border-border bg-muted/25 p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0"><p className="truncate font-medium">{employeeNames.get(ev.employee_id) || "Neznámý"}</p><p className="mt-0.5 text-xs text-muted-foreground">{ev.work_date} · {ev.shift}</p></div>
                  <Badge variant={ev.score >= 80 ? "default" : ev.score >= 60 ? "secondary" : "destructive"} className="shrink-0">{ev.score}</Badge>
                </div>
                {ev.note ? <p className="mt-2 truncate text-xs text-muted-foreground">{ev.note}</p> : null}
                <div className="mt-3 flex justify-end gap-1 border-t border-border pt-2">
                  <Button size="sm" variant="ghost" onClick={() => openEdit(ev)}><Pencil className="h-3.5 w-3.5" /> Upravit</Button>
                  <Button size="sm" variant="outline" onClick={() => del.mutate(ev.id)}><Trash2 className="h-3.5 w-3.5" /></Button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </AppShell>
  );
}
