export type Product = {
  id: string;
  code: string;
  name: string | null;
  active: boolean;
  first_seen_date: string;
  note: string | null;
  is_demo: boolean;
  created_at: string;
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
