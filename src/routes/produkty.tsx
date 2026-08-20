import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, Plus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useProductNorms, useProducts, useDailyRecords } from "@/lib/data";
import { currentNorm, getNormHistory, recalculatePerformance, type Product } from "@/lib/products";
import { fmt } from "@/lib/metrics";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useApprovalFields } from "@/lib/auth";

export const Route = createFileRoute("/produkty")({
  head: () => ({
    meta: [
      { title: "Produkty a normy – Výkonnost operátorů" },
      {
        name: "description",
        content:
          "Evidence výrobků a verzovaných hodinových norem HA/TUP s platností od–do a historií změn.",
      },
      { property: "og:title", content: "Produkty a normy – Výkonnost operátorů" },
      {
        property: "og:description",
        content: "Verzované normy ks/h pro výrobky, HA norma platí pro celou linku.",
      },
    ],
  }),
  component: ProductsPage,
});

function ProductsPage() {
  const qc = useQueryClient();
  const approval = useApprovalFields();
  const { data: products = [] } = useProducts();
  const { data: norms = [] } = useProductNorms();

  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [selected, setSelected] = useState<Product | null>(null);
  const [operation, setOperation] = useState<"HA" | "TUP">("HA");
  const [normValue, setNormValue] = useState("");
  const [validFrom, setValidFrom] = useState(new Date().toISOString().slice(0, 10));

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["products"] });
    qc.invalidateQueries({ queryKey: ["product_norms"] });
    qc.invalidateQueries({ queryKey: ["daily"] });
  };

  const addProduct = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("products")
        .insert({ code: code.trim(), name: name.trim() || null, ...approval() });
      if (error) throw error;
    },
    onSuccess: () => {
      invalidate();
      setCode("");
      setName("");
      toast.success("Produkt uložen");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const toggleActive = useMutation({
    mutationFn: async (p: Product) => {
      const { error } = await supabase
        .from("products")
        .update({ active: !p.active })
        .eq("id", p.id);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  const existing = selected ? currentNorm(norms, selected.id, operation) : undefined;
  const normNum = normValue === "" ? null : Number(normValue);
  const isChange = !!existing && normNum !== null && Number(existing.norm_per_hour) !== normNum;

  const saveNorm = useMutation({
    mutationFn: async () => {
      if (!selected || normNum === null) throw new Error("Vyberte produkt a zadejte normu.");
      if (existing && Number(existing.norm_per_hour) === normNum) {
        throw new Error("Stejná norma už platí – nová verze není potřeba.");
      }

      // Získáme historii norem PŘED uložením nové
      const oldNormHistory = getNormHistory(norms, selected.id, operation);

      if (existing) {
        const { error } = await supabase
          .from("product_norms")
          .update({ valid_to: validFrom })
          .eq("id", existing.id);
        if (error) throw error;
      }
      const { error } = await supabase.from("product_norms").insert({
        product_id: selected.id,
        operation,
        norm_per_hour: normNum,
        valid_from: validFrom,
        source: "manual",
        confirmed: true,
        note: operation === "HA" ? "Norma celé HA linky" : null,
        ...approval(),
      });
      if (error) throw error;

      // Pokud se norma snížila, přepočítáme všechny záznamy
      if (oldNormHistory.length > 0) {
        const oldNormAtFirst = oldNormHistory[0]; // nejstarší norma v historii
        if (oldNormAtFirst && normNum < oldNormAtFirst.norm_per_hour) {
          // Získáme všechny záznamy pro tento produkt
          const { data: dailyRecords } = await supabase
            .from("daily_records")
            .select("id, performance, available_time, work_date, product_id")
            .eq("product_id", selected.id)
            .eq("approval_status", "approved");

          if (dailyRecords && dailyRecords.length > 0) {
            const recalculations = recalculatePerformance(
              dailyRecords as unknown as import("@/lib/metrics").DailyRecord[],
              oldNormHistory,
              normNum,
              selected.id,
              operation,
            );

            // provedeme batch update
            if (recalculations.length > 0) {
              for (const { recordId, newPerformance } of recalculations) {
                await supabase
                  .from("daily_records")
                  .update({ performance: newPerformance })
                  .eq("id", recordId);
              }
              toast.info(`Přepočítáno ${recalculations.length} záznamů kvůli snížení normy.`);
            }
          }
        }
      }
    },
    onSuccess: () => {
      invalidate();
      setNormValue("");
      toast.success("Nová verze normy uložena, historie zachována.");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <AppShell
      title="Produkty a normy"
      subtitle="Normy se verzují podle platnosti. Norma HA platí pro celou linku, ne pro jednoho pracovníka."
    >
      <div className="grid min-w-0 grid-cols-1 gap-6 xl:grid-cols-[380px_1fr]">
        <div className="grid min-w-0 gap-6">
          <Card className="min-w-0 gap-3 overflow-hidden p-4 sm:p-5">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Nový produkt
            </h2>
            <div className="grid gap-1.5">
              <Label>Kód / název</Label>
              <Input className="h-11" value={code} onChange={(e) => setCode(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label>Popis</Label>
              <Input className="h-11" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <Button
              className="h-11"
              disabled={!code.trim() || addProduct.isPending}
              onClick={() => addProduct.mutate()}
            >
              <Plus className="h-4 w-4" /> Přidat produkt
            </Button>
          </Card>

          <Card className="min-w-0 gap-3 overflow-hidden p-4 sm:p-5">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Nová verze normy
            </h2>
            <div className="grid gap-1.5">
              <Label>Produkt</Label>
              <Select
                value={selected?.id ?? ""}
                onValueChange={(v) => setSelected(products.find((p) => p.id === v) ?? null)}
              >
                <SelectTrigger className="h-11">
                  <SelectValue placeholder="Vyberte produkt" />
                </SelectTrigger>
                <SelectContent>
                  {products.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.code}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label>Operace</Label>
                <Select value={operation} onValueChange={(v) => setOperation(v as "HA" | "TUP")}>
                  <SelectTrigger className="h-11">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="HA">HA (celá linka)</SelectItem>
                    <SelectItem value="TUP">TUP</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label>Norma (ks/h)</Label>
                <Input
                  type="number"
                  inputMode="decimal"
                  step="0.1"
                  className="h-11"
                  value={normValue}
                  onChange={(e) => setNormValue(e.target.value)}
                />
              </div>
              <div className="grid gap-1.5 sm:col-span-2">
                <Label>Platnost od</Label>
                <Input
                  type="date"
                  className="h-11"
                  value={validFrom}
                  onChange={(e) => setValidFrom(e.target.value)}
                />
              </div>
            </div>
            {isChange && existing ? (
              <div className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm">
                <div className="flex items-center gap-2 font-semibold">
                  <AlertTriangle className="h-4 w-4" /> Změna normy
                </div>
                {existing.norm_per_hour} ks/h → {normNum} ks/h. Původní verze zůstane v historii.
              </div>
            ) : null}
            <Button
              className="h-11"
              disabled={!selected || normValue === "" || saveNorm.isPending}
              onClick={() => saveNorm.mutate()}
            >
              Uložit verzi normy
            </Button>
          </Card>
        </div>

        <div className="grid min-w-0 gap-6">
          <div className="min-w-0 overflow-hidden rounded-lg border border-border bg-card">
            <div className="border-b border-border px-4 py-3 text-sm font-semibold">
              Produkty ({products.length})
            </div>
            <div className="divide-y divide-border">
              {products.length === 0 ? (
                <p className="p-4 text-sm text-muted-foreground">Zatím žádné produkty.</p>
              ) : (
                products.map((p) => {
                  const ha = currentNorm(norms, p.id, "HA");
                  const tup = currentNorm(norms, p.id, "TUP");
                  return (
                    <div
                      key={p.id}
                      className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 p-3"
                    >
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium">
                          {p.code}{" "}
                          {p.name ? (
                            <span className="text-muted-foreground">– {p.name}</span>
                          ) : null}
                        </div>
                        <div className="mt-1 flex flex-wrap gap-1.5 text-[11px] text-muted-foreground">
                          <Badge variant="secondary">
                            HA: {ha ? `${fmt(ha.norm_per_hour, 0)} ks/h` : "–"}
                          </Badge>
                          <Badge variant="secondary">
                            TUP: {tup ? `${fmt(tup.norm_per_hour, 0)} ks/h` : "–"}
                          </Badge>
                          <span>první výskyt {p.first_seen_date}</span>
                        </div>
                      </div>
                      <Switch checked={p.active} onCheckedChange={() => toggleActive.mutate(p)} />
                    </div>
                  );
                })
              )}
            </div>
          </div>

          <div className="min-w-0 overflow-hidden rounded-lg border border-border bg-card">
            <div className="border-b border-border px-4 py-3 text-sm font-semibold">
              Historie norem ({norms.length})
            </div>
            <div className="divide-y divide-border">
              {norms.length === 0 ? (
                <p className="p-4 text-sm text-muted-foreground">Zatím žádné normy.</p>
              ) : (
                norms.map((n) => {
                  const p = products.find((x) => x.id === n.product_id);
                  return (
                    <div key={n.id} className="flex flex-wrap items-center gap-2 p-3 text-sm">
                      <span className="font-medium">{p?.code ?? "?"}</span>
                      <Badge variant="outline">{n.operation}</Badge>
                      <span className="tabular-nums">{fmt(n.norm_per_hour, 0)} ks/h</span>
                      <span className="text-xs text-muted-foreground">
                        platnost {n.valid_from} – {n.valid_to ?? "nyní"} · zdroj {n.source}
                      </span>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
