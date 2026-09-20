import { supabase } from "@/integrations/supabase/client";
import type { Assignment, AssignmentType } from "./shift-assignment";

export type IwShiftAssignment = {
  id: string;
  shift_id: string;
  employee_id: string;
  workstation_id: string | null;
  production_id: string | null;
  assignment_type: AssignmentType;
  is_manual_override: boolean;
  suggested_workstation_id: string | null;
  assigned_at: string;
};

export type IwShiftTempOperator = {
  id: string;
  shift_id: string;
  employee_id: string;
  added_reason: string | null;
  added_by: string | null;
  added_at: string;
};

export async function listAssignments(shiftId: string): Promise<IwShiftAssignment[]> {
  const { data, error } = await supabase.from("iw_shift_assignments").select("*").eq("shift_id", shiftId);
  if (error) throw error;
  return (data ?? []) as IwShiftAssignment[];
}

export async function listTempOperators(shiftId: string): Promise<IwShiftTempOperator[]> {
  const { data, error } = await supabase.from("iw_shift_temp_operators").select("*").eq("shift_id", shiftId);
  if (error) throw error;
  return (data ?? []) as IwShiftTempOperator[];
}

// # dělá: přidá dočasného operátora pro tuto směnu (employees.is_temporary musí být true)
export async function addTempOperator(input: { shiftId: string; employeeId: string; reason?: string | null; addedBy?: string | null }): Promise<void> {
  const { data: employee, error: employeeError } = await supabase.from("employees").select("is_temporary").eq("id", input.employeeId).maybeSingle();
  if (employeeError) throw employeeError;
  if (!employee?.is_temporary) throw new Error("Dočasný operátor musí mít v profilu zaměstnance příznak is_temporary.");
  const { error } = await supabase.from("iw_shift_temp_operators").upsert(
    { shift_id: input.shiftId, employee_id: input.employeeId, added_reason: input.reason ?? null, added_by: input.addedBy ?? null },
    { onConflict: "shift_id,employee_id" },
  );
  if (error) throw error;
}

export async function removeTempOperator(id: string): Promise<void> {
  const { error } = await supabase.from("iw_shift_temp_operators").delete().eq("id", id);
  if (error) throw error;
}

// # dělá: uloží navržené přiřazení jako výchozí stav (přepíše dřívější NEmanuální návrh, ruční úpravy nechává)
export async function saveSuggestedAssignments(shiftId: string, assignments: Assignment[]): Promise<void> {
  const rows = assignments.map((a) => ({
    shift_id: shiftId,
    employee_id: a.employeeId,
    workstation_id: a.workstationId,
    production_id: a.productionId,
    assignment_type: a.assignmentType,
    suggested_workstation_id: a.workstationId,
    is_manual_override: false,
  }));
  if (rows.length === 0) return;
  const { error } = await supabase.from("iw_shift_assignments").upsert(rows, { onConflict: "shift_id,employee_id" });
  if (error) throw error;
}

// # dělá: TL ručně přesune zaměstnance na jiné pracoviště; algoritmus si tento zásah "Přepočítat" nesmí sám přepsat
export async function setManualAssignment(input: { shiftId: string; employeeId: string; workstationId: string | null; productionId: string | null; assignmentType: AssignmentType }): Promise<void> {
  const { error } = await supabase.from("iw_shift_assignments").upsert(
    {
      shift_id: input.shiftId,
      employee_id: input.employeeId,
      workstation_id: input.workstationId,
      production_id: input.productionId,
      assignment_type: input.assignmentType,
      is_manual_override: true,
    },
    { onConflict: "shift_id,employee_id" },
  );
  if (error) throw error;
}

// # dělá: smaže všechna NEmanuální přiřazení směny, aby "Přepočítat" mohlo zapsat čerstvý návrh bez duplicit
export async function clearNonManualAssignments(shiftId: string): Promise<void> {
  const { error } = await supabase.from("iw_shift_assignments").delete().eq("shift_id", shiftId).eq("is_manual_override", false);
  if (error) throw error;
}
