import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, ChevronDown, Pencil, Save, SlidersHorizontal, X } from "lucide-react";
import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/pracoviste")({
  head: () => ({ meta: [
    { title: "Pracoviště – Výkonnost operátorů" },
    { name: "description", content: "Přehled pracovišť podle kódu, linky a názvu." },
  ]}),
  component: WorkplacesPage,
});

type Workplace = { id: string; code: string; line_name: string; workplace_name: string; area: "HA" | "TUP"; source_line: string | null; records: number; lastDate: string | null; avgOee: number | null; avgAvailability: number | null };
type ParsedImport = { code: string; line_name: string; workplace_name: string; area: "HA" | "TUP"; source_line: string };
type DetailRecord = { date: string; product: string; hours: number; oee: number | null };
type SortKey = "code" | "line" | "name" | "oee" | "availability" | "records";

function parseImportedLine(value: string): ParsedImport | null {
  const source_line = value.trim();
  const match = source_line.match(/^(\d{3}\.\d{2})\s*-\s*(.+)$/i);
  if (!match) return null;
  const code = match[1];
  const remainder = match[2].trim();
  const prefix = code.slice(0, 3);
  if (prefix !== "041" && prefix !== "050") return null;
  const area: "HA" | "TUP" = prefix === "050" ? "TUP" : "HA";
  const lineMatch = remainder.match(/(?:^|\s)(L\d+\/\d+(?:\s+HF)?|Olovo)\s*$/i);
  const line_name = lineMatch ? (/^olovo$/i.test(lineMatch[1]) ? "Olovo" : lineMatch[1].toUpperCase()) : "Neurčeno";
  const workplace_name = lineMatch ? remainder.slice(0, lineMatch.index).trim() : remainder;
  if (!workplace_name) return null;
  return { code, line_name, workplace_name, area, source_line };
}

function oeeTone(value: number | null) {
  if (value == null) return "text-muted-foreground";
  if (value >= 100) return "text-emerald-300";
  if (value >= 80) return "text-amber-300";
  return "text-rose-300";
}
function formatOee(value: number | null) { return value == null ? "–" : `${value.toFixed(1)} %`; }
function shiftHours(_shift: string) { return 8; }

function WorkplacesPage() {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  const [saving, setSaving] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [period, setPeriod] = useState({ from: "", to: "" });
  const [search, setSearch] = useState("");
  const [areaFilter, setAreaFilter] = useState<"all" | "HA" | "TUP">("all");
  const [lineFilter, setLineFilter] = useState("all");
  const [sortKey, setSortKey] = useState<SortKey>("code");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");

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
        if (!createError) {
          for (const row of created ?? []) masterByCode.set(String(row.code), row);
        }
      }
      for (const item of imported.values()) {
        if (!masterByCode.has(item.code)) masterByCode.set(item.code, { id: `import-${item.code}`, ...item });
      }

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
        return {
          id: String(row.id), code: String(row.code), line_name: String(row.line_name),
          workplace_name: String(row.workplace_name), area: row.area as Workplace["area"],
          source_line: row.source_line ?? null, records: stat?.records ?? 0,
          lastDate: stat?.lastDate ?? null,
          avgOee: stat && stat.oeeCount > 0 ? stat.oeeSum / stat.oeeCount : null,
          avgAvailability: stat && stat.availabilityCount > 0 ? stat.availabilitySum / stat.availabilityCount : null,
        };
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
      let query = supabase.from("daily_records").select("work_date,product,oee,shift").eq("line", workplace.source_line ?? "").order("work_date", { ascending: false });
      if (period.from) query = query.gte("work_date", period.from);
      if (period.to) query = query.lte("work_date", period.to);
      const { data, error } = await query;
      if (error) throw error;
      const byDayProduct = new Map<string, DetailRecord>();
      for (const row of data ?? []) {
        const date = String(row.work_date);
        const product = String(row.product ?? "–");
        const key = `${date}|${product}`;
        const current = byDayProduct.get(key);
        const oee = row.oee == null ? null : Number(row.oee);
        if (!current) byDayProduct.set(key, { date, product, hours: shiftHours(String((row as any).shift ?? "")), oee: Number.isFinite(oee as number) ? oee : null });
        else if (oee != null && Number.isFinite(oee)) current.oee = current.oee == null ? oee : (current.oee + oee) / 2;
      }
      return [...byDayProduct.values()].sort((a, b) => b.date.localeCompare(a.date) || a.product.localeCompare(b.product, "cs"));
    },
  });

  function beginEdit(workplace: Workplace) { setEditing(workplace.id); setDraftName(workplace.workplace_name); }
  async function saveEdit(workplace: Workplace) {
    const name = draftName.trim();
    if (!name) return;
    setSaving(true);
    try {
      if (workplace.id.startsWith("import-")) {
        const { data, error } = await (supabase as any).from("workplaces").upsert({ code: workplace.code, line_name: workplace.line_name, workplace_name: name, area: workplace.area, source_line: workplace.source_line }, { onConflict: "code" }).select("id").single();
        if (error) throw error;
        if (data?.id) setEditing(null);
      } else {
        const { error } = await (supabase as any).from("workplaces").update({ workplace_name: name }).eq("id", workplace.id);
        if (error) throw error;
        setEditing(null);
      }
      await queryClient.invalidateQueries({ queryKey: ["workplaces"] });
    } finally {
      setSaving(false);
    }
  }

  return (
    <AppShell title="Pracoviště" subtitle="Přehled pracovišť podle kódu, linky a názvu.">
      <div className="grid min-w-0 gap-6">
        <Card className="p-4 sm:p-5">
          <div className="flex items-center gap-3">
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-primary/10 text-primary"><SlidersHorizontal className="h-5 w-5" /></span>
            <div><h2 className="font-semibold">Filtry a řazení</h2><p className="text-xs text-muted-foreground">Omezte seznam a změňte pořadí podle potřebného ukazatele.</p></div>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <div><Label className="text-xs">Hledat</Label><Input className="mt-1" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Kód, linka nebo název…" /></div>
            <div><Label className="text-xs">Oblast</Label><select className="mt-1 flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={areaFilter} onChange={(e) => setAreaFilter(e.target.value as "all" | "HA" | "TUP")}><option value="all">Vše</option><option value="HA">HA</option><option value="TUP">TUP</option></select></div>
            <div><Label className="text-xs">Linka</Label><select className="mt-1 flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={lineFilter} onChange={(e) => setLineFilter(e.target.value)}><option value="all">Všechny linky</option>{lineOptions.map((line) => <option key={line} value={line}>{line}</option>)}</select></div>
            <div><Label className="text-xs">Řadit podle</Label><select className="mt-1 flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={sortKey} onChange={(e) => setSortKey(e.target.value as SortKey)}><option value="code">Kód pracoviště</option><option value="line">Linka</option><option value="name">Název pracoviště</option><option value="oee">OEE</option><option value="availability">Dostupnost</option><option value="records">Počet záznamů</option></select></div>
            <div className="flex items-end gap-2"><Button variant="outline" className="w-full" onClick={() => setSortDirection((d) => d === "asc" ? "desc" : "asc")}>{sortDirection === "asc" ? "Vzestupně ↑" : "Sestupně ↓"}</Button><Button variant="ghost" onClick={() => { setSearch(""); setAreaFilter("all"); setLineFilter("all"); setSortKey("code"); setSortDirection("asc"); }}>Reset</Button></div>
          </div>
        </Card>

        <Card className="overflow-hidden p-0">
          <div className="border-b border-border px-4 py-4 sm:px-5">
            <div className="flex items-center justify-between gap-3"><div className="flex items-center gap-3"><span className="grid h-10 w-10 place-items-center rounded-xl bg-primary/10 text-primary"><Building2 className="h-5 w-5" /></span><div><h2 className="font-semibold">Porovnání pracovišť</h2><p className="text-xs text-muted-foreground">OEE a dostupnost podle aktuálně filtrovaných pracovišť.</p></div></div><div className="text-xs text-muted-foreground">{filteredWorkplaces.length} / {workplaces.length}</div></div>
          </div>
          {isLoading ? <div className="p-5 text-sm text-muted-foreground">Načítám pracoviště…</div> : isError ? <div className="p-5 text-sm text-rose-300">Nepodařilo se načíst data pracovišť.</div> : filteredWorkplaces.length === 0 ? <div className="p-5 text-sm text-muted-foreground">Filtru neodpovídá žádné pracoviště.</div> : <div className="h-[320px] w-full p-3 sm:h-[360px] sm:p-5"><ResponsiveContainer width="100%" height="100%"><BarChart data={chartData} margin={{ top: 8, right: 12, left: 0, bottom: 28 }}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="name" angle={-35} textAnchor="end" height={65} interval={0} /><YAxis domain={[0, "auto"]} tickFormatter={(value) => `${value}%`} /><Tooltip formatter={(value: number | undefined) => value == null ? "–" : `${value.toFixed(1)} %`} /><Legend /><Bar dataKey="oee" name="OEE" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} /><Bar dataKey="availability" name="Dostupnost" fill="hsl(var(--chart-2))" radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer></div>}
        </Card>

        <Card className="overflow-hidden p-0">
          <div className="border-b border-border px-4 py-4 sm:px-5"><div className="flex items-center gap-3"><span className="grid h-10 w-10 place-items-center rounded-xl bg-primary/10 text-primary"><Building2 className="h-5 w-5" /></span><div><h2 className="font-semibold">Seznam pracovišť</h2><p className="text-xs text-muted-foreground">{filteredWorkplaces.length} z {workplaces.length} pracovišť · kliknutím zobrazíte záznamy</p></div></div></div>
          {isLoading ? <div className="p-5 text-sm text-muted-foreground">Načítám pracoviště…</div> : isError ? <div className="p-5 text-sm text-rose-300">Nepodařilo se načíst data pracovišť.</div> : filteredWorkplaces.length === 0 ? <div className="p-5 text-sm text-muted-foreground">Zatím nebylo importováno žádné pracoviště.</div> : (
            <div className="overflow-x-auto">
              <div className="min-w-[720px]">
                <div className="grid grid-cols-[140px_120px_minmax(220px,1fr)_130px_54px] gap-3 border-b border-border bg-muted/30 px-4 py-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground sm:px-5">
                  <span>Kód pracoviště</span><span>Linka</span><span>Název pracoviště</span><span>Průměrné OEE</span><span></span>
                </div>
                <div className="divide-y divide-border">
                  {filteredWorkplaces.map((workplace) => (
                    <div key={workplace.id}>
                      <button type="button" className="grid w-full grid-cols-[140px_120px_minmax(220px,1fr)_130px_54px] items-center gap-3 px-4 py-4 text-left transition-colors hover:bg-muted/20 sm:px-5" onClick={() => setExpanded(expanded === workplace.id ? null : workplace.id)}>
                        <span className="flex items-center gap-2 font-mono font-semibold"><ChevronDown className={`h-4 w-4 shrink-0 transition-transform ${expanded === workplace.id ? "rotate-180" : ""}`} />{workplace.code}</span>
                        <span className="font-medium">{workplace.line_name}</span>
                        <span className="min-w-0 truncate font-medium">{workplace.workplace_name}</span>
                        <span className={`font-semibold tabular-nums ${oeeTone(workplace.avgOee)}`}>{formatOee(workplace.avgOee)}</span>
                        <span aria-hidden="true" />
                      </button>

                      {expanded === workplace.id && (
                        <div className="border-t border-border bg-muted/10 px-4 py-4 sm:px-6">
                          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                            <div><div className="font-semibold">Záznamy pracoviště</div><div className="text-xs text-muted-foreground">{workplace.code} · {workplace.workplace_name}</div></div>
                            <div className="flex flex-wrap items-end gap-2"><div><Label className="text-xs">Od</Label><Input type="date" value={period.from} onChange={(e) => setPeriod((p) => ({ ...p, from: e.target.value }))} /></div><div><Label className="text-xs">Do</Label><Input type="date" value={period.to} onChange={(e) => setPeriod((p) => ({ ...p, to: e.target.value }))} /></div><Button variant="outline" onClick={() => setPeriod({ from: "", to: "" })}>Celé období</Button></div>
                          </div>
                          {detailQuery.isLoading ? <div className="py-4 text-sm text-muted-foreground">Načítám záznamy…</div> : detailQuery.data?.length ? <div className="overflow-x-auto"><div className="min-w-[620px]"><div className="grid grid-cols-[130px_minmax(0,1fr)_100px_120px] gap-3 border-b border-border px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground"><span>Datum</span><span>Vyráběný produkt</span><span>Počet hodin</span><span>OEE</span></div><div className="divide-y divide-border">{detailQuery.data.map((record) => <div key={`${record.date}-${record.product}`} className="grid grid-cols-[130px_minmax(0,1fr)_100px_120px] gap-3 px-3 py-3 text-sm"><span>{record.date}</span><span className="truncate font-medium">{record.product}</span><span>{record.hours} h</span><span className={`font-semibold ${oeeTone(record.oee)}`}>{formatOee(record.oee)}</span></div>)}</div></div></div> : <div className="py-4 text-sm text-muted-foreground">Pro zvolené období nejsou žádné záznamy.</div>}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </Card>

        <Card className="p-4 sm:p-5"><div className="flex items-start gap-3"><span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary"><Building2 className="h-5 w-5" /></span><div><h2 className="font-semibold">Pravidlo pracovišť</h2><p className="mt-1 text-sm text-muted-foreground">Kód 041.xx = HA, kód 050.xx = TUP. Linka a název se přebírají z denního záznamu. Olovo je vedeno jako samostatná linka.</p></div></div></Card>
      </div>
    </AppShell>
  );
}
