import { supabase } from "@/integrations/supabase/client";
import type { IwWorkstation } from "./floorMap";
import { parseImportedLine } from "./workplace-line-parser";

export type RotationRecord = {
  employeeId: string;
  workDate: string;
  workstationCode: string | null;
  productCode: string | null;
  coworkerIds: string[];
};

const normalize = (value: string | null | undefined) => (value ?? "").trim().toLowerCase() || null;

/**
 * Rotace se dívá jen na posledních `lookbackDays` dnů (dle zadání). Zdroj dat:
 * primárně skutečná historie z `daily_records`/`daily_record_coworkers` (co
 * už bylo importem potvrzeno), doplněná o vlastní dříve ZAHÁJENÉ směny tohoto
 * modulu – jinak by rotace byla "slepá" pro dny, kdy OCR schválení ještě
 * neproběhlo. Žádná duplicitní historická tabulka se nevytváří.
 */
export async function getRotationHistory(input: {
  employeeIds: string[];
  workDate: string;
  workstations: IwWorkstation[];
  lookbackDays?: number;
}): Promise<RotationRecord[]> {
  const { employeeIds, workDate, workstations, lookbackDays = 3 } = input;
  if (employeeIds.length === 0) return [];

  const from = new Date(`${workDate}T00:00:00Z`);
  from.setUTCDate(from.getUTCDate() - lookbackDays);
  const fromIso = from.toISOString().slice(0, 10);

  const { data: records, error } = await supabase
    .from("daily_records")
    .select("id, employee_id, work_date, line, product")
    .in("employee_id", employeeIds)
    .gte("work_date", fromIso)
    .lt("work_date", workDate);
  if (error) throw error;

  const recordIds = (records ?? []).map((r) => r.id);
  const coworkersByRecord = new Map<string, string[]>();
  if (recordIds.length > 0) {
    const { data: coworkers, error: coworkerError } = await supabase.from("daily_record_coworkers").select("record_id, coworker_id").in("record_id", recordIds);
    if (coworkerError) throw coworkerError;
    for (const row of coworkers ?? []) {
      const list = coworkersByRecord.get(row.record_id) ?? [];
      list.push(row.coworker_id);
      coworkersByRecord.set(row.record_id, list);
    }
  }

  const fromDaily: RotationRecord[] = (records ?? []).map((r) => ({
    employeeId: r.employee_id,
    workDate: r.work_date,
    workstationCode: parseImportedLine(r.line ?? "")?.code ?? null,
    productCode: normalize(r.product),
    coworkerIds: coworkersByRecord.get(r.id) ?? [],
  }));

  const workstationCodeById = new Map(workstations.map((w) => [w.id, w.code]));
  const { data: ownAssignments, error: ownError } = await supabase
    .from("iw_shift_assignments")
    .select("employee_id, workstation_id, iw_shift_productions(product_code), iw_shifts!inner(id, work_date, status)")
    .in("employee_id", employeeIds)
    .gte("iw_shifts.work_date", fromIso)
    .lt("iw_shifts.work_date", workDate)
    .eq("iw_shifts.status", "started");
  if (ownError) throw ownError;

  const coworkersByShift = new Map<string, string[]>();
  for (const row of (ownAssignments ?? []) as any[]) {
    const shiftId = row.iw_shifts?.id;
    if (!shiftId) continue;
    const list = coworkersByShift.get(shiftId) ?? [];
    list.push(row.employee_id);
    coworkersByShift.set(shiftId, list);
  }

  const ownRecords: RotationRecord[] = ((ownAssignments ?? []) as any[]).map((row) => {
    const shiftId = row.iw_shifts?.id;
    return {
      employeeId: row.employee_id,
      workDate: row.iw_shifts?.work_date,
      workstationCode: row.workstation_id ? (workstationCodeById.get(row.workstation_id) ?? null) : null,
      productCode: normalize(row.iw_shift_productions?.product_code),
      coworkerIds: (coworkersByShift.get(shiftId) ?? []).filter((id) => id !== row.employee_id),
    };
  });

  return [...fromDaily, ...ownRecords];
}

export type RotationTarget = { workstationCode: string; productCode: string | null };

/**
 * Nižší skóre = kandidát je "více due" pro změnu (méně opakování za poslední 3 dny).
 * Toto je čistě technický výběrový mechanismus, ne hodnocení zaměstnance.
 * Rotace se uplatňuje AŽ PO splnění tvrdých omezení (dostupnost, kvalifikace) -
 * tato funkce sama o sobě žádná tvrdá omezení nekontroluje.
 */
export function rotationScore(employeeId: string, target: RotationTarget, history: RotationRecord[], alreadyPickedForThisSlot: string[]): number {
  const own = history.filter((h) => h.employeeId === employeeId);
  let score = 0;
  if (own.some((h) => h.workstationCode && h.workstationCode === target.workstationCode)) score += 2;
  if (target.productCode && own.some((h) => h.productCode && h.productCode === target.productCode)) score += 1;
  const recentColleagues = new Set(own.flatMap((h) => h.coworkerIds));
  if (alreadyPickedForThisSlot.some((id) => id !== employeeId && recentColleagues.has(id))) score += 1;
  return score;
}
