import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { LayoutGrid, Save } from "lucide-react";
import { useState } from "react";
import { AppShell } from "@/components/AppShell";
import { Panel, PanelHeader } from "@/components/interaktivni/Panel";
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
          <Panel className="p-5 text-sm text-muted-foreground">Načítám mapu haly…</Panel>
        ) : isError ? (
          <Panel className="p-5 text-sm text-rose-700 dark:text-rose-300">Nepodařilo se načíst mapu haly.</Panel>
        ) : (
          [...groups.entries()].map(([groupName, items]) => (
            <Panel key={groupName}>
              <PanelHeader icon={<LayoutGrid className="h-4 w-4" />} title={groupName} subtitle={`${items.length} pracovišť`} />
              <div className="divide-y divide-white/10">
                {items.map((workstation) => (
                  <div key={workstation.id} className="px-4 py-4 sm:px-5">
                    {editingId === workstation.id ? (
                      <div className="grid gap-2 sm:grid-cols-[1fr_1fr_2fr_auto]">
                        <input value={draft.group_name} onChange={(e) => setDraft((d) => ({ ...d, group_name: e.target.value }))} placeholder="Skupina" aria-label="Skupina" />
                        <input value={draft.display_name} onChange={(e) => setDraft((d) => ({ ...d, display_name: e.target.value }))} placeholder="Zobrazovaný název" aria-label="Zobrazovaný název" />
                        <input value={draft.note} onChange={(e) => setDraft((d) => ({ ...d, note: e.target.value }))} placeholder="Poznámka (volitelné)" aria-label="Poznámka" />
                        <div className="flex gap-2">
                          <button type="button" className="iw-btn iw-btn-active" disabled={saving} onClick={() => void saveEdit(workstation)}>
                            <Save className="h-4 w-4" /> Uložit
                          </button>
                          <button type="button" className="iw-btn" onClick={() => setEditingId(null)}>
                            Zrušit
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button type="button" className="flex w-full flex-wrap items-center gap-3 text-left" onClick={() => beginEdit(workstation)}>
                        <span className="iw-mono text-xs font-semibold text-foreground/70">{workstation.code}</span>
                        <span className="iw-chip">{workstation.area}</span>
                        <span className="iw-mono min-w-0 flex-1 truncate text-sm text-foreground/85">{workstation.display_name}</span>
                        {workstation.note ? <span className="text-xs text-amber-700 dark:text-amber-300">⚠ {workstation.note}</span> : null}
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </Panel>
          ))
        )}
      </div>
    </AppShell>
  );
}
