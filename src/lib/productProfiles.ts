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
      out.push({ id: `${profile.id}:HA`, product_id: haProduct.id, operation: "HA", norm_per_hour: Number(profile.h_norm_per_hour), valid_from: profile.valid_from, valid_to: profile.valid_to, source: "product_profile", confirmed: true, note: profile.profile_name, created_at: createdAt });
    }
    if (tupProduct && profile.t_norm_per_hour != null) {
      out.push({ id: `${profile.id}:TUP`, product_id: tupProduct.id, operation: "TUP", norm_per_hour: Number(profile.t_norm_per_hour), valid_from: profile.valid_from, valid_to: profile.valid_to, source: "product_profile", confirmed: true, note: profile.profile_name, created_at: createdAt });
    }
  }
  return out;
}

type ImportedProfileSide = { code: string; norm: number; capacity: number };

export async function upsertImportedProductProfile(input: {
  profileName?: string | null;
  ha?: ImportedProfileSide;
  tup?: ImportedProfileSide;
  validFrom: string;
}) {
  if (!input.ha && !input.tup) throw new Error("Importovaný Product Profile nemá HA ani TUP Product ID.");
  for (const side of [input.ha, input.tup]) {
    if (!side) continue;
    if (!side.code.trim()) throw new Error("Product ID v Product Profile nesmí být prázdné.");
    if (!Number.isFinite(side.norm) || side.norm <= 0) throw new Error(`Norma pro ${side.code} musí být kladné číslo.`);
    if (!Number.isInteger(side.capacity) || side.capacity < 1) throw new Error(`Kapacita pro ${side.code} musí být celé číslo alespoň 1.`);
  }

  const { data: profiles, error: profileError } = await (supabase.from("product_profiles") as any)
    .select("*")
    .is("valid_to", null)
    .order("valid_from", { ascending: false });
  if (profileError) throw profileError;

  const haCode = input.ha?.code;
  const tupCode = input.tup?.code;
  const wantedHa = normalizeCode(haCode);
  const wantedTup = normalizeCode(tupCode);
  const current = (profiles ?? []).find((profile: ProductProfile) => {
    const ph = normalizeCode(profile.ha_subassy);
    const pt = normalizeCode(profile.tup_subassy);
    if (wantedHa && wantedTup) return ph === wantedHa && pt === wantedTup;
    const wanted = wantedHa || wantedTup;
    return !!wanted && (ph === wanted || pt === wanted);
  }) as ProductProfile | undefined;

  const payload = {
    profile_name: input.profileName?.trim() || current?.profile_name || input.ha?.code || input.tup?.code || null,
    ha_subassy: input.ha?.code ?? current?.ha_subassy ?? null,
    h_capacity: input.ha?.capacity ?? current?.h_capacity ?? null,
    h_norm_per_hour: input.ha?.norm ?? current?.h_norm_per_hour ?? null,
    tup_subassy: input.tup?.code ?? current?.tup_subassy ?? null,
    t_capacity: input.tup?.capacity ?? current?.t_capacity ?? null,
    t_norm_per_hour: input.tup?.norm ?? current?.t_norm_per_hour ?? null,
  };

  if (current?.valid_from === input.validFrom) {
    const { error } = await (supabase.from("product_profiles") as any).update(payload).eq("id", current.id);
    if (error) throw error;
    return current.id;
  }

  if (current && current.valid_to == null) {
    const previousDay = new Date(`${input.validFrom}T00:00:00Z`);
    previousDay.setUTCDate(previousDay.getUTCDate() - 1);
    const { error } = await (supabase.from("product_profiles") as any)
      .update({ valid_to: previousDay.toISOString().slice(0, 10) })
      .eq("id", current.id);
    if (error) throw error;
  }

  const versionNo = current ? Number(current.version_no ?? 1) + 1 : 1;
  const { data, error } = await (supabase.from("product_profiles") as any)
    .insert({ ...payload, valid_from: input.validFrom, valid_to: null, version_no: versionNo })
    .select("id")
    .maybeSingle();
  if (error) throw error;
  if (!data?.id) {
    throw new Error("Product Profile byl uložen, ale databáze nevrátila jeho ID. Zkontrolujte oprávnění SELECT pro product_profiles.");
  }
  return String(data.id);
}

export async function applyProductProfileNorms(input: { productId: string; haNorm?: number | null; tupNorm?: number | null; validFrom: string; note?: string | null }) {
  const { data: product, error: productError } = await supabase.from("products").select("id,code,name,employees_per_product").eq("id", input.productId).maybeSingle();
  if (productError) throw productError;
  if (!product) throw new Error("Produkt pro přeměření nebyl nalezen.");

  const wantedCode = normalizeCode(product.code);
  const { data: candidates, error: profileError } = await (supabase.from("product_profiles") as any).select("*").is("valid_to", null).order("valid_from", { ascending: false });
  if (profileError) throw profileError;
  const current = (candidates ?? []).find((profile: ProductProfile) => normalizeCode(profile.ha_subassy) === wantedCode || normalizeCode(profile.tup_subassy) === wantedCode);
  if (!current) throw new Error(`Pro produkt ${product.code} neexistuje Product Profile.`);

  const nextHa = input.haNorm != null ? Number(input.haNorm) : Number(current.h_norm_per_hour);
  const nextTup = input.tupNorm != null ? Number(input.tupNorm) : Number(current.t_norm_per_hour);
  if (!Number.isFinite(nextHa) || nextHa <= 0 || !Number.isFinite(nextTup) || nextTup <= 0) throw new Error("Nové normy musí být kladná čísla.");

  if (current.valid_from === input.validFrom) {
    const { error } = await (supabase.from("product_profiles") as any).update({ h_norm_per_hour: nextHa, t_norm_per_hour: nextTup }).eq("id", current.id);
    if (error) throw error;
    return;
  }

  const previousDay = new Date(`${input.validFrom}T00:00:00Z`);
  previousDay.setUTCDate(previousDay.getUTCDate() - 1);
  const { error: closeError } = await (supabase.from("product_profiles") as any).update({ valid_to: previousDay.toISOString().slice(0, 10) }).eq("id", current.id);
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