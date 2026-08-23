import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, Link2, Pencil, Plus, Save, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useProductNorms, useProducts } from "@/lib/data";
import { currentNorm, getNormHistory, recalculatePerformance, recalculateOeeForEmployees, type Product } from "@/lib/products";
import { fmt } from "@/lib/metrics";
import { AppShell } from "@/components/AppShell";
import { ProductFamilyManager } from "@/components/ProductFamilyManager";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useApprovalFields } from "@/lib/auth";

export const Route = createFileRoute("/produkty")({
  head: () => ({ meta: [
    { title: "Produkty a normy – Výkonnost operátorů" },
    { name: "description", content: "Evidence výrobků a verzovaných hodinových norem HA/TUP s platností od–do a historií změn." },
    { property: "og:title", content: "Produkty a normy – Výkonnost operátorů" },
    { property: "og:description", content: "Verzované normy ks/h pro výrobky, HA norma platí pro celou linku." },
  ]}),
  component: ProductsPage,
});

type Relationship = { id: string; source_product_id: string; target_product_id: string; relationship_type: string };

function ProductsPage() {
  const qc = useQueryClient();
  const approval = useApprovalFields();
  const { data: products = [] } = useProducts();
  const { data: norms = [] } = useProductNorms();
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [selected, setSelected] = useState<Product | null>(null);
  const [editProduct, setEditProduct] = useState<Product | null>(null);
  const [operation, setOperation] = useState<"HA" | "TUP">("HA");
  const [normValue, setNormValue] = useState("");
  const [validFrom, setValidFrom] = useState(new Date().toISOString().slice(0, 10));
  const [employeesPerProduct, setEmployeesPerProduct] = useState("1");
  const [editCapacity, setEditCapacity] = useState("1");
  const [editHaNorm, setEditHaNorm] = useState("");
  const [editTupNorm, setEditTupNorm] = useState("");
  const [relationships, setRelationships] = useState<Relationship[]>([]);
  const [relationshipTarget, setRelationshipTarget] = useState("");
  const [relationshipSearch, setRelationshipSearch] = useState("");

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["products"] });
    qc.invalidateQueries({ queryKey: ["product_norms"] });
    qc.invalidateQueries({ queryKey: ["daily"] });
  };

  const loadRelationships = async (productId: string) => {
    const { data, error } = await (supabase.from("product_relationships") as any)
      .select("id,source_product_id,target_product_id,relationship_type")
      .or(`source_product_id.eq.${productId},target_product_id.eq.${productId}`);
    if (error) { toast.error(`Nepodařilo se načíst výrobní vazby: ${error.message}`); return; }
    setRelationships((data ?? []) as Relationship[]);
  };

  const startEdit = (p: Product) => {
    setEditProduct(p);
    window.requestAnimationFrame(() => document.getElementById("edit-product-card")?.scrollIntoView({ behavior: "smooth", block: "center" }));
    setEditCapacity(String(p.employees_per_product ?? 1));
    const ha = currentNorm(norms, p.id, "HA");
    const tup = currentNorm(norms, p.id, "TUP");
    setEditHaNorm(ha ? String(ha.norm_per_hour) : "");
    setEditTupNorm(tup ? String(tup.norm_per_hour) : "");
    setRelationshipTarget("");
    setRelationshipSearch("");
    void loadRelationships(p.id);
  };

  const addRelationship = useMutation({
    mutationFn: async () => {
      if (!editProduct || !relationshipTarget) throw new Error("Vyberte TUP produkt.");
      if (relationshipTarget === editProduct.id) throw new Error("Produkt nemůže být navázán sám na sebe.");
      const exists = relationships.some(r => r.source_product_id === editProduct.id && r.target_product_id === relationshipTarget && r.relationship_type === "HA_TO_TUP");
      if (exists) throw new Error("Tato vazba už existuje.");
      const { error } = await (supabase.from("product_relationships") as any).insert({ source_product_id: editProduct.id, target_product_id: relationshipTarget, relationship_type: "HA_TO_TUP", ...approval() });
      if (error) throw error;
    },
    onSuccess: () => { if (editProduct) void loadRelationships(editProduct.id); setRelationshipTarget(""); setRelationshipSearch(""); toast.success("Výrobní vazba byla přidána."); },
    onError: (e: Error) => toast.error(e.message),
  });

  const removeRelationship = useMutation({
    mutationFn: async (id: string) => { const { error } = await (supabase.from("product_relationships") as any).delete().eq("id", id); if (error) throw error; },
    onSuccess: () => { if (editProduct) void loadRelationships(editProduct.id); toast.success("Výrobní vazba byla odstraněna."); },
    onError: (e: Error) => toast.error(e.message),
  });

  const setTupParent = useMutation({
    mutationFn: async (haId: string) => {
      if (!editProduct) throw new Error("Vyberte produkt.");
      const { error: delError } = await (supabase.from("product_relationships") as any).delete().eq("target_product_id", editProduct.id).eq("relationship_type", "HA_TO_TUP");
      if (delError) throw delError;
      if (haId) {
        const { error } = await (supabase.from("product_relationships") as any).insert({ source_product_id: haId, target_product_id: editProduct.id, relationship_type: "HA_TO_TUP", ...approval() });
        if (error) throw error;
      }
    },
    onSuccess: () => { if (editProduct) void loadRelationships(editProduct.id); toast.success("Nadřazený HA produkt byl uložen."); },
    onError: (e: Error) => toast.error(e.message),
  });

  const addProduct = useMutation({
    mutationFn: async () => {
      const empNum = employeesPerProduct === "" ? 1 : Number(employeesPerProduct);
      if (!code.trim()) throw new Error("Zadejte kód produktu.");
      if (!Number.isInteger(empNum) || empNum < 1) throw new Error("Počet operátorů musí být celé číslo alespoň 1.");
      const { error } = await supabase.from("products").insert({ code: code.trim(), name: name.trim() || null, employees_per_product: empNum, ...approval() });
      if (error) throw error;
    },
    onSuccess: () => { invalidate(); setCode(""); setName(""); setEmployeesPerProduct("1"); toast.success("Produkt uložen"); },
    onError: (e: Error) => toast.error(e.message),
  });

  const toggleActive = useMutation({
    mutationFn: async (p: Product) => { const { error } = await supabase.from("products").update({ active: !p.active }).eq("id", p.id); if (error) throw error; },
    onSuccess: invalidate,
  });

  const updateProduct = useMutation({
    mutationFn: async () => {
      if (!editProduct) throw new Error("Vyberte produkt.");
      const capacity = Number(editCapacity);
      if (!Number.isInteger(capacity) || capacity < 1) throw new Error("Počet operátorů musí být celé číslo alespoň 1.");
      const oldCapacity = Number(editProduct.employees_per_product ?? 1);
      const { error: productError } = await supabase.from("products").update({ employees_per_product: capacity }).eq("id", editProduct.id);
      if (productError) throw productError;
      const updates: Array<{ operation: "HA" | "TUP"; value: string }> = [{ operation: "HA", value: editHaNorm }, { operation: "TUP", value: editTupNorm }];
      for (const item of updates) {
        if (item.value === "") continue;
        const value = Number(item.value);
        if (!Number.isFinite(value) || value <= 0) throw new Error(`Neplatná norma ${item.operation}.`);
        const current = currentNorm(norms, editProduct.id, item.operation);
        if (current && Number(current.norm_per_hour) === value) continue;
        if (current) { const { error } = await supabase.from("product_norms").update({ valid_to: validFrom }).eq("id", current.id); if (error) throw error; }
        const { error } = await supabase.from("product_norms").insert({ product_id: editProduct.id, operation: item.operation, norm_per_hour: value, valid_from: validFrom, source: "manual", confirmed: true, note: item.operation === "HA" ? "Norma celé HA linky" : null, ...approval() });
        if (error) throw error;
      }
      if (capacity !== oldCapacity) {
        const { data: dailyRecords } = await supabase.from("daily_records").select("id, oee, work_date, product_id").eq("product_id", editProduct.id).eq("approval_status", "approved");
        if (dailyRecords?.length) {
          const recalculations = recalculateOeeForEmployees(dailyRecords as unknown as import("@/lib/metrics").DailyRecord[], capacity);
          for (const { recordId, newOee } of recalculations) await supabase.from("daily_records").update({ oee: newOee }).eq("id", recordId);
          if (recalculations.length) toast.info(`Přepočítáno ${recalculations.length} OEE podle nové kapacity.`);
        }
      }
    },
    onSuccess: () => { invalidate(); setEditProduct(null); setRelationships([]); toast.success("Produkt, kapacita a normy byly upraveny."); },
    onError: (e: Error) => toast.error(e.message),
  });

  const existing = selected ? currentNorm(norms, selected.id, operation) : undefined;
  const normNum = normValue === "" ? null : Number(normValue);
  const isChange = !!existing && normNum !== null && Number(existing.norm_per_hour) !== normNum;

  const saveNorm = useMutation({
    mutationFn: async () => {
      if (!selected || normNum === null) throw new Error("Vyberte produkt a zadejte normu.");
      if (existing && Number(existing.norm_per_hour) === normNum) throw new Error("Stejná norma už platí – nová verze není potřeba.");
      const oldNormHistory = getNormHistory(norms, selected.id, operation);
      if (existing) { const { error } = await supabase.from("product_norms").update({ valid_to: validFrom }).eq("id", existing.id); if (error) throw error; }
      const { error } = await supabase.from("product_norms").insert({ product_id: selected.id, operation, norm_per_hour: normNum, valid_from: validFrom, source: "manual", confirmed: true, note: operation === "HA" ? "Norma celé HA linky" : null, ...approval() });
      if (error) throw error;
      const { data: productData } = await supabase.from("products").select("employees_per_product").eq("id", selected.id).single();
      const employees = productData?.employees_per_product ?? 1;
      if (oldNormHistory.length > 0 && normNum < oldNormHistory[0].norm_per_hour) {
        const { data: dailyRecords } = await supabase.from("daily_records").select("id, performance, available_time, work_date, product_id, oee").eq("product_id", selected.id).eq("approval_status", "approved");
        if (dailyRecords?.length) {
          const recalculations = recalculatePerformance(dailyRecords as unknown as import("@/lib/metrics").DailyRecord[], oldNormHistory, normNum, selected.id, operation);
          for (const { recordId, newPerformance } of recalculations) await supabase.from("daily_records").update({ performance: newPerformance }).eq("id", recordId);
          if (recalculations.length) toast.info(`Přepočítáno ${recalculations.length} záznamů kvůli snížení normy.`);
        }
      }
      if (employees > 1) {
        const { data: dailyRecords } = await supabase.from("daily_records").select("id, oee, work_date, product_id").eq("product_id", selected.id).eq("approval_status", "approved");
        if (dailyRecords?.length) {
          const recalculations = recalculateOeeForEmployees(dailyRecords as unknown as import("@/lib/metrics").DailyRecord[], employees);
          for (const { recordId, newOee } of recalculations) await supabase.from("daily_records").update({ oee: newOee }).eq("id", recordId);
        }
      }
    },
    onSuccess: () => { invalidate(); setNormValue(""); toast.success("Nová verze normy uložena, historie zachována."); },
    onError: (e: Error) => toast.error(e.message),
  });

  const relationshipProducts = products.filter(p => p.id !== editProduct?.id && `${p.code} ${p.name ?? ""}`.toLowerCase().includes(relationshipSearch.toLowerCase()));
  const outgoing = editProduct ? relationships.filter(r => r.source_product_id === editProduct.id && r.relationship_type === "HA_TO_TUP") : [];
  const incoming = editProduct ? relationships.filter(r => r.target_product_id === editProduct.id && r.relationship_type === "HA_TO_TUP") : [];
  const parentHa = incoming[0]?.source_product_id ?? "";

  return <AppShell title="Produkty a normy" subtitle="Normy se verzují podle platnosti. Norma HA platí pro celou linku, ne pro jednoho pracovníka.">
    <div className="grid min-w-0 gap-6">
      <ProductFamilyManager />
      <div className="grid min-w-0 grid-cols-1 gap-6 xl:grid-cols-[380px_1fr]">
        <div className="grid min-w-0 gap-6">
          <Card className="min-w-0 gap-3 overflow-hidden p-4 sm:p-5">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Nový produkt</h2>
            <div className="grid gap-1.5"><Label>Kód / název</Label><Input className="h-11" value={code} onChange={(e) => setCode(e.target.value)} /></div>
            <div className="grid gap-1.5"><Label>Popis</Label><Input className="h-11" value={name} onChange={(e) => setName(e.target.value)} /></div>
            <div className="grid gap-1.5"><Label>Zaměstnanci na produkt (počet operátorů na linku)</Label><Input type="number" min="1" className="h-11" value={employeesPerProduct} onChange={(e) => setEmployeesPerProduct(e.target.value)} /><p className="text-[10px] text-muted-foreground">Např. H_32346264-005 je určen pro 2 operátory.</p></div>
            <Button className="h-11" disabled={!code.trim() || addProduct.isPending} onClick={() => addProduct.mutate()}><Plus className="h-4 w-4" /> Přidat produkt</Button>
          </Card>
          <Card className="min-w-0 gap-3 overflow-hidden p-4 sm:p-5">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Nová verze normy</h2>
            <div className="grid gap-1.5"><Label>Produkt</Label><Select value={selected?.id ?? ""} onValueChange={(v) => setSelected(products.find((p) => p.id === v) ?? null)}><SelectTrigger className="h-11"><SelectValue placeholder="Vyberte produkt" /></SelectTrigger><SelectContent>{products.map((p) => <SelectItem key={p.id} value={p.id}>{p.code}</SelectItem>)}</SelectContent></Select></div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2"><div className="grid gap-1.5"><Label>Operace</Label><Select value={operation} onValueChange={(v) => setOperation(v as "HA" | "TUP")}><SelectTrigger className="h-11"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="HA">HA (celá linka)</SelectItem><SelectItem value="TUP">TUP</SelectItem></SelectContent></Select></div><div className="grid gap-1.5"><Label>Norma (ks/h)</Label><Input type="number" step="0.1" className="h-11" value={normValue} onChange={(e) => setNormValue(e.target.value)} /></div><div className="grid gap-1.5 sm:col-span-2"><Label>Platnost od</Label><Input type="date" className="h-11" value={validFrom} onChange={(e) => setValidFrom(e.target.value)} /></div></div>
            {isChange && existing ? <div className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm"><div className="flex items-center gap-2 font-semibold"><AlertTriangle className="h-4 w-4" /> Změna normy</div>{existing.norm_per_hour} ks/h → {normNum} ks/h. Původní verze zůstane v historii.</div> : null}
            <Button className="h-11" disabled={!selected || normValue === "" || saveNorm.isPending} onClick={() => saveNorm.mutate()}>Uložit verzi normy</Button>
          </Card>
          {editProduct ? <Card id="edit-product-card" className="min-w-0 gap-4 overflow-hidden p-4 sm:p-5">
            <div className="flex items-center justify-between gap-2"><h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Upravit produkt: {editProduct.code}</h2><Button variant="ghost" size="sm" onClick={() => { setEditProduct(null); setRelationships([]); }}>Zrušit</Button></div>
            <div className="grid gap-1.5"><Label>Kapacita / počet operátorů</Label><Input type="number" min="1" className="h-11" value={editCapacity} onChange={(e) => setEditCapacity(e.target.value)} /><p className="text-xs text-muted-foreground">Norma je vztažená k tomuto počtu operátorů.</p></div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2"><div className="grid gap-1.5"><Label>HA norma (ks/h)</Label><Input type="number" step="0.1" className="h-11" value={editHaNorm} onChange={(e) => setEditHaNorm(e.target.value)} /></div><div className="grid gap-1.5"><Label>TUP norma (ks/h)</Label><Input type="number" step="0.1" className="h-11" value={editTupNorm} onChange={(e) => setEditTupNorm(e.target.value)} /></div></div>
            <div className="grid gap-1.5"><Label>Platnost změny od</Label><Input type="date" className="h-11" value={validFrom} onChange={(e) => setValidFrom(e.target.value)} /></div>
            <div className="rounded-xl border bg-muted/20 p-4 space-y-4">
              <div className="flex items-center gap-2"><Link2 className="h-4 w-4" /><div><div className="font-semibold">Výrobní vazby HA → TUP</div><div className="text-xs text-muted-foreground">Vazba je podle ID produktu, takže změna názvu ji nerozbije.</div></div></div>
              <div className="grid gap-2"><Label>Navázané TUP produkty</Label>{outgoing.length === 0 ? <div className="text-sm text-muted-foreground">Zatím nejsou navázané žádné TUP produkty.</div> : outgoing.map(r => { const target = products.find(p => p.id === r.target_product_id); return <div key={r.id} className="flex items-center justify-between gap-2 rounded-lg border bg-background px-3 py-2"><span className="text-sm font-medium">{target?.code ?? r.target_product_id}</span><Button size="sm" variant="ghost" disabled={removeRelationship.isPending} onClick={() => removeRelationship.mutate(r.id)}><Trash2 className="h-4 w-4" /></Button></div>; })}</div>
              <div className="grid gap-2"><Label>Přidat TUP produkt</Label><Input placeholder="Hledat podle kódu nebo názvu…" value={relationshipSearch} onChange={e => setRelationshipSearch(e.target.value)} /><Select value={relationshipTarget} onValueChange={setRelationshipTarget}><SelectTrigger className="h-11"><SelectValue placeholder="Vyberte TUP produkt" /></SelectTrigger><SelectContent>{relationshipProducts.filter(p => !outgoing.some(r => r.target_product_id === p.id)).slice(0, 50).map(p => <SelectItem key={p.id} value={p.id}>{p.code}{p.name ? ` – ${p.name}` : ""}</SelectItem>)}</SelectContent></Select><Button variant="outline" disabled={!relationshipTarget || addRelationship.isPending} onClick={() => addRelationship.mutate()}><Plus className="h-4 w-4" /> Přidat vazbu</Button></div>
              <div className="grid gap-2 border-t pt-4"><Label>Nadřazený HA produkt tohoto produktu</Label><Select value={parentHa || "none"} onValueChange={v => setTupParent.mutate(v === "none" ? "" : v)}><SelectTrigger className="h-11"><SelectValue placeholder="Bez nadřazeného HA produktu" /></SelectTrigger><SelectContent><SelectItem value="none">Bez nadřazeného HA produktu</SelectItem>{products.filter(p => p.id !== editProduct.id).map(p => <SelectItem key={p.id} value={p.id}>{p.code}{p.name ? ` – ${p.name}` : ""}</SelectItem>)}</SelectContent></Select><p className="text-xs text-muted-foreground">U TUP produktu vyber nadřazený HA produkt. U HA produktu se zobrazují navázané TUP produkty.</p></div>
            </div>
            <Button className="h-11" disabled={updateProduct.isPending} onClick={() => updateProduct.mutate()}><Save className="h-4 w-4" /> Uložit změny</Button>
          </Card> : null}
        </div>
        <div className="grid min-w-0 gap-6">
          <div className="min-w-0 overflow-hidden rounded-lg border border-border bg-card"><div className="border-b border-border px-4 py-3 text-sm font-semibold">Produkty ({products.length})</div><div className="divide-y divide-border">{products.length === 0 ? <p className="p-4 text-sm text-muted-foreground">Zatím žádné produkty.</p> : products.map((p) => { const ha = currentNorm(norms, p.id, "HA"); const tup = currentNorm(norms, p.id, "TUP"); return <div key={p.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 p-3"><div className="min-w-0"><div className="truncate text-sm font-medium">{p.code} {p.name ? <span className="text-muted-foreground">– {p.name}</span> : null}</div><div className="mt-1 flex flex-wrap gap-1.5 text-[11px] text-muted-foreground"><Badge variant="secondary">HA: {ha ? `${fmt(ha.norm_per_hour, 0)} ks/h` : "–"}</Badge><Badge variant="secondary">TUP: {tup ? `${fmt(tup.norm_per_hour, 0)} ks/h` : "–"}</Badge><Badge variant="outline">Kapacita: {p.employees_per_product ?? 1}</Badge><span>první výskyt {p.first_seen_date}</span></div></div><div className="flex items-center gap-2"><Button variant="outline" size="sm" onClick={() => startEdit(p)}><Pencil className="mr-1 h-4 w-4" /> Upravit</Button><Switch checked={p.active} onCheckedChange={() => toggleActive.mutate(p)} /></div></div>; })}</div></div>
          <div className="min-w-0 overflow-hidden rounded-lg border border-border bg-card"><div className="border-b border-border px-4 py-3 text-sm font-semibold">Historie norem ({norms.length})</div><div className="divide-y divide-border">{norms.length === 0 ? <p className="p-4 text-sm text-muted-foreground">Zatím žádné normy.</p> : norms.map((n) => { const p = products.find((x) => x.id === n.product_id); return <div key={n.id} className="flex flex-wrap items-center gap-2 p-3 text-sm"><span className="font-medium">{p?.code ?? "?"}</span><Badge variant="outline">{n.operation}</Badge><span className="tabular-nums">{fmt(n.norm_per_hour, 0)} ks/h</span><span className="text-xs text-muted-foreground">platnost {n.valid_from} – {n.valid_to ?? "nyní"} · zdroj {n.source}</span></div>; })}</div></div>
        </div>
      </div>
    </div>
  </AppShell>;
}
