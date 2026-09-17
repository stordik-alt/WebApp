import { useEffect, useMemo, useRef, useState } from "react";
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
type BatchItem = { key: string; fileName: string; status: ItemStatus; message?: string | undefined; itemId?: string; screenshotPath?: string; result?: OcrResult; blockers?: ImportBlocker[]; createdRecords?: number };
const normalize = (v: string | null | undefined) => (v ?? "").trim().replace(/\s+/g, "").toLowerCase();
function errorMessage(error: unknown): string { if (error instanceof Error && error.message.trim()) return error.message; if (typeof error === "string" && error.trim()) return error; if (error && typeof error === "object") { const value = error as Record<string, unknown>; const nested = [value["message"], (value["error"] as any)?.message, (value["cause"] as any)?.message, value["detail"]].find((v) => typeof v === "string" && v.trim()); if (nested) return String(nested); try { const json = JSON.stringify(error); if (json && json !== "{}") return json; } catch {} } return "Neznámá chyba."; }
function blockerLabel(blocker: ImportBlocker) { const labels: Record<ImportBlocker, string> = { MISSING_DATE: "Chybí datum", MISSING_SHIFT: "Chybí směna", MISSING_LINE: "Chybí linka", PRODUCT_NOT_FOUND: "Product ID není v databázi", PRODUCT_PROFILE_MISSING: "Chybí Product Profile", PRODUCT_PROFILE_INCOMPLETE: "Product Profile není kompletní", EMPLOYEE_UNMATCHED: "Zaměstnanec nebyl jednoznačně přiřazen", POSITION_MISSING: "Chybí pozice HA/TUP", OEE_MISSING: "Chybí OEE", PERFORMANCE_MISSING: "Chybí výkon", AVAILABILITY_MISSING: "Chybí dostupnost", HOURLY_DATA_MISSING: "Chybí hodinová data", HOURLY_KPI_MISSING: "Hodinová data nemají platný výkon/dostupnost", DUPLICATE_RECORD: "Záznam již existuje" }; return labels[blocker]; }

export function ScreenshotImportV2({ employees, onImported }: { employees: Employee[]; onImported?: () => void }) {
  const extractStage = useServerFn(extractScreenshotStage);
  const extractHourly = useServerFn(extractHourlyWithContext);
  const { data: products = [] } = useProducts();
  const fileRef = useRef<HTMLInputElement>(null);
  const processingKeysRef = useRef(new Set<string>());
  const recoveryStartedRef = useRef(false);
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
  // Reads the actual up-to-date items state (not a stale closure capture),
  // since setState's functional form always receives the latest committed value.
  const readItems = () => new Promise<BatchItem[]>((resolve) => setItems((prev) => { resolve(prev); return prev; }));
  // Reports what the batch actually did, based on each item's real persisted
  // status - never a blanket success/failure. Every screenshot's outcome is
  // already saved by the time this runs (processOne persists per-item,
  // independent of whatever runs after it), so the summary must reflect that
  // even if a later bookkeeping step (completeImportBatch) itself failed.
  const reportBatchOutcome = async (label: string) => {
    const finalItems = await readItems();
    const auto = finalItems.filter((x) => x.status === "AUTO_APPROVED").length;
    const pending = finalItems.filter((x) => x.status === "PENDING_APPROVAL").length;
    const errored = finalItems.filter((x) => x.status === "ERROR" || x.status === "DUPLICATE").length;
    const createdRecords = finalItems.reduce((sum, x) => sum + (x.createdRecords ?? 0), 0);
    const summary = `${label}: ${finalItems.length} screenshotů zpracováno, ${auto} automaticky schváleno (${createdRecords} výrobních záznamů), ${pending} ke schválení${errored ? `, ${errored} s chybou` : ""}.`;
    if (auto === 0 && pending === 0 && errored > 0) toast.error(summary); else toast.success(summary);
    onImported?.();
  };
  const reset = () => { setBusy(false); processingKeysRef.current.clear(); setItems([]); setBatchId(null); setSelectedKey(null); setPreviewUrl(null); recoveryStartedRef.current = false; if (fileRef.current) fileRef.current.value = ""; };
  const close = () => { if (busy) return; setOpen(false); reset(); };
  const loadProfiles = async () => { const { data, error } = await supabase.from("product_profiles").select("id,ha_subassy,h_capacity,h_norm_per_hour,tup_subassy,t_capacity,t_norm_per_hour,valid_from,valid_to,version_no").is("valid_to", null); if (error) throw error; return data ?? []; };

  const processOne = async (file: File, key: string, currentBatchId: string, existingItem?: { id: string; screenshotPath: string }) => {
    if (processingKeysRef.current.has(key)) return;
    processingKeysRef.current.add(key);
    updateItem(key, { status: "PROCESSING", message: undefined });
    let itemId: string | undefined = existingItem?.id;
    try {
      if (!existingItem) {
        const sourceHash = await sha256File(file);
        const { data: duplicate } = await (supabase as any).from("import_items").select("id,screenshot_path,status,created_at").eq("source_hash", sourceHash).in("status", ["PROCESSING", "VALIDATING", "PENDING_APPROVAL", "AUTO_APPROVED", "APPROVED"]).order("created_at", { ascending: false }).limit(1).maybeSingle();
        if (duplicate) { updateItem(key, { status: "DUPLICATE", message: "Stejný screenshot již byl úspěšně importován nebo je právě zpracováván.", itemId: duplicate.id, screenshotPath: duplicate.screenshot_path }); return; }
        const extension = (file.name.split(".").pop() || "png").toLowerCase();
        const path = `daily/${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}.${extension}`;
        const upload = await supabase.storage.from("screenshots").upload(path, file, { contentType: file.type || "image/png" });
        if (upload.error) throw upload.error;
        const created = await createImportItem(currentBatchId, path, sourceHash);
        itemId = created.id;
        updateItem(key, { itemId, screenshotPath: path });
      } else {
        updateItem(key, { itemId: existingItem.id, screenshotPath: existingItem.screenshotPath });
        const { error } = await (supabase as any).from("import_items").update({ status: "PROCESSING", error_message: null, completed_at: null }).eq("id", existingItem.id);
        if (error) throw error;
        await (supabase as any).from("import_item_rows").delete().eq("import_item_id", existingItem.id);
        await (supabase as any).from("import_item_hourly").delete().eq("import_item_id", existingItem.id);
      }
      const dataUrl = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(new Error("Soubor se nepodařilo načíst.")); reader.readAsDataURL(file); });
      setPreviewUrl((current) => selectedKey === key || !current ? dataUrl : current);
      const image = await preprocessOcrImage(dataUrl, { scale: 1.5, quality: 0.86, maxWidth: 3072, maxHeight: 3072 });
      const header = await extractStage({ data: { imageDataUrl: image, stage: "products" } });
      const employeeResult = await extractStage({ data: { imageDataUrl: image, stage: "employees" } });
      const result: OcrResult = { ...header, rows: employeeResult.rows ?? [] };
      const loadedProfiles = await loadProfiles();
      if (!itemId) throw new Error("Importní záznam nebyl vytvořen.");
      const persisted = await persistOcrResult(itemId, result, allProducts, employees, loadedProfiles as any);
      let finalResult = result;
      let hourly = result.hourly_metrics ?? [];
      let actualOee: number | null = null;
      let finalRows = persisted.employeeRows;
      let finalMatchedProduct = persisted.matchedProduct;
      let blockers = [...persisted.blockers];
      // Reuse the SAME resolution persistOcrResult already computed (canonical
      // resolveProducts, which checks product_profiles.ha_subassy/tup_subassy,
      // not just products.code) instead of re-deriving product code and profile
      // locally - two independent lookups could disagree and silently skip the
      // hourly OCR pass even when the product/profile were actually valid.
      const profile = persisted.matchedProfile;
      const productCode = finalMatchedProduct?.code || result.product_code?.trim() || result.products?.[0]?.product_code?.trim() || "";
      const allProfilesForItem = [...new Map(
        [profile, ...persisted.resolutions.map((r) => r.resolution.profile)]
          .filter((p): p is NonNullable<typeof p> => Boolean(p))
          .map((p) => [normalize(p.ha_subassy) || normalize(p.tup_subassy), p])
      ).values()];
      if (profile && finalRows.length && finalMatchedProduct) {
        const hourlyImage = await preprocessOcrImage(dataUrl, { scale: 2, quality: 0.92, maxWidth: 4096, maxHeight: 4096 });
        const role = /^H_/i.test(productCode) ? "HA" : /^T_/i.test(productCode) ? "TUP" : null;
        const hourlyResult = await extractHourly({ data: { imageDataUrl: hourlyImage, context: { profiles: allProfilesForItem.length ? allProfilesForItem : [profile], operator_count: finalRows.length, role } } });
        hourly = hourlyResult.hourly_metrics ?? [];
        actualOee = hourlyResult.actual_shift_oee_pct ?? null;
        finalResult = { ...result, hourly_metrics: hourly, shift: hourlyResult.shift ?? result.shift, ...(hourlyResult.screenshot_time ? { screenshot_time: hourlyResult.screenshot_time } : {}), ...(actualOee != null ? { actual_shift_oee_pct: actualOee } : {}) } as OcrResult;
        if (!hourly.length) blockers.push("HOURLY_DATA_MISSING");
        const { error: hourlyDeleteError } = await (supabase as any).from("import_item_hourly").delete().eq("import_item_id", itemId);
        if (hourlyDeleteError) throw hourlyDeleteError;
        const { error: rowDeleteError } = await (supabase as any).from("import_item_rows").delete().eq("import_item_id", itemId);
        if (rowDeleteError) throw rowDeleteError;
        const refreshed = await persistOcrResult(itemId, finalResult, allProducts, employees, loadedProfiles as any);
        finalRows = refreshed.employeeRows;
        finalMatchedProduct = refreshed.matchedProduct;
        blockers = [...new Set([...blockers, ...refreshed.blockers])];
      } else if (finalRows.length && (!finalMatchedProduct || !profile)) blockers.push(finalMatchedProduct ? "PRODUCT_PROFILE_MISSING" : "PRODUCT_NOT_FOUND");
      else if (!finalRows.length) blockers.push("EMPLOYEE_UNMATCHED");
      blockers = [...new Set(blockers)];
      const finalized = await finalizeImportItem(itemId, finalResult, finalRows, finalMatchedProduct, blockers, hourly, actualOee);
      updateItem(key, { status: finalized.status, blockers: finalized.blockers, result: finalResult, createdRecords: finalized.createdRecords, message: finalized.status === "PENDING_APPROVAL" ? "Import byl uložen do Ke schválení." : undefined });
    } catch (error) {
      const message = errorMessage(error);
      if (itemId) await markImportItemError(itemId, message);
      updateItem(key, { status: "ERROR", message });
    } finally {
      processingKeysRef.current.delete(key);
    }
  };

  const startBatch = async (files: File[]) => {
    if (!files.length) return;
    setOpen(true); setBusy(true);
    const initial = files.map((file, index) => ({ key: `${Date.now()}-${index}-${file.name}`, fileName: file.name, status: "QUEUED" as const }));
    setItems(initial); setSelectedKey(initial[0]?.key ?? null);
    let batch: { id: string };
    try {
      batch = await createImportBatch(files.length); setBatchId(batch.id);
    } catch (error) {
      // Nothing was processed yet - this genuinely is a full failure.
      toast.error(`Hromadný import se nepodařilo zahájit: ${errorMessage(error)}`);
      setBusy(false);
      return;
    }
    for (const [index, file] of files.entries()) await processOne(file, initial[index]?.key ?? `${Date.now()}-${index}-${file.name}`, batch.id);
    // HA->TUP linkage is only ever evaluated after the whole batch is
    // approved (never per-screenshot - the HA and TUP sides are normally
    // two different screenshots, and processing order isn't guaranteed).
    await (supabase as any).rpc("evaluate_batch_ha_tup_linkage", { p_batch_id: batch.id }).catch(() => {});
    // completeImportBatch only aggregates already-persisted per-item results
    // into import_batches' summary counters - it never creates or mutates
    // import_items/daily_records. Its failure must never surface as "import
    // failed": every screenshot's real outcome is already saved regardless.
    try { await completeImportBatch(batch.id); } catch (error) { console.error("Souhrn dávky se nepodařilo uložit (záznamy byly přesto zpracovány):", error); }
    await reportBatchOutcome("Hromadný import dokončen");
    setBusy(false);
  };

  useEffect(() => {
    let cancelled = false;
    const recover = async () => {
      if (cancelled || recoveryStartedRef.current || busy) return;
      recoveryStartedRef.current = true;
      try {
        const { data: batch } = await (supabase as any).from("import_batches").select("id,total_items,status,created_at").eq("status", "PROCESSING").order("created_at", { ascending: false }).limit(1).maybeSingle();
        if (!batch || cancelled) return;
        const { data: dbItems, error } = await (supabase as any).from("import_items").select("id,screenshot_path,status,work_date,shift,line,product_code,ocr_data,pending_reasons,created_at").eq("batch_id", batch.id).order("created_at", { ascending: true });
        if (error) throw error;
        const recovered: BatchItem[] = (dbItems ?? []).map((row: any) => {
          const status: ItemStatus = row.status === "AUTO_APPROVED" || row.status === "APPROVED" ? "AUTO_APPROVED" : row.status === "PENDING_APPROVAL" ? "PENDING_APPROVAL" : row.status === "ERROR" ? "ERROR" : row.status === "DUPLICATE" ? "DUPLICATE" : "PROCESSING";
          const result = row.ocr_data && typeof row.ocr_data === "object" ? row.ocr_data as OcrResult : undefined;
          return { key: `recovery-${row.id}`, fileName: String(row.screenshot_path ?? row.id).split("/").pop() || row.id, status, itemId: row.id, screenshotPath: row.screenshot_path, result, blockers: Array.isArray(row.pending_reasons) ? row.pending_reasons : undefined };
        });
        const unfinished = (dbItems ?? []).filter((row: any) => row.status === "PROCESSING" || row.status === "VALIDATING");
        if (!recovered.length || !unfinished.length) return;
        setBatchId(batch.id); setItems(recovered); setSelectedKey(recovered[0]?.key ?? null); setOpen(true); setBusy(true);
        for (const row of unfinished) {
          if (cancelled) return;
          const key = `recovery-${row.id}`;
          // If a previous run got interrupted after the OCR/hourly-extraction
          // step already wrote import_item_hourly (e.g. the tab was closed or
          // refreshed right before the final approval RPC), auto_approve_import_item
          // is self-contained and can finish the item from that data alone -
          // no need to re-download the screenshot and re-run both OCR passes
          // again. Try that first; only fall back to a full reprocess if the
          // item genuinely has no usable hourly data yet (row.status
          // "PROCESSING", or the RPC itself reports it's missing).
          if (row.status === "VALIDATING") {
            // Only a clean AUTO_APPROVED counts as resumed. A PENDING_APPROVAL
            // result here doesn't necessarily mean the blocker is real - it
            // could just reflect the incomplete state left by the
            // interruption - so fall through to a full reprocess in that
            // case, same as before this shortcut existed, rather than
            // stranding the item on a blocker a fresh OCR pass might clear.
            const resumed = await (async () => {
              try {
                const { data, error } = await (supabase as any).rpc("auto_approve_import_item", { p_import_item_id: row.id });
                if (error) return false;
                const response = data as { status?: string; created_daily_records?: number } | null;
                if (response?.status === "AUTO_APPROVED") { updateItem(key, { status: "AUTO_APPROVED", createdRecords: Number(response.created_daily_records ?? 0) }); return true; }
                return false;
              } catch { return false; }
            })();
            if (resumed) continue;
          }
          const { data: blob, error: downloadError } = await supabase.storage.from("screenshots").download(row.screenshot_path);
          if (downloadError) { updateItem(key, { status: "ERROR", message: `Nelze obnovit screenshot: ${downloadError.message}` }); await markImportItemError(row.id, `Nelze obnovit screenshot po návratu do aplikace: ${downloadError.message}`); continue; }
          const type = blob.type || "image/png";
          const file = new File([blob], String(row.screenshot_path).split("/").pop() || `${row.id}.png`, { type });
          await processOne(file, key, batch.id, { id: row.id, screenshotPath: row.screenshot_path });
        }
        await (supabase as any).rpc("evaluate_batch_ha_tup_linkage", { p_batch_id: batch.id }).catch(() => {});
        // Same reasoning as startBatch: this is bookkeeping only, its failure
        // must not overwrite the accurate per-item outcome already persisted.
        try { await completeImportBatch(batch.id); } catch (error) { console.error("Souhrn dávky se nepodařilo uložit (záznamy byly přesto zpracovány):", error); }
        if (!cancelled) { setBusy(false); await reportBatchOutcome("Pokračování importu po návratu do aplikace dokončeno"); }
      } catch (error) {
        if (!cancelled) { setBusy(false); toast.error(`Obnovení importu se nepodařilo dokončit: ${errorMessage(error)}`); }
      }
    };
    void recover();
    const onVisibility = () => { if (document.visibilityState === "visible") void recover(); };
    document.addEventListener("visibilitychange", onVisibility);
    return () => { cancelled = true; document.removeEventListener("visibilitychange", onVisibility); };
  }, [allProducts.length, employees.length]);

  return <><div className="rounded-2xl border border-primary/30 bg-card/40 p-5 shadow-sm"><div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><div className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">Import dat • 2.0 AUTO</div><h2 className="text-xl font-semibold">Hromadný import screenshotů</h2><p className="text-sm text-muted-foreground">Každý screenshot se zpracuje samostatně. Bezpečné záznamy jdou automaticky do denních dat, výjimky do Ke schválení.</p></div><Button onClick={() => { reset(); setOpen(true); setTimeout(() => fileRef.current?.click(), 0); }} className="w-full sm:w-auto"><UploadCloud className="mr-2 h-4 w-4" />Vybrat screenshoty</Button></div></div><Dialog open={open} onOpenChange={(value) => { if (!value) close(); else setOpen(true); }}><DialogContent onPointerDownOutside={(event) => { if (busy) event.preventDefault(); }} onInteractOutside={(event) => { if (busy) event.preventDefault(); }} className="fixed inset-0 flex h-[100dvh] w-screen max-w-none translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden rounded-none border-0 p-0 sm:inset-4 sm:h-auto sm:max-h-[calc(100dvh-2rem)] sm:w-[calc(100vw-2rem)] sm:translate-x-0 sm:translate-y-0 sm:rounded-2xl sm:border"><DialogHeader className="shrink-0 border-b px-4 py-3 sm:px-6"><div className="flex items-center justify-between gap-3 pr-8"><div><DialogTitle className="text-lg">Hromadný import 2.0 AUTO</DialogTitle><div className="text-xs text-muted-foreground">Batch {batchId ? batchId.slice(0, 8) : "…"}</div></div><div className="text-xs text-muted-foreground">{counts.total} celkem</div></div></DialogHeader><div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-4 sm:px-6"><div className="mx-auto grid w-full max-w-6xl gap-4 lg:grid-cols-[0.8fr_1.2fr]"><section className="space-y-3"><input ref={fileRef} type="file" multiple accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => { const files = Array.from(e.target.files ?? []); if (files.length) void startBatch(files); }} /><div className="grid grid-cols-2 gap-2 sm:grid-cols-4"><div className="rounded-xl border p-3"><div className="text-xs text-muted-foreground">Automaticky</div><div className="text-2xl font-semibold">{counts.auto}</div></div><div className="rounded-xl border p-3"><div className="text-xs text-muted-foreground">Ke schválení</div><div className="text-2xl font-semibold">{counts.pending}</div></div><div className="rounded-xl border p-3"><div className="text-xs text-muted-foreground">Chyby</div><div className="text-2xl font-semibold">{counts.error}</div></div><div className="rounded-xl border p-3"><div className="text-xs text-muted-foreground">Zpracování</div><div className="text-2xl font-semibold">{counts.processing}</div></div></div>{items.map((item) => <button key={item.key} type="button" onClick={() => setSelectedKey(item.key)} className={`w-full rounded-2xl border p-4 text-left ${selectedKey === item.key ? "border-primary bg-primary/5" : "bg-card"}`}><div className="flex items-start gap-3"><div className="min-w-0 flex-1"><div className="truncate font-semibold">{item.fileName}</div><div className="mt-1 text-xs text-muted-foreground">{item.status === "PROCESSING" ? "Zpracovávám OCR…" : item.status === "QUEUED" ? "Čeká ve frontě" : item.status === "AUTO_APPROVED" ? `AUTO • ${item.createdRecords ?? 0} záznamů` : item.status === "DUPLICATE" ? "Duplicitní screenshot" : item.status === "PENDING_APPROVAL" ? "Ke schválení" : "Chyba"}</div></div>{item.status === "AUTO_APPROVED" ? <Check className="h-5 w-5" /> : item.status === "PENDING_APPROVAL" ? <AlertTriangle className="h-5 w-5" /> : item.status === "ERROR" || item.status === "DUPLICATE" ? <X className="h-5 w-5" /> : <Loader2 className="h-5 w-5 animate-spin" />}</div></button>)}</section><section className="space-y-4">{selected && <><div className="rounded-2xl border p-4"><div className="mb-3 flex items-center justify-between"><h3 className="font-semibold">Výsledek OCR</h3><span className="text-xs text-muted-foreground">Jistota hlavičky {selected.result ? `${Math.round((selected.result.header_confidence || 0) * 100)} %` : "—"}</span></div>{selected.result ? <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4"><div><span className="text-muted-foreground">Datum</span><div>{selected.result.work_date ?? "—"}</div></div><div><span className="text-muted-foreground">Směna</span><div>{selected.result.shift ?? "—"}</div></div><div><span className="text-muted-foreground">Linka</span><div>{selected.result.line ?? "—"}</div></div><div><span className="text-muted-foreground">Product</span><div className="break-all">{selected.result.product_code ?? selected.result.products?.[0]?.product_code ?? "—"}</div></div></div> : <div className="text-sm text-muted-foreground">Detail se zobrazí po dokončení OCR.</div>}</div>{selected.status === "PENDING_APPROVAL" && <div className="rounded-2xl border border-primary/40 bg-primary/5 p-4"><div className="font-semibold">Ke schválení</div><p className="mt-1 text-sm text-muted-foreground">Původní screenshot zůstává připojený k importu. Master data se automaticky nevytvářejí.</p>{selected.blockers?.length ? <ul className="mt-3 space-y-1 text-sm">{selected.blockers.map((blocker) => <li key={blocker}>• {blockerLabel(blocker)}</li>)}</ul> : null}</div>}{selected.message && <div className={`rounded-xl border p-3 text-sm ${selected.status === "ERROR" ? "border-destructive/40 bg-destructive/5 text-destructive" : "bg-muted/20"}`}>{selected.message}</div>}{previewUrl && <div className="overflow-hidden rounded-2xl border bg-black/20"><img src={previewUrl} alt={`Náhled ${selected.fileName}`} className="max-h-[45dvh] w-full object-contain" /></div>}</>}</section></div></div><DialogFooter className="shrink-0 border-t bg-background/95 px-3 py-3 sm:px-6"><Button variant="outline" className="w-full sm:w-auto" disabled={busy} onClick={close}><X className="mr-2 h-4 w-4" />Zavřít</Button></DialogFooter></DialogContent></Dialog></>;
}