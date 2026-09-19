import { findCompletionOffset, remainingProductiveMinutes, shiftAbsoluteMinutesToIso, type IwShiftName } from "./shift-windows";

export type ExpectedCompletion =
  | { status: "DONE" }
  | { status: "NO_OPERATOR" }
  | { status: "INVALID" }
  | { status: "WILL_FINISH"; expectedCompletionAt: string }
  | { status: "WONT_FINISH"; minutesShort: number };

export type ExpectedCompletionInput = {
  shift: IwShiftName;
  workDate: string;
  fromTime: string;
  remainingPieces: number;
  /** Norma z product_profiles (h_norm_per_hour / t_norm_per_hour). */
  normPerHour: number;
  /** Kapacita produktu z product_profiles (h_capacity / t_capacity) – "pro kolik lidí je výroba určena". */
  designedCapacity: number;
  /** Skutečně přidělený počet operátorů na tuto výrobu právě teď. */
  assignedOperators: number;
};

/**
 * Vypočítá předpokládané dokončení výroby. Používá STEJNÝ vzorec jako
 * kanonická KPI vrstva (`reconstruct_import_item_hourly`: `norm * minuty/60 *
 * (operator_count / capacity)`), jen obráceně – řeší čas potřebný k
 * vyrobení zbývajících kusů místo výkonu za odpracovaný čas.
 */
export function computeExpectedCompletion(input: ExpectedCompletionInput): ExpectedCompletion {
  const { shift, workDate, fromTime, remainingPieces, normPerHour, designedCapacity, assignedOperators } = input;

  if (!Number.isFinite(normPerHour) || normPerHour <= 0 || !Number.isFinite(designedCapacity) || designedCapacity <= 0) {
    return { status: "INVALID" };
  }
  if (remainingPieces <= 0) return { status: "DONE" };
  if (assignedOperators <= 0) return { status: "NO_OPERATOR" };

  const staffingRatio = assignedOperators / designedCapacity;
  const effectiveRatePerHour = normPerHour * staffingRatio;
  if (effectiveRatePerHour <= 0) return { status: "INVALID" };

  const minutesNeeded = (remainingPieces / effectiveRatePerHour) * 60;
  const available = remainingProductiveMinutes(shift, fromTime);
  if (minutesNeeded > available) {
    return { status: "WONT_FINISH", minutesShort: minutesNeeded - available };
  }

  const offset = findCompletionOffset(shift, fromTime, minutesNeeded);
  if ("minutesShort" in offset) return { status: "WONT_FINISH", minutesShort: offset.minutesShort };
  return { status: "WILL_FINISH", expectedCompletionAt: shiftAbsoluteMinutesToIso(workDate, offset.offsetAbsoluteMinutes) };
}
