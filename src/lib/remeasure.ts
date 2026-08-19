import type { DailyRecord } from "./metrics";
import { SHIFTS } from "./metrics";
import { avgValid } from "./shifts";

/** Cílová hranice splnění normy (zatím fixní 100 % OEE). */
export const OEE_TARGET = 100;
/** Počet po sobě jdoucích relevantních směn pod hranicí, který vyvolá návrh. */
export const STREAK_LENGTH = 3;

export type ProductShift = {
  product: string;
  work_date: string;
  shift: string;
  /** Průměrné OEE produktu za směnu (nejprve průměr přes linky pracovníka, pak přes pracovníky). */
  oee: number | null;
  lines: string[];
  employeeIds: string[];
};

export type RemeasureProposal = {
  product: string;
  product_id: string | null;
  /** Stabilní klíč trojice směn – brání vzniku duplicitních návrhů. */
  triggerKey: string;
  shifts: ProductShift[];
  avgOee: number;
};

export type NormRemeasurement = {
  id: string;
  product_id: string | null;
  product_code: string;
  trigger_key: string;
  shifts: ProductShift[];
  avg_oee: number | null;
  current_norm_ha: number | null;
  current_norm_tup: number | null;
  status: "pending" | "accepted" | "rejected";
  decided_at: string | null;
  decided_by: string | null;
  result_norm_ha: number | null;
  result_norm_tup: number | null;
  result_valid_from: string | null;
  result_note: string | null;
  confirmed_by: string | null;
  result_applied_at: string | null;
  created_at: string;
};

const shiftOrder = (s: string) => {
  const i = (SHIFTS as readonly string[]).indexOf(s);
  return i === -1 ? 99 : i;
};

/**
 * Relevantní směny produktu seřazené chronologicky.
 * Více linek jednoho pracovníka v jedné směně se nejdřív zprůměruje (žádné dvojí započítání).
 */
export function productShifts(records: DailyRecord[]): ProductShift[] {
  const byProductShift = new Map<string, DailyRecord[]>();
  for (const r of records) {
    const product = (r.product ?? "").trim();
    if (!product) continue;
    const k = `${product}|${r.work_date}|${r.shift}`;
    byProductShift.set(k, [...(byProductShift.get(k) ?? []), r]);
  }

  const out: ProductShift[] = [];
  for (const [, recs] of byProductShift) {
    const first = recs[0]!;
    const byEmployee = new Map<string, DailyRecord[]>();
    for (const r of recs) byEmployee.set(r.employee_id, [...(byEmployee.get(r.employee_id) ?? []), r]);
    const perEmployee = Array.from(byEmployee.values()).map((rs) => avgValid(rs.map((r) => r.oee)));
    out.push({
      product: (first.product ?? "").trim(),
      work_date: first.work_date,
      shift: first.shift,
      oee: avgValid(perEmployee),
      lines: Array.from(new Set(recs.map((r) => r.line).filter(Boolean))),
      employeeIds: Array.from(byEmployee.keys()),
    });
  }

  return out.sort(
    (a, b) =>
      a.work_date.localeCompare(b.work_date) ||
      shiftOrder(a.shift) - shiftOrder(b.shift) ||
      a.product.localeCompare(b.product),
  );
}

export const triggerKeyOf = (product: string, shifts: ProductShift[]) =>
  `${product.toLowerCase()}|${shifts.map((s) => `${s.work_date}#${s.shift}`).join("|")}`;

/**
 * Návrhy na přeměření: 3 po sobě jdoucí relevantní směny stejného produktu pod hranicí OEE.
 * Směny bez validního OEE se ignorují (nepočítají se ani jako nesplněné, ani nepřeruší řadu).
 * Každý produkt má vlastní posloupnost – jiný produkt mezi směnami ji nemíchá.
 */
export function detectRemeasureProposals(
  records: DailyRecord[],
  target = OEE_TARGET,
): RemeasureProposal[] {
  const all = productShifts(records);
  const byProduct = new Map<string, ProductShift[]>();
  for (const ps of all) {
    if (ps.oee === null) continue; // ignorováno pro tento test
    byProduct.set(ps.product, [...(byProduct.get(ps.product) ?? []), ps]);
  }

  const proposals: RemeasureProposal[] = [];
  for (const [product, shifts] of byProduct) {
    for (let i = 0; i + STREAK_LENGTH <= shifts.length; i++) {
      const win = shifts.slice(i, i + STREAK_LENGTH);
      if (!win.every((s) => (s.oee as number) < target)) continue;
      const productId =
        null as string | null;
      proposals.push({
        product,
        product_id: productId,
        triggerKey: triggerKeyOf(product, win),
        shifts: win,
        avgOee: win.reduce((a, s) => a + (s.oee as number), 0) / win.length,
      });
    }
  }
  return proposals;
}

/** Jen nejnovější návrh pro každý produkt, který ještě nemá záznam v databázi. */
export function newProposals(
  records: DailyRecord[],
  existing: { trigger_key: string; product_code: string; status: string }[],
  target = OEE_TARGET,
): RemeasureProposal[] {
  const keys = new Set(existing.map((e) => e.trigger_key));
  const openProducts = new Set(
    existing.filter((e) => e.status === "pending").map((e) => e.product_code.toLowerCase()),
  );
  const latestByProduct = new Map<string, RemeasureProposal>();
  for (const p of detectRemeasureProposals(records, target)) {
    if (keys.has(p.triggerKey)) continue;
    if (openProducts.has(p.product.toLowerCase())) continue;
    latestByProduct.set(p.product, p);
  }
  return Array.from(latestByProduct.values());
}
