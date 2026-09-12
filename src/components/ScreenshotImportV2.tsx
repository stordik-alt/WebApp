import { useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Check, ImageUp, Loader2, UploadCloud, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { extractScreenshotStage, type OcrHourlyMetric, type OcrProduct, type OcrResult } from "@/lib/ocr.functions";
import { extractHourlyWithContext, type ProductProfileContext } from "@/lib/ocr.hourly.functions";
import { preprocessOcrImage } from "@/lib/ocr-image";
import { useProducts } from "@/lib/data";
import type { Product } from "@/lib/products";
import { upsertImportedProductProfile } from "@/lib/productProfiles";
import { SHIFTS, type Employee } from "@/lib/metrics";
import { useApprovalFields } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type Stage = "products" | "profiles" | "employees" | "hourly" | "ready";
type EmployeeDraft = { key: string; ocrName: string; employeeId: string | null; position: "HA" | "TUP"; oee: string; performance: string; availableTime: string; confidence: number; include: boolean };
type ProfileDraft = { key: string; profileName: string; haCode: string; haNorm: string; haCapacity: string; tupCode: string; tupNorm: string; tupCapacity: string };

const normalize = (v: string | null | undefined) => (v ?? "").trim().replace(/\s+/g, "").toLowerCase();
const normalizeName = (v: string | null | undefined) => (v ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const sideCode = (code: string, side: "HA" | "TUP") => { const raw = code.trim().replace(/\s+/g, ""); if (!raw) return ""; const upper = raw.toUpperCase(); if (/^[HT]_/.test(upper)) return upper[0] + "_" + raw.slice(2); return `${side === "HA" ? "H" : "T"}_${raw}`; };
const asNumber = (v: string) => v.trim() === "" ? null : Number(v);
function employeeMatch(name: string, employees: Employee[]) { const wanted = normalizeName(name); if (!wanted) return undefined; return employees.find((e) => normalizeName(e.full_name) === wanted) ?? employees.find((e) => { const parts = wanted.split(" ").filter(Boolean); const candidate = normalizeName(e.full_name); return parts.length > 1 && parts.every((p) => candidate.includes(p)); }); }
function profileComplete(profile: ProductProfileContext | undefined, code: string) { if (!profile) return false; const wanted = normalize(code); const h = normalize(profile.ha_subassy) === wanted; const t = normalize(profile.tup_subassy) === wanted; const haOk = Boolean(profile.ha_subassy && Number(profile.h_norm_per_hour) > 0 && Number(profile.h_capacity) >= 1); const tupOk = Boolean(profile.tup_subassy && Number(profile.t_norm_per_hour) > 0 && Number(profile.t_capacity) >= 1); return (h || t) && haOk && tupOk; }
function shiftFromHours(metrics: OcrHourlyMetric[]): string | null { const hours = metrics.map((m) => m.hour).filter((h): h is number => h != null).map((h) => ((Math.round(h) % 24) + 24) % 24); if (!hours.length) return null; const min = Math.min(...hours); const max = Math.max(...hours); if (hours.some((h) => h >= 22 || h < 6)) return "Noční"; if (min >= 14 && max <= 21) return "Odpolední"; if (min >= 6 && max <= 13) return "Ranní"; return null; }

export function ScreenshotImportV2({ employees, onImported }: { employees: Employee[]; onImported?: () => void }) {
  const extractStage = useServerFn(extractScreenshotStage);
  const extractHourly = useServerFn(extractHourlyWithContext);
  const approval = useApprovalFields();
  const { data: products = [] } = useProducts();
  const fileRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState<Stage>("products");
  const [fileName, setFileName] = useState("");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [screenshotPath, setScreenshotPath] = useState<string | null>(null);
  const [result, setResult] = useState<OcrResult | null>(null);
  const [productDrafts, setProductDrafts] = useState<OcrProduct[]>([]);
  const [profiles, setProfiles] = useState<ProductProfileContext[]>([]);
  const [profileDrafts, setProfileDrafts] = useState<ProfileDraft[]>([]);
  const [employeeDrafts, setEmployeeDrafts] = useState<EmployeeDraft[]>([]);
  const [addedEmployees, setAddedEmployees] = useState<Employee[]>([]);
  const [newEmployeeRow, setNewEmployeeRow] = useState<string | null>(null);
  const [newEmployeeName, setNewEmployeeName] = useState("");
  const [newEmployeeNo, setNewEmployeeNo] = useState("");
  const [hourly, setHourly] = useState<OcrHourlyMetric[]>([]);
  const [actualOee, setActualOee] = useState<number | null>(null);
  const [saved, setSaved] = useState(false);

  const activeEmployees = useMemo(() => [...employees, ...addedEmployees].filter((e) => e.active), [employees, addedEmployees]);
  const allProducts = products as Product[];
  const selectedEmployees = employeeDrafts.filter((r) => r.include);
  const unresolved = selectedEmployees.filter((r) => !r.employeeId);
  const currentProduct = productDrafts[0]?.product_code ?? result?.product_code ?? "";

  const close = () => { if (busy) return; setOpen(false); reset(); };
  const reset = () => { setBusy(false); setStage("products"); setFileName(""); setPreviewUrl(null); setScreenshotPath(null); setResult(null); setProductDrafts([]); setProfiles([]); setProfileDrafts([]); setEmployeeDrafts([]); setAddedEmployees([]); setNewEmployeeRow(null); setNewEmployeeName(""); setNewEmployeeNo(""); setHourly([]); setActualOee(null); setSaved(false); if (fileRef.current) fileRef.current.value = ""; };

  const loadProfiles = async () => {
    const { data, error } = await supabase.from("product_profiles").select("id,ha_subassy,h_capacity,h_norm_per_hour,tup_subassy,t_capacity,t_norm_per_hour,valid_from,valid_to,version_no").is("valid_to", null);
    if (error) throw error;
    return (data ?? []) as ProductProfileContext[];
  };

  const openProfileSetup = (detected: OcrProduct[], activeProfiles: ProductProfileContext[]) => {
    const missing = detected.filter((p) => !profileComplete(activeProfiles.find((x) => normalize(x.ha_subassy) === normalize(p.product_code) || normalize(x.tup_subassy) === normalize(p.product_code)), p.product_code));
    const drafts: ProfileDraft[] = [];
    const seen = new Set<string>();
    for (const p of missing) {
      const isH = /^H_/i.test(p.product_code);
      const haCode = isH ? p.product_code : detected.find((x) => /^H_/i.test(x.product_code))?.product_code ?? sideCode(p.product_code, "HA");
      const tupCode = !isH ? p.product_code : detected.find((x) => /^T_/i.test(x.product_code))?.product_code ?? sideCode(p.product_code, "TUP");
      const key = `${normalize(haCode)}|${normalize(tupCode)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const hp = detected.find((x) => normalize(x.product_code) === normalize(haCode));
      const tp = detected.find((x) => normalize(x.product_code) === normalize(tupCode));
      const existing = activeProfiles.find((x) => normalize(x.ha_subassy) === normalize(haCode) || normalize(x.tup_subassy) === normalize(tupCode));
      const hProduct = allProducts.find((x) => normalize(x.code) === normalize(haCode));
      const tProduct = allProducts.find((x) => normalize(x.code) === normalize(tupCode));
      drafts.push({ key, profileName: "", haCode, haNorm: hp?.norm_per_hour != null ? String(hp.norm_per_hour) : existing?.h_norm_per_hour != null ? String(existing.h_norm_per_hour) : "", haCapacity: hProduct?.employees_per_product != null ? String(hProduct.employees_per_product) : existing?.h_capacity != null ? String(existing.h_capacity) : "", tupCode, tupNorm: tp?.norm_per_hour != null ? String(tp.norm_per_hour) : existing?.t_norm_per_hour != null ? String(existing.t_norm_per_hour) : "", tupCapacity: tProduct?.employees_per_product != null ? String(tProduct.employees_per_product) : existing?.t_capacity != null ? String(existing.t_capacity) : "" });
    }
    setProfileDrafts(drafts);
    setStage(drafts.length ? "profiles" : "employees");
    if (!drafts.length) void runEmployees();
  };

  const runEmployees = async (imageDataUrl?: string) => {
    const source = imageDataUrl ?? previewUrl;
    if (!source) return;
    setBusy(true); setStage("employees");
    try {
      const image = await preprocessOcrImage(source, { scale: 2, quality: 0.94, maxWidth: 4096, maxHeight: 4096 });
      const r = await extractStage({ data: { imageDataUrl: image, stage: "employees" } });
      const next = (r.rows ?? []).map((row, i) => { const name = String(row.employee_name ?? "").trim(); const match = employeeMatch(name, activeEmployees); const lineText = String(result?.line ?? "").toLowerCase(); const productText = String(currentProduct ?? "").toUpperCase(); const position = /hand\s*assy|handassy/.test(lineText) || /^H_/.test(productText) ? "HA" as const : /tup/.test(lineText) || /^T_/.test(productText) ? "TUP" as const : row.position === "TUP" ? "TUP" as const : "HA" as const; return { key: `${i}-${name}`, ocrName: name, employeeId: match?.id ?? null, position, oee: row.oee == null ? "" : String(row.oee), performance: row.performance == null ? "" : String(row.performance), availableTime: row.available_time == null ? "" : String(row.available_time), confidence: Number(row.confidence) || 0, include: true }; }).filter((r) => r.ocrName);
      setEmployeeDrafts(next);
      if (!next.length) toast.warning("OCR nenašlo čitelný řádek zaměstnance.");
    } catch (e) { toast.error(`2. sekvence OCR selhala: ${(e as Error).message}`); } finally { setBusy(false); }
  };

  const saveProfiles = async () => {
    setBusy(true);
    try {
      const date = result?.work_date ?? new Date().toISOString().slice(0, 10);
      for (const d of profileDrafts) {
        const haNorm = asNumber(d.haNorm), tupNorm = asNumber(d.tupNorm), haCapacity = asNumber(d.haCapacity), tupCapacity = asNumber(d.tupCapacity);
        if (!d.profileName.trim()) throw new Error("Zadejte název Product Profile.");
        if (!d.haCode.trim() || !d.tupCode.trim()) throw new Error("Product Profile musí obsahovat HA i TUP Product ID.");
        if (haNorm == null || !Number.isFinite(haNorm) || haNorm <= 0 || tupNorm == null || !Number.isFinite(tupNorm) || tupNorm <= 0) throw new Error("Obě normy musí být kladná čísla.");
        if (haCapacity == null || !Number.isInteger(haCapacity) || haCapacity < 1 || tupCapacity == null || !Number.isInteger(tupCapacity) || tupCapacity < 1) throw new Error("Obě kapacity musí být celé číslo alespoň 1.");
        const ensure = async (code: string, capacity: number, variant: "H" | "T") => {
          const existing = allProducts.find((p) => normalize(p.code) === normalize(code));
          if (existing) { if (existing.employees_per_product !== capacity) await supabase.from("products").update({ employees_per_product: capacity, variant_type: variant }).eq("id", existing.id); return existing; }
          const { data, error } = await supabase.from("products").insert({ code: code.trim(), name: d.profileName.trim(), employees_per_product: capacity, first_seen_date: date, variant_type: variant, ...approval() }).select("*").single();
          if (error) throw error; return data as Product;
        };
        const hp = await ensure(d.haCode, haCapacity, "H"); const tp = await ensure(d.tupCode, tupCapacity, "T");
        await upsertImportedProductProfile({ profileName: d.profileName.trim(), ha: { code: hp.code, norm: haNorm, capacity: haCapacity }, tup: { code: tp.code, norm: tupNorm, capacity: tupCapacity }, validFrom: date });
      }
      setProfiles(await loadProfiles()); setStage("employees"); await runEmployees();
    } catch (e) { toast.error(`Product Profile se nepodařilo uložit: ${(e as Error).message}`); } finally { setBusy(false); }
  };

  const runHourly = async () => {
    if (!previewUrl) return;
    if (unresolved.length) { toast.warning("Nejprve přiřaďte nebo vytvořte všechny zaměstnance."); return; }
    setBusy(true); setStage("hourly");
    try {
      const operatorCount = selectedEmployees.length; if (!operatorCount) throw new Error("Vyberte alespoň jednoho zaměstnance.");
      const relevant = profiles.filter((p) => productDrafts.some((d) => normalize(p.ha_subassy) === normalize(d.product_code) || normalize(p.tup_subassy) === normalize(d.product_code)));
      if (!relevant.length) throw new Error("Pro Product ID nebyl nalezen kompletní Product Profile.");
      const image = await preprocessOcrImage(previewUrl, { scale: 2, quality: 0.94, maxWidth: 4096, maxHeight: 4096 });
      const r = await extractHourly({ data: { imageDataUrl: image, context: { profiles: relevant, operator_count: operatorCount } } });
      const hourlyMetrics = r.hourly_metrics ?? [];
      setHourly(hourlyMetrics); setActualOee(r.actual_shift_oee_pct ?? null);
      const performanceValues = hourlyMetrics.map((m) => m.performance_pct).filter((v): v is number => v != null && Number.isFinite(v));
      const availabilityValues = hourlyMetrics.map((m) => m.availability_pct).filter((v): v is number => v != null && Number.isFinite(v));
      const performanceFromHourly = performanceValues.length ? performanceValues.reduce((a, b) => a + b, 0) / performanceValues.length : null;
      const availabilityFromHourly = availabilityValues.length ? availabilityValues.reduce((a, b) => a + b, 0) / availabilityValues.length : null;
      setEmployeeDrafts((prev) => prev.map((row) => ({ ...row, performance: performanceFromHourly != null ? String(Number(performanceFromHourly.toFixed(2))) : row.performance, availableTime: availabilityFromHourly != null ? String(Number(availabilityFromHourly.toFixed(2))) : row.availableTime })));
      const inferredShift = shiftFromHours(hourlyMetrics);
      if (inferredShift) setResult((prev) => prev ? { ...prev, shift: inferredShift } : prev);
      setStage("ready");
    } catch (e) { toast.error(`3. sekvence OCR selhala: ${(e as Error).message}`); setStage("employees"); } finally { setBusy(false); }
  };

  const saveImport = async () => {
    setBusy(true);
    try {
      const workDate = result?.work_date ?? new Date().toISOString().slice(0, 10);
      const shift = shiftFromHours(hourly) ?? result?.shift ?? SHIFTS[0];
      const line = result?.line?.trim() ?? "";
      if (!line) throw new Error("Chybí výrobní linka.");
      const selected = selectedEmployees;
      if (actualOee == null || !Number.isFinite(actualOee)) throw new Error("Skutečné OEE nebylo vypočteno. Import nelze uložit.");
      const hourlyPerformanceValues = hourly.map((m) => m.performance_pct).filter((v): v is number => v != null && Number.isFinite(v));
      const hourlyAvailabilityValues = hourly.map((m) => m.availability_pct).filter((v): v is number => v != null && Number.isFinite(v));
      const performanceFromHourly = hourlyPerformanceValues.length ? hourlyPerformanceValues.reduce((a, b) => a + b, 0) / hourlyPerformanceValues.length : null;
      const availabilityFromHourly = hourlyAvailabilityValues.length ? hourlyAvailabilityValues.reduce((a, b) => a + b, 0) / hourlyAvailabilityValues.length : null;
      if (performanceFromHourly == null || availabilityFromHourly == null) throw new Error("3. sekvence neposkytla platný Výkon nebo Dostupnost. Import nelze uložit.");
      const records = [];
      for (const row of selected) {
        const productCode = row.position === "TUP" ? productDrafts.find((p) => /^T_/i.test(p.product_code))?.product_code ?? currentProduct : productDrafts.find((p) => /^H_/i.test(p.product_code))?.product_code ?? currentProduct;
        const product = allProducts.find((p) => normalize(p.code) === normalize(productCode));
        if (!product) throw new Error(`Product ID ${productCode} nebylo nalezeno.`);
        records.push({ employee_id: row.employeeId, work_date: workDate, shift, line, product_id: product.id, position: row.position, oee: actualOee, performance: Number(performanceFromHourly.toFixed(2)), available_time: Number(availabilityFromHourly.toFixed(2)), help_score: 0, screenshot_path: screenshotPath, ...approval() });
      }
      if (!records.length) throw new Error("Import neobsahuje žádného vybraného zaměstnance.");
      const { error } = await supabase.from("daily_records").insert(records);
      if (error) throw error;
      setSaved(true); toast.success(`Import uložen pro ${records.length} zaměstnanců.`); onImported?.();
    } catch (e) { toast.error(`Import se nepodařilo uložit: ${(e as Error).message}`); } finally { setBusy(false); }
  };

  const startFile = async (file: File) => {
    setOpen(true); setBusy(true); setStage("products"); setFileName(file.name);
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(new Error("Soubor se nepodařilo načíst.")); reader.readAsDataURL(file); });
      setPreviewUrl(dataUrl);
      const image = await preprocessOcrImage(dataUrl, { scale: 2, quality: 0.94, maxWidth: 4096, maxHeight: 4096 });
      const path = `daily/${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}.${(file.name.split(".").pop() || "png").toLowerCase()}`;
      const upload = await supabase.storage.from("screenshots").upload(path, file, { contentType: file.type || "image/png" }); if (!upload.error) setScreenshotPath(path);
      const r = await extractStage({ data: { imageDataUrl: image, stage: "products" } });
      setResult(r); setProductDrafts(r.products?.length ? r.products : r.product_code ? [{ product_code: r.product_code, norm_per_hour: r.norm_per_hour, confidence: r.header_confidence }] : []);
      const loadedProfiles = await loadProfiles(); setProfiles(loadedProfiles);
      setStage("products");
      const detected = r.products?.length ? r.products : r.product_code ? [{ product_code: r.product_code, norm_per_hour: r.norm_per_hour, confidence: r.header_confidence }] : [];
      const missing = detected.filter((p) => !profileComplete(loadedProfiles.find((x) => normalize(x.ha_subassy) === normalize(p.product_code) || normalize(x.tup_subassy) === normalize(p.product_code)), p.product_code));
      if (missing.length) openProfileSetup(detected, loadedProfiles); else await runEmployees(dataUrl);
    } catch (e) { toast.error(`1. sekvence OCR selhala: ${(e as Error).message}`); } finally { setBusy(false); }
  };

  const patchEmployee = (key: string, patch: Partial<EmployeeDraft>) => setEmployeeDrafts((prev) => prev.map((r) => r.key === key ? { ...r, ...patch } : r));
  const createEmployee = async () => {
    const name = newEmployeeName.trim(); if (!name) return;
    try {
      const { data, error } = await supabase.from("employees").insert({ full_name: name, personal_no: newEmployeeNo.trim() || null, active: true, qual_ha: false, qual_tup: false, is_temporary: false, position_type: "standard", note: null }).select("*").single();
      if (error) throw error; if (!data) throw new Error("Zaměstnance se nepodařilo načíst po uložení.");
      setAddedEmployees((prev) => [...prev, data as Employee]); if (newEmployeeRow) patchEmployee(newEmployeeRow, { employeeId: data.id }); setNewEmployeeRow(null); setNewEmployeeName(""); setNewEmployeeNo(""); toast.success("Zaměstnanec byl vytvořen a přiřazen.");
    } catch (e) { toast.error(`Zaměstnance se nepodařilo vytvořit: ${(e as Error).message}`); }
  };

  return <>
    <div className="rounded-2xl border border-primary/30 bg-card/40 p-5 shadow-sm">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div><div className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">Import dat</div><h2 className="text-xl font-semibold">Screenshoty výroby</h2><p className="text-sm text-muted-foreground">Import probíhá v samostatném okně optimalizovaném pro telefon.</p></div>
        <Button onClick={() => { reset(); setOpen(true); }} className="w-full sm:w-auto"><UploadCloud className="mr-2 h-4 w-4" />Importovat screenshot</Button>
      </div>
    </div>

    <Dialog open={open} onOpenChange={(v) => { if (!v) close(); else setOpen(true); }}>
      <DialogContent className="fixed inset-0 flex h-[100dvh] w-screen max-w-none translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden rounded-none border-0 p-0 sm:inset-4 sm:h-auto sm:max-h-[calc(100dvh-2rem)] sm:w-[calc(100vw-2rem)] sm:translate-x-0 sm:translate-y-0 sm:rounded-2xl sm:border">
        <DialogHeader className="shrink-0 border-b px-4 py-3 sm:px-6">
          <div className="flex items-center justify-between gap-3 pr-8"><div><DialogTitle className="text-lg">Import screenshotu</DialogTitle><div className="text-xs text-muted-foreground">{stage === "products" ? "1 / 3 Produkty" : stage === "profiles" ? "1 / 3 Product Profile" : stage === "employees" ? "2 / 3 Zaměstnanci" : stage === "hourly" ? "3 / 3 Hodinová data" : "Kontrola před uložením"}</div></div>{fileName && <div className="max-w-[45%] truncate text-xs text-muted-foreground">{fileName}</div>}</div>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-4 sm:px-6">
          <div className="mx-auto grid w-full max-w-6xl gap-4 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
            <section className="space-y-3">
              {!previewUrl ? <button type="button" className="flex min-h-56 w-full flex-col items-center justify-center rounded-2xl border-2 border-dashed border-primary/40 bg-muted/20 p-6 text-center" onClick={() => fileRef.current?.click()}><ImageUp className="mb-3 h-10 w-10 text-primary" /><span className="font-semibold">Vyberte screenshot</span><span className="mt-1 text-sm text-muted-foreground">PNG nebo JPG • celé okno se přizpůsobí telefonu</span></button> : <div className="overflow-hidden rounded-2xl border bg-black/20"><img src={previewUrl} alt="Náhled importovaného screenshotu" className="max-h-[38dvh] w-full object-contain" /></div>}
              <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void startFile(f); }} />
              {result && <div className="rounded-2xl border p-4 text-sm"><div className="font-semibold">Hlavička</div><div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3"><div><span className="text-muted-foreground">Datum</span><div>{result.work_date ?? "—"}</div></div><div><span className="text-muted-foreground">Směna</span><div>{result.shift ?? "—"}</div></div><div><span className="text-muted-foreground">Linka</span><div>{result.line ?? "—"}</div></div></div></div>}
            </section>

            <section className="space-y-4">
              {busy && <div className="flex items-center gap-2 rounded-xl border bg-muted/20 p-3 text-sm"><Loader2 className="h-4 w-4 animate-spin" />Zpracovávám OCR…</div>}
              {stage === "products" && result && <div className="space-y-3"><div className="rounded-2xl border p-4"><div className="mb-2 font-semibold">Rozpoznané Product ID</div>{productDrafts.map((p) => <div key={p.product_code} className="rounded-xl bg-muted/30 p-3"><div className="font-medium break-all">{p.product_code}</div><div className="text-sm text-muted-foreground">OCR jistota {Math.round((p.confidence || 0) * 100)} % • norma {p.norm_per_hour ?? "—"} ks/h</div></div>)}</div></div>}

              {stage === "profiles" && <div className="space-y-3"><div className="rounded-2xl border p-4"><h3 className="text-lg font-semibold">Potvrzení Product Profile</h3><p className="mt-1 text-sm text-muted-foreground">Norma je návrh OCR. Kapacitu musí potvrdit administrátor. Hodnoty nejsou automaticky nastavené na 1.</p></div>{profileDrafts.map((d, i) => <div key={d.key} className="space-y-4 rounded-2xl border p-4"><div className="space-y-2"><Label>Název profilu *</Label><Input value={d.profileName} onChange={(e) => setProfileDrafts((p) => p.map((x, j) => j === i ? { ...x, profileName: e.target.value } : x))} placeholder="např. Immergas V3646" /></div><div className="grid grid-cols-1 gap-4 sm:grid-cols-2"><div className="space-y-2"><Label>HA Product ID</Label><Input value={d.haCode} readOnly /><Label>HA norma</Label><Input inputMode="decimal" value={d.haNorm} onChange={(e) => setProfileDrafts((p) => p.map((x, j) => j === i ? { ...x, haNorm: e.target.value } : x))} /><Label>HA kapacita operátorů *</Label><Input inputMode="numeric" value={d.haCapacity} onChange={(e) => setProfileDrafts((p) => p.map((x, j) => j === i ? { ...x, haCapacity: e.target.value } : x))} placeholder="např. 2" /></div><div className="space-y-2"><Label>TUP Product ID</Label><Input value={d.tupCode} readOnly /><Label>TUP norma</Label><Input inputMode="decimal" value={d.tupNorm} onChange={(e) => setProfileDrafts((p) => p.map((x, j) => j === i ? { ...x, tupNorm: e.target.value } : x))} /><Label>TUP kapacita operátorů *</Label><Input inputMode="numeric" value={d.tupCapacity} onChange={(e) => setProfileDrafts((p) => p.map((x, j) => j === i ? { ...x, tupCapacity: e.target.value } : x))} placeholder="např. 2" /></div></div></div>)}</div>}

              {stage === "employees" && <div className="space-y-3"><div className="rounded-2xl border p-4"><h3 className="text-lg font-semibold">Zaměstnanci</h3><p className="mt-1 text-sm text-muted-foreground">Zkontrolujte hodnoty přímo z řádku zaměstnance. Výkon a dostupnost se nesmějí zaměnit s hodinovou tabulkou.</p></div>{employeeDrafts.map((r) => <div key={r.key} className="space-y-3 rounded-2xl border p-4"><div className="flex items-center gap-3"><input type="checkbox" checked={r.include} onChange={(e) => patchEmployee(r.key, { include: e.target.checked })} className="h-5 w-5" /><div className="min-w-0 flex-1"><div className="font-semibold break-words">{r.ocrName}</div><div className="text-xs text-muted-foreground">OCR jistota {Math.round(r.confidence * 100)} %</div></div></div><div className="grid grid-cols-1 gap-3 sm:grid-cols-2"><div><Label>Pozice</Label><Select value={r.position} onValueChange={(v) => patchEmployee(r.key, { position: v as "HA" | "TUP" })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="HA">HA</SelectItem><SelectItem value="TUP">TUP</SelectItem></SelectContent></Select></div><div><Label>Přiřazený zaměstnanec</Label>{r.employeeId ? <div className="rounded-md border bg-muted/20 px-3 py-2 text-sm">{activeEmployees.find((e) => e.id === r.employeeId)?.full_name ?? "Přiřazen"}</div> : <Button variant="outline" className="w-full" onClick={() => { setNewEmployeeRow(r.key); setNewEmployeeName(r.ocrName); }}>+ Vytvořit zaměstnance</Button>}</div></div><div className="grid grid-cols-1 gap-3 sm:grid-cols-3"><div><Label>OEE % (OCR)</Label><Input inputMode="decimal" value={r.oee} onChange={(e) => patchEmployee(r.key, { oee: e.target.value })} placeholder="OCR" /></div><div><Label>Výkon %</Label><Input inputMode="decimal" value={r.performance} onChange={(e) => patchEmployee(r.key, { performance: e.target.value })} placeholder="OCR" /></div><div><Label>Dostupnost %</Label><Input inputMode="decimal" value={r.availableTime} onChange={(e) => patchEmployee(r.key, { availableTime: e.target.value })} placeholder="OCR" /></div></div></div>)}{newEmployeeRow && <div className="rounded-2xl border p-4"><h4 className="font-semibold">Nový zaměstnanec</h4><div className="mt-3 grid gap-3 sm:grid-cols-2"><Input value={newEmployeeName} onChange={(e) => setNewEmployeeName(e.target.value)} placeholder="Jméno a příjmení" /><Input value={newEmployeeNo} onChange={(e) => setNewEmployeeNo(e.target.value)} placeholder="Osobní číslo (volitelné)" /></div><Button className="mt-3 w-full sm:w-auto" onClick={() => void createEmployee()}>Uložit a přiřadit</Button></div>}</div>}

              {(stage === "hourly" || stage === "ready") && <div className="space-y-3"><div className="rounded-2xl border p-4"><h3 className="text-lg font-semibold">Hodinová data</h3><p className="mt-1 text-sm text-muted-foreground">Norma a kapacita pochází z Product Profile. Směna se kontroluje také podle hodinové tabulky.</p>{stage === "ready" && <div className="mt-3 rounded-xl bg-muted/30 p-3 text-sm"><div>Výpočet skutečného OEE: výkon × dostupnost × (kapacita / počet operátorů) / 100</div><div className="mt-1 text-lg font-semibold">Skutečné OEE: {actualOee == null ? "nelze spočítat" : `${actualOee.toFixed(2)} %`}</div><div className="mt-1">Směna: {shiftFromHours(hourly) ?? result?.shift ?? "—"}</div></div>}</div>{hourly.map((m, i) => <div key={`${m.hour}-${i}`} className="grid grid-cols-2 gap-2 rounded-xl border p-3 sm:grid-cols-5"><div><span className="text-xs text-muted-foreground">Hodina</span><div>{m.hour ?? "—"}</div></div><div><span className="text-xs text-muted-foreground">Produkt</span><div className="break-all">{m.product_code ?? "—"}</div></div><div><span className="text-xs text-muted-foreground">Výstup</span><div>{m.actual_output ?? "—"}</div></div><div><span className="text-xs text-muted-foreground">Výkon</span><div>{m.performance_pct == null ? "—" : `${m.performance_pct} %`}</div></div><div><span className="text-xs text-muted-foreground">Dostupnost</span><div>{m.availability_pct == null ? "—" : `${m.availability_pct} %`}</div></div></div>)}</div>}

              {stage === "ready" && <div className="rounded-2xl border border-primary/40 bg-primary/5 p-4"><div className="flex items-start gap-3"><Check className="mt-0.5 h-5 w-5 shrink-0 text-primary" /><div><div className="font-semibold">Import je připraven</div><div className="text-sm text-muted-foreground">Před uložením zkontrolujte všechny hodnoty. Směna bude uložena jako {shiftFromHours(hourly) ?? result?.shift ?? SHIFTS[0]}.</div></div></div></div>}
            </section>
          </div>
        </div>
        <DialogFooter className="shrink-0 border-t bg-background/95 px-3 py-3 sm:px-6">
          <div className="flex w-full flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="outline" className="w-full sm:w-auto" disabled={busy} onClick={close}><X className="mr-2 h-4 w-4" />Zrušit</Button>
            {!previewUrl && <Button className="w-full sm:w-auto" onClick={() => fileRef.current?.click()}><UploadCloud className="mr-2 h-4 w-4" />Vybrat screenshot</Button>}
            {stage === "profiles" && <Button className="w-full sm:w-auto" disabled={busy} onClick={() => void saveProfiles()}>Potvrdit Product Profile</Button>}
            {stage === "employees" && <Button className="w-full sm:w-auto" disabled={busy || unresolved.length > 0 || selectedEmployees.length === 0} onClick={() => void runHourly()}>Pokračovat na hodinová data</Button>}
            {stage === "ready" && <Button className="w-full sm:w-auto" disabled={busy || saved} onClick={() => void saveImport()}>{saved ? "Import uložen" : "Uložit import"}</Button>}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </>;
}
