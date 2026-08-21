import type { DailyRecord } from "./metrics";

export type Product = {
  id: string;
  code: string;
  name: string | null;
  active: boolean;
  first_seen_date: string;
  note: string | null;
  is_demo: boolean;
  created_at: string;
  employees_per_product: number;
};

export type ProductNorm = {
  id: string;
  product_id: string;
  operation: "HA" | "TUP";
  norm_per_hour: number;
  valid_from: string;
  valid_to: string | null;
  source: string;
  confirmed: boolean;
  note: string | null;
  created_at: string;
};

export const normalizeCode = (c: string) => c.trim().toLowerCase();

export function findProductByCode(products: Product[], code: string | null | undefined) {
  if (!code) return undefined;
  return products.find((p) => normalizeCode(p.code) === normalizeCode(code));
}

export function normValidAt(
  norms: ProductNorm[],
  productId: string,
  operation: "HA" | "TUP",
  date: string,
): ProductNorm | undefined {
  return norms
    .filter(
      (n) =>
        n.product_id === productId &&
        n.operation === operation &&
        n.valid_from <= date &&
        (n.valid_to === null || n.valid_to >= date),
    )
    .sort((a, b) => b.valid_from.localeCompare(a.valid_from))[0];
}

export function currentNorm(norms: ProductNorm[], productId: string, operation: "HA" | "TUP") {
  return normValidAt(norms, productId, operation, new Date().toISOString().slice(0, 10));
}

export function getNormHistory(
  norms: ProductNorm[],
  productId: string,
  operation: "HA" | "TUP",
): ProductNorm[] {
  return norms
    .filter((n) => n.product_id === productId && n.operation === operation)
    .sort((a, b) => a.valid_from.localeCompare(b.valid_from));
}

/** Přepočet výkonu při změně hodinové normy. */
export function recalculatePerformance(
  records: DailyRecord[],
  oldNorms: ProductNorm[],
  newNorm: number,
  productId: string,
  operation: "HA" | "TUP",
): { recordId: string; newPerformance: number }[] {
  const result: { recordId: string; newPerformance: number }[] = [];
  for (const record of records) {
    const oldNormAtDate = normValidAt(oldNorms, productId, operation, record.work_date);
    if (!oldNormAtDate || newNorm >= oldNormAtDate.norm_per_hour) continue;
    if (record.performance === null || record.performance === undefined) continue;
    if (record.available_time === null || record.available_time === undefined || record.available_time <= 0) continue;
    const newPerformance = record.performance * (newNorm / oldNormAtDate.norm_per_hour);
    result.push({ recordId: record.id, newPerformance: Math.round(newPerformance * 100) / 100 });
  }
  return result;
}

/**
 * Přepočítá výkon podle skutečného počtu operátorů.
 * Příklad: norma 100 ks/h pro 2 operátory, skutečně 1 operátor => efektivní norma 50 ks/h.
 */
export function adjustedNormForOperators(
  normPerHour: number,
  operatorsRequired: number,
  actualOperators: number,
): number {
  if (!Number.isFinite(normPerHour) || normPerHour <= 0) return normPerHour;
  if (!Number.isFinite(operatorsRequired) || operatorsRequired <= 0) return normPerHour;
  if (!Number.isFinite(actualOperators) || actualOperators <= 0) return 0;
  return normPerHour / operatorsRequired * actualOperators;
}

/**
 * Přepočítá výkon z původní normy na skutečný počet operátorů.
 * oldPerformance je výkon proti normě pro plný počet operátorů.
 */
export function recalculatePerformanceForEmployees(
  oldPerformance: number | null | undefined,
  operatorsRequired: number,
  actualOperators: number,
): number | null {
  if (oldPerformance === null || oldPerformance === undefined) return null;
  if (operatorsRequired <= 0 || actualOperators <= 0) return oldPerformance;
  const adjusted = oldPerformance * (operatorsRequired / actualOperators);
  return Math.round(adjusted * 100) / 100;
}

/**
 * Přepočítá OEE stejným poměrem jako výkon.
 * Pokud je OEE založené na výkonu proti plné normě, korekce na skutečný počet
 * operátorů je: OEE × (required / actual). Hodnota se neomezuje na 100 %.
 */
export function recalculateOeeForEmployees(
  records: DailyRecord[],
  employeesPerProduct: number,
  actualEmployeesByRecord?: Map<string, number>,
): { recordId: string; newOee: number }[] {
  const result: { recordId: string; newOee: number }[] = [];
  if (employeesPerProduct <= 0) return result;

  for (const record of records) {
    if (record.oee === null || record.oee === undefined) continue;
    const actualEmployees = actualEmployeesByRecord?.get(record.id) ?? 1;
    if (actualEmployees <= 0 || actualEmployees >= employeesPerProduct) continue;
    const newOee = record.oee * (employeesPerProduct / actualEmployees);
    result.push({ recordId: record.id, newOee: Math.round(newOee * 100) / 100 });
  }
  return result;
}
