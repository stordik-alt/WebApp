import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { LayoutGrid, Save } from "lucide-react";
import { useState } from "react";
import { AppShell } from "@/components/AppShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { groupWorkstations, listWorkstations, updateWorkstation, type IwWorkstation } from "@/lib/floorMap";

export const Route = createFileRoute("/interaktivni/pracoviste-mapa")({
  head: () => ({
    meta: [
      { title: "Mapa haly – Interaktivní prostředí" },
      { name: "description", content: "Editovatelná fixní mapa výrobní haly (HA/TUP/sekundární pracoviště)." },
    ],
  }),
  component: FloorMapAdminPage,
});

function FloorMapAdminPage() {
  const queryClient = useQueryClient();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ group_name: string; display_name: string; note: string }>({ group_name: "", display_name: "", note: "" });
  const [saving, setSaving] = useState(false);

  const { data: workstations = [], isLoading, isError } = useQuery({
    queryKey: ["iw_workstations"],
    queryFn: listWorkstations,
  });

  const groups = groupWorkstations(workstations);

  function beginEdit(workstation: IwWorkstation) {
    setEditingId(workstation.id);
    setDraft({ group_name: workstation.group_name, display_name: workstation.display_name, note: workstation.note ?? "" });
  }

  async function saveEdit(workstation: IwWorkstation) {
    setSaving(true);
    try {
      await updateWorkstation(workstation.id, {
        group_name: draft.group_name.trim() || workstation.group_name,
        display_name: draft.display_name.trim() || workstation.display_name,
        note: draft.note.trim() || null,
      });
      setEditingId(null);
      await queryClient.invalidateQueries({ queryKey: ["iw_workstations"] });
    } finally {
      setSaving(false);
    }
  }

  return (
    <AppShell title="Mapa haly" subtitle="Best-effort rekonstrukce reálného rozložení – oprav skupinu, název nebo poznámku podle skutečnosti.">
      <div className="grid min-w-0 gap-4 sm:gap-6">
        {isLoading ? (
          <Card className="p-5 text-sm text-muted-foreground">Načítám mapu haly…</Card>
        ) : isError ? (
          <Card className="p-5 text-sm text-rose-300">Nepodařilo se načíst mapu haly.</Card>
        ) : (
          [...groups.entries()].map(([groupName, items]) => (
            <Card key={groupName} className="overflow-hidden p-0">
              <div className="flex items-center gap-3 border-b border-border px-4 py-4 sm:px-5">
                <span className="grid h-10 w-10 place-items-center rounded-xl bg-primary/10 text-primary">
                  <LayoutGrid className="h-5 w-5" />
                </span>
                <div>
                  <h2 className="text-lg font-semibold">{groupName}</h2>
                  <p className="text-xs text-muted-foreground">{items.length} pracovišť</p>
                </div>
              </div>
              <div className="divide-y divide-border">
                {items.map((workstation) => (
                  <div key={workstation.id} className="px-4 py-4 sm:px-5">
                    {editingId === workstation.id ? (
                      <div className="grid gap-2 sm:grid-cols-[1fr_1fr_2fr_auto]">
                        <Input value={draft.group_name} onChange={(e) => setDraft((d) => ({ ...d, group_name: e.target.value }))} placeholder="Skupina" aria-label="Skupina" />
                        <Input value={draft.display_name} onChange={(e) => setDraft((d) => ({ ...d, display_name: e.target.value }))} placeholder="Zobrazovaný název" aria-label="Zobrazovaný název" />
                        <Input value={draft.note} onChange={(e) => setDraft((d) => ({ ...d, note: e.target.value }))} placeholder="Poznámka (volitelné)" aria-label="Poznámka" />
                        <div className="flex gap-2">
                          <Button size="sm" disabled={saving} onClick={() => void saveEdit(workstation)}>
                            <Save className="mr-1 h-4 w-4" /> Uložit
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setEditingId(null)}>
                            Zrušit
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <button type="button" className="flex w-full flex-wrap items-center gap-3 text-left" onClick={() => beginEdit(workstation)}>
                        <span className="font-mono text-xs font-semibold">{workstation.code}</span>
                        <Badge variant={workstation.is_secondary ? "outline" : "secondary"}>{workstation.area}</Badge>
                        <span className="min-w-0 flex-1 truncate font-medium">{workstation.display_name}</span>
                        {workstation.note ? <span className="text-xs text-amber-300">⚠ {workstation.note}</span> : null}
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </Card>
          ))
        )}
      </div>
    </AppShell>
  );
}
