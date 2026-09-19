import { supabase } from "@/integrations/supabase/client";
import { changeProduction, type IwShiftProductionArea } from "./shiftProductions";

export type IwShiftSnapshot = {
  id: string;
  shift_id: string;
  snapshot_at: string;
  confirmed_by: string;
  payload: unknown;
  created_at: string;
};

export type IwShiftHistorySegment = {
  id: string;
  shift_id: string;
  employee_id: string;
  workstation_id: string;
  production_id: string | null;
  product_code: string | null;
  segment_start_at: string;
  segment_end_at: string | null;
  coworker_employee_ids: string[];
  result_snapshot: unknown;
  created_at: string;
};

// # dělá: "ZAHÁJIT VÝROBU" - zavolá RPC, které v jedné transakci zapíše needitovatelný snapshot a otevře historii
export async function startShiftProduction(shiftId: string): Promise<{ snapshot_id: string; shift_id: string }> {
  const { data, error } = await supabase.rpc("start_shift_production", { p_shift_id: shiftId });
  if (error) throw error;
  return data as { snapshot_id: string; shift_id: string };
}

export async function getShiftSnapshot(shiftId: string): Promise<IwShiftSnapshot | null> {
  const { data, error } = await supabase.from("iw_shift_snapshots").select("*").eq("shift_id", shiftId).order("snapshot_at", { ascending: false }).limit(1).maybeSingle();
  if (error) throw error;
  return (data as IwShiftSnapshot | null) ?? null;
}

export async function listHistorySegments(shiftId: string): Promise<IwShiftHistorySegment[]> {
  const { data, error } = await supabase.from("iw_shift_history_segments").select("*").eq("shift_id", shiftId);
  if (error) throw error;
  return (data ?? []) as IwShiftHistorySegment[];
}

/**
 * Změna produktu uprostřed směny (jen po ZAHÁJIT VÝROBU): uzavře stávající výrobu i všechny
 * otevřené historické segmenty na daném pracovišti a otevře nové - nikdy nepřepisuje předchozí
 * záznam (sekce 15 zadání: PERSON->ČAS->PRACOVIŠTĚ->VÝROBEK->KOLEGOVÉ->VÝSLEDEK).
 */
export async function changeProductionMidShift(input: {
  shiftId: string;
  workstationId: string;
  previousProductionId: string;
  previousSequenceNo: number;
  productCode: string;
  area: IwShiftProductionArea;
  remainingPieces: number;
  priority?: number | null;
}): Promise<void> {
  const newProduction = await changeProduction({
    shiftId: input.shiftId,
    workstationId: input.workstationId,
    previousProductionId: input.previousProductionId,
    productCode: input.productCode,
    area: input.area,
    remainingPieces: input.remainingPieces,
    priority: input.priority,
    previousSequenceNo: input.previousSequenceNo,
  });

  const { data: openSegments, error } = await supabase
    .from("iw_shift_history_segments")
    .select("id, employee_id, coworker_employee_ids")
    .eq("shift_id", input.shiftId)
    .eq("workstation_id", input.workstationId)
    .is("segment_end_at", null);
  if (error) throw error;

  const now = new Date().toISOString();
  for (const segment of openSegments ?? []) {
    const { error: closeError } = await supabase.rpc("close_history_segment", { p_segment_id: segment.id, p_ended_at: now });
    if (closeError) throw closeError;
  }

  if ((openSegments ?? []).length > 0) {
    const rows = (openSegments ?? []).map((segment) => ({
      shift_id: input.shiftId,
      employee_id: segment.employee_id,
      workstation_id: input.workstationId,
      production_id: newProduction.id,
      product_code: input.productCode,
      segment_start_at: now,
      coworker_employee_ids: segment.coworker_employee_ids,
    }));
    const { error: insertError } = await supabase.from("iw_shift_history_segments").insert(rows);
    if (insertError) throw insertError;
  }
}
