import { supabase } from "@/integrations/supabase/client";

export type ProductVariantType = "H" | "T";

export type ProductFamily = {
  id: string;
  name: string;
  h_product_id: string | null;
  t_product_id: string | null;
  created_at: string;
  updated_at: string;
};

export type ProductVariant = {
  id: string;
  code: string;
  name: string | null;
  family_id: string | null;
  variant_type: ProductVariantType | null;
};

export async function getProductFamily(productId: string) {
  const { data, error } = await supabase
    .from("product_families")
    .select("*")
    .or(`h_product_id.eq.${productId},t_product_id.eq.${productId}`)
    .maybeSingle();
  if (error) throw error;
  return data as ProductFamily | null;
}

export async function createProductFamily(input: {
  name: string;
  hProductCode: string;
  tProductCode: string;
  hNorm?: number | null;
  tNorm?: number | null;
  employeesPerProduct?: number;
  approval?: Record<string, unknown>;
}) {
  const name = input.name.trim();
  const hCode = input.hProductCode.trim();
  const tCode = input.tProductCode.trim();
  if (!name) throw new Error("Název produktu je povinný.");
  if (!hCode) throw new Error("H_ verze produktu je povinná.");
  if (!tCode) throw new Error("T_ verze produktu je povinná.");
  if (hCode === tCode) throw new Error("H_ a T_ verze musí být odlišné.");

  const approval = input.approval ?? {};
  const capacity = input.employeesPerProduct ?? 1;
  if (!Number.isInteger(capacity) || capacity < 1) throw new Error("Počet operátorů musí být celé číslo alespoň 1.");

  const { data: family, error: familyError } = await supabase
    .from("product_families")
    .insert({ name })
    .select("*")
    .single();
  if (familyError) throw familyError;

  try {
    const { data: variants, error: variantsError } = await supabase
      .from("products")
      .insert([
        { code: hCode, name, family_id: family.id, variant_type: "H", employees_per_product: capacity, ...approval },
        { code: tCode, name, family_id: family.id, variant_type: "T", employees_per_product: capacity, ...approval },
      ])
      .select("id,code,name,family_id,variant_type");
    if (variantsError) throw variantsError;

    const h = variants?.find((p) => p.variant_type === "H");
    const t = variants?.find((p) => p.variant_type === "T");
    if (!h || !t) throw new Error("Nepodařilo se vytvořit H_ a T_ variantu produktu.");

    const { error: familyUpdateError } = await supabase
      .from("product_families")
      .update({ h_product_id: h.id, t_product_id: t.id })
      .eq("id", family.id);
    if (familyUpdateError) throw familyUpdateError;

    const norms = [];
    const validFrom = new Date().toISOString().slice(0, 10);
    if (input.hNorm != null) norms.push({ product_id: h.id, operation: "HA", norm_per_hour: input.hNorm, valid_from: validFrom, source: "manual", confirmed: true, ...approval });
    if (input.tNorm != null) norms.push({ product_id: t.id, operation: "TUP", norm_per_hour: input.tNorm, valid_from: validFrom, source: "manual", confirmed: true, ...approval });
    if (norms.length) {
      const { error: normError } = await supabase.from("product_norms").insert(norms);
      if (normError) throw normError;
    }

    return { family: { ...family, h_product_id: h.id, t_product_id: t.id } as ProductFamily, h, t };
  } catch (error) {
    await supabase.from("products").delete().eq("family_id", family.id);
    await supabase.from("product_families").delete().eq("id", family.id);
    throw error;
  }
}

export async function setProductVariant(familyId: string, variant: ProductVariantType, productId: string) {
  const column = variant === "H" ? "h_product_id" : "t_product_id";
  const otherColumn = variant === "H" ? "t_product_id" : "h_product_id";
  const { data: family, error } = await supabase.from("product_families").select("*").eq("id", familyId).single();
  if (error) throw error;
  if (family[otherColumn] === productId) throw new Error("H_ a T_ varianta musí být odlišné produkty.");
  const { error: updateError } = await supabase.from("product_families").update({ [column]: productId }).eq("id", familyId);
  if (updateError) throw updateError;
  const { error: productError } = await supabase.from("products").update({ family_id: familyId, variant_type: variant }).eq("id", productId);
  if (productError) throw productError;
}
