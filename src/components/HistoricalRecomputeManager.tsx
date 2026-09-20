import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { History, PlayCircle, RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const db = supabase as any;

type RecomputeResult = {
  total: number;
  changed: number;
  unchanged: number;
  needs_review: number;
  needs_review_details: Array<{ import_item_id: string; work_date: string | null; line: string | null; product_code: string | null; reason: string }>;
  errors: number;
  error_details: Array<{ import_item_id: string; work_date: string | null; error: string }>;
  batches_relinked: number | null;
  dry_run: boolean;
};

function ResultSummary({ result }: { result: RecomputeResult }) {
  return (
    <div className="grid gap-2">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        <div className="rounded-lg border bg-muted/20 p-3 text-center"><div className="text-xs text-muted-foreground">Zpracováno</div><div className="text-xl font-bold">{result.total}</div></div>
        <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-center"><div className="text-xs text-muted-foreground">Přepočítáno</div><div className="text-xl font-bold">{result.changed}</div></div>
        <div className="rounded-lg border bg-muted/20 p-3 text-center"><div className="text-xs text-muted-foreground">Beze změny</div><div className="text-xl font-bold">{result.unchanged}</div></div>
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-center"><div className="text-xs text-muted-foreground">Ke kontrole</div><div className="text-xl font-bold">{result.needs_review}</div></div>
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-center"><div className="text-xs text-muted-foreground">Chyby</div><div className="text-xl font-bold">{result.errors}</div></div>
      </div>
      <div className="text-xs text-muted-foreground">HA→TUP vazby znovu vyhodnoceny pro {result.batches_relinked ?? 0} dávek.</div>
      {result.needs_review_details?.length ? <div className="mt-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
        <div className="text-xs font-semibold text-amber-400">Záznamy ke kontrole (schváleny, ale nešlo dopočítat KPI - ponechány na poslední platné hodnotě)</div>
        <div className="mt-1 grid gap-1 text-xs">{result.needs_review_details.map((n, i) => <div key={`${n.import_item_id}-${n.product_code}-${i}`}>{n.work_date ?? "?"} · {n.line ?? "?"} · <span className="font-medium">{n.product_code ?? "?"}</span> · {n.reason}</div>)}</div>
      </div> : null}
      {result.error_details.length ? <div className="mt-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3">
        <div className="text-xs font-semibold text-destructive">Chyby při přepočtu</div>
        <div className="mt-1 grid gap-1 text-xs">{result.error_details.map((e) => <div key={e.import_item_id}>{e.work_date ?? "?"} · {e.import_item_id.slice(0, 8)}… · {e.error}</div>)}</div>
      </div> : null}
    </div>
  );
}

export function HistoricalRecomputeManager() {
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [sampleLimit, setSampleLimit] = useState("50");
  const [previewResult, setPreviewResult] = useState<RecomputeResult | null>(null);
  const [applyResult, setApplyResult] = useState<RecomputeResult | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const preview = useMutation({
    mutationFn: async () => {
      const limit = sampleLimit.trim() ? Number(sampleLimit) : null;
      const { data, error } = await db.rpc("historical_recompute_preview", { p_work_date_from: dateFrom || null, p_work_date_to: dateTo || null, p_sample_limit: limit });
      if (error) throw error;
      return data as RecomputeResult;
    },
    onSuccess: (data) => { setPreviewResult(data); setApplyResult(null); toast.success("Náhled dokončen. Žádná data nebyla uložena (zkušební transakce byla vrácena zpět)."); },
    onError: (e: Error) => toast.error(e.message),
  });

  const apply = useMutation({
    mutationFn: async () => {
      const { data, error } = await db.rpc("historical_recompute_apply", { p_work_date_from: dateFrom || null, p_work_date_to: dateTo || null });
      if (error) throw error;
      return data as RecomputeResult;
    },
    onSuccess: (data) => { setApplyResult(data); setConfirmOpen(false); toast.success(`Hromadný přepočet dokončen: ${data.changed} záznamů přepočítáno.`); },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Card className="p-4">
      <div className="flex items-center gap-2"><History className="h-4 w-4 text-primary" /><div><h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Hromadný přepočet historických záznamů</h2><p className="text-xs text-muted-foreground">Přepočítá schválené výrobní záznamy aktuální výpočtovou logikou (Product Profile, HA/TUP vazby, hodinová rekonstrukce). Nemaže ani znovu nevytváří žádné záznamy - pouze aktualizuje výsledky.</p></div></div>
      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <div className="grid gap-1.5"><Label>Datum od (nepovinné)</Label><Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} /></div>
        <div className="grid gap-1.5"><Label>Datum do (nepovinné)</Label><Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} /></div>
        <div className="grid gap-1.5"><Label>Velikost testovacího vzorku (náhled)</Label><Input type="number" min="1" value={sampleLimit} onChange={(e) => setSampleLimit(e.target.value)} placeholder="prázdné = vše" /></div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button variant="outline" disabled={preview.isPending} onClick={() => preview.mutate()}><RefreshCw className="mr-2 h-4 w-4" />Spustit náhled (dry-run)</Button>
        <Button disabled={!previewResult || apply.isPending} onClick={() => setConfirmOpen(true)}><PlayCircle className="mr-2 h-4 w-4" />Spustit skutečný přepočet</Button>
        {!previewResult ? <Badge variant="outline">Nejdřív spusťte náhled</Badge> : null}
      </div>
      {previewResult ? <div className="mt-4"><div className="mb-2 text-sm font-semibold">Výsledek náhledu (testovací vzorek, nic se neuložilo)</div><ResultSummary result={previewResult} /></div> : null}
      {applyResult ? <div className="mt-4"><div className="mb-2 text-sm font-semibold text-emerald-400">Výsledek skutečného přepočtu (uloženo)</div><ResultSummary result={applyResult} /></div> : null}
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="max-h-[90vh] w-[calc(100%-1rem)] overflow-y-auto sm:w-[calc(100%-3rem)] sm:max-w-lg">
          <DialogHeader><DialogTitle>Potvrdit hromadný přepočet</DialogTitle></DialogHeader>
          <div className="text-sm text-muted-foreground">
            Tato akce trvale přepočítá a uloží nové hodnoty Výkonu, Dostupnosti a OEE pro všechny schválené záznamy {dateFrom || dateTo ? `v rozsahu ${dateFrom || "?"} – ${dateTo || "?"}` : "ve všech dostupných datech"} (na základě náhledu: {previewResult ? `${previewResult.changed} z ${previewResult.total} by se změnilo` : "neznámo"}). Historické záznamy se nemažou ani znovu nevytvářejí, mění se pouze jejich vypočtené hodnoty.
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setConfirmOpen(false)}>Zrušit</Button><Button disabled={apply.isPending} onClick={() => apply.mutate()}>Potvrdit a přepočítat</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
