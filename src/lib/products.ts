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

/** Norma platná k danému datu – historická hodnocení musí používat normu platnou v období. */
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

/**
 * Získat historii norem pro produkt a operaci (seřazenou od nejstarší k nejnovější).
 */
export function getNormHistory(
  norms: ProductNorm[],
  productId: string,
  operation: "HA" | "TUP",
): ProductNorm[] {
  return norms
    .filter((n) => n.product_id === productId && n.operation === operation)
    .sort((a, b) => a.valid_from.localeCompare(b.valid_from));
}

/**
 * Přepočítat performance všech záznamů při změně normy.
 * Pokud se norma sníží: přepočítá všechny záznamy (performance * new_norm / old_norm_at_date).
 * Pokud se norma zvýší: zůstanou původní hodnoty (neměníme).
 * 
 * @param records Všechny denní záznamy
 * @param oldNorms Původní norma platná ke dni záznamu
 * @param newNorm Nová norma
 * @param productId ID produktu
 * @param operation Operace (HA/TUP)
 * @returns Pole { recordId, newPerformance } pro všechny změněné záznamy
 */
export function recalculatePerformance(
  records: DailyRecord[],
  oldNorms: ProductNorm[],
  newNorm: number,
  productId: string,
  operation: "HA" | "TUP",
): { recordId: string; newPerformance: number }[] {
  const result: { recordId: string; newPerformance: number }[] = [];

  for (const record of records) {
    // Zjistíme, jaká norma byla platná k datu záznamu
    const oldNormAtDate = normValidAt(oldNorms, productId, operation, record.work_date);
    if (!oldNormAtDate) continue; // Když neznáme starou normu, nepočítáme

    // Pokud se norma zvýšila nebo zůstala stejná, nepřepočítáváme
    if (newNorm >= oldNormAtDate.norm_per_hour) continue;

    // Pokud nemáme performance nebo available_time, nemůžeme přepočítávat
    if (record.performance === null || record.available_time === null) continue;
    if (record.performance === undefined || record.available_time === undefined) continue;
    if (record.available_time <= 0) continue;

    // Vzorec: new_performance = old_performance * (new_norm / old_norm_at_date)
    const newPerformance = record.performance * (newNorm / oldNormAtDate.norm_per_hour);
    result.push({ recordId: record.id, newPerformance: Math.round(newPerformance * 100) / 100 });
  }

  return result;
}

/**
 * Přepočítat OEE při změně počtu zaměstnanců.
 * Pokud je v záznamu méně zaměstnanců než employees_per_product, upraví OEE.
 * Vzorec: new_oee = old_oee * (actual_employees / employees_per_product)
 * 
 * @param records Všechny denní záznamy
 * @param employeesPerProduct Počet zaměstnanců pro produkt
 * @returns Pole { recordId, newOee } pro všechny změněné záznamy
 */
export function recalculateOeeForEmployees(
  records: DailyRecord[],
  employeesPerProduct: number,
): { recordId: string; newOee: number }[] {
  const result: { recordId: string; newOee: number }[] = [];

  if (employeesPerProduct <= 0) return result;

  for (const record of records) {
    // Pokud nemáme OEE, nepočítáme
    if (record.oee === null || record.oee === undefined) continue;

    // Počet zaměstnanců z linky (počet unikátních employee_id pro daný záznam)
    const actualEmployees = 1; // Každý daily_record je pro 1 zaměstnance

    // Pokud je zaměstnanců méně nežEmployeesPerProduct, přepočítáme OEE
    if (actualEmployees < employeesPerProduct) {
      const newOee = record.oee * (actualEmployees / employeesPerProduct);
      result.push({ recordId: record.id, newOee: Math.round(newOee * 100) / 100 });
    }
  }

  return result;
}
