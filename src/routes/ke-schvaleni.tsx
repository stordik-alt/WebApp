import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { useAuth } from "@/lib/auth";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { AccountApprovalQueue } from "@/components/AccountApprovalQueue";
import { ImportApprovalQueue } from "@/components/ImportApprovalQueue";

export const Route = createFileRoute("/ke-schvaleni")({
  head: () => ({ meta: [{ title: "Ke schválení – Výkonnost operátorů" }, { name: "description", content: "Kontrola a schvalování importů a nových účtů před zařazením do aplikace." }] }),
  component: ApprovalPage,
});

const db = supabase as any;
const normalize = (v: unknown) => String(v ?? "").trim().toLowerCase().replace(/\s+/g, "");

function MultiProductApprovalOverview() {
  const query = useQuery({
    queryKey: ["approval-multi-product-overview"],
    queryFn: async () => {
      const { data, error } = await db.from("import_items").select("id,created_at,work_date,shift,line,product_code,ocr_data").eq("status", "PENDING_APPROVAL").order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const items = query.data ?? [];
  if (!items.length) return null;

  return <div className="grid gap-3">
    {items.map((item: any) => {
      const data = item.ocr_data ?? {};
      const hourly = Array.isArray(data.hourly_metrics) ? data.hourly_metrics : [];
      const listed = Array.isArray(data.products) ? data.products : [];
      const codes = Array.from(new Set([
        ...hourly.map((m: any) => String(m.product_code ?? "").trim()).filter(Boolean),
        ...listed.map((m: any) => String(m.product_code ?? "").trim()).filter(Boolean),
        String(data.product_code ?? "").trim(),
      ].filter(Boolean)));
      const products = codes.map((code) => {
        const rows = hourly.filter((m: any) => normalize(m.product_code) === normalize(code));
        const listedProduct = listed.find((m: any) => normalize(m.product_code) === normalize(code));
        const weighted = (field: string) => {
          let total = 0;
          let weight = 0;
          for (const row of rows) {
            const value = Number(row[field]);
            const minutes = Number(row.actual_minutes ?? 0);
            if (Number.isFinite(value) && minutes > 0) { total += value * minutes; weight += minutes; }
          }
          return weight > 0 ? total / weight : null;
        };
        const output = rows.reduce((sum: number, row: any) => sum + (Number.isFinite(Number(row.actual_output)) ? Number(row.actual_output) : 0), 0);
        const rowNorm = rows.map((r: any) => Number(r.norm_per_hour)).find((n: number) => Number.isFinite(n) && n > 0);
        const norm = Number(listedProduct?.norm_per_hour) > 0 ? Number(listedProduct.norm_per_hour) : rowNorm ?? null;
        const hours = rows.map((r: any) => Number(r.hour)).filter((h: number) => Number.isFinite(h)).sort((a: number, b: number) => a - b);
        return { code, norm, output, performance: weighted("performance_pct"), availability: weighted("availability_pct"), oee: weighted("actual_oee_pct"), hours };
      });

      return <Card key={item.id} className="border-primary/30 bg-primary/5 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="font-semibold">OCR – rozpoznané produkty</div>
            <div className="text-xs text-muted-foreground">{item.work_date ?? "—"} · {item.shift ?? "—"} · {item.line ?? "—"}</div>
          </div>
          <Badge variant="secondary">{products.length} {products.length === 1 ? "produkt" : products.length < 5 ? "produkty" : "produktů"}</Badge>
        </div>
        <div className="mt-3 grid gap-2">
          {products.map((product) => <div key={product.code} className="rounded-lg border bg-background p-3">
            <div className="flex flex-wrap items-center justify-between gap-2"><div className="font-semibold break-all">{product.code}</div><div className="text-sm font-medium">Norma: {product.norm != null ? `${product.norm} ks/h` : "—"}</div></div>
            <div className="mt-2 grid grid-cols-2 gap-2 text-xs sm:grid-cols-5">
              <div><div className="text-muted-foreground">Hodiny</div><div className="font-medium">{product.hours.length ? product.hours.join(", ") : "—"}</div></div>
              <div><div className="text-muted-foreground">Výstup</div><div className="font-medium">{product.output || "—"}</div></div>
              <div><div className="text-muted-foreground">Výkon</div><div className="font-medium">{product.performance != null ? `${product.performance.toFixed(2)} %` : "—"}</div></div>
              <div><div className="text-muted-foreground">Dostupnost</div><div className="font-medium">{product.availability != null ? `${product.availability.toFixed(2)} %` : "—"}</div></div>
              <div><div className="text-muted-foreground">OEE</div><div className="font-medium">{product.oee != null ? `${product.oee.toFixed(2)} %` : "—"}</div></div>
            </div>
          </div>)}
        </div>
      </Card>;
    })}
  </div>;
}

function ApprovalPage() {
  const { isAdmin } = useAuth();
  return <AppShell title="Ke schválení" subtitle="Importy, nové účty a záznamy čekající na kontrolu správce">
    {!isAdmin ? <Card className="p-6 text-center"><div className="text-base font-semibold">Přístup pouze pro správce</div><div className="mt-1 text-sm text-muted-foreground">Rozhodovat o importech, záznamech a účtech může pouze administrátor.</div></Card> : <div className="grid gap-6"><MultiProductApprovalOverview /><ImportApprovalQueue /><AccountApprovalQueue /></div>}
  </AppShell>;
}
