import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useEmployees, useEmployeePerformanceSummaries } from "@/lib/data";
import type { Employee } from "@/lib/metrics";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Pencil } from "lucide-react";

export const Route = createFileRoute("/zamestnanci")({
  head: () => ({
    meta: [
      { title: "Zaměstnanci – Výkonnost operátorů" },
      { name: "description", content: "Evidence pracovníků výroby DPS, kvalifikace HA a TUP, aktivní a neaktivní zaměstnanci." },
      { property: "og:title", content: "Zaměstnanci – Výkonnost operátorů" },
      { property: "og:description", content: "Evidence pracovníků výroby DPS včetně kvalifikací HA a TUP." },
    ],
  }),
  component: EmployeesPage,
});

type FormState = {
  full_name: string;
  personal_no: string;
  qual_ha: boolean;
  qual_tup: boolean;
  active: boolean;
  is_temporary: boolean;
  position_type: "standard" | "handler" | "vlnař";
  note: string;
};

const EMPTY: FormState = {
  full_name: "",
  personal_no: "",
  qual_ha: false,
  qual_tup: false,
  active: true,
  is_temporary: false,
  position_type: "standard",
  note: "",
};

function formatMetric(value: number | null, suffix = "%") {
  return value === null ? "–" : `${value.toLocaleString("cs-CZ", { maximumFractionDigits: 1 })}${suffix}`;
}

function scaleColor(value: number | null, min: number, max: number) {
  if (value === null) return undefined;
  const ratio = max === min ? 1 : Math.max(0, Math.min(1, (value - min) / (max - min)));
  const hue = ratio * 120;
  return {
    backgroundColor: `hsl(${hue} 72% 88%)`,
    color: `hsl(${hue} 55% 25%)`,
  };
}

function oeeColor(value: number | null) {
  if (value === null) return undefined;
  const ratio = Math.max(0, Math.min(1, (value - 80) / 20));
  return scaleColor(ratio, 0, 1);
}

function helpColor(value: number | null) {
  if (value === null) return undefined;
  if (value === 0) return { backgroundColor: "hsl(210 75% 88%)", color: "hsl(210 55% 28%)" };
  const ratio = Math.max(0, Math.min(1, Math.abs(value) / 100));
  const hue = value > 0 ? 120 : 0;
  return {
    backgroundColor: `hsl(${hue} ${55 + ratio * 17}% ${92 - ratio * 14}%)`,
    color: `hsl(${hue} 55% 25%)`,
  };
}

function MetricCell({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return <TableCell><span className="inline-flex min-w-[72px] justify-center rounded-md px-2 py-1 font-medium" style={style}>{children}</span></TableCell>;
}

function EmployeesPage() {
  const { data: employees = [], isLoading } = useEmployees();
  const { data: performance = [], isLoading: performanceLoading } = useEmployeePerformanceSummaries();
  const [showInactive, setShowInactive] = useState(true);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Employee | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY);
  const qc = useQueryClient();
  const performanceMap = new Map(performance.map((p) => [p.employee_id, p]));
  const qualityValues = performance.map((p) => p.avg_quality).filter((v): v is number => v !== null);
  const qualityMin = qualityValues.length ? Math.min(...qualityValues) : 0;
  const qualityMax = qualityValues.length ? Math.max(...qualityValues) : 0;

  const save = useMutation({
    mutationFn: async () => {
      const payload = {
        full_name: form.full_name.trim(),
        personal_no: form.personal_no.trim() || null,
        qual_ha: form.qual_ha,
        qual_tup: form.qual_tup,
        active: form.active,
        is_temporary: form.is_temporary,
        position_type: form.position_type,
        note: form.note.trim() || null,
      };
      if (editing) {
        const { error } = await supabase.from("employees").update(payload).eq("id", editing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("employees").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["employees"] });
      setOpen(false);
      toast.success(editing ? "Zaměstnanec upraven" : "Zaměstnanec přidán");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const toggleActive = useMutation({
    mutationFn: async (emp: Employee) => {
      const { error } = await supabase.from("employees").update({ active: !emp.active }).eq("id", emp.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["employees"] });
      toast.success("Stav změněn. Historická data zůstávají zachována.");
    },
  });

  const rows = employees.filter((e) => showInactive || e.active);

  function openNew() {
    setEditing(null);
    setForm(EMPTY);
    setOpen(true);
  }

  function openEdit(emp: Employee) {
    setEditing(emp);
    setForm({
      full_name: emp.full_name,
      personal_no: emp.personal_no ?? "",
      qual_ha: emp.qual_ha,
      qual_tup: emp.qual_tup,
      active: emp.active,
      is_temporary: emp.is_temporary,
      position_type: emp.position_type,
      note: emp.note ?? "",
    });
    setOpen(true);
  }

  return (
    <AppShell
      title="Zaměstnanci"
      subtitle="Pozice (HA/TUP) se zadává u denního záznamu, není pevnou vlastností zaměstnance."
      actions={
        <>
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            <Switch checked={showInactive} onCheckedChange={setShowInactive} />
            Zobrazit neaktivní
          </label>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button onClick={openNew}><Plus className="h-4 w-4" /> Přidat zaměstnance</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>{editing ? "Upravit zaměstnance" : "Nový zaměstnanec"}</DialogTitle></DialogHeader>
              <div className="grid gap-4">
                <div className="grid gap-2"><Label htmlFor="name">Jméno a příjmení</Label><Input id="name" value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} autoFocus /></div>
                <div className="grid gap-2"><Label htmlFor="pno">Osobní číslo</Label><Input id="pno" value={form.personal_no} onChange={(e) => setForm({ ...form, personal_no: e.target.value })} /></div>
                <div className="grid gap-2">
                  <Label>Kvalifikace</Label>
                  <div className="flex gap-6">
                    <label className="flex items-center gap-2 text-sm"><Checkbox checked={form.qual_ha} onCheckedChange={(v) => setForm({ ...form, qual_ha: v === true })} />HA</label>
                    <label className="flex items-center gap-2 text-sm"><Checkbox checked={form.qual_tup} onCheckedChange={(v) => setForm({ ...form, qual_tup: v === true })} />TUP</label>
                  </div>
                  <div className="flex items-center gap-2"><Checkbox checked={form.is_temporary} onCheckedChange={(v) => setForm({ ...form, is_temporary: v === true })} />Dočasný (bez profilu, výkon není v reportech)</div>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="positionType">Typ pozice</Label>
                  <select id="positionType" className="flex h-11 w-full rounded-md border border-border bg-background px-3 py-2 text-sm" value={form.position_type} onChange={(e) => setForm({ ...form, position_type: e.target.value as "standard" | "handler" | "vlnař" })}>
                    <option value="standard">Standardní (HA/TUP s OEE/normami)</option>
                    <option value="handler">Handler (hodnocení práce)</option>
                    <option value="vlnař">Vlnař (hodnocení práce)</option>
                  </select>
                  <p className="text-[10px] text-muted-foreground">Handler a vlnař: denní/týdenní záznamy bez OEE/norem.</p>
                </div>
                <div className="grid gap-2"><Label htmlFor="note">Poznámka</Label><Input id="note" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} /></div>
                <label className="flex items-center gap-2 text-sm"><Switch checked={form.active} onCheckedChange={(v) => setForm({ ...form, active: v })} />Aktivní</label>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setOpen(false)}>Zrušit</Button>
                <Button onClick={() => save.mutate()} disabled={!form.full_name.trim() || save.isPending}>Uložit</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </>
      }
    >
      <div className="rounded-lg border border-border bg-card shadow-[var(--shadow-card)] overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Jméno</TableHead>
              <TableHead>Osobní číslo</TableHead>
              <TableHead>Kvalifikace</TableHead>
              <TableHead>Průměrné OEE</TableHead>
              <TableHead>Quality skóre</TableHead>
              <TableHead>Body za výpomoc</TableHead>
              <TableHead>Stav</TableHead>
              <TableHead>Typ</TableHead>
              <TableHead>Poznámka</TableHead>
              <TableHead className="text-right">Akce</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading || performanceLoading ? (
              <TableRow><TableCell colSpan={10} className="text-muted-foreground">Načítání…</TableCell></TableRow>
            ) : rows.length === 0 ? (
              <TableRow><TableCell colSpan={10} className="text-muted-foreground">Zatím žádní zaměstnanci.</TableCell></TableRow>
            ) : rows.map((emp) => {
              const stats = performanceMap.get(emp.id);
              return (
                <TableRow key={emp.id} className={emp.active ? "" : "opacity-60"}>
                  <TableCell className="font-medium"><Link to="/zamestnanec/$id" params={{ id: emp.id }} className="hover:underline">{emp.full_name}</Link>{emp.is_demo ? <Badge variant="outline" className="ml-2 text-[10px]">DEMO</Badge> : null}</TableCell>
                  <TableCell>{emp.personal_no ?? "–"}</TableCell>
                  <TableCell className="space-x-1">{emp.qual_ha ? <Badge variant="secondary">HA</Badge> : null}{emp.qual_tup ? <Badge variant="secondary">TUP</Badge> : null}{!emp.qual_ha && !emp.qual_tup ? "–" : null}</TableCell>
                  <MetricCell style={oeeColor(stats?.avg_oee ?? null)}>{formatMetric(stats?.avg_oee ?? null)}</MetricCell>
                  <MetricCell style={scaleColor(stats?.avg_quality ?? null, qualityMin, qualityMax)}>{formatMetric(stats?.avg_quality ?? null)}</MetricCell>
                  <MetricCell style={helpColor(stats?.help_points ?? null)}>{stats ? stats.help_points.toLocaleString("cs-CZ", { maximumFractionDigits: 1 }) : "–"}</MetricCell>
                  <TableCell>{emp.active ? <Badge className="bg-success text-success-foreground">Aktivní</Badge> : <Badge variant="outline">Neaktivní</Badge>}</TableCell>
                  <TableCell>{emp.position_type === "standard" ? <Badge variant="outline" className="text-[10px]">Standard</Badge> : emp.position_type === "handler" ? <Badge className="bg-purple-500 text-white">Handler</Badge> : emp.position_type === "vlnař" ? <Badge className="bg-blue-500 text-white">Vlnař</Badge> : null}</TableCell>
                  <TableCell className="max-w-[240px] truncate text-muted-foreground">{emp.note ?? "–"}</TableCell>
                  <TableCell className="space-x-2 text-right">
                    <Button size="sm" variant="ghost" onClick={() => openEdit(emp)}><Pencil className="h-3.5 w-3.5" /> Upravit</Button>
                    <Button size="sm" variant="outline" onClick={() => toggleActive.mutate(emp)}>{emp.active ? "Deaktivovat" : "Aktivovat"}</Button>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </AppShell>
  );
}
