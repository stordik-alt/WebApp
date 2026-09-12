import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Building2, Factory, Users } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { Card } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/pracoviste")({
  head: () => ({ meta: [
    { title: "Pracoviště – Výkonnost operátorů" },
    { name: "description", content: "Přehled pracovišť a linek zapsaných při importu denních dat." },
  ]}),
  component: WorkplacesPage,
});

type Workplace = { line: string; position: "HA" | "TUP"; records: number; lastDate: string | null };

function detectPosition(line: string): "HA" | "TUP" {
  const text = line.toLowerCase().replace(/\s+/g, " ").trim();
  if (/touch\s*up|touchup|\btup\b/.test(text)) return "TUP";
  if (/hand\s*assy|handassy/.test(text)) return "HA";
  return "HA";
}

function WorkplacesPage() {
  const { data: workplaces = [], isLoading } = useQuery({
    queryKey: ["workplaces"],
    queryFn: async (): Promise<Workplace[]> => {
      const { data, error } = await supabase.from("daily_records").select("line,work_date").order("work_date", { ascending: false });
      if (error) throw error;
      const map = new Map<string, Workplace>();
      for (const row of data ?? []) {
        const line = String(row.line ?? "").trim();
        if (!line) continue;
        const current = map.get(line);
        if (current) {
          current.records += 1;
          if (!current.lastDate || String(row.work_date ?? "") > current.lastDate) current.lastDate = row.work_date;
        } else {
          map.set(line, { line, position: detectPosition(line), records: 1, lastDate: row.work_date ?? null });
        }
      }
      return [...map.values()].sort((a, b) => a.line.localeCompare(b.line, "cs"));
    },
  });

  return (
    <AppShell title="Pracoviště" subtitle="Pracoviště se automaticky evidují z linek zapsaných při importu denních dat.">
      <div className="grid min-w-0 gap-6">
        <Card className="overflow-hidden p-0">
          <div className="border-b border-border px-4 py-4 sm:px-5">
            <div className="flex items-center gap-3">
              <span className="grid h-10 w-10 place-items-center rounded-xl bg-primary/10 text-primary"><Building2 className="h-5 w-5" /></span>
              <div><h2 className="font-semibold">Evidovaná pracoviště</h2><p className="text-xs text-muted-foreground">{workplaces.length} unikátních pracovišť</p></div>
            </div>
          </div>
          {isLoading ? <div className="p-5 text-sm text-muted-foreground">Načítám pracoviště…</div> : workplaces.length === 0 ? <div className="p-5 text-sm text-muted-foreground">Zatím nebylo importováno žádné pracoviště.</div> : (
            <div className="divide-y divide-border">
              {workplaces.map((workplace) => (
                <div key={workplace.line} className="flex min-w-0 items-center justify-between gap-4 p-4">
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-muted"><Factory className="h-4 w-4" /></span>
                    <div className="min-w-0"><div className="truncate font-medium">{workplace.line}</div><div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground"><span className="inline-flex items-center gap-1"><Users className="h-3.5 w-3.5" />{workplace.records} záznamů</span>{workplace.lastDate ? <span>poslední {workplace.lastDate}</span> : null}</div></div>
                  </div>
                  <span className={workplace.position === "TUP" ? "shrink-0 rounded-full border border-fuchsia-400/30 bg-fuchsia-400/10 px-2.5 py-1 text-xs font-semibold text-fuchsia-300" : "shrink-0 rounded-full border border-cyan-400/30 bg-cyan-400/10 px-2.5 py-1 text-xs font-semibold text-cyan-300"}>{workplace.position}</span>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </AppShell>
  );
}
