import { useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Check, Loader2, UploadCloud, X, AlertTriangle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { extractScreenshotStage, type OcrResult } from "@/lib/ocr.functions";
import { extractHourlyWithContext } from "@/lib/ocr.hourly.functions";
import { preprocessOcrImage } from "@/lib/ocr-image";
import { useProducts } from "@/lib/data";
import type { Product } from "@/lib/products";
import type { Employee } from "@/lib/metrics";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { completeImportBatch, createImportBatch, createImportItem, finalizeImportItem, markImportItemError, persistOcrResult, sha256File, type ImportBlocker } from "@/lib/import-v2-auto";

type ItemStatus = "QUEUED" | "PROCESSING" | "AUTO_APPROVED" | "PENDING_APPROVAL" | "ERROR" | "DUPLICATE";
type BatchItem = { key: string; fileName: string; status: ItemStatus; message?: string; itemId?: string; screenshotPath?: string; result?: OcrResult; blockers?: ImportBlocker[]; createdRecords?: number };

const normalize = (v: string | null | undefined) => (v ?? "").trim().replace(/\s+/g, "").toLowerCase();
const normalizeName = (v: string | null | undefined) => (v ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

function blockerLabel(blocker: ImportBlocker) {
  const labels: Record<ImportBlocker, string> = {
    MISSING_DATE: "Chybí datum", MISSING_SHIFT: "Chybí směna", MISSING_LINE: "Chybí linka", PRODUCT_NOT_FOUND: "Product ID není v databázi",
    PRODUCT_PROFILE_MISSING: "Chybí Product Profile", PRODUCT_PROFILE_INCOMPLETE: "Product Profile není kompletní", EMPLOYEE_UNMATCHED: "Zaměstnanec nebyl jednoznačně přiřazen",
    POSITION_MISSING: "Chybí pozice HA/TUP", OEE_MISSING: "Chybí OEE", PERFORMANCE_MISSING: "Chybí výkon", AVAILABILITY_MISSING: "Chybí dostupnost",
    HOURLY_DATA_MISSING: "Chybí hodinová data", HOURLY_KPI_MISSING: "Hodinová data nemají platný výkon/dostupnost", DUPLICATE_RECORD: "Záznam již existuje",
  };
  return labels[blocker];
}

export function ScreenshotImportV2({ employees, onImported }: { employees: Employee[]; onImported?: () => void }) {
  const extractStage = useServerFn(extractScreenshotStage);
  const extractHourly = useServerFn(extractHourlyWithContext);
  const { data: products = [] } = useProducts();
  const fileRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [items, setItems] = useState<BatchItem[]>([]);
  const [batchId, setBatchId] = useState<string | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const allProducts = products as Product[];
  const selected = useMemo(() => items.find((item) => item.key === selectedKey) ?? null, [items, selectedKey]);
  const counts = useMemo(() => ({ total: items.length, auto: items.filter((x) => x.status === "AUTO_APPROVED").length, pending: items.filter((x) => x.status === "PENDING_APPROVAL").length, error: items.filter((x) => x.status === "ERROR" || x.status === "DUPLICATE").length, processing: items.filter((x) => x.status === "PROCESSING" || x.status === "QUEUED").length }), [items]);

  const updateItem = (key: string, patch: Partial<BatchItem>) => setItems((prev) => prev.map((item) => item.key === key ? { ...item, ...patch } : item));
  const reset = () => { setBusy(false); setItems([]); setBatchId(null); setSelectedKey(null); setPreviewUrl(null); if (fileRef.current) fileRef.current.value = ""; };
  const close = () => { if (busy) return; setOpen(false); reset(); };

  const loadProfiles = async () => {
    const { data, error } = await supabase.from("product_profiles").select("id,ha_subassy,h_capacity,h_norm_per_hour,tup_subassy,t_capacity,t_norm_per_hour,valid_from,valid_to,version_no").is("valid_to", null);
    if (error) throw error;
    return data ?? [];
  };

  const processOne = async (file: File, key: string, currentBatchId: string) => {
    updateItem(key, { status: "PROCESSING" });
    let itemId: string | undefined;
    try {
      const sourceHash = await sha256File(file);
      const { data: duplicate } = await (supabase as any).from("import_items").select("id,screenshot_path,status,created_at").eq("source_hash", sourceHash).in("status", ["PROCESSING", "VALIDATING", "PENDING_APPROVAL", "AUTO_APPROVED", "APPROVED"]).order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (duplicate) { updateItem(key, { status: "DUPLICATE", message: "Stejný screenshot již byl úspěšně importován nebo je právě zpracováván.", itemId: duplicate.id, screenshotPath: duplicate.screenshot_path }); return; }

      const extension = (file.name.split(".").pop() || "png").toLowerCase();
      const path = `daily/${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}.${extension}`;
      const upload = await supabase.storage.from("screenshots").upload(path, file, { contentType: file.type || "image/png" });
      if (upload.error) throw upload.error;
      const created = await createImportItem(currentBatchId, path, sourceHash); itemId = created.id; updateItem(key, { itemId, screenshotPath: path });

      const dataUrl = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(new Error("Soubor se nepodařilo načíst.")); reader.readAsDataURL(file); });
      setPreviewUrl((current) => selectedKey === key || !current ? dataUrl : current);
      const image = await preprocessOcrImage(dataUrl, { scale: 2, quality: 0.94, maxWidth: 4096, maxHeight: 4096 });

      const header = await extractStage({ data: { imageDataUrl: image, stage: "products" } });
      const employeeResult = await extractStage({ data: { imageDataUrl: image, stage: "employees" } });
      const result: OcrResult = { ...header, rows: employeeResult.rows ?? [] };
      const loadedProfiles = await loadProfiles();
      const persisted = await persistOcrResult(itemId, result, allProducts, employees, loadedProfiles as any);

      let finalResult = result;
      let hourly = result.hourly_metrics ?? [];
      let actualOee: number | null = null;
      let finalRows = persisted.employeeRows;
      let finalMatchedProduct = persisted.matchedProduct;
      let blockers = [...persisted.blockers];

      if (!blockers.length && finalMatchedProduct && finalRows.length) {
        const productCode = result.product_code?.trim() || result.products?.[0]?.product_code?.trim() || "";
        const profile = loadedProfiles.find((p: any) => normalize(p.ha_subassy) === normalize(productCode) || normalize(p.tup_subassy) === normalize(productCode));
        if (profile) {
          const hourlyResult = await extractHourly({ data: { imageDataUrl: image, context: { profiles: [profile], operator_count: finalRows.length } } });
          hourly = hourlyResult.hourly_metrics ?? [];
          actualOee = hourlyResult.actual_shift_oee_pct ?? null;
          finalResult = { ...result, hourly_metrics: hourly, shift: hourlyResult.shift ?? result.shift };
          if (!hourly.length) blockers.push("HOURLY_DATA_MISSING");
          const hasPerformance = hourly.some((m) => m.performance_pct != null && Number.isFinite(Number(m.performance_pct)));
          const hasAvailability = hourly.some((m) => m.availability_pct != null && Number.isFinite(Number(m.availability_pct)));
          if (!hasPerformance || !hasAvailability) blockers.push("HOURLY_KPI_MISSING");
          if (actualOee == null || !Number.isFinite(actualOee)) blockers.push("HOURLY_KPI_MISSING");

          await (supabase as any).from("import_item_hourly").delete().eq("import_item_id", itemId);
          await (supabase as any).from("import_item_rows").delete().eq("import_item_id", itemId);
          const refreshed = await persistOcrResult(itemId, finalResult, allProducts, employees, loadedProfiles as any);
          finalRows = refreshed.employeeRows; finalMatchedProduct = refreshed.matchedProduct;
          blockers = [...new Set([...blockers, ...refreshed.blockers])];
        } else blockers.push("PRODUCT_PROFILE_MISSING");
      } else if (!blockers.length) {
        blockers.push("EMPLOYEE_UNMATCHED");
      }

      if (!blockers.length) {
        const finalized = await finalizeImportItem(itemId, finalResult, finalRows, finalMatchedProduct, [], hourly, actualOee);
        updateItem(key, { status: finalized.status, result: finalResult, createdRecords: finalized.createdRecords });
      } else {
        await finalizeImportItem(itemId, finalResult, finalRows, finalMatchedProduct, blockers, hourly, actualOee);
        updateItem(key, { status: "PENDING_APPROVAL", blockers, result: finalResult, message: "Import byl uložen do Ke schválení." });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Neznámá chyba.";
      if (itemId) await markImportItemError(itemId, message);
      updateItem(key, { status: "ERROR", message });
    }
  };

  const startBatch = async (files: File[]) => {
    if (!files.length) return;
    setOpen(true); setBusy(true);
    const initial = files.map((file, index) => ({ key: `${Date.now()}-${index}-${file.name}`, fileName: file.name, status: "QUEUED" as const }));
    setItems(initial); setSelectedKey(initial[0]?.key ?? null);
    try {
      const batch = await createImportBatch(files.length); setBatchId(batch.id);
      // Sequential processing keeps OCR/resource usage predictable; a failure affects only that item.
      for (const [index, file] of files.entries()) await processOne(file, initial[index].key, batch.id);
      await completeImportBatch(batch.id);
      toast.success(`Hromadný import dokončen: ${files.length} screenshotů.`); onImported?.();
    } catch (error) { toast.error(`Hromadný import se nepodařilo dokončit: ${error instanceof Error ? error.message : "Neznámá chyba."}`); }
    finally { setBusy(false); }
  };

  return <>
    <div className="rounded-2xl border border-primary/30 bg-card/40 p-5 shadow-sm"><div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><div className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">Import dat • 2.0 AUTO</div><h2 className="text-xl font-semibold">Hromadný import screenshotů</h2><p className="text-sm text-muted-foreground">Každý screenshot se zpracuje samostatně. Bezpečné záznamy jdou automaticky do denních dat, výjimky do Ke schválení.</p></div><Button onClick={() => { reset(); setOpen(true); setTimeout(() => fileRef.current?.click(), 0); }} className="w-full sm:w-auto"><UploadCloud className="mr-2 h-4 w-4" />Vybrat screenshoty</Button></div></div>

    <Dialog open={open} onOpenChange={(value) => { if (!value) close(); else setOpen(true); }}><DialogContent className="fixed inset-0 flex h-[100dvh] w-screen max-w-none translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden rounded-none border-0 p-0 sm:inset-4 sm:h-auto sm:max-h-[calc(100dvh-2rem)] sm:w-[calc(100vw-2rem)] sm:translate-x-0 sm:translate-y-0 sm:rounded-2xl sm:border">
      <DialogHeader className="shrink-0 border-b px-4 py-3 sm:px-6"><div className="flex items-center justify-between gap-3 pr-8"><div><DialogTitle className="text-lg">Hromadný import 2.0 AUTO</DialogTitle><div className="text-xs text-muted-foreground">Batch {batchId ? batchId.slice(0, 8) : "…"}</div></div><div className="text-xs text-muted-foreground">{counts.total} celkem</div></div></DialogHeader>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-4 sm:px-6"><div className="mx-auto grid w-full max-w-6xl gap-4 lg:grid-cols-[0.8fr_1.2fr]">
        <section className="space-y-3"><input ref={fileRef} type="file" multiple accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => { const files = Array.from(e.target.files ?? []); if (files.length) void startBatch(files); }} />
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4"><div className="rounded-xl border p-3"><div className="text-xs text-muted-foreground">Automaticky</div><div className="text-2xl font-semibold">{counts.auto}</div></div><div className="rounded-xl border p-3"><div className="text-xs text-muted-foreground">Ke schválení</div><div className="text-2xl font-semibold">{counts.pending}</div></div><div className="rounded-xl border p-3"><div className="text-xs text-muted-foreground">Chyby</div><div className="text-2xl font-semibold">{counts.error}</div></div><div className="rounded-xl border p-3"><div className="text-xs text-muted-foreground">Zpracování</div><div className="text-2xl font-semibold">{counts.processing}</div></div></div>
          {items.map((item) => <button key={item.key} type="button" onClick={() => setSelectedKey(item.key)} className={`w-full rounded-2xl border p-4 text-left ${selectedKey === item.key ? "border-primary bg-primary/5" : "bg-card"}`}><div className="flex items-start gap-3"><div className="min-w-0 flex-1"><div className="truncate font-semibold">{item.fileName}</div><div className="mt-1 text-xs text-muted-foreground">{item.status === "PROCESSING" ? "Zpracovávám OCR…" : item.status === "QUEUED" ? "Čeká ve frontě" : item.status === "AUTO_APPROVED" ? `AUTO • ${item.createdRecords ?? 0} záznamů` : item.status === "DUPLICATE" ? "Duplicitní screenshot" : item.status === "PENDING_APPROVAL" ? "Ke schválení" : "Chyba"}</div></div>{item.status === "AUTO_APPROVED" ? <Check className="h-5 w-5" /> : item.status === "PENDING_APPROVAL" ? <AlertTriangle className="h-5 w-5" /> : item.status === "ERROR" || item.status === "DUPLICATE" ? <X className="h-5 w-5" /> : <Loader2 className="h-5 w-5 animate-spin" />}</div></button>)}
        </section>
        <section className="space-y-4">{selected && <><div className="rounded-2xl border p-4"><div className="mb-3 flex items-center justify-between"><h3 className="font-semibold">Výsledek OCR</h3><span className="text-xs text-muted-foreground">Jistota hlavičky {selected.result ? `${Math.round((selected.result.header_confidence || 0) * 100)} %` : "—"}</span></div>{selected.result ? <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4"><div><span className="text-muted-foreground">Datum</span><div>{selected.result.work_date ?? "—"}</div></div><div><span className="text-muted-foreground">Směna</span><div>{selected.result.shift ?? "—"}</div></div><div><span className="text-muted-foreground">Linka</span><div>{selected.result.line ?? "—"}</div></div><div><span className="text-muted-foreground">Product</span><div className="break-all">{selected.result.product_code ?? selected.result.products?.[0]?.product_code ?? "—"}</div></div></div> : <div className="text-sm text-muted-foreground">Detail se zobrazí po dokončení OCR.</div>}</div>
          {selected.status === "PENDING_APPROVAL" && <div className="rounded-2xl border border-primary/40 bg-primary/5 p-4"><div className="font-semibold">Ke schválení</div><p className="mt-1 text-sm text-muted-foreground">Původní screenshot zůstává připojený k importu. Master data se automaticky nevytvářejí.</p>{selected.blockers?.length ? <ul className="mt-3 space-y-1 text-sm">{selected.blockers.map((blocker) => <li key={blocker}>• {blockerLabel(blocker)}</li>)}</ul> : null}</div>}
          {selected.message && <div className="rounded-xl border bg-muted/20 p-3 text-sm">{selected.message}</div>}{previewUrl && <div className="overflow-hidden rounded-2xl border bg-black/20"><img src={previewUrl} alt={`Náhled ${selected.fileName}`} className="max-h-[45dvh] w-full object-contain" /></div>}</>}</section>
      </div></div>
      <DialogFooter className="shrink-0 border-t bg-background/95 px-3 py-3 sm:px-6"><Button variant="outline" className="w-full sm:w-auto" disabled={busy} onClick={close}><X className="mr-2 h-4 w-4" />Zavřít</Button></DialogFooter>
    </DialogContent></Dialog>
  </>;
}
