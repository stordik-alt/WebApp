import type { Product, ProductNorm } from "./products";
import { supabase } from "@/integrations/supabase/client";

export type ProductProfile = {
  id: string;
  profile_name: string | null;
  ha_subassy: string | null;
  h_capacity: number | null;
  h_norm_per_hour: number | null;
  tup_subassy: string | null;
  t_capacity: number | null;
  t_norm_per_hour: number | null;
  valid_from: string;
  valid_to: string | null;
  version_no: number;
  created_at: string | null;
};

const normalizeCode = (value: string | null | undefined) => (value ?? "").trim().toLowerCase().replace(/\s+/g, "");

export function profileNorms(profiles: ProductProfile[], products: Product[], onlyValid = false): ProductNorm[] {
  const byCode = new Map(products.map((p) => [normalizeCode(p.code), p]));
  const today = new Date().toISOString().slice(0, 10);
  const out: ProductNorm[] = [];
  for (const profile of profiles) {
    if (onlyValid && (profile.valid_from > today || (profile.valid_to !== null && profile.valid_to < today))) continue;
    const createdAt = profile.created_at ?? `${profile.valid_from}T00:00:00.000Z`;
    const haProduct = profile.ha_subassy ? byCode.get(normalizeCode(profile.ha_subassy)) : undefined;
    const tupProduct = profile.tup_subassy ? byCode.get(normalizeCode(profile.tup_subassy)) : undefined;
    if (haProduct && profile.h_norm_per_hour != null) {
      out.push({
        id: `${profile.id}:HA`,
        product_id: haProduct.id,
        operation: "HA",
        norm_per_hour: Number(profile.h_norm_per_hour),
        valid_from: profile.valid_from,
        valid_to: profile.valid_to,
        source: "product_profile",
        confirmed: true,
        note: profile.profile_name,
        created_at: createdAt,
      });
    }
    if (tupProduct && profile.t_norm_per_hour != null) {
      out.push({
        id: `${profile.id}:TUP`,
        product_id: tupProduct.id,
        operation: "TUP",
        norm_per_hour: Number(profile.t_norm_per_hour),
        valid_from: profile.valid_from,
        valid_to: profile.valid_to,
        source: "product_profile",
        confirmed: true,
        note: profile.profile_name,
        created_at: createdAt,
      });
    }
  }
  return out;
}

export async function applyProductProfileNorms(input: {
  productId: string;
  haNorm?: number | null;
  tupNorm?: number | null;
  validFrom: string;
  note?: string | null;
}) {
  const { data: product, error: productError } = await supabase.from("products").select("id,code,name,employees_per_product").eq("id", input.productId).maybeSingle();
  if (productError) throw productError;
  if (!product) throw new Error("Produkt pro přeměření nebyl nalezen.");

  const code = normalizeCode(product.code);
  const { data: current, error: profileError } = await (supabase.from("product_profiles") as any)
    .select("*")
    .is("valid_to", null)
    .or(`ha_subassy.eq.${code},tup_subassy.eq.${code}`)
    .order("valid_from", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (profileError) throw profileError;
  if (!current) throw new Error(`Pro produkt ${product.code} neexistuje Product Profile.`);

  const nextHa = input.haNorm != null ? Number(input.haNorm) : Number(current.h_norm_per_hour);
  const nextTup = input.tupNorm != null ? Number(input.tupNorm) : Number(current.t_norm_per_hour);
  if (!Number.isFinite(nextHa) || nextHa <= 0 || !Number.isFinite(nextTup) || nextTup <= 0) {
    throw new Error("Nové normy musí být kladná čísla.");
  }

  const normalizedHa = normalizeCode(current.ha_subassy);
  const normalizedTup = normalizeCode(current.tup_subassy);
  if (code !== normalizedHa && code !== normalizedTup) throw new Error("Product Profile neobsahuje daný Product ID.");

  if (current.valid_from === input.validFrom) {
    const payload: Record<string, unknown> = {
      h_norm_per_hour: nextHa,
      t_norm_per_hour: nextTup,
    };
    const { error } = await (supabase.from("product_profiles") as any).update(payload).eq("id", current.id);
    if (error) throw error;
    return;
  }

  const previousDay = new Date(`${input.validFrom}T00:00:00Z`);
  previousDay.setUTCDate(previousDay.getUTCDate() - 1);
  const { error: closeError } = await (supabase.from("product_profiles") as any)
    .update({ valid_to: previousDay.toISOString().slice(0, 10) })
    .eq("id", current.id);
  if (closeError) throw closeError;

  const { error: insertError } = await (supabase.from("product_profiles") as any).insert({
    profile_name: current.profile_name,
    ha_subassy: current.ha_subassy,
    h_capacity: current.h_capacity,
    h_norm_per_hour: nextHa,
    tup_subassy: current.tup_subassy,
    t_capacity: current.t_capacity,
    t_norm_per_hour: nextTup,
    valid_from: input.validFrom,
    valid_to: null,
    version_no: Number(current.version_no ?? 1) + 1,
  });
  if (insertError) throw insertError;
}
