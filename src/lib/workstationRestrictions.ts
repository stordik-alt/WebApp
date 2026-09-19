import { supabase } from "@/integrations/supabase/client";

/**
 * Per-zaměstnanec omezení konkrétního pracoviště (typicky TESTY/PREP).
 * Důvod se dle zadání neeviduje jako povinný údaj – `reason` je čistě volitelná poznámka.
 */
export type IwWorkstationRestriction = {
  id: string;
  employee_id: string;
  workstation_id: string;
  restriction_type: string;
  reason: string | null;
  created_by: string | null;
  created_at: string;
};

// # dělá: načte omezení pro danou množinu zaměstnanců najednou (pro hromadné vyhodnocení způsobilosti)
export async function listRestrictionsForEmployees(employeeIds: string[]): Promise<IwWorkstationRestriction[]> {
  if (employeeIds.length === 0) return [];
  const { data, error } = await supabase.from("iw_workstation_restrictions").select("*").in("employee_id", employeeIds);
  if (error) throw error;
  return (data ?? []) as IwWorkstationRestriction[];
}

// # dělá: sestaví mapu employee_id -> množina zakázaných workstation_id pro rychlé vyhodnocení způsobilosti
export function toExclusionMap(restrictions: IwWorkstationRestriction[]): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  for (const restriction of restrictions) {
    const set = map.get(restriction.employee_id) ?? new Set<string>();
    set.add(restriction.workstation_id);
    map.set(restriction.employee_id, set);
  }
  return map;
}

// # dělá: zapíše/aktualizuje omezení zaměstnance pro dané pracoviště
export async function setWorkstationRestriction(input: {
  employeeId: string;
  workstationId: string;
  reason?: string | null;
  createdBy?: string | null;
}): Promise<void> {
  const { error } = await supabase.from("iw_workstation_restrictions").upsert(
    {
      employee_id: input.employeeId,
      workstation_id: input.workstationId,
      restriction_type: "excluded",
      reason: input.reason ?? null,
      created_by: input.createdBy ?? null,
    },
    { onConflict: "employee_id,workstation_id" },
  );
  if (error) throw error;
}

// # dělá: zruší omezení zaměstnance pro dané pracoviště
export async function clearWorkstationRestriction(employeeId: string, workstationId: string): Promise<void> {
  const { error } = await supabase.from("iw_workstation_restrictions").delete().eq("employee_id", employeeId).eq("workstation_id", workstationId);
  if (error) throw error;
}
