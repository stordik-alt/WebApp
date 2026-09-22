import { supabase } from "@/integrations/supabase/client";

export type IwWorkstationArea = "HA" | "TUP" | "BOTH" | "SECONDARY";

export type IwWorkstation = {
  id: string;
  code: string;
  line_name: string;
  workplace_name: string;
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

type WorkplaceMaster = {
  id: string;
  code: string;
  line_name: string;
  workplace_name: string;
  area: "HA" | "TUP";
  created_at: string;
  updated_at: string;
};

export function normalizeParentLine(lineName: string, workplaceName = ""): string {
  const combined = `${lineName} ${workplaceName}`.trim();
  const match = combined.match(/\b(L[13]\s*\/\s*\d+)/i);
  if (match) return match[1].replace(/\s+/g, "").toUpperCase();
  if (combined.toLocaleLowerCase("cs-CZ").includes("olovo") || combined.toLocaleLowerCase("cs-CZ").includes("krátká linka")) return "Olovo";
  return lineName.trim() || "Neurčeno";
}

export function hallGroup(lineName: string, workplaceName: string): string {
  const parent = normalizeParentLine(lineName, workplaceName);
  if (parent === "Olovo") return "Olovo";
  if (/^L1\//i.test(parent)) return "L1";
  if (/^L3\//i.test(parent)) return "L3";
  return "Sekundární";
}

export function hallSortOrder(lineName: string, workplaceName: string, area: "HA" | "TUP"): number {
  const parent = normalizeParentLine(lineName, workplaceName);
  if (parent === "Olovo") return 1000 + (area === "HA" ? 0 : 1);
  const match = parent.match(/^L([13])\/(\d+)/i);
  if (!match) return 9000;
  const line = Number(match[1]);
  const station = Number(match[2]);
  const base = line === 1 ? 100 : 1000;
  return base + station * 10 + (area === "HA" ? 0 : 1);
}

/**
 * Hlavním zdrojem pracovišť je public.workplaces.
 * iw_workstations obsahuje pouze mapové vlastnosti (skupina, pořadí, poznámku).
 * Díky tomu se ručně přidané nebo upravené pracoviště v Hodnocení → Pracoviště
 * automaticky projeví i v mapě malé haly bez duplicitního master záznamu.
 */
export async function listWorkstations(): Promise<IwWorkstation[]> {
  const [{ data: mapRows, error: mapError }, { data: masterRows, error: masterError }] = await Promise.all([
    supabase.from("iw_workstations").select("*").order("sort_order", { ascending: true }),
    supabase.from("workplaces").select("id,code,line_name,workplace_name,area,created_at,updated_at").order("code", { ascending: true }),
  ]);
  if (mapError) throw mapError;
  if (masterError) throw masterError;

  const masters = (masterRows ?? []) as WorkplaceMaster[];
  const map = (mapRows ?? []) as IwWorkstation[];
  const byWorkplaceId = new Map(map.filter((row) => row.workplace_id).map((row) => [row.workplace_id as string, row]));
  const byCode = new Map(map.map((row) => [row.code, row]));
  const synced: IwWorkstation[] = [];

  for (const workplace of masters) {
    const existing = byWorkplaceId.get(workplace.id) ?? byCode.get(workplace.code);
    const group = hallGroup(workplace.line_name, workplace.workplace_name);
    const order = hallSortOrder(workplace.line_name, workplace.workplace_name, workplace.area);
    const base = existing ?? {
      id: `workplace:${workplace.id}`,
      code: workplace.code,
      line_name: workplace.line_name,
      workplace_name: workplace.workplace_name,
      workplace_id: workplace.id,
      area: workplace.area,
      group_name: group,
      display_name: workplace.workplace_name,
      sort_order: order,
      requires_ha_qual: workplace.area === "HA",
      requires_tup_qual: workplace.area === "TUP",
      is_secondary: false,
      active: true,
      note: null,
      created_at: workplace.created_at,
      updated_at: workplace.updated_at,
    };

    synced.push({
      ...base,
      code: workplace.code,
      workplace_id: workplace.id,
      area: workplace.area,
      line_name: workplace.line_name,
      workplace_name: workplace.workplace_name,
      group_name: group,
      display_name: workplace.workplace_name,
      sort_order: order,
      updated_at: workplace.updated_at,
    });
  }

  // Keep map-only entries such as TESTY/PREP and synthetic TUP stations.
  for (const row of map) {
    if (!row.workplace_id || !masters.some((workplace) => workplace.id === row.workplace_id)) {
      const parentLine = normalizeParentLine(row.line_name ?? row.group_name, row.workplace_name ?? row.display_name);
      const childName = row.area === "TUP" ? "TouchUp" : row.area === "HA" ? "HandAssy" : (row.workplace_name ?? row.display_name);
      synced.push({
        ...row,
        line_name: parentLine,
        workplace_name: childName,
        display_name: childName,
        group_name: parentLine,
        sort_order: hallSortOrder(parentLine, childName, row.area === "TUP" ? "TUP" : "HA"),
      });
    }
  }

  return synced
    .filter((row) => row.active)
    .sort((a, b) =>
      hallSortOrder(a.line_name, a.workplace_name, a.area === "TUP" ? "TUP" : "HA") -
      hallSortOrder(b.line_name, b.workplace_name, b.area === "TUP" ? "TUP" : "HA") ||
      a.code.localeCompare(b.code, "cs")
    );
}

export type IwWorkstationPatch = Partial<
  Pick<IwWorkstation, "group_name" | "display_name" | "sort_order" | "requires_ha_qual" | "requires_tup_qual" | "is_secondary" | "active" | "note" | "workplace_id">
>;

export async function updateWorkstation(id: string, patch: IwWorkstationPatch): Promise<void> {
  if (id.startsWith("workplace:")) {
    if (patch.display_name !== undefined) {
      const workplaceId = id.slice("workplace:".length);
      const { error } = await supabase.from("workplaces").update({ workplace_name: patch.display_name }).eq("id", workplaceId);
      if (error) throw error;
    }
    return;
  }

  const { error } = await supabase.from("iw_workstations").update(patch).eq("id", id);
  if (error) throw error;
}

export function groupWorkstations(workstations: IwWorkstation[]): Map<string, IwWorkstation[]> {
  const groups = new Map<string, IwWorkstation[]>();
  for (const workstation of workstations) {
    const parentLine = normalizeParentLine(workstation.line_name, workstation.workplace_name);
    const list = groups.get(parentLine) ?? [];
    list.push(workstation);
    groups.set(parentLine, list);
  }
  return groups;
}
