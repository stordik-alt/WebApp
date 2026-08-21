import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
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
import { Plus, Pencil, ArrowDown, ArrowUp, ArrowUpDown, FilterX } from "lucide-react";

export const Route = createFileRoute("/zamestnanci")({
  head: () => ({ meta: [{ title: "Zaměstnanci – Výkonnost operátorů" }] }),
  component: EmployeesPage,
});

type FormState = { full_name: string; personal_no: string; qual_ha: boolean; qual_tup: boolean; active: boolean; is_temporary: boolean; position_type: "standard" | "handler" | "vlnař"; note: string };
const EMPTY: FormState = { full_name: "", personal_no: "", qual_ha: false, qual_tup: false, active: true, is_temporary: false, position_type: "standard", note: "" };
type SortKey = "full_name" | "personal_no" | "oee" | "quality" | "help" | "status" | "type";
type SortDir = "asc" | "desc";

function formatMetric(value: number | null, suffix = "%") { return value === null ? "–" : `${value.toLocaleString("cs-CZ", { maximumFractionDigits: 1 })}${suffix}`; }
function scaleColor(value: number | null, min: number, max: number) { if (value === null) return undefined; const ratio = max === min ? 1 : Math.max(0, Math.min(1, (value - min) / (max - min))); const hue = ratio * 120; return { backgroundColor: `hsl(${hue} 72% 88%)`, color: `hsl(${hue} 55% 25%)` }; }
function oeeColor(value: number | null) { if (value === null) return undefined; return scaleColor(value, 80, 100); }
function helpColor(value: number | null) { if (value === null) return undefined; if (value === 0) return { backgroundColor: "hsl(210 75% 88%)", color: "hsl(210 55% 28%)" }; const ratio = Math.max(0, Math.min(1, Math.abs(value) / 100)); const hue = value > 0 ? 120 : 0; return { backgroundColor: `hsl(${hue} ${55 + ratio * 17}% ${92 - ratio * 14}%)`, color: `hsl(${hue} 55% 25%)` }; }
function MetricCell({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) { return <TableCell><span className="inline-flex min-w-[72px] justify-center rounded-md px-2 py-1 font-medium" style={style}>{children}</span></TableCell>; }

function EmployeesPage() {
  const { data: employees = [], isLoading } = useEmployees();
  const { data: performance = [], isLoading: performanceLoading } = useEmployeePerformanceSummaries();
  const [showInactive, setShowInactive] = useState(true);
  const [positionFilter, setPositionFilter] = useState<"all" | Employee["position_type"]>("all");
  const [qualificationFilter, setQualificationFilter] = useState<"all" | "HA" | "TUP" | "both" | "none">("all");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive">("all");
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("full_name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Employee | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY);
  const qc = useQueryClient();
  const performanceMap = new Map(performance.map((p) => [p.employee_id, p]));
  const qualityValues = performance.map((p) => p.avg_quality).filter((v): v is number => v !== null);
  const qualityMin = qualityValues.length ? Math.min(...qualityValues) : 0;
  const qualityMax = qualityValues.length ? Math.max(...qualityValues) : 0;

  const save = useMutation({ mutationFn: async () => { const payload = { full_name: form.full_name.trim(), personal_no: form.personal_no.trim() || null, qual_ha: form.qual_ha, qual_tup: form.qual_tup, active: form.active, is_temporary: form.is_temporary, position_type: form.position_type, note: form.note.trim() || null }; if (editing) { const { error } = await supabase.from("employees").update(payload).eq("id", editing.id); if (error) throw error; } else { const { error } = await supabase.from("employees").insert(payload); if (error) throw error; } }, onSuccess: () => { qc.invalidateQueries({ queryKey: ["employees"] }); setOpen(false); toast.success(editing ? "Zaměstnanec upraven" : "Zaměstnanec přidán"); }, onError: (e: Error) => toast.error(e.message) });
  const toggleActive = useMutation({ mutationFn: async (emp: Employee) => { const { error } = await supabase.from("employees").update({ active: !emp.active }).eq("id", emp.id); if (error) throw error; }, onSuccess: () => { qc.invalidateQueries({ queryKey: ["employees"] }); toast.success("Stav změněn. Historická data zůstávají zachována."); } });

  function openNew() { setEditing(null); setForm(EMPTY); setOpen(true); }
  function openEdit(emp: Employee) { setEditing(emp); setForm({ full_name: emp.full_name, personal_no: emp.personal_no ?? "", qual_ha: emp.qual_ha, qual_tup: emp.qual_tup, active: emp.active, is_temporary: emp.is_temporary, position_type: emp.position_type, note: emp.note ?? "" }); setOpen(true); }
  function toggleSort(key: SortKey) { if (sortKey === key) setSortDir((d) => d === "asc" ? "desc" : "asc"); else { setSortKey(key); setSortDir(key === "full_name" || key === "personal_no" || key === "type" ? "asc" : "desc"); } }
  function clearFilters() { setSearch(""); setPositionFilter("all"); setQualificationFilter("all"); setStatusFilter("all"); setShowInactive(true); }

  const rows = useMemo(() => {
    const filtered = employees.filter((e) => {
      if (!showInactive && !e.active) return false;
      if (statusFilter === "active" && !e.active) return false;
      if (statusFilter === "inactive" && e.active) return false;
      if (positionFilter !== "all" && e.position_type !== positionFilter) return false;
      if (qualificationFilter === "HA" && !e.qual_ha) return false;
      if (qualificationFilter === "TUP" && !e.qual_tup) return false;
      if (qualificationFilter === "both" && !(e.qual_ha && e.qual_tup)) return false;
      if (qualificationFilter === "none" && (e.qual_ha || e.qual_tup)) return false;
      if (search && !`${e.full_name} ${e.personal_no ?? ""}`.toLocaleLowerCase("cs-CZ").includes(search.toLocaleLowerCase("cs-CZ"))) return false;
      return true;
    });
    return [...filtered].sort((a, b) => {
      const sa = performanceMap.get(a.id), sb = performanceMap.get(b.id);
      const av: string | number = sortKey === "full_name" ? a.full_name : sortKey === "personal_no" ? (a.personal_no ?? "") : sortKey === "oee" ? (sa?.avg_oee ?? -Infinity) : sortKey === "quality" ? (sa?.avg_quality ?? -Infinity) : sortKey === "help" ? (sa?.help_points ?? -Infinity) : sortKey === "status" ? (a.active ? 1 : 0) : a.position_type;
      const bv: string | number = sortKey === "full_name" ? b.full_name : sortKey === "personal_no" ? (b.personal_no ?? "") : sortKey === "oee" ? (sb?.avg_oee ?? -Infinity) : sortKey === "quality" ? (sb?.avg_quality ?? -Infinity) : sortKey === "help" ? (sb?.help_points ?? -Infinity) : sortKey === "status" ? (b.active ? 1 : 0) : b.position_type;
      const cmp = typeof av === "number" && typeof bv === "number" ? av - bv : String(av).localeCompare(String(bv), "cs");
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [employees, performanceMap, showInactive, positionFilter, qualificationFilter, statusFilter, search, sortKey, sortDir]);

  const sortButton = (label: string, key: SortKey) => <Button variant="ghost" size="sm" className="h-8 px-1" onClick={() => toggleSort(key)} title={`Seřadit podle ${label}`}>{label}{sortKey === key ? (sortDir === "asc" ? <ArrowUp className="ml-1 h-3 w-3" /> : <ArrowDown className="ml-1 h-3 w-3" />) : <ArrowUpDown className="ml-1 h-3 w-3 opacity-40" />}</Button>;

  return <AppShell title="Zaměstnanci" subtitle="Pozice (HA/TUP) se zadává u denního záznamu, není pevnou vlastností zaměstnance." actions={<><label className="flex items-center gap-2 text-sm text-muted-foreground"><Switch checked={showInactive} onCheckedChange={setShowInactive} />Zobrazit neaktivní</label><Dialog open={open} onOpenChange={setOpen}><DialogTrigger asChild><Button onClick={openNew}><Plus className="h-4 w-4" /> Přidat zaměstnance</Button></DialogTrigger><DialogContent><DialogHeader><DialogTitle>{editing ? "Upravit zaměstnance" : "Nový zaměstnanec"}</DialogTitle></DialogHeader><div className="grid gap-4"><div className="grid gap-2"><Label htmlFor="name">Jméno a příjmení</Label><Input id="name" value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} autoFocus /></div><div className="grid gap-2"><Label htmlFor="pno">Osobní číslo</Label><Input id="pno" value={form.personal_no} onChange={(e) => setForm({ ...form, personal_no: e.target.value })} /></div><div className="grid gap-2"><Label>Kvalifikace</Label><div className="flex gap-6"><label className="flex items-center gap-2 text-sm"><Checkbox checked={form.qual_ha} onCheckedChange={(v) => setForm({ ...form, qual_ha: v === true })} />HA</label><label className="flex items-center gap-2 text-sm"><Checkbox checked={form.qual_tup} onCheckedChange={(v) => setForm({ ...form, qual_tup: v === true })} />TUP</label></div><div className="flex items-center gap-2"><Checkbox checked={form.is_temporary} onCheckedChange={(v) => setForm({ ...form, is_temporary: v === true })} />Dočasný (bez profilu, výkon není v reportech)</div></div><div className="grid gap-2"><Label htmlFor="positionType">Typ pozice</Label><select id="positionType" className="flex h-11 w-full rounded-md border border-border bg-background px-3 py-2 text-sm" value={form.position_type} onChange={(e) => setForm({ ...form, position_type: e.target.value as "standard" | "handler" | "vlnař" })}><option value="standard">Standardní (HA/TUP s OEE/normami)</option><option value="handler">Handler (hodnocení práce)</option><option value="vlnař">Vlnař (hodnocení práce)</option></select></div><div className="grid gap-2"><Label htmlFor="note">Poznámka</Label><Input id="note" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} /></div><label className="flex items-center gap-2 text-sm"><Switch checked={form.active} onCheckedChange={(v) => setForm({ ...form, active: v })} />Aktivní</label></div><DialogFooter><Button variant="outline" onClick={() => setOpen(false)}>Zrušit</Button><Button onClick={() => save.mutate()} disabled={!form.full_name.trim() || save.isPending}>Uložit</Button></DialogFooter></DialogContent></Dialog></>}> 
    <div className="mb-3 rounded-lg border border-border bg-card p-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[220px] flex-1"><Label>Hledat</Label><Input placeholder="Jméno nebo osobní číslo…" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
        <div><Label>Pozice</Label><select className="flex h-10 rounded-md border border-border bg-background px-3 text-sm" value={positionFilter} onChange={(e) => setPositionFilter(e.target.value as typeof positionFilter)}><option value="all">Všechny</option><option value="standard">Standard</option><option value="handler">Handler</option><option value="vlnař">Vlnař</option></select></div>
        <div><Label>Kvalifikace</Label><select className="flex h-10 rounded-md border border-border bg-background px-3 text-sm" value={qualificationFilter} onChange={(e) => setQualificationFilter(e.target.value as typeof qualificationFilter)}><option value="all">Všechny</option><option value="HA">HA</option><option value="TUP">TUP</option><option value="both">HA + TUP</option><option value="none">Bez kvalifikace</option></select></div>
        <div><Label>Stav</Label><select className="flex h-10 rounded-md border border-border bg-background px-3 text-sm" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}><option value="all">Všechny</option><option value="active">Aktivní</option><option value="inactive">Neaktivní</option></select></div>
        <Button variant="outline" onClick={clearFilters}><FilterX className="h-4 w-4" /> Zrušit filtry</Button>
      </div>
      <div className="mt-2 text-xs text-muted-foreground">Zobrazeno {rows.length} z {employees.length} zaměstnanců. Kliknutím na záhlaví sloupce můžete tabulku seřadit.</div>
    </div>
    <div className="rounded-lg border border-border bg-card shadow-[var(--shadow-card)] overflow-x-auto"><Table><TableHeader><TableRow><TableHead>{sortButton("Jméno", "full_name")}</TableHead><TableHead>{sortButton("Osobní číslo", "personal_no")}</TableHead><TableHead>Kvalifikace</TableHead><TableHead>{sortButton("Průměrné OEE", "oee")}</TableHead><TableHead>{sortButton("Quality skóre", "quality")}</TableHead><TableHead>{sortButton("Body za výpomoc", "help")}</TableHead><TableHead>{sortButton("Stav", "status")}</TableHead><TableHead>{sortButton("Typ", "type")}</TableHead><TableHead>Poznámka</TableHead><TableHead className="text-right">Akce</TableHead></TableRow></TableHeader><TableBody>{isLoading || performanceLoading ? <TableRow><TableCell colSpan={10} className="text-muted-foreground">Načítání…</TableCell></TableRow> : rows.length === 0 ? <TableRow><TableCell colSpan={10} className="text-muted-foreground">Žádný zaměstnanec neodpovídá filtru.</TableCell></TableRow> : rows.map((emp) => { const stats = performanceMap.get(emp.id); return <TableRow key={emp.id} className={emp.active ? "" : "opacity-60"}><TableCell className="font-medium"><Link to="/zamestnanec/$id" params={{ id: emp.id }} className="hover:underline">{emp.full_name}</Link>{emp.is_demo ? <Badge variant="outline" className="ml-2 text-[10px]">DEMO</Badge> : null}</TableCell><TableCell>{emp.personal_no ?? "–"}</TableCell><TableCell className="space-x-1">{emp.qual_ha ? <Badge variant="secondary">HA</Badge> : null}{emp.qual_tup ? <Badge variant="secondary">TUP</Badge> : null}{!emp.qual_ha && !emp.qual_tup ? "–" : null}</TableCell><MetricCell style={oeeColor(stats?.avg_oee ?? null)}>{formatMetric(stats?.avg_oee ?? null)}</MetricCell><MetricCell style={scaleColor(stats?.avg_quality ?? null, qualityMin, qualityMax)}>{formatMetric(stats?.avg_quality ?? null)}</MetricCell><MetricCell style={helpColor(stats?.help_points ?? null)}>{stats ? stats.help_points.toLocaleString("cs-CZ", { maximumFractionDigits: 1 }) : "–"}</MetricCell><TableCell>{emp.active ? <Badge className="bg-success text-success-foreground">Aktivní</Badge> : <Badge variant="outline">Neaktivní</Badge>}</TableCell><TableCell>{emp.position_type === "standard" ? <Badge variant="outline" className="text-[10px]">Standard</Badge> : emp.position_type === "handler" ? <Badge className="bg-purple-500 text-white">Handler</Badge> : <Badge className="bg-blue-500 text-white">Vlnař</Badge>}</TableCell><TableCell className="max-w-[240px] truncate text-muted-foreground">{emp.note ?? "–"}</TableCell><TableCell className="space-x-2 text-right"><Button size="sm" variant="ghost" onClick={() => openEdit(emp)}><Pencil className="h-3.5 w-3.5" /> Upravit</Button><Button size="sm" variant="outline" onClick={() => toggleActive.mutate(emp)}>{emp.active ? "Deaktivovat" : "Aktivovat"}</Button></TableCell></TableRow>; })}</TableBody></Table></div>
  </AppShell>;
}
