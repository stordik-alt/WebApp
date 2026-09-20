import { supabase } from "@/integrations/supabase/client";

/**
 * Fixní mapa haly pro Interaktivní prostředí (Verze 2.02).
 * Toto je best-effort rekonstrukce reálného rozložení (viz migrace
 * 20260919130000_verze_2_02_floor_map_and_rosters.sql) – admin ji může
 * kdykoli opravit, aniž by se cokoli měnilo na existující `workplaces`.
 */
export type IwWorkstationArea = "HA" | "TUP" | "BOTH" | "SECONDARY";

export type IwWorkstation = {
  id: string;
  code: string;
  workplace_id: string | null;
  area: IwWorkstationArea;
  group_name: string;
  display_name: string;
  sort_order: number;
  requires_ha_qual: boolean;
  requires_tup_qual: boolean;
  is_secondary: boolean;
  active: boolean;
  note: string | null;
  created_at: string;
  updated_at: string;
};

// # dělá: načte celou fixní mapu haly seřazenou podle zamýšleného pořadí zobrazení
export async function listWorkstations(): Promise<IwWorkstation[]> {
  const { data, error } = await supabase.from("iw_workstations").select("*").order("sort_order", { ascending: true });
  if (error) throw error;
  return (data ?? []) as IwWorkstation[];
}

export type IwWorkstationPatch = Partial<
  Pick<IwWorkstation, "group_name" | "display_name" | "sort_order" | "requires_ha_qual" | "requires_tup_qual" | "is_secondary" | "active" | "note" | "workplace_id">
>;

// # dělá: umožní adminovi opravit best-effort mapu (skupina, název, pořadí, kvalifikace, propojení na workplaces)
export async function updateWorkstation(id: string, patch: IwWorkstationPatch): Promise<void> {
  const { error } = await supabase.from("iw_workstations").update(patch).eq("id", id);
  if (error) throw error;
}

// # dělá: seskupí pracoviště podle group_name (Delta/Ersa/Olovo/Sekundární) pro vykreslení mapy po skupinách
export function groupWorkstations(workstations: IwWorkstation[]): Map<string, IwWorkstation[]> {
  const groups = new Map<string, IwWorkstation[]>();
  for (const workstation of workstations) {
    const list = groups.get(workstation.group_name) ?? [];
    list.push(workstation);
    groups.set(workstation.group_name, list);
  }
  return groups;
}
