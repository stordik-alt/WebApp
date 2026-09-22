import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, ChevronDown, Pencil, Plus, Save, SlidersHorizontal, X } from "lucide-react";
import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AppShell } from "@/components/AppShell";
import { HaTupLinkageReport } from "@/components/HaTupLinkageReport";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { parseImportedLine } from "@/lib/workplace-line-parser";

export const Route = createFileRoute("/pracoviste")({
  head: () => ({ meta: [
    { title: "Pracoviště – Výkonnost operátorů" },
    { name: "description", content: "Přehled pracovišť podle kódu, linky a názvu." },
  ]}),
  component: WorkplacesPage,
});

type Workplace = { id: string; code: string; line_name: string; workplace_name: string; area: "HA" | "TUP" | "BOTH"; source_line: string | null; records: number; lastDate: string | null; avgOee: number | null; avgAvailability: number | null };
type DetailRecord = { date: string; product: string; hours: number; oee: number | null };
type SortKey = "code" | "line" | "name" | "oee" | "availability" | "records";

function oeeTone(value: number | null) {
  if (value == null) return "text-muted-foreground";
  if (value >= 100) return "text-success";
  if (value >= 80) return "text-warning";
  return "text-destructive";
}
function formatOee(value: number | null) { return value == null ? "–" : `${value.toFixed(1)} %`; }
function shiftHours(_shift: string) { return 8; }

function WorkplacesPage() {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  const [draftCode, setDraftCode] = useState("");
  const [draftLine, setDraftLine] = useState("");
  const [draftArea, setDraftArea] = useState<"HA" | "TUP" | "BOTH">("HA");
  const [saving, setSaving] = useState(false);
  const [workplaceDialogOpen, setWorkplaceDialogOpen] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [period, setPeriod] = useState({ from: "", to: "" });
  const [search, setSearch] = useState("");
  const [areaFilter, setAreaFilter] = useState<"all" | "HA" | "TUP">("all");
  const [lineFilter, setLineFilter] = useState("all");
  const [sortKey, setSortKey] = useState<SortKey>("code");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");
  const [showFilters, setShowFilters] = useState(false);

  const { data: workplaces = [], isLoading, isError } = useQuery({
    queryKey: ["workplaces"],
    queryFn: async (): Promise<Workplace[]> => {
      const { data: masterRows, error: masterError } = await (supabase as any).from("workplaces").select("id,code,line_name,workplace_name,area,source_line,created_at,updated_at").order("code", { ascending: true });
      if (masterError) throw masterError;
      const { data: records, error: recordsError } = await supabase.from("daily_records").select("line,work_date,oee,available_time");
      if (recordsError) throw recordsError;
      const imported = new Map<string, ParsedImport>();
      for (const row of records ?? []) {
        const parsed = parseImportedLine(String(row.line ?? ""));
        if (parsed && !imported.has(parsed.code)) imported.set(parsed.code, parsed);
      }
      const masterByCode = new Map<string, any>((masterRows ?? []).map((row: any) => [String(row.code), row]));
      const missing = [...imported.values()].filter((item) => !masterByCode.has(item.code));
      if (missing.length) {
        const { data: created, error: createError } = await (supabase as any).from("workplaces").insert(missing.map((item) => ({ ...item }))).select("id,code,line_name,workplace_name,area,source_line,created_at,updated_at");
        if (!createError) for (const row of created ?? []) masterByCode.set(String(row.code), row);
      }
      for (const item of imported.values()) if (!masterByCode.has(item.code)) masterByCode.set(item.code, { id: `import-${item.code}`, ...item });
      const stats = new Map<string, { records: number; lastDate: string | null; oeeSum: number; oeeCount: number; availabilitySum: number; availabilityCount: number }>();
      for (const row of records ?? []) {
        const parsed = parseImportedLine(String(row.line ?? ""));
        if (!parsed) continue;
        const current = stats.get(parsed.code) ?? { records: 0, lastDate: null, oeeSum: 0, oeeCount: 0, availabilitySum: 0, availabilityCount: 0 };
        current.records += 1;
        const date = row.work_date ? String(row.work_date) : null;
        if (date && (!current.lastDate || date > current.lastDate)) current.lastDate = date;
        const oee = Number(row.oee);
        if (Number.isFinite(oee)) { current.oeeSum += oee; current.oeeCount += 1; }
        const availability = Number((row as any).available_time);
        if (Number.isFinite(availability)) { current.availabilitySum += availability; current.availabilityCount += 1; }
        stats.set(parsed.code, current);
      }
      return [...masterByCode.values()].map((row: any) => {
        const stat = stats.get(String(row.code));
        return { id: String(row.id), code: String(row.code), line_name: String(row.line_name), workplace_name: String(row.workplace_name), area: row.area as Workplace["area"], source_line: row.source_line ?? null, records: stat?.records ?? 0, lastDate: stat?.lastDate ?? null, avgOee: stat && stat.oeeCount > 0 ? stat.oeeSum / stat.oeeCount : null, avgAvailability: stat && stat.availabilityCount > 0 ? stat.availabilitySum / stat.availabilityCount : null };
      }).sort((a, b) => a.code.localeCompare(b.code, "cs"));
    },
  });

  const lineOptions = useMemo(() => [...new Set(workplaces.map((w) => w.line_name))].sort((a, b) => a.localeCompare(b, "cs")), [workplaces]);
  const filteredWorkplaces = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase("cs-CZ");
    const result = workplaces.filter((w) => {
      if (areaFilter !== "all" && w.area !== areaFilter) return false;
      if (lineFilter !== "all" && w.line_name !== lineFilter) return false;
      if (!needle) return true;
      return [w.code, w.line_name, w.workplace_name, w.area].some((value) => value.toLocaleLowerCase("cs-CZ").includes(needle));
    });
    const compare = (a: Workplace, b: Workplace) => {
      let value = 0;
      if (sortKey === "code") value = a.code.localeCompare(b.code, "cs");
      if (sortKey === "line") value = a.line_name.localeCompare(b.line_name, "cs") || a.code.localeCompare(b.code, "cs");
      if (sortKey === "name") value = a.workplace_name.localeCompare(b.workplace_name, "cs") || a.code.localeCompare(b.code, "cs");
      if (sortKey === "oee") value = (a.avgOee ?? -Infinity) - (b.avgOee ?? -Infinity);
      if (sortKey === "availability") value = (a.avgAvailability ?? -Infinity) - (b.avgAvailability ?? -Infinity);
      if (sortKey === "records") value = a.records - b.records;
      return sortDirection === "asc" ? value : -value;
    };
    return [...result].sort(compare);
  }, [workplaces, search, areaFilter, lineFilter, sortKey, sortDirection]);
  const chartData = useMemo(() => filteredWorkplaces.map((w) => ({ name: w.code, oee: w.avgOee, availability: w.avgAvailability })), [filteredWorkplaces]);

  const detailQuery = useQuery({
    queryKey: ["workplace-detail", expanded, period.from, period.to],
    enabled: Boolean(expanded),
    queryFn: async (): Promise<DetailRecord[]> => {
      const workplace = workplaces.find((w) => w.id === expanded);
      if (!workplace) return [];
      let query = supabase.from("daily_records").select("work_date,line,product,product_id,oee,shift,products:product_id(code)").ilike("line", `${workplace.code} - %`).order("work_date", { ascending: false });
      if (period.from) query = query.gte("work_date", period.from);
      if (period.to) query = query.lte("work_date", period.to);
      const { data, error } = await query;
      if (error) throw error;
      const byDayProduct = new Map<string, DetailRecord>();
      for (const row of data ?? []) {
        const date = String(row.work_date);
        const product = String(row.product ?? (Array.isArray((row as any).products) ? (row as any).products[0]?.code : (row as any).products?.code) ?? "–");
        const productCode = product.trim().toUpperCase();
        if ((workplace.area === "HA" && productCode.startsWith("T_")) || (workplace.area === "TUP" && productCode.startsWith("H_"))) continue;
        const key = `${date}|${product}`;
        const current = byDayProduct.get(key);
        const oee = row.oee == null ? null : Number(row.oee);
        if (!current) byDayProduct.set(key, { date, product, hours: shiftHours(String((row as any).shift ?? "")), oee: Number.isFinite(oee as number) ? oee : null });
        else if (oee != null && Number.isFinite(oee)) current.oee = current.oee == null ? oee : (current.oee + oee) / 2;
      }
      return [...byDayProduct.values()].sort((a, b) => b.date.localeCompare(a.date) || a.product.localeCompare(b.product, "cs"));
    },
  });

  function openCreateDialog() {
    setEditing(null);
    setDraftCode("");
    setDraftLine("");
    setDraftName("");
    setDraftArea("HA");
    setFormError(null);
    setWorkplaceDialogOpen(true);
  }

  function beginEdit(workplace: Workplace) {
    setEditing(workplace.id);
    setDraftCode(workplace.code);
    setDraftLine(workplace.line_name);
    setDraftName(workplace.workplace_name);
    setDraftArea(workplace.area === "TUP" ? "TUP" : workplace.area === "BOTH" ? "BOTH" : "HA");
    setFormError(null);
    setWorkplaceDialogOpen(true);
  }

  async function saveWorkplace() {
    const code = draftCode.trim().toUpperCase();
    const line = draftLine.trim();
    const name = draftName.trim();

    if (!/^(041|050)\.\d{2}$/.test(code)) {
      setFormError("Kód musí mít formát 041.xx pro HA nebo 050.xx pro TUP.");
      return;
    }
    if (draftArea === "HA" && !code.startsWith("041.")) {
      setFormError("Pro oblast HA musí kód začínat 041.");
      return;
    }
    if (draftArea === "TUP" && !code.startsWith("050.")) {
      setFormError("Pro oblast TUP musí kód začínat 050.");
      return;
    }
    if (!line) {
      setFormError("Vyplňte linku.");
      return;
    }
    if (!name) {
      setFormError("Vyplňte název pracoviště.");
      return;
    }

    const sourceLine = `${code} - ${name} ${line}`;
    setSaving(true);
    setFormError(null);
    try {
      if (editing) {
        const workplace = workplaces.find((item) => item.id === editing);
        if (!workplace) throw new Error("Pracoviště nebylo nalezeno.");
        const { error } = await (supabase as any)
          .from("workplaces")
          .update({
            code,
            line_name: line,
            workplace_name: name,
            area: draftArea,
            source_line: sourceLine,
          })
          .eq("id", editing);
        if (error) {
          if (String(error.code) === "23505") throw new Error("Pracoviště s tímto kódem už existuje.");
          throw error;
        }
      } else {
        const { error } = await (supabase as any)
          .from("workplaces")
          .insert({
            code,
            line_name: line,
            workplace_name: name,
            area: draftArea,
            source_line: sourceLine,
          });
        if (error) {
          if (String(error.code) === "23505") throw new Error("Pracoviště s tímto kódem už existuje.");
          throw error;
        }
      }

      setWorkplaceDialogOpen(false);
      setEditing(null);
      await queryClient.invalidateQueries({ queryKey: ["workplaces"] });
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Pracoviště se nepodařilo uložit.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <AppShell title="Pracoviště" subtitle="Přehled pracovišť podle kódu, linky a názvu.">
      <div className="grid min-w-0 gap-4 sm:gap-6">
        <Card className="overflow-hidden p-0">
          <div className="flex items-center gap-2 px-3 py-2 sm:px-4">
            <button type="button" className="flex min-w-0 flex-1 items-center gap-2 text-left" onClick={() => setShowFilters((value) => !value)} aria-expanded={showFilters}>
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary"><SlidersHorizontal className="h-4 w-4" /></span>
              <span className="font-semibold">Filtry a řazení</span>
              <ChevronDown className={`ml-auto h-4 w-4 shrink-0 transition-transform ${showFilters ? "rotate-180" : ""}`} />
            </button>
            <span className="shrink-0 text-xs text-muted-foreground">{filteredWorkplaces.length}/{workplaces.length}</span>
          </div>
          {showFilters ? (
            <div className="border-t border-border px-3 py-2 sm:px-4">
              <div className="grid grid-cols-2 gap-2 lg:grid-cols-5">
                <Input className="col-span-2 h-9 lg:col-span-1" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Hledat…" aria-label="Hledat" />
                <select className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm" value={areaFilter} onChange={(e) => setAreaFilter(e.target.value as "all" | "HA" | "TUP")} aria-label="Oblast"><option value="all">Oblast: Vše</option><option value="HA">Oblast: HA</option><option value="TUP">Oblast: TUP</option></select>
                <select className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm" value={lineFilter} onChange={(e) => setLineFilter(e.target.value)} aria-label="Linka"><option value="all">Linka: všechny</option>{lineOptions.map((line) => <option key={line} value={line}>{line}</option>)}</select>
                <select className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm" value={sortKey} onChange={(e) => setSortKey(e.target.value as SortKey)} aria-label="Řadit podle"><option value="code">Řadit: kód</option><option value="line">Řadit: linka</option><option value="name">Řadit: název</option><option value="oee">Řadit: OEE</option><option value="availability">Řadit: dostupnost</option><option value="records">Řadit: záznamy</option></select>
                <div className="flex gap-2"><Button variant="outline" className="h-9 flex-1 px-2" onClick={() => setSortDirection((d) => d === "asc" ? "desc" : "asc")}>{sortDirection === "asc" ? "↑" : "↓"}</Button><Button variant="ghost" className="h-9 px-3" onClick={() => { setSearch(""); setAreaFilter("all"); setLineFilter("all"); setSortKey("code"); setSortDirection("asc"); }}>Reset</Button></div>
              </div>
            </div>
          ) : null}
        </Card>

        <Card className="overflow-hidden p-0">
          <div className="border-b border-border px-4 py-4 sm:px-5">
            <div className="flex items-center justify-between gap-3"><div className="flex items-center gap-3"><span className="grid h-10 w-10 place-items-center rounded-[var(--radius-md)] bg-primary/10 text-primary"><Building2 className="h-5 w-5" /></span><div><h2 className="text-lg font-semibold">Porovnání pracovišť</h2><p className="text-xs text-muted-foreground">OEE a dostupnost podle aktuálně filtrovaných pracovišť.</p></div></div><div className="text-xs text-muted-foreground">{filteredWorkplaces.length} / {workplaces.length}</div></div>
          </div>
          {isLoading ? <div className="p-5 text-sm text-muted-foreground">Načítám pracoviště…</div> : isError ? <div className="p-5 text-sm text-primary">Nepodařilo se načíst data pracovišť.</div> : filteredWorkplaces.length === 0 ? <div className="p-5 text-sm text-muted-foreground">Filtru neodpovídá žádné pracoviště.</div> : <div className="h-[320px] w-full p-3 sm:h-[360px] sm:p-5"><ResponsiveContainer width="100%" height="100%"><BarChart data={chartData} margin={{ top: 8, right: 12, left: 0, bottom: 28 }}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="name" angle={-35} textAnchor="end" height={65} interval={0} fontSize={11} stroke="hsl(var(--muted-foreground))" /><YAxis domain={[0, "auto"]} tickFormatter={(value) => `${value}%`} fontSize={11} stroke="hsl(var(--muted-foreground))" width={40} /><Tooltip formatter={(value: unknown) => { const n = typeof value === "number" ? value : Number(value); return Number.isFinite(n) ? `${n.toFixed(1)} %` : "–"; }} /><Legend /><Bar dataKey="oee" name="OEE" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} /><Bar dataKey="availability" name="Dostupnost" fill="hsl(var(--chart-2))" radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer></div>}
        </Card>

        <Card className="overflow-hidden p-0">
          <div className="border-b border-border px-4 py-4 sm:px-5"><div className="flex items-center justify-between gap-3"><div className="flex min-w-0 items-center gap-3"><span className="grid h-10 w-10 shrink-0 place-items-center rounded-[var(--radius-md)] bg-primary/10 text-primary"><Building2 className="h-5 w-5" /></span><div className="min-w-0"><h2 className="text-lg font-semibold">Seznam pracovišť</h2><p className="text-xs text-muted-foreground">{filteredWorkplaces.length} z {workplaces.length} pracovišť · kliknutím zobrazíte záznamy</p></div></div><Button onClick={openCreateDialog} className="shrink-0"><Plus className="mr-2 h-4 w-4" />Přidat pracoviště</Button></div></div>
          {isLoading ? <div className="p-5 text-sm text-muted-foreground">Načítám pracoviště…</div> : isError ? <div className="p-5 text-sm text-primary">Nepodařilo se načíst data pracovišť.</div> : filteredWorkplaces.length === 0 ? <div className="p-5 text-sm text-muted-foreground">Zatím nebylo importováno žádné pracoviště.</div> : (
            <>
            <div className="hidden overflow-x-auto md:block"><div className="min-w-[720px]">
              <div className="grid grid-cols-[140px_120px_minmax(220px,1fr)_130px_100px] gap-3 border-b border-border bg-muted/30 px-4 py-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground sm:px-5"><span>Kód pracoviště</span><span>Linka</span><span>Název pracoviště</span><span>Průměrné OEE</span><span>Akce</span></div>
              <div className="divide-y divide-border">{filteredWorkplaces.map((workplace) => (
                <div key={workplace.id}>
                  <div className="grid grid-cols-[140px_120px_minmax(220px,1fr)_130px_100px] items-center gap-3 px-4 py-3 sm:px-5">
                    <button type="button" className="flex min-w-0 items-center gap-2 text-left font-mono font-semibold" onClick={() => setExpanded(expanded === workplace.id ? null : workplace.id)}>
                      <ChevronDown className={`h-4 w-4 shrink-0 transition-transform ${expanded === workplace.id ? "rotate-180" : ""}`} />{workplace.code}
                    </button>
                    <button type="button" className="min-w-0 truncate text-left font-medium" onClick={() => setExpanded(expanded === workplace.id ? null : workplace.id)}>{workplace.line_name}</button>
                    <button type="button" className="min-w-0 truncate text-left font-medium" onClick={() => setExpanded(expanded === workplace.id ? null : workplace.id)}>{workplace.workplace_name}</button>
                    <button type="button" className={`text-left font-semibold tabular-nums ${oeeTone(workplace.avgOee)}`} onClick={() => setExpanded(expanded === workplace.id ? null : workplace.id)}>{formatOee(workplace.avgOee)}</button>
                    <Button variant="outline" size="sm" onClick={() => beginEdit(workplace)}><Pencil className="mr-1.5 h-4 w-4" />Upravit</Button>
                  </div>
                  {expanded === workplace.id && <div className="border-t border-border bg-muted/10 px-4 py-4 sm:px-6">
                    <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"><div className="min-w-0"><div className="font-semibold">Záznamy pracoviště</div><div className="text-xs text-muted-foreground">{workplace.code} · {workplace.workplace_name}</div></div><div className="grid grid-cols-1 gap-2 sm:flex sm:flex-wrap sm:items-end"><Button variant="outline" onClick={(event) => { event.stopPropagation(); beginEdit(workplace); }}><Pencil className="mr-2 h-4 w-4" />Upravit</Button><div className="min-w-0"><Label className="text-xs">Od</Label><Input type="date" value={period.from} onChange={(e) => setPeriod((p) => ({ ...p, from: e.target.value }))} className="w-full sm:w-auto" /></div><div className="min-w-0"><Label className="text-xs">Do</Label><Input type="date" value={period.to} onChange={(e) => setPeriod((p) => ({ ...p, to: e.target.value }))} className="w-full sm:w-auto" /></div><Button variant="outline" onClick={() => setPeriod({ from: "", to: "" })}>Celé období</Button></div></div>
                    {detailQuery.isLoading ? <div className="py-4 text-sm text-muted-foreground">Načítám záznamy…</div> : detailQuery.data?.length ? <div className="overflow-x-auto"><div className="min-w-[620px]"><div className="grid grid-cols-[130px_minmax(0,1fr)_100px_120px] gap-3 border-b border-border px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground"><span>Datum</span><span>Vyráběný produkt</span><span>Počet hodin</span><span>OEE</span></div><div className="divide-y divide-border">{detailQuery.data.map((record) => <div key={`${record.date}-${record.product}`} className="grid grid-cols-[130px_minmax(0,1fr)_100px_120px] gap-3 px-3 py-3 text-sm"><span>{record.date}</span><span className="truncate font-medium">{record.product}</span><span>{record.hours} h</span><span className={`font-semibold ${oeeTone(record.oee)}`}>{formatOee(record.oee)}</span></div>)}</div></div></div> : <div className="py-4 text-sm text-muted-foreground">Pro zvolené období nejsou žádné záznamy.</div>}
                  </div>}
                </div>
              ))}</div>
            </div></div>
            <div className="divide-y divide-border md:hidden">{filteredWorkplaces.map((workplace) => (
                <div key={workplace.id}>
                  <div className="flex items-center gap-2 px-3 py-3">
                    <button type="button" className="flex min-w-0 flex-1 items-center gap-3 text-left" onClick={() => setExpanded(expanded === workplace.id ? null : workplace.id)}>
                      <ChevronDown className={`h-4 w-4 shrink-0 transition-transform ${expanded === workplace.id ? "rotate-180" : ""}`} />
                      <div className="min-w-0 flex-1"><div className="flex items-center gap-2"><span className="font-mono text-xs font-semibold">{workplace.code}</span><span className="truncate text-xs text-muted-foreground">{workplace.line_name}</span></div><p className="truncate text-sm font-medium">{workplace.workplace_name}</p></div>
                      <span className={`shrink-0 font-semibold tabular-nums ${oeeTone(workplace.avgOee)}`}>{formatOee(workplace.avgOee)}</span>
                    </button>
                    <Button variant="outline" size="sm" className="shrink-0" onClick={() => beginEdit(workplace)} aria-label={`Upravit pracoviště ${workplace.code}`}><Pencil className="h-4 w-4" /><span className="sr-only">Upravit</span></Button>
                  </div>
                  {expanded === workplace.id && <div className="border-t border-border bg-muted/10 px-4 py-4">
                    <div className="mb-3 space-y-2"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><div className="font-semibold">Záznamy pracoviště</div><div className="text-xs text-muted-foreground">{workplace.code} · {workplace.workplace_name}</div></div><Button variant="outline" size="sm" onClick={(event) => { event.stopPropagation(); beginEdit(workplace); }}><Pencil className="mr-2 h-4 w-4" />Upravit</Button></div><div className="grid grid-cols-1 gap-2 sm:flex sm:flex-wrap sm:items-end"><div className="min-w-0"><Label className="text-xs">Od</Label><Input type="date" value={period.from} onChange={(e) => setPeriod((p) => ({ ...p, from: e.target.value }))} className="w-full sm:w-auto" /></div><div className="min-w-0"><Label className="text-xs">Do</Label><Input type="date" value={period.to} onChange={(e) => setPeriod((p) => ({ ...p, to: e.target.value }))} className="w-full sm:w-auto" /></div><Button variant="outline" onClick={() => setPeriod({ from: "", to: "" })}>Celé období</Button></div></div>
                    {detailQuery.isLoading ? <div className="py-4 text-sm text-muted-foreground">Načítám záznamy…</div> : detailQuery.data?.length ? <div className="space-y-2">{detailQuery.data.map((record) => <div key={`${record.date}-${record.product}`} className="rounded-lg border border-border bg-muted/25 p-2.5 text-sm"><div className="flex items-center justify-between gap-2"><span className="text-xs text-muted-foreground">{record.date}</span><span className={`font-semibold ${oeeTone(record.oee)}`}>{formatOee(record.oee)}</span></div><p className="mt-1 truncate font-medium">{record.product}</p><p className="mt-0.5 text-xs text-muted-foreground">{record.hours} h</p></div>)}</div> : <div className="py-4 text-sm text-muted-foreground">Pro zvolené období nejsou žádné záznamy.</div>}
                  </div>}
                </div>
              ))}</div>
            </>
          )}
        </Card>

        <Card className="p-4 sm:p-5"><div className="flex items-start gap-3"><span className="grid h-10 w-10 shrink-0 place-items-center rounded-[var(--radius-md)] bg-primary/10 text-primary"><Building2 className="h-5 w-5" /></span><div><h2 className="text-lg font-semibold">Pravidlo pracovišť</h2><p className="mt-1 text-sm text-muted-foreground">Kód 041.xx = HA, kód 050.xx = TUP. Linka a název se přebírají z denního záznamu. Olovo je vedeno jako samostatná linka.</p></div></div></Card>

        <HaTupLinkageReport />
      </div>

      <Dialog open={workplaceDialogOpen} onOpenChange={(open) => { if (!saving) { setWorkplaceDialogOpen(open); if (!open) setFormError(null); } }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? "Upravit pracoviště" : "Vytvořit pracoviště"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-2">
              <Label htmlFor="workplace-code">Kód pracoviště</Label>
              <Input
                id="workplace-code"
                value={draftCode}
                onChange={(event) => setDraftCode(event.target.value)}
                placeholder="041.01"
                
                className="font-mono"
              />
              <p className="text-xs text-muted-foreground">HA: 041.xx · TUP: 050.xx</p>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="workplace-line">Linka</Label>
              <Input id="workplace-line" value={draftLine} onChange={(event) => setDraftLine(event.target.value)} placeholder="L1/1" />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="workplace-name">Název pracoviště</Label>
              <Input id="workplace-name" value={draftName} onChange={(event) => setDraftName(event.target.value)} placeholder="HandAssy OPF" />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="workplace-area">Oblast</Label>
              <select id="workplace-area" className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={draftArea} onChange={(event) => setDraftArea(event.target.value as "HA" | "TUP" | "BOTH")}>
                <option value="HA">HA</option>
                <option value="TUP">TUP</option>
                <option value="BOTH">HA + TUP</option>
              </select>
            </div>
            {formError ? <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{formError}</div> : null}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setWorkplaceDialogOpen(false)} disabled={saving}><X className="mr-2 h-4 w-4" />Zrušit</Button>
            <Button onClick={saveWorkplace} disabled={saving}>{saving ? "Ukládám…" : <><Save className="mr-2 h-4 w-4" />Uložit</>}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
