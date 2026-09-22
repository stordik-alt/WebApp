import { supabase } from "@/integrations/supabase/client";
import type { IwShiftName } from "./shift-windows";

export type IwShiftStatus = "draft" | "started" | "locked";

export type IwShift = {
  id: string;
  team_id: string;
  work_date: string;
  shift: IwShiftName;
  status: IwShiftStatus;
  started_at: string | null;
  started_by: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
};

export type IwShiftProductionArea = "HA" | "TUP";

export type IwShiftProduction = {
  id: string;
  shift_id: string;
  workstation_id: string;
  product_id: string | null;
  product_code: string;
  area: IwShiftProductionArea;
  remaining_pieces: number;
  priority: number | null;
  sequence_no: number;
  started_at: string;
  ended_at: string | null;
  created_at: string;
  updated_at: string;
};

export type IwActiveProduct = {
  id: string;
  code: string;
  name: string | null;
};

export async function listActiveProducts(): Promise<IwActiveProduct[]> {
  const { data, error } = await supabase
    .from("products")
    .select("id, code, name")
    .eq("active", true)
    .eq("approval_status", "approved")
    .order("code", { ascending: true });
  if (error) throw error;
  return (data ?? []) as IwActiveProduct[];
}

// # dělá: najde nebo vytvoří draft směnu pro daný tým/datum/směnu (unikátní na team_id+work_date+shift)
export async function ensureShift(input: { teamId: string; workDate: string; shift: IwShiftName; createdBy: string }): Promise<IwShift> {
  const { data: existing, error: findError } = await supabase
    .from("iw_shifts")
    .select("*")
    .eq("team_id", input.teamId)
    .eq("work_date", input.workDate)
    .eq("shift", input.shift)
    .maybeSingle();
  if (findError) throw findError;
  if (existing) return existing as IwShift;

  const { data, error } = await supabase
    .from("iw_shifts")
    .insert({ team_id: input.teamId, work_date: input.workDate, shift: input.shift, created_by: input.createdBy })
    .select("*")
    .single();
  if (error) throw error;
  return data as IwShift;
}

// # dělá: načte aktivní (neukončené) výroby dané směny
export async function listActiveProductions(shiftId: string): Promise<IwShiftProduction[]> {
  const { data, error } = await supabase.from("iw_shift_productions").select("*").eq("shift_id", shiftId).is("ended_at", null);
  if (error) throw error;
  return (data ?? []) as IwShiftProduction[];
}

// # dělá: založí novou výrobu na pracovišti pro danou směnu
export async function startProduction(input: {
  shiftId: string;
  workstationId: string;
  workplaceId?: string | null;
  productId: string;
  productCode: string;
  area: IwShiftProductionArea;
  remainingPieces: number;
  priority?: number | null;
}): Promise<IwShiftProduction> {
  // Some master workplaces are represented in the UI before an iw_workstations
  // row exists. Resolve/create the technical row so the production FK always
  // receives a real iw_workstations.id.
  let workstationId = input.workstationId;
  if (input.workplaceId) {
    const { data: existingWorkstation, error: lookupError } = await supabase
      .from("iw_workstations")
      .select("id")
      .eq("workplace_id", input.workplaceId)
      .maybeSingle();
    if (lookupError) throw lookupError;

    if (existingWorkstation) {
      workstationId = existingWorkstation.id;
    } else {
      const { data: createdWorkstation, error: createError } = await supabase
        .from("iw_workstations")
        .insert({
          workplace_id: input.workplaceId,
          code: input.productCode ? input.workstationId : input.workstationId,
          area: input.area,
          active: true,
        })
        .select("id")
        .single();
      if (createError) throw createError;
      workstationId = createdWorkstation.id;
    }
  }

  const { data, error } = await supabase
    .from("iw_shift_productions")
    .insert({
      shift_id: input.shiftId,
      workstation_id: workstationId,
      product_id: input.productId,
      product_code: input.productCode,
      area: input.area,
      remaining_pieces: input.remainingPieces,
      priority: input.priority ?? null,
    })
    .select("*")
    .single();
  if (error) throw error;
  return data as IwShiftProduction;
}

// # dělá: upraví běžící výrobu; změna produktu se uloží spolu s canonical product_id
export async function updateProduction(
  id: string,
  patch: Partial<Pick<IwShiftProduction, "remaining_pieces" | "priority" | "product_id" | "product_code">>,
): Promise<void> {
  const { error } = await supabase.from("iw_shift_productions").update(patch).eq("id", id);
  if (error) throw error;
}

/**
 * Ukončí aktuální výrobu na pracovišti a založí novou se zvýšeným sequence_no,
 * beze ztráty historie – nikdy nepřepisuje předchozí záznam (viz sekce 15 zadání).
 */
export async function changeProduction(input: {
  shiftId: string;
  workstationId: string;
  previousProductionId: string;
  productId: string;
  productCode: string;
  area: IwShiftProductionArea;
  remainingPieces: number;
  priority?: number | null;
  previousSequenceNo: number;
}): Promise<IwShiftProduction> {
  const { error: closeError } = await supabase.from("iw_shift_productions").update({ ended_at: new Date().toISOString() }).eq("id", input.previousProductionId);
  if (closeError) throw closeError;

  const { data, error } = await supabase
    .from("iw_shift_productions")
    .insert({
      shift_id: input.shiftId,
      workstation_id: input.workstationId,
      product_id: input.productId,
      product_code: input.productCode,
      area: input.area,
      remaining_pieces: input.remainingPieces,
      priority: input.priority ?? null,
      sequence_no: input.previousSequenceNo + 1,
    })
    .select("*")
    .single();
  if (error) throw error;
  return data as IwShiftProduction;
}

export type ResolvedProductProfile = {
  product_code: string;
  h_capacity: number | null;
  h_norm_per_hour: number | null;
  t_capacity: number | null;
  t_norm_per_hour: number | null;
  profile_complete: boolean | null;
};

// # dělá: dotáhne normu a kapacitu produktu živě přes kanonický resolver (nikdy je neukládá)
export async function resolveProductProfile(code: string, workDate: string): Promise<ResolvedProductProfile | null> {
  const { data, error } = await supabase.rpc("resolve_product_profile", { p_code: code, p_work_date: workDate });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return (row as ResolvedProductProfile | undefined) ?? null;
}
