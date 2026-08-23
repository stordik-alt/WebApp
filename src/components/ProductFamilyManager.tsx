import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Link2, Pencil, Plus, Save, Trash2 } from "lucide-react";
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
const emptyForm = { name: "", hCode: "", tCode: "", hNorm: "", tNorm: "", capacity: "1" };

export function ProductFamilyManager() {
  const qc = useQueryClient(); const approval = useApprovalFields();
  const { data: products = [] } = useProducts(); const { data: norms = [] } = useProductNorms();
  const [families, setFamilies] = useState<Family[]>([]); const [form, setForm] = useState(emptyForm); const [editing, setEditing] = useState<Family | null>(null); const [busy, setBusy] = useState(false);
  const load = async () => { const { data, error } = await (supabase.from("product_families") as any).select("id,name,h_product_id,t_product_id").order("name"); if (error) { if (!/does not exist|relation/i.test(error.message)) toast.error(`Nepodařilo se načíst produktové rodiny: ${error.message}`); return; } setFamilies((data ?? []) as Family[]); };
  useEffect(() => { void load(); }, []);
  const productById = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const available = useMemo(() => products.filter((p) => p.active), [products]);
  const reset = () => { setForm(emptyForm); setEditing(null); };
  const findByCode = (code: string) => products.find((p) => p.code.trim().toLowerCase() === code.trim().toLowerCase());

  const saveFamily = async () => {
    const name = form.name.trim(), hCode = form.hCode.trim(), tCode = form.tCode.trim(), hNorm = Number(form.hNorm), tNorm = Number(form.tNorm), capacity = Number(form.capacity);
    if (!name) throw new Error("Zadejte název Produkt ID."); if (!/^H_/i.test(hCode)) throw new Error("H_ varianta je povinná a musí začínat H_."); if (!/^T_/i.test(tCode)) throw new Error("T_ varianta je povinná a musí začínat T_.");
    if (!Number.isFinite(hNorm) || hNorm <= 0 || !Number.isFinite(tNorm) || tNorm <= 0) throw new Error("Zadejte platnou normu H_ i T_."); if (!Number.isInteger(capacity) || capacity < 1) throw new Error("Kapacita musí být celé číslo alespoň 1."); if (hCode.toLowerCase() === tCode.toLowerCase()) throw new Error("H_ a T_ varianta musí mít odlišný kód.");
    setBusy(true);
    try {
      let hProduct = findByCode(hCode); let tProduct = findByCode(tCode); const date = new Date().toISOString().slice(0, 10);
      const createProduct = async (code: string) => { const { data, error } = await supabase.from("products").insert({ code, name, employees_per_product: capacity, first_seen_date: date, ...approval() }).select("*").single(); if (error) throw error; return data as Product; };
      if (!hProduct) hProduct = await createProduct(hCode); if (!tProduct) tProduct = await createProduct(tCode); if (hProduct.id === tProduct.id) throw new Error("H_ a T_ nesmí odkazovat na stejný produkt.");
      let familyId = editing?.id;
      if (familyId) { const { error } = await (supabase.from("product_families") as any).update({ name, h_product_id: hProduct.id, t_product_id: tProduct.id }).eq("id", familyId); if (error) throw error; }
      else { const { data, error } = await (supabase.from("product_families") as any).insert({ name, h_product_id: hProduct.id, t_product_id: tProduct.id }).select("id").single(); if (error) throw error; familyId = data.id; }
      const { error: hp } = await (supabase.from("products") as any).update({ family_id: familyId, variant_type: "H", name, employees_per_product: capacity }).eq("id", hProduct.id); if (hp) throw hp;
      const { error: tp } = await (supabase.from("products") as any).update({ family_id: familyId, variant_type: "T", name, employees_per_product: capacity }).eq("id", tProduct.id); if (tp) throw tp;
      const saveNorm = async (productId: string, operation: "HA" | "TUP", value: number) => { const current = currentNorm(norms, productId, operation); if (current && Number(current.norm_per_hour) === value) return; if (current) { const { error } = await supabase.from("product_norms").update({ valid_to: date }).eq("id", current.id); if (error) throw error; } const { error } = await supabase.from("product_norms").insert({ product_id: productId, operation, norm_per_hour: value, valid_from: date, source: "product_family", confirmed: true, note: operation === "HA" ? "Norma H_ varianty celé HA linky" : "Norma T_ varianty", ...approval() }); if (error) throw error; };
      await saveNorm(hProduct.id, "HA", hNorm); await saveNorm(tProduct.id, "TUP", tNorm);
      await (supabase.from("product_relationships") as any).delete().eq("target_product_id", tProduct.id).eq("relationship_type", "HA_TO_TUP");
      const { error: linkError } = await (supabase.from("product_relationships") as any).insert({ source_product_id: hProduct.id, target_product_id: tProduct.id, relationship_type: "HA_TO_TUP", ...approval() }); if (linkError && !/duplicate/i.test(linkError.message)) throw linkError;
      await load(); qc.invalidateQueries({ queryKey: ["products"] }); qc.invalidateQueries({ queryKey: ["product_norms"] }); toast.success(editing ? "Produktová rodina byla upravena." : "Produktová rodina byla založena."); reset();
    } finally { setBusy(false); }
  };

  const startEdit = (family: Family) => { const h = family.h_product_id ? productById.get(family.h_product_id) : undefined; const t = family.t_product_id ? productById.get(family.t_product_id) : undefined; const hn = h ? currentNorm(norms, h.id, "HA") : undefined; const tn = t ? currentNorm(norms, t.id, "TUP") : undefined; setEditing(family); setForm({ name: family.name, hCode: h?.code ?? "", tCode: t?.code ?? "", hNorm: hn ? String(hn.norm_per_hour) : "", tNorm: tn ? String(tn.norm_per_hour) : "", capacity: String(h?.employees_per_product ?? t?.employees_per_product ?? 1) }); };
  const remove = async (family: Family) => { if (!window.confirm(`Opravdu odstranit produktovou rodinu „${family.name}"? Produkty zůstanou zachované.`)) return; const { error } = await (supabase.from("product_families") as any).delete().eq("id", family.id); if (error) { toast.error(error.message); return; } await load(); qc.invalidateQueries({ queryKey: ["products"] }); toast.success("Produktová rodina byla odstraněna. Produkty zůstaly zachované."); };

  return <Card className="min-w-0 overflow-hidden p-4 sm:p-5">
    <div className="mb-4 flex items-center gap-2"><Link2 className="h-4 w-4" /><div><h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Produktové ID – H_ / T_ varianty</h2><p className="text-xs text-muted-foreground">Jeden produkt má společné ID a samostatný H_ a T_ kód i normu.</p></div></div>
    <div className="grid gap-3 rounded-xl border bg-muted/20 p-4 lg:grid-cols-6">
      <div className="grid gap-1.5 lg:col-span-2"><Label>Název Produkt ID</Label><Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Např. Sestava 4962V3596B" /></div><div className="grid gap-1.5"><Label>H_ verze</Label><Input value={form.hCode} onChange={e => setForm({ ...form, hCode: e.target.value })} placeholder="H_..." /></div><div className="grid gap-1.5"><Label>Norma H_</Label><Input type="number" step="0.1" value={form.hNorm} onChange={e => setForm({ ...form, hNorm: e.target.value })} placeholder="ks/h" /></div><div className="grid gap-1.5"><Label>T_ verze</Label><Input value={form.tCode} onChange={e => setForm({ ...form, tCode: e.target.value })} placeholder="T_..." /></div><div className="grid gap-1.5"><Label>Norma T_</Label><Input type="number" step="0.1" value={form.tNorm} onChange={e => setForm({ ...form, tNorm: e.target.value })} placeholder="ks/h" /></div><div className="grid gap-1.5"><Label>Kapacita</Label><Input type="number" min="1" value={form.capacity} onChange={e => setForm({ ...form, capacity: e.target.value })} /></div>
      <div className="flex flex-wrap items-end gap-2 lg:col-span-6"><Button disabled={busy} onClick={() => void saveFamily().catch((e: Error) => toast.error(e.message))}>{editing ? <Save className="h-4 w-4" /> : <Plus className="h-4 w-4" />}{editing ? " Uložit změny" : " Založit Produkt ID"}</Button>{editing && <Button variant="outline" onClick={reset}>Zrušit</Button>}</div>
    </div>
    <div className="mt-4 grid gap-2">{families.length === 0 ? <div className="rounded-lg border p-4 text-sm text-muted-foreground">Zatím nejsou založené žádné Produkt ID. Po aplikaci SQL migrace je můžete vytvářet zde.</div> : families.map(f => { const h = f.h_product_id ? productById.get(f.h_product_id) : undefined; const t = f.t_product_id ? productById.get(f.t_product_id) : undefined; return <div key={f.id} className="grid gap-3 rounded-lg border p-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"><div><div className="flex flex-wrap items-center gap-2"><span className="font-semibold">{f.name}</span><Badge variant="outline">ID {f.id.slice(0, 8)}</Badge></div><div className="mt-1 flex flex-wrap gap-2 text-xs text-muted-foreground"><span>H_: {h?.code ?? "–"}</span><span>T_: {t?.code ?? "–"}</span><span>Kapacita: {h?.employees_per_product ?? t?.employees_per_product ?? "–"}</span></div></div><div className="flex gap-2"><Button variant="outline" size="sm" onClick={() => startEdit(f)}><Pencil className="mr-1 h-4 w-4" /> Upravit</Button><Button variant="ghost" size="sm" onClick={() => void remove(f)}><Trash2 className="h-4 w-4" /></Button></div></div>; })}</div>
    {available.length > 0 && families.length === 0 ? <p className="mt-3 text-[11px] text-muted-foreground">Existující produkty se automaticky nemažou ani nepřepisují. Nové Produkt ID je bezpečně propojí přes jejich H_/T_ kódy.</p> : null}
  </Card>;
}
