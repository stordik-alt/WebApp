import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, Factory, Pencil, Save, Users, X } from "lucide-react";
import { useMemo, useState } from "react";
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

type Workplace = {
  id: string;
  code: string;
  line_name: string;
  workplace_name: string;
  area: "HA" | "TUP";
  source_line: string | null;
  records: number;
  lastDate: string | null;
  avgOee: number | null;
};

type ParsedImport = { code: string; line_name: string; workplace_name: string; area: "HA" | "TUP"; source_line: string };

function parseImportedLine(value: string): ParsedImport | null {
  const source_line = value.trim();
  const match = source_line.match(/^(\d{3}\.\d{2})\s*-\s*(.*?)\s+(L\d+\/\d+|Olovo)\s*$/i);
  if (!match) return null;
  const code = match[1];
  const workplace_name = match[2].trim();
  const line_name = /^olovo$/i.test(match[3]) ? "Olovo" : match[3].toUpperCase();
  const prefix = code.slice(0, 3);
  const area: "HA" | "TUP" = prefix === "050" ? "TUP" : "HA";
  if (prefix !== "041" && prefix !== "050") return null;
  if (!workplace_name) return null;
  return { code, line_name, workplace_name, area, source_line };
}

function oeeTone(value: number | null) {
  if (value == null) return "text-muted-foreground";
  if (value >= 100) return "text-emerald-300";
  if (value >= 80) return "text-amber-300";
  return "text-rose-300";
}

function formatOee(value: number | null) {
  return value == null ? "–" : `${value.toFixed(1)} %`;
}

function WorkplacesPage() {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  const [saving, setSaving] = useState(false);

  const { data: workplaces = [], isLoading } = useQuery({
    queryKey: ["workplaces"],
    queryFn: async (): Promise<Workplace[]> => {
      const { data: masterRows, error: masterError } = await (supabase as any)
        .from("workplaces")
        .select("id,code,line_name,workplace_name,area,source_line,created_at,updated_at")
        .order("code", { ascending: true });
      if (masterError) throw masterError;

      const { data: records, error: recordsError } = await supabase
        .from("daily_records")
        .select("line,work_date,oee");
      if (recordsError) throw recordsError;

      const imported = new Map<string, ParsedImport>();
      for (const row of records ?? []) {
        const parsed = parseImportedLine(String(row.line ?? ""));
        if (parsed && !imported.has(parsed.code)) imported.set(parsed.code, parsed);
      }

      const masterByCode = new Map<string, any>((masterRows ?? []).map((row: any) => [String(row.code), row]));
      const missing = [...imported.values()].filter((item) => !masterByCode.has(item.code));
      if (missing.length) {
        const { data: created, error: createError } = await (supabase as any)
          .from("workplaces")
          .insert(missing.map((item) => ({ ...item })))
          .select("id,code,line_name,workplace_name,area,source_line,created_at,updated_at");
        if (createError && createError.code !== "23505") throw createError;
        for (const row of created ?? []) masterByCode.set(String(row.code), row);
      }

      const stats = new Map<string, { records: number; lastDate: string | null; oeeSum: number; oeeCount: number }>();
      for (const row of records ?? []) {
        const parsed = parseImportedLine(String(row.line ?? ""));
        if (!parsed) continue;
        const current = stats.get(parsed.code) ?? { records: 0, lastDate: null, oeeSum: 0, oeeCount: 0 };
        current.records += 1;
        const date = row.work_date ? String(row.work_date) : null;
        if (date && (!current.lastDate || date > current.lastDate)) current.lastDate = date;
        const oee = Number(row.oee);
        if (Number.isFinite(oee)) {
          current.oeeSum += oee;
          current.oeeCount += 1;
        }
        stats.set(parsed.code, current);
      }

      return [...masterByCode.values()].map((row: any) => {
        const stat = stats.get(String(row.code));
        return {
          id: String(row.id), code: String(row.code), line_name: String(row.line_name), workplace_name: String(row.workplace_name),
          area: row.area as Workplace["area"], source_line: row.source_line ?? null,
          records: stat?.records ?? 0,
          lastDate: stat?.lastDate ?? null,
          avgOee: stat && stat.oeeCount > 0 ? stat.oeeSum / stat.oeeCount : null,
        };
      }).sort((a, b) => a.code.localeCompare(b.code, "cs"));
    },
  });

  const grouped = useMemo(() => workplaces.reduce<Record<string, Workplace[]>>((acc, item) => {
    (acc[item.line_name] ??= []).push(item);
    return acc;
  }, {}), [workplaces]);

  function beginEdit(workplace: Workplace) {
    setEditing(workplace.id);
    setDraftName(workplace.workplace_name);
  }

  async function saveEdit(workplace: Workplace) {
    const name = draftName.trim();
    if (!name) return;
    setSaving(true);
    try {
      const { error } = await (supabase as any).from("workplaces").update({ workplace_name: name }).eq("id", workplace.id);
      if (error) throw error;
      setEditing(null);
      await queryClient.invalidateQueries({ queryKey: ["workplaces"] });
    } finally {
      setSaving(false);
    }
  }

  return (
    <AppShell title="Pracoviště" subtitle="Kód pracoviště určuje HA/TUP. Název pracoviště se přebírá z importu a lze ho kdykoliv upravit.">
      <div className="grid min-w-0 gap-6">
        <Card className="overflow-hidden p-0">
          <div className="border-b border-border px-4 py-4 sm:px-5">
            <div className="flex items-center gap-3">
              <span className="grid h-10 w-10 place-items-center rounded-xl bg-primary/10 text-primary"><Building2 className="h-5 w-5" /></span>
              <div><h2 className="font-semibold">Seznam pracovišť</h2><p className="text-xs text-muted-foreground">{workplaces.length} pracovišť · řazeno podle kódu</p></div>
            </div>
          </div>
          {isLoading ? <div className="p-5 text-sm text-muted-foreground">Načítám pracoviště…</div> : workplaces.length === 0 ? <div className="p-5 text-sm text-muted-foreground">Zatím nebylo importováno žádné pracoviště.</div> : (
            <div>
              <div className="hidden grid-cols-[140px_120px_minmax(0,1fr)_130px_auto] gap-4 border-b border-border bg-muted/30 px-4 py-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground sm:grid">
                <span>Kód pracoviště</span><span>Linka</span><span>Název pracoviště</span><span>Průměrné OEE</span><span></span>
              </div>
              <div className="divide-y divide-border">
                {Object.entries(grouped).map(([line, items]) => (
                  <div key={line}>
                    {items.map((workplace) => (
                      <div key={workplace.id} className="grid gap-3 p-4 sm:grid-cols-[140px_120px_minmax(0,1fr)_130px_auto] sm:items-center sm:gap-4">
                        <div><div className="font-mono font-semibold">{workplace.code}</div><div className="mt-1 text-xs text-muted-foreground sm:hidden">{workplace.area}</div></div>
                        <div className="font-medium">{workplace.line_name}</div>
                        <div className="min-w-0">
                          {editing === workplace.id ? (
                            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                              <div className="min-w-0 flex-1"><Label className="sr-only">Název pracoviště</Label><Input value={draftName} onChange={(e) => setDraftName(e.target.value)} autoFocus /></div>
                              <div className="flex gap-2"><Button size="sm" onClick={() => saveEdit(workplace)} disabled={saving || !draftName.trim()}><Save className="mr-1 h-4 w-4" />Uložit</Button><Button size="sm" variant="outline" onClick={() => setEditing(null)} disabled={saving}><X className="mr-1 h-4 w-4" />Zrušit</Button></div>
                            </div>
                          ) : <><div className="font-medium">{workplace.workplace_name}</div><div className="mt-1 flex flex-wrap gap-2 text-xs text-muted-foreground"><span>{workplace.area}</span>{workplace.records ? <span>· {workplace.records} záznamů</span> : null}{workplace.lastDate ? <span>· poslední {workplace.lastDate}</span> : null}</div></>}
                        </div>
                        <div className={`font-semibold tabular-nums ${oeeTone(workplace.avgOee)}`}>{formatOee(workplace.avgOee)}</div>
                        {editing !== workplace.id ? <Button size="sm" variant="ghost" onClick={() => beginEdit(workplace)}><Pencil className="mr-1 h-4 w-4" />Upravit</Button> : <span />}
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          )}
        </Card>
        <Card className="p-4 text-sm text-muted-foreground"><div className="flex items-start gap-3"><Factory className="mt-0.5 h-4 w-4 shrink-0" /><p><strong>Pravidlo:</strong> kód <span className="font-mono">041.xx</span> = HA, kód <span className="font-mono">050.xx</span> = TUP. <strong>Olovo je společná linka</strong>, nikoliv společné pracoviště — na lince Olovo jsou samostatná pracoviště HA a TUP. Každé pracoviště má vlastní kód a vlastní zařazení podle kódu.</p><Users className="mt-0.5 h-4 w-4 shrink-0" /></div></Card>
      </div>
    </AppShell>
  );
}
