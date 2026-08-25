import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ChevronDown, ChevronUp, Link2, Plus, Save, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useProductNorms, useProducts } from "@/lib/data";
import { useApprovalFields } from "@/lib/auth";
import { currentNorm, type Product } from "@/lib/products";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";

type Family = { id: string; name: string; h_product_id: string | null; t_product_id: string | null };
type ProfileDraft = { name: string; hCode: string; tCode: string; hNorm: string; tNorm: string; hCapacity: string; tCapacity: string };
const emptyForm: ProfileDraft = { name: "", hCode: "", tCode: "", hNorm: "", tNorm: "", hCapacity: "1", tCapacity: "1" };

export function ProductFamilyManager() {
  const qc = useQueryClient();
  const approval = useApprovalFields();
  const { data: products = [] } = useProducts();
  const { data: norms = [] } = useProductNorms();
  const [families, setFamilies] = useState<Family[]>([]);
  const [form, setForm] = useState<ProfileDraft>(emptyForm);
  const [editing, setEditing] = useState<Family | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const { data, error } = await (supabase.from("product_families") as any)
      .select("id,name,h_product_id,t_product_id")
      .order("name");
    if (error) {
      if (!/does not exist|relation/i.test(error.message)) toast.error(`Nepodařilo se načíst produktové profily: ${error.message}`);
      return;
    }
    setFamilies((data ?? []) as Family[]);
  };
  useEffect(() => { void load(); }, []);

  const productById = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const familyProductIds = useMemo(() => new Set(families.flatMap((f) => [f.h_product_id, f.t_product_id].filter(Boolean) as string[])), [families]);
  const standalone = useMemo(() => products.filter((p) => p.active && !familyProductIds.has(p.id)), [products, familyProductIds]);
  const findByCode = (code: string) => products.find((p) => p.code.trim().toLowerCase() === code.trim().toLowerCase());

  const reset = () => { setForm(emptyForm); setEditing(null); };

  const startEdit = (family: Family) => {
    const h = family.h_product_id ? productById.get(family.h_product_id) : undefined;
    const t = family.t_product_id ? productById.get(family.t_product_id) : undefined;
    const hn = h ? currentNorm(norms, h.id, "HA") : undefined;
    const tn = t ? currentNorm(norms, t.id, "TUP") : undefined;
    setEditing(family);
    setExpanded(family.id);
    setForm({
      name: family.name,
      hCode: h?.code ?? "",
      tCode: t?.code ?? "",
      hNorm: hn ? String(hn.norm_per_hour) : "",
      tNorm: tn ? String(tn.norm_per_hour) : "",
      hCapacity: String(h?.employees_per_product ?? 1),
      tCapacity: String(t?.employees_per_product ?? 1),
    });
  };

  const saveNorm = async (productId: string, operation: "HA" | "TUP", value: number, date: string) => {
    const current = currentNorm(norms, productId, operation);
    if (current && Number(current.norm_per_hour) === value) return;
    if (current) {
      const { error } = await supabase.from("product_norms").update({ valid_to: date }).eq("id", current.id);
      if (error) throw error;
    }
    const { error } = await supabase.from("product_norms").insert({
      product_id: productId,
      operation,
      norm_per_hour: value,
      valid_from: date,
      source: "product_family",
      confirmed: true,
      note: operation === "HA" ? "Norma H_ varianty celé HA linky" : "Norma T_ varianty",
      ...approval(),
    });
    if (error) throw error;
  };

  const saveFamily = async () => {
    const name = form.name.trim();
    const hCode = form.hCode.trim();
    const tCode = form.tCode.trim();
    const hNorm = Number(form.hNorm);
    const tNorm = Number(form.tNorm);
    const hCapacity = Number(form.hCapacity);
    const tCapacity = Number(form.tCapacity);
    if (!name) throw new Error("Zadejte název Product ID.");
    if (!/^H_/i.test(hCode)) throw new Error("H_ varianta musí začínat H_.");
    if (!/^T_/i.test(tCode)) throw new Error("T_ varianta musí začínat T_.");
    if (hCode.toLowerCase() === tCode.toLowerCase()) throw new Error("H_ a T_ varianta musí mít odlišný kód.");
    if (!Number.isFinite(hNorm) || hNorm <= 0 || !Number.isFinite(tNorm) || tNorm <= 0) throw new Error("Zadejte platnou normu pro H_ i T_.");
    if (!Number.isInteger(hCapacity) || hCapacity < 1 || !Number.isInteger(tCapacity) || tCapacity < 1) throw new Error("Kapacita H_ i T_ musí být celé číslo alespoň 1.");

    setBusy(true);
    try {
      const date = new Date().toISOString().slice(0, 10);
      let hProduct = findByCode(hCode);
      let tProduct = findByCode(tCode);
      const createProduct = async (code: string, capacity: number) => {
        const { data, error } = await supabase.from("products").insert({ code, name, employees_per_product: capacity, first_seen_date: date, ...approval() }).select("*").single();
        if (error) throw error;
        return data as Product;
      };
      if (!hProduct) hProduct = await createProduct(hCode, hCapacity);
      if (!tProduct) tProduct = await createProduct(tCode, tCapacity);
      if (hProduct.id === tProduct.id) throw new Error("H_ a T_ nesmí odkazovat na stejný produkt.");

      let familyId = editing?.id;
      if (familyId) {
        const { error } = await (supabase.from("product_families") as any).update({ name, h_product_id: hProduct.id, t_product_id: tProduct.id }).eq("id", familyId);
        if (error) throw error;
      } else {
        const { data, error } = await (supabase.from("product_families") as any).insert({ name, h_product_id: hProduct.id, t_product_id: tProduct.id }).select("id").single();
        if (error) throw error;
        familyId = data.id;
      }

      const { error: hError } = await (supabase.from("products") as any).update({ code: hCode, family_id: familyId, variant_type: "H", name, employees_per_product: hCapacity }).eq("id", hProduct.id);
      if (hError) throw hError;
      const { error: tError } = await (supabase.from("products") as any).update({ code: tCode, family_id: familyId, variant_type: "T", name, employees_per_product: tCapacity }).eq("id", tProduct.id);
      if (tError) throw tError;

      await saveNorm(hProduct.id, "HA", hNorm, date);
      await saveNorm(tProduct.id, "TUP", tNorm, date);
      await (supabase.from("product_relationships") as any).delete().eq("target_product_id", tProduct.id).eq("relationship_type", "HA_TO_TUP");
      const { error: linkError } = await (supabase.from("product_relationships") as any).insert({ source_product_id: hProduct.id, target_product_id: tProduct.id, relationship_type: "HA_TO_TUP", ...approval() });
      if (linkError && !/duplicate/i.test(linkError.message)) throw linkError;

      await load();
      qc.invalidateQueries({ queryKey: ["products"] });
      qc.invalidateQueries({ queryKey: ["product_norms"] });
      toast.success(editing ? "Profil Product ID byl upraven." : "Profil Product ID byl založen.");
      reset();
    } finally {
      setBusy(false);
    }
  };

  const remove = async (family: Family) => {
    if (!window.confirm(`Opravdu odstranit profil „${family.name}"? H_ a T_ produkty zůstanou zachované.`)) return;
    const { error } = await (supabase.from("product_families") as any).delete().eq("id", family.id);
    if (error) { toast.error(error.message); return; }
    await load();
    qc.invalidateQueries({ queryKey: ["products"] });
    toast.success("Profil odstraněn. Produkty zůstaly zachované.");
  };

  const toggle = (id: string) => setExpanded((current) => current === id ? null : id);

  return <Card className="min-w-0 overflow-hidden p-4 sm:p-5">
    <div className="mb-4 flex items-center gap-2">
      <Link2 className="h-4 w-4" />
      <div><h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Product ID – profily</h2><p className="text-xs text-muted-foreground">Každé Product ID lze rozkliknout. Uvnitř jsou samostatně H_ a T_ norma i kapacita.</p></div>
    </div>

    <div className="mb-4 rounded-xl border bg-muted/20 p-4">
      <div className="mb-3 text-sm font-semibold">Nové Product ID</div>
      <div className="grid gap-3 lg:grid-cols-6">
        <div className="grid gap-1.5 lg:col-span-2"><Label>Název</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Např. Sestava 4962V3596B" /></div>
        <div className="grid gap-1.5"><Label>H_ Product ID</Label><Input value={form.hCode} onChange={(e) => setForm({ ...form, hCode: e.target.value })} placeholder="H_..." /></div>
        <div className="grid gap-1.5"><Label>T_ Product ID</Label><Input value={form.tCode} onChange={(e) => setForm({ ...form, tCode: e.target.value })} placeholder="T_..." /></div>
        <div className="grid gap-1.5"><Label>Norma H_</Label><Input type="number" step="0.1" value={form.hNorm} onChange={(e) => setForm({ ...form, hNorm: e.target.value })} placeholder="ks/h" /></div>
        <div className="grid gap-1.5"><Label>Norma T_</Label><Input type="number" step="0.1" value={form.tNorm} onChange={(e) => setForm({ ...form, tNorm: e.target.value })} placeholder="ks/h" /></div>
        <div className="grid gap-1.5"><Label>Kapacita H_</Label><Input type="number" min="1" value={form.hCapacity} onChange={(e) => setForm({ ...form, hCapacity: e.target.value })} /></div>
        <div className="grid gap-1.5"><Label>Kapacita T_</Label><Input type="number" min="1" value={form.tCapacity} onChange={(e) => setForm({ ...form, tCapacity: e.target.value })} /></div>
        <div className="flex items-end gap-2 lg:col-span-6"><Button disabled={busy} onClick={() => void saveFamily().catch((e: Error) => toast.error(e.message))}><Plus className="h-4 w-4" /> Založit Product ID</Button>{editing && <Button variant="outline" onClick={reset}>Zrušit úpravu</Button>}</div>
      </div>
    </div>

    <div className="grid gap-2">
      {families.map((family) => {
        const h = family.h_product_id ? productById.get(family.h_product_id) : undefined;
        const t = family.t_product_id ? productById.get(family.t_product_id) : undefined;
        const open = expanded === family.id;
        const hNorm = h ? currentNorm(norms, h.id, "HA") : undefined;
        const tNorm = t ? currentNorm(norms, t.id, "TUP") : undefined;
        return <div key={family.id} className="overflow-hidden rounded-xl border">
          <button type="button" className="flex w-full items-center justify-between gap-3 p-4 text-left hover:bg-muted/30" onClick={() => toggle(family.id)}>
            <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><span className="font-semibold">{family.name}</span><Badge variant="outline">Product ID</Badge></div><div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground"><span>H_: {h?.code ?? "–"}</span><span>T_: {t?.code ?? "–"}</span><span>H kap.: {h?.employees_per_product ?? "–"}</span><span>T kap.: {t?.employees_per_product ?? "–"}</span></div></div>{open ? <ChevronUp className="h-4 w-4 shrink-0" /> : <ChevronDown className="h-4 w-4 shrink-0" />}</button>
          {open && <div className="border-t bg-muted/10 p-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="rounded-lg border bg-background p-4"><div className="mb-3 flex items-center justify-between"><div className="font-semibold">H_ varianta</div><Badge>HA</Badge></div><div className="grid gap-3"><div><Label>Product ID</Label><Input value={h?.code ?? "–"} readOnly /></div><div><Label>Norma ks/h</Label><Input value={hNorm ? String(hNorm.norm_per_hour) : "–"} readOnly /></div><div><Label>Kapacita operátorů</Label><Input value={String(h?.employees_per_product ?? "–")} readOnly /></div></div></div>
              <div className="rounded-lg border bg-background p-4"><div className="mb-3 flex items-center justify-between"><div className="font-semibold">T_ varianta</div><Badge variant="secondary">TUP</Badge></div><div className="grid gap-3"><div><Label>Product ID</Label><Input value={t?.code ?? "–"} readOnly /></div><div><Label>Norma ks/h</Label><Input value={tNorm ? String(tNorm.norm_per_hour) : "–"} readOnly /></div><div><Label>Kapacita operátorů</Label><Input value={String(t?.employees_per_product ?? "–")} readOnly /></div></div></div>
            </div>
            <div className="mt-4 flex flex-wrap gap-2"><Button variant="outline" onClick={() => startEdit(family)}><Pencil className="mr-1 h-4 w-4" /> Upravit profil</Button><Button variant="ghost" onClick={() => void remove(family)}><Trash2 className="mr-1 h-4 w-4" /> Odstranit profil</Button></div>
          </div>}
        </div>;
      })}
      {standalone.map((product) => {
        const open = expanded === `product:${product.id}`;
        const operation = /^T_/i.test(product.code) ? "TUP" : "HA";
        const norm = currentNorm(norms, product.id, operation);
        return <div key={product.id} className="overflow-hidden rounded-xl border border-dashed">
          <button type="button" className="flex w-full items-center justify-between gap-3 p-4 text-left hover:bg-muted/30" onClick={() => toggle(`product:${product.id}`)}>
            <div><div className="flex flex-wrap items-center gap-2"><span className="font-semibold">{product.name || product.code}</span><Badge variant="outline">Samostatný produkt</Badge></div><div className="mt-1 text-xs text-muted-foreground">{product.code} · kapacita {product.employees_per_product} · norma {norm?.norm_per_hour ?? "–"} ks/h</div></div>{open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}</button>
          {open && <div className="border-t bg-muted/10 p-4"><div className="grid gap-3 sm:grid-cols-3"><div><Label>Product ID</Label><Input value={product.code} readOnly /></div><div><Label>Norma ks/h</Label><Input value={norm ? String(norm.norm_per_hour) : "–"} readOnly /></div><div><Label>Kapacita operátorů</Label><Input value={String(product.employees_per_product)} readOnly /></div></div><p className="mt-3 text-xs text-muted-foreground">Tento produkt zatím není propojený do H_/T_ profilu. Pro vytvoření společného profilu použijte „Nové Product ID“ nahoře.</p></div>}
        </div>;
      })}
      {!families.length && !standalone.length && <div className="rounded-lg border p-4 text-sm text-muted-foreground">Zatím nejsou založená žádná Product ID.</div>}
    </div>
  </Card>;
}
