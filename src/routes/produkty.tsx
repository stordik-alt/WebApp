import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { ProductProfileManagerV2 } from "@/components/ProductProfileManagerV2";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { supabase } from "@/integrations/supabase/client";
import { useProducts } from "@/lib/data";

export const Route = createFileRoute("/produkty")({
  head: () => ({ meta: [
    { title: "Produkty a normy – Výkonnost operátorů" },
    { name: "description", content: "Evidence výrobků a Product Profiles s HA/TUP normami, kapacitami a historií verzí." },
    { property: "og:title", content: "Produkty a normy – Výkonnost operátorů" },
    { property: "og:description", content: "Product Profiles jsou zdrojem pravdy pro HA/TUP Product ID, normy a kapacity." },
  ]}),
  component: ProductsPage,
});

function openProductProfileEditor(productCode: string) {
  const wanted = productCode.trim().toLowerCase();
  if (!wanted) return;
  const editButtons = Array.from(document.querySelectorAll<HTMLButtonElement>("button")).filter((button) => button.textContent?.includes("Upravit"));
  const target = editButtons.find((button) => {
    let node: HTMLElement | null = button;
    for (let depth = 0; node && depth < 4; depth += 1, node = node.parentElement) {
      if (node.textContent?.toLowerCase().includes(wanted)) return true;
    }
    return false;
  });
  if (target) {
    target.click();
    return;
  }
  toast.error(`Product Profile pro ${productCode} nebyl nalezen.`);
}

function ProductsPage() {
  const qc = useQueryClient();
  const { data: products = [] } = useProducts();

  const toggleActive = useMutation({
    mutationFn: async (product: { id: string; active: boolean }) => {
      const { error } = await supabase.from("products").update({ active: !product.active }).eq("id", product.id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["products"] }),
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <AppShell title="Produkty a normy" subtitle="Product Profiles jsou zdrojem pravdy pro HA/TUP Product ID, normy, kapacity a jejich verzování.">
      <div className="grid min-w-0 gap-6">
        <ProductProfileManagerV2 />
        <Card className="min-w-0 overflow-hidden p-0">
          <div className="border-b border-border px-4 py-3 text-sm font-semibold">Produkty ({products.length})</div>
          <div className="divide-y divide-border">
            {products.length === 0 ? <p className="p-4 text-sm text-muted-foreground">Produkty se vytvářejí pouze přes Product Profile.</p> : products.map((product) => (
              <div key={product.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 p-3">
                <div className="min-w-0"><div className="truncate text-sm font-medium">{product.code}{product.name ? <span className="text-muted-foreground"> – {product.name}</span> : null}</div><div className="mt-1 flex flex-wrap gap-2 text-[11px] text-muted-foreground"><span>Kapacita: {product.employees_per_product ?? 1}</span><span>první výskyt {product.first_seen_date}</span></div></div>
                <div className="flex items-center gap-2"><Button variant="outline" size="sm" onClick={() => openProductProfileEditor(product.code)}>Spravováno přes Product Profile</Button><Switch checked={product.active} onCheckedChange={() => toggleActive.mutate(product)} /></div>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </AppShell>
  );
}
