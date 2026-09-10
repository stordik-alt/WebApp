import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Pencil, Plus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useProducts } from "@/lib/data";
import { AppShell } from "@/components/AppShell";
import { ProductProfileManager } from "@/components/ProductProfileManager";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { useApprovalFields } from "@/lib/auth";

export const Route = createFileRoute("/produkty")({
  head: () => ({ meta: [
    { title: "Produkty a normy – Výkonnost operátorů" },
    { name: "description", content: "Evidence výrobků a Product Profiles s HA/TUP normami, kapacitami a historií verzí." },
    { property: "og:title", content: "Produkty a normy – Výkonnost operátorů" },
    { property: "og:description", content: "Product Profiles jsou zdrojem pravdy pro HA/TUP Product ID, normy a kapacity." },
  ]}),
  component: ProductsPage,
});

function ProductsPage() {
  const qc = useQueryClient();
  const approval = useApprovalFields();
  const { data: products = [] } = useProducts();
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [capacity, setCapacity] = useState("1");
  const [busy, setBusy] = useState(false);

  const addProduct = useMutation({
    mutationFn: async () => {
      const employeeCount = Number(capacity);
      if (!code.trim()) throw new Error("Zadejte Product ID.");
      if (!Number.isInteger(employeeCount) || employeeCount < 1) throw new Error("Kapacita musí být celé číslo alespoň 1.");
      const { error } = await supabase.from("products").insert({
        code: code.trim(),
        name: name.trim() || null,
        employees_per_product: employeeCount,
        first_seen_date: new Date().toISOString().slice(0, 10),
        variant_type: /^T_/i.test(code.trim()) ? "T" : "H",
        ...approval(),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["products"] });
      qc.invalidateQueries({ queryKey: ["product_profiles"] });
      setCode("");
      setName("");
      setCapacity("1");
      toast.success("Produkt uložen.");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const toggleActive = useMutation({
    mutationFn: async (product: { id: string; active: boolean }) => {
      const { error } = await supabase.from("products").update({ active: !product.active }).eq("id", product.id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["products"] }),
    onError: (e: Error) => toast.error(e.message),
  });

  const createProfileProduct = async (codeValue: string, nameValue: string, capacityValue: number, variant: "H" | "T") => {
    const existing = products.find((p) => p.code.trim().toLowerCase() === codeValue.trim().toLowerCase());
    if (existing) return existing;
    const { data, error } = await supabase.from("products").insert({
      code: codeValue.trim(),
      name: nameValue.trim() || null,
      employees_per_product: capacityValue,
      first_seen_date: new Date().toISOString().slice(0, 10),
      variant_type: variant,
      ...approval(),
    }).select("*").single();
    if (error) throw error;
    return data;
  };

  return (
    <AppShell title="Produkty a normy" subtitle="Product Profiles jsou zdrojem pravdy pro HA/TUP Product ID, normy, kapacity a jejich verzování.">
      <div className="grid min-w-0 gap-6">
        <ProductProfileManager onProductsCreated={async (profile) => {
          setBusy(true);
          try {
            await createProfileProduct(profile.haCode, profile.name, profile.haCapacity, "H");
            await createProfileProduct(profile.tupCode, profile.name, profile.tupCapacity, "T");
            qc.invalidateQueries({ queryKey: ["products"] });
            qc.invalidateQueries({ queryKey: ["product_profiles"] });
          } finally {
            setBusy(false);
          }
        }} />

        <div className="grid min-w-0 grid-cols-1 gap-6 xl:grid-cols-[380px_1fr]">
          <Card className="min-w-0 overflow-hidden p-4 sm:p-5">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Samostatný produkt</h2>
            <p className="mt-1 text-xs text-muted-foreground">Pro produkty mimo HA/TUP profilu.</p>
            <div className="mt-4 grid gap-3">
              <div className="grid gap-1.5"><Label>Product ID</Label><Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="H_... nebo T_..." /></div>
              <div className="grid gap-1.5"><Label>Název</Label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
              <div className="grid gap-1.5"><Label>Kapacita operátorů</Label><Input type="number" min="1" value={capacity} onChange={(e) => setCapacity(e.target.value)} /></div>
              <Button className="h-11" disabled={addProduct.isPending || busy || !code.trim()} onClick={() => addProduct.mutate()}><Plus className="h-4 w-4" /> Přidat produkt</Button>
            </div>
          </Card>

          <Card className="min-w-0 overflow-hidden p-0">
            <div className="border-b border-border px-4 py-3 text-sm font-semibold">Produkty ({products.length})</div>
            <div className="divide-y divide-border">
              {products.length === 0 ? <p className="p-4 text-sm text-muted-foreground">Zatím žádné produkty.</p> : products.map((product) => (
                <div key={product.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 p-3">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">{product.code}{product.name ? <span className="text-muted-foreground"> – {product.name}</span> : null}</div>
                    <div className="mt-1 flex flex-wrap gap-2 text-[11px] text-muted-foreground"><span>Kapacita: {product.employees_per_product ?? 1}</span><span>první výskyt {product.first_seen_date}</span></div>
                  </div>
                  <div className="flex items-center gap-2"><Button variant="outline" size="sm" onClick={() => toast.info("Úpravy norem a kapacit provádějte v Product Profile nahoře.")}><Pencil className="mr-1 h-4 w-4" /> Upravit</Button><Switch checked={product.active} onCheckedChange={() => toggleActive.mutate(product)} /></div>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>
    </AppShell>
  );
}
