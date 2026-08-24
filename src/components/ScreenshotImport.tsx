import { useMemo, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Check, ImageUp, Loader2, Plus, Trash2, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { extractScreenshotStage, type OcrProduct, type OcrResult, type OcrHourlyMetric } from "@/lib/ocr.functions";
import { useProductNorms, useProducts, useShiftAggregates } from "@/lib/data";
import { currentNorm, findProductByCode, type Product } from "@/lib/products";
import { SHIFTS, type Employee } from "@/lib/metrics";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useApprovalFields } from "@/lib/auth";

type DraftRow = { key: string; ocrName: string; employeeId: string | null; position: "HA" | "TUP"; oee: string; performance: string; availableTime: string; helpScore: string; confidence: number; include: boolean };
type DraftProduct = OcrProduct & { key: string; employees_per_product: number | null };
type ProductSetupDraft = { key: string; code: string; norm: string; capacity: string; confidence: number };
type ImportStage = "products" | "employees" | "hourly" | "ready";
const strip = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9 ]/g, "").trim();
function matchEmployee(name: string, employees: Employee[]): Employee | undefined { const n = strip(name); if (!n) return undefined; const exact = employees.find((e) => strip(e.full_name) === n); if (exact) return exact; const parts = n.split(/\s+/).filter(Boolean); return employees.find((e) => { const en = strip(e.full_name); return parts.length > 1 && parts.every((p) => en.includes(p)); }); }

export function ScreenshotImport({ employees, onImported }: { employees: Employee[]; onImported?: () => void }) {
  const qc = useQueryClient();
  const approval = useApprovalFields();
  const extractStage = useServerFn(extractScreenshotStage);
  const { data: products = [] } = useProducts();
  const { data: norms = [] } = useProductNorms();
  const { records: existingRecords, shifts: existingShifts } = useShiftAggregates();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false); const [stage, setStage] = useState<ImportStage>("products"); const [result, setResult] = useState<OcrResult | null>(null); const [screenshotPath, setScreenshotPath] = useState<string | null>(null); const [previewUrl, setPreviewUrl] = useState<string | null>(null); const [workDate, setWorkDate] = useState(""); const [shift, setShift] = useState<string>(SHIFTS[0]); const [line, setLine] = useState(""); const [productCode, setProductCode] = useState(""); const [normValue, setNormValue] = useState(""); const [productDrafts, setProductDrafts] = useState<DraftProduct[]>([]); const [rows, setRows] = useState<DraftRow[]>([]);
  const [addedEmployees, setAddedEmployees] = useState<Employee[]>([]); const [employeeSetupOpen, setEmployeeSetupOpen] = useState(false); const [addEmployeeOpen, setAddEmployeeOpen] = useState(false); const [addEmployeeRowKey, setAddEmployeeRowKey] = useState<string | null>(null); const [addEmployeeName, setAddEmployeeName] = useState(""); const [addEmployeePersonalNo, setAddEmployeePersonalNo] = useState("");
  const [newProductModalOpen, setNewProductModalOpen] = useState(false); const [productSetupSaving, setProductSetupSaving] = useState(false); const [productSetupDrafts, setProductSetupDrafts] = useState<ProductSetupDraft[]>([]); const [createdProducts, setCreatedProducts] = useState<Product[]>([]);
  const [hourlyMetrics, setHourlyMetrics] = useState<OcrHourlyMetric[]>([]);
  const activeEmployees = useMemo(() => [...employees, ...addedEmployees].filter((e) => e.active), [employees, addedEmployees]);
  const allProducts = useMemo(() => {
    const byCode = new Map<string, Product>();
    [...products, ...createdProducts].forEach((p) => byCode.set(p.code.trim().toLowerCase(), p));
    return Array.from(byCode.values());
  }, [products, createdProducts]);
  const primaryProductCode = productDrafts[0]?.product_code || productCode.trim();
  const normNum = normValue === "" ? null : Number(normValue);
  const missingProductCodes = useMemo(() => productDrafts.filter((p) => !findProductByCode(allProducts, p.product_code)).map((p) => p.product_code), [productDrafts, allProducts]);
  const patch = (key: string, p: Partial<DraftRow>) => setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...p } : r)));
  const reset = () => { setStage("products"); setResult(null); setHourlyMetrics([]); setEmployeeSetupOpen(false); setRows([]); setProductDrafts([]); setScreenshotPath(null); setPreviewUrl(null); setProductCode(""); setNormValue(""); setAddedEmployees([]); setAddEmployeeOpen(false); setAddEmployeeRowKey(null); setAddEmployeeName(""); setAddEmployeePersonalNo(""); setNewProductModalOpen(false); setProductSetupSaving(false); setProductSetupDrafts([]); setCreatedProducts([]); if (fileRef.current) fileRef.current.value = ""; };
  const openAddEmployee = (row: DraftRow) => { setAddEmployeeRowKey(row.key); setAddEmployeeName(row.ocrName.trim()); setAddEmployeePersonalNo(""); setAddEmployeeOpen(true); };
  const createEmployee = useMutation({
    mutationFn: async () => {
      const fullName = addEmployeeName.trim();
      const personalNo = addEmployeePersonalNo.trim();
      if (!fullName) throw new Error("Zadejte jméno zaměstnance.");
      if (personalNo) {
        const { data: byPersonalNo, error: lookupError } = await supabase.from("employees").select("*").eq("personal_no", personalNo).maybeSingle();
        if (lookupError) throw lookupError;
        if (byPersonalNo) return byPersonalNo as Employee;
      }
      const existing = matchEmployee(fullName, [...employees, ...addedEmployees]);
      if (existing) return existing;
      const payload = { full_name: fullName, personal_no: personalNo || null, qual_ha: false, qual_tup: false, active: true, is_temporary: false, position_type: "standard" as const, note: null };
      const { data, error } = await supabase.from("employees").insert(payload).select("*").single();
      if (error) throw error;
      if (!data) throw new Error("Zaměstnanec byl uložen, ale nepodařilo se načíst vytvořený záznam.");
      return data as Employee;
    },
    onSuccess: (employee) => {
      setAddedEmployees((prev) => prev.some((e) => e.id === employee.id) ? prev : [...prev, employee]);
      if (addEmployeeRowKey) patch(addEmployeeRowKey, { employeeId: employee.id });
      qc.invalidateQueries({ queryKey: ["employees"] });
      setAddEmployeeOpen(false);
      setAddEmployeeRowKey(null);
      setAddEmployeeName("");
      setAddEmployeePersonalNo("");
      toast.success(`Zaměstnanec „${employee.full_name}" byl přidán a přiřazen k řádku importu.`);
    },
    onError: (e: Error) => toast.error(`Zaměstnance se nepodařilo přidat: ${e.message}`),
  });

  const openProductSetup = (detected: DraftProduct[]) => {
    const missing = detected.filter((p) => !findProductByCode(allProducts, p.product_code));
    if (!missing.length) return;
    setProductSetupDrafts(missing.map((p, i) => ({
      key: `${i}-${p.product_code}`,
      code: p.product_code.trim(),
      norm: p.norm_per_hour != null ? String(p.norm_per_hour) : "",
      capacity: String(findProductByCode(allProducts, p.product_code)?.employees_per_product ?? 1),
      confidence: p.confidence,
    })));
    setNewProductModalOpen(true);
  };

  const createProductIds = async () => {
    if (!productSetupDrafts.length) return;
    setProductSetupSaving(true);
    try {
      const date = workDate || new Date().toISOString().slice(0, 10);
      const created: Product[] = [];
      for (const draft of productSetupDrafts) {
        const code = draft.code.trim();
        const norm = Number(draft.norm);
        const capacity = Number(draft.capacity);
        if (!code) throw new Error("Každý Product ID musí mít kód.");
        if (!Number.isFinite(norm) || norm <= 0) throw new Error(`Zadejte platnou normu pro ${code}.`);
        if (!Number.isInteger(capacity) || capacity < 1) throw new Error(`Zadejte platnou kapacitu operátorů pro ${code}.`);
        const already = findProductByCode(allProducts, code) ?? created.find((p) => p.code.trim().toLowerCase() === code.toLowerCase());
        const product = already ?? (await (async () => {
          const base = code.replace(/^[HT]_?/i, "");
          const { data, error } = await supabase.from("products").insert({
            code,
            name: base ? `Produkt ${base}` : code,
            employees_per_product: capacity,
            first_seen_date: date,
            ...approval(),
          }).select("*").single();
          if (error) throw error;
          return data as Product;
        })());
        if (!already) {
          const operation: "HA" | "TUP" = /^T_/i.test(code) ? "TUP" : "HA";
          const { error: normError } = await supabase.from("product_norms").insert({
            product_id: product.id,
            operation,
            norm_per_hour: norm,
            valid_from: date,
            source: "screenshot",
            confirmed: true,
            note: "Norma vytvořená při importu screenshotu",
            ...approval(),
          });
          if (normError) throw normError;
        }
        created.push(product);
      }
      setCreatedProducts((prev) => {
        const byCode = new Map(prev.map((p) => [p.code.trim().toLowerCase(), p]));
        created.forEach((p) => byCode.set(p.code.trim().toLowerCase(), p));
        return Array.from(byCode.values());
      });
      setNewProductModalOpen(false);
      setProductSetupDrafts([]);
      qc.invalidateQueries({ queryKey: ["products"] });
      qc.invalidateQueries({ queryKey: ["product_norms"] });
      toast.success(`Zkontrolováno/ založeno ${productSetupDrafts.length} Product ID. Pokračuji na zaměstnance.`);
      if (previewUrl) void runEmployeeStage(previewUrl);
    } finally {
      setProductSetupSaving(false);
    }
  };

  const runEmployeeStage = async (imageDataUrl: string) => {
    setBusy(true); setStage("employees");
    try {
      const r = await extractStage({ data: { imageDataUrl, stage: "employees" } });
      setResult((prev) => ({ ...(prev ?? r), work_date: prev?.work_date ?? r.work_date, shift: prev?.shift ?? r.shift, line: prev?.line ?? r.line, product_code: prev?.product_code ?? r.product_code, norm_per_hour: prev?.norm_per_hour ?? r.norm_per_hour, products: prev?.products?.length ? prev.products : r.products, header_confidence: Math.max(prev?.header_confidence ?? 0, r.header_confidence), rows: r.rows, hourly_metrics: prev?.hourly_metrics ?? [], predicted_shift_output: prev?.predicted_shift_output ?? null, productive_minutes: prev?.productive_minutes ?? null }));
      const fallbackPosition: "HA" | "TUP" = productDrafts.some((p) => /^T_/i.test(p.product_code)) ? "TUP" : "HA";
      const nextRows: DraftRow[] = r.rows.map((row, i) => {
        const emp = matchEmployee(row.employee_name, activeEmployees);
        return { key: i + "-" + (row.employee_name || "manual"), ocrName: row.employee_name, employeeId: emp?.id ?? null, position: row.position ?? fallbackPosition, oee: row.oee !== null ? String(row.oee) : "", performance: row.performance !== null ? String(row.performance) : "", availableTime: row.available_time !== null ? String(row.available_time) : "", helpScore: "0", confidence: row.confidence, include: true };
      });
      setRows(nextRows);
      if (!nextRows.length || nextRows.some((r) => r.include && !r.employeeId)) { setEmployeeSetupOpen(true); if (!nextRows.length) toast.warning("OCR zaměstnanců nevrátil žádný čitelný řádek. Hodinová data se zatím nespustí."); }
      else await runHourlyStage(imageDataUrl, nextRows);
    } catch (e) { toast.error("OCR zaměstnanců se nepodařilo dokončit: " + (e as Error).message); setStage("employees"); }
    finally { setBusy(false); }
  };

  const runHourlyStage = async (imageDataUrl: string, employeeRows: DraftRow[] = rows) => {
    setBusy(true); setStage("hourly");
    try {
      const r = await extractStage({ data: { imageDataUrl, stage: "hourly" } });
      const resolveImportNorm = (code: string | null) => {
        const target = code || productDrafts[0]?.product_code || productCode;
        const product = findProductByCode(allProducts, target);
        if (product) {
          const operation: "HA" | "TUP" = /^T_/i.test(product.code) ? "TUP" : "HA";
          const dbNorm = currentNorm(norms, product.id, operation);
          if (dbNorm) return Number(dbNorm.norm_per_hour);
        }
        const draft = productDrafts.find((p) => p.product_code.trim().toLowerCase() === target.trim().toLowerCase());
        return draft?.norm_per_hour ?? null;
      };
      const hourly = (r.hourly_metrics ?? []).map((metric) => ({
        ...metric,
        norm_per_hour: resolveImportNorm(metric.product_code),
      }));
      setHourlyMetrics(hourly);
      const avgPerformanceValues = hourly.map((x) => x.performance_pct).filter((x): x is number => x !== null);
      const avgAvailabilityValues = hourly.map((x) => x.availability_pct).filter((x): x is number => x !== null);
      const performanceFallback = avgPerformanceValues.length ? avgPerformanceValues.reduce((a, b) => a + b, 0) / avgPerformanceValues.length : null;
      const availabilityFallback = avgAvailabilityValues.length ? avgAvailabilityValues.reduce((a, b) => a + b, 0) / avgAvailabilityValues.length : null;
      const completedRows = employeeRows.map((row) => ({ ...row, performance: row.performance === "" && performanceFallback !== null ? String(performanceFallback) : row.performance, availableTime: row.availableTime === "" && availabilityFallback !== null ? String(availabilityFallback) : row.availableTime }));
      setRows(completedRows);
      const primaryImportNorm = resolveImportNorm(productDrafts[0]?.product_code || r.product_code);
      setResult((prev) => ({ ...(prev ?? r), work_date: prev?.work_date ?? r.work_date, shift: prev?.shift ?? r.shift, line: prev?.line ?? r.line, product_code: prev?.product_code ?? r.product_code, norm_per_hour: primaryImportNorm ?? prev?.norm_per_hour ?? r.norm_per_hour, products: prev?.products?.length ? prev.products : r.products, header_confidence: Math.max(prev?.header_confidence ?? 0, r.header_confidence), rows: completedRows, hourly_metrics: hourly, predicted_shift_output: r.predicted_shift_output, productive_minutes: r.productive_minutes }));
      setStage("ready");
      toast.success("OCR dokončen: produkty, zaměstnanci i hodinová data jsou připravena k importu.");
    } catch (e) { toast.error("OCR hodinových dat se nepodařilo dokončit: " + (e as Error).message); setStage("hourly"); }
    finally { setBusy(false); }
  };

  const onFile = async (file: File) => {
    setBusy(true); setStage("products"); setResult(null); setRows([]); setProductDrafts([]); setHourlyMetrics([]);
    try {
      const dataUrl = await new Promise<string>((res, rej) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result)); fr.onerror = () => rej(new Error("Soubor se nepodařilo načíst.")); fr.readAsDataURL(file); });
      setPreviewUrl(dataUrl);
      const ext = (file.name.split(".").pop() || "png").toLowerCase();
      const path = "daily/" + new Date().toISOString().slice(0, 10) + "/" + crypto.randomUUID() + "." + ext;
      const { error: upErr } = await supabase.storage.from("screenshots").upload(path, file, { contentType: file.type || "image/png" });
      if (upErr) toast.warning("Screenshot se nepodařilo uložit do archivu, rozpoznávání pokračuje."); else setScreenshotPath(path);
      // FÁZE 1: pouze produkty a hlavička.
      const r = await extractStage({ data: { imageDataUrl: dataUrl, stage: "products" } });
      setResult(r); setWorkDate(r.work_date ?? new Date().toISOString().slice(0, 10)); setShift(r.shift && SHIFTS.includes(r.shift as never) ? r.shift : SHIFTS[0]); setLine(r.line ?? ""); setProductCode(r.product_code ?? ""); setNormValue(r.norm_per_hour !== null ? String(r.norm_per_hour) : "");
      const detectedProducts = r.products?.length ? r.products : (r.product_code ? [{ product_code: r.product_code, norm_per_hour: r.norm_per_hour, confidence: r.header_confidence }] : []);
      setProductDrafts(detectedProducts.map((p, i) => ({ ...p, key: i + "-" + p.product_code, employees_per_product: findProductByCode(allProducts, p.product_code)?.employees_per_product ?? null })));
      const newProducts = detectedProducts.filter((p) => !findProductByCode(allProducts, p.product_code));
      if (newProducts.length > 0) { setStage("products"); openProductSetup(detectedProducts); toast.warning("Nalezeno " + newProducts.length + " nové Product ID. Nejprve je založte."); }
      else await runEmployeeStage(dataUrl);
    } catch (e) { toast.error((e as Error).message); setStage("products"); }
    finally { setBusy(false); }
  };
  const unresolvedEmployeeRows = rows.filter((r) => r.include && !r.employeeId);
  const continueAfterEmployees = async () => { if (!previewUrl) return; if (!rows.length) { toast.warning("Nejdříve musí OCR rozpoznat alespoň jednoho zaměstnance."); return; } if (unresolvedEmployeeRows.length) { toast.warning("Nejprve přiřaďte nebo vytvořte všechny zaměstnance z OCR."); return; } setEmployeeSetupOpen(false); await runHourlyStage(previewUrl, rows); };

  const setDraftNorm = (key: string, value: string) => setProductDrafts((prev) => prev.map((p) => p.key === key ? { ...p, norm_per_hour: value === "" ? null : Number(value) } : p));

  const confirmImport = useMutation({
    mutationFn: async () => {
      if (!line.trim()) throw new Error("Doplňte linku."); const l = line.trim().toLowerCase();
      const selected = rows.filter((r) => r.include && r.employeeId && !existingRecords.some((x) => x.employee_id === r.employeeId && x.work_date === workDate && x.shift === shift && x.line.trim().toLowerCase() === l)); if (!selected.length) throw new Error("Není co importovat – doplňte pracovníka, nebo už jsou tyto řádky uložené.");
      const drafts = productDrafts.filter((p) => p.product_code.trim()); if (!drafts.length && productCode.trim()) drafts.push({ key: "legacy", product_code: productCode.trim(), norm_per_hour: normNum, confidence: 0.5, employees_per_product: null }); if (!drafts.length) throw new Error("Screenshot neobsahuje žádný rozpoznaný produkt.");
      const productByCode = new Map<string, Product>();
      for (const d of drafts) {
        const existing = findProductByCode(allProducts, d.product_code);
        if (existing) productByCode.set(d.product_code.trim().toLowerCase(), existing);
      }
      if (missingProductCodes.length) throw new Error("Nejprve dokončete kontrolu/založení všech Product ID v prvním kroku.");
      const primary = productByCode.get(drafts[0].product_code.trim().toLowerCase());
      const hProduct = productByCode.get((drafts.find((d) => /^H_/i.test(d.product_code))?.product_code || "").trim().toLowerCase());
      const tProduct = productByCode.get((drafts.find((d) => /^T_/i.test(d.product_code))?.product_code || "").trim().toLowerCase());
      if (!primary && !hProduct && !tProduct) throw new Error("Produkt se nepodařilo dohledat.");
      const records = selected.map((r) => { const positionProduct = r.position === "TUP" ? tProduct : hProduct; const product = positionProduct || primary; if (!product) throw new Error(`Pro pozici ${r.position} nebyl nalezen Product ID.`); return { employee_id: r.employeeId, work_date: workDate, shift, line: line.trim(), product_id: product.id, position: r.position, oee: Number(r.oee) || 0, performance: Number(r.performance) || 0, available_time: Number(r.availableTime) || 0, help_score: Number(r.helpScore) || 0, screenshot_path: screenshotPath, ...approval() }; });
      const { error } = await supabase.from("daily_records").insert(records);
      if (error) throw error;
      return selected.length;
    },
    onSuccess: (count) => { qc.invalidateQueries(); toast.success(`Importováno ${count} řádků.`); onImported?.(); reset(); },
    onError: (e: Error) => toast.error(`Import se nepodařil: ${e.message}`),
  });

  const otherLineNotices = useMemo(() => { if (!workDate || !line.trim()) return [] as { name: string; lines: string[] }[]; const l = line.trim().toLowerCase(); return rows.filter((r) => r.include && r.employeeId).map((r) => { const agg = existingShifts.find((a) => a.employee_id === r.employeeId && a.work_date === workDate && a.shift === shift); if (!agg) return null; const otherLines = agg.lines.filter((x) => x.trim().toLowerCase() !== l); if (!otherLines.length) return null; const name = employees.find((e) => e.id === r.employeeId)?.full_name ?? r.ocrName; return { name, lines: otherLines }; }).filter((x): x is { name: string; lines: string[] } => x !== null); }, [workDate, line, rows, existingShifts]);
  const duplicateNames = useMemo(() => { if (!workDate || !line.trim()) return []; const l = line.trim().toLowerCase(); return rows.filter((r) => r.include && r.employeeId && existingRecords.some((x) => x.employee_id === r.employeeId && x.work_date === workDate && x.shift === shift && x.line.trim().toLowerCase() === l)).map((r) => employees.find((e) => e.id === r.employeeId)?.full_name ?? r.ocrName); }, [workDate, line, rows, existingRecords, employees]);
  const lowConf = (c: number) => c < 0.7;
  const importBlocked = stage !== "ready" || missingProductCodes.length > 0;

  return <Card className="min-w-0 gap-4 overflow-hidden p-4 shadow-[var(--shadow-card)] sm:p-5">
    <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Import ze screenshotu</h2>{result ? <Button variant="ghost" size="sm" onClick={reset}><X className="h-4 w-4" /> Zrušit</Button> : null}</div>
    <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void onFile(f); }} />
    {!result ? <div className="grid gap-2"><Button size="lg" className="h-12 w-full" disabled={busy} onClick={() => fileRef.current?.click()}>{busy ? <><Loader2 className="h-4 w-4 animate-spin" /> Rozpoznávám…</> : <><ImageUp className="h-4 w-4" /> Nahrát screenshot</>}</Button><p className="text-xs text-muted-foreground">Data se nikdy neuloží automaticky – nejprve zobrazíme návrh k odsouhlasení. Ruční zadávání zůstává beze změny.</p></div> : <div className="grid min-w-0 gap-4">
      <div className="rounded-md border border-primary/40 bg-primary/5 px-3 py-2 text-sm"><strong>{stage === "products" ? "1/3 Produkty" : stage === "employees" ? "2/3 Zaměstnanci" : stage === "hourly" ? "3/3 Hodinová data" : "Import připraven"}</strong>{" – "}{stage === "products" ? "Nejprve se porovnávají Product ID s databází." : stage === "employees" ? "Po vyřešení zaměstnanců se načtou hodinová data." : stage === "hourly" ? "Probíhá načtení norem, dostupnosti, výkonu a hodinových hodnot." : "Zkontrolujte všechna rozpoznaná data před uložením."}</div>
      <div className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm"><strong>Zkontrolujte importovaná data.</strong> Zvýrazněné hodnoty jsou nejisté nebo chybí.</div>
      {productDrafts.length > 0 ? <div className="rounded-md border border-primary/40 bg-primary/5 p-3">
        <div className="mb-2 text-sm font-semibold">Rozpoznané Product ID</div>
        <div className="grid gap-2">
          {productDrafts.map((p) => {
            const existing = findProductByCode(allProducts, p.product_code);
            const operation: "HA" | "TUP" = /^T_/i.test(p.product_code) ? "TUP" : "HA";
            const dbNorm = existing ? currentNorm(norms, existing.id, operation)?.norm_per_hour : null;
            const importNorm = dbNorm ?? p.norm_per_hour;
            const setup = productSetupDrafts.find((d) => d.code.trim().toLowerCase() === p.product_code.trim().toLowerCase());
            return <div key={p.key} className="rounded border p-3">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <div><div className="font-medium">{p.product_code}</div><div className="text-[11px] text-muted-foreground">jistota {Math.round(p.confidence * 100)} % · {existing ? "Product ID evidováno" : "nové Product ID"}</div></div>
                {existing ? <span className="text-xs text-muted-foreground">norma z Product ID</span> : <span className="text-xs text-warning">nutno založit</span>}
              </div>
              {existing ? <div className="text-sm font-medium">{importNorm != null ? `${importNorm} ks/h` : "norma chybí"}</div> : setup ? <div className="grid gap-3 sm:grid-cols-2">
                <div className="grid gap-1.5"><Label>Norma (ks/h) *</Label><Input type="number" min="0.1" step="0.1" inputMode="decimal" value={setup.norm} onChange={(e) => setProductSetupDrafts((prev) => prev.map((x) => x.key === setup.key ? { ...x, norm: e.target.value } : x))} placeholder="např. 100" /></div>
                <div className="grid gap-1.5"><Label>Kapacita / operátoři *</Label><Input type="number" min="1" step="1" inputMode="numeric" value={setup.capacity} onChange={(e) => setProductSetupDrafts((prev) => prev.map((x) => x.key === setup.key ? { ...x, capacity: e.target.value } : x))} /></div>
              </div> : null}
            </div>;
          })}
        </div>
        {missingProductCodes.length > 0 ? <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-md border border-warning/40 bg-warning/10 p-3">
          <span className="text-sm">Nové Product ID vyžadují potvrzení normy a kapacity.</span>
          <Button type="button" disabled={productSetupSaving || !productSetupDrafts.length} onClick={() => void createProductIds()}><Check className="h-4 w-4" /> {productSetupSaving ? "Vytvářím…" : `Založit ${missingProductCodes.length} Product ID a pokračovat`}</Button>
        </div> : null}
      </div> : null}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-4"><div className="grid gap-1"><Label>Datum</Label><Input type="date" value={workDate} onChange={(e) => setWorkDate(e.target.value)} /></div><div className="grid gap-1"><Label>Směna</Label><Select value={shift} onValueChange={setShift}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{SHIFTS.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent></Select></div><div className="grid gap-1"><Label>Linka</Label><Input value={line} onChange={(e) => setLine(e.target.value)} placeholder="např. L1" /></div><div className="grid gap-1"><Label>Kód produktu</Label><Input value={productCode} onChange={(e) => setProductCode(e.target.value)} /></div></div>
      {(duplicateNames.length || otherLineNotices.length) ? <div className="grid gap-2">{duplicateNames.length ? <div className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm"><strong>Duplicitní řádky:</strong> {duplicateNames.join(", ")}</div> : null}{otherLineNotices.length ? <div className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm"><strong>Upozornění:</strong> {otherLineNotices.map((x) => `${x.name}: ${x.lines.join(", ")}`).join("; ")}</div> : null}</div> : null}
      <div className="overflow-x-auto rounded-md border"><table className="w-full min-w-[900px] text-sm"><thead><tr className="border-b bg-muted/50"><th className="p-2 text-left">Zahrnout</th><th className="p-2 text-left">Zaměstnanec</th><th className="p-2 text-left">Pozice</th><th className="p-2 text-left">OEE</th><th className="p-2 text-left">Výkon</th><th className="p-2 text-left">Dostupný čas</th><th className="p-2 text-left">Pomoc</th><th className="p-2 text-left">Jistota</th><th className="p-2 text-left"></th></tr></thead><tbody>{rows.map((r) => <tr key={r.key} className="border-b last:border-0"><td className="p-2"><input type="checkbox" checked={r.include} onChange={(e) => patch(r.key, { include: e.target.checked })} /></td><td className="p-2"><div className="flex items-center gap-2"><Select value={r.employeeId ?? "__none"} onValueChange={(v) => patch(r.key, { employeeId: v === "__none" ? null : v })}><SelectTrigger className="min-w-[220px]"><SelectValue placeholder={r.ocrName || "Vyberte zaměstnance"} /></SelectTrigger><SelectContent><SelectItem value="__none">{r.ocrName || "Nenalezeno"}</SelectItem>{activeEmployees.map((e) => <SelectItem key={e.id} value={e.id}>{e.full_name}{e.personal_no ? ` (${e.personal_no})` : ""}</SelectItem>)}</SelectContent></Select><Button type="button" variant="outline" size="sm" onClick={() => openAddEmployee(r)}><Plus className="h-4 w-4" /></Button></div></td><td className="p-2"><Select value={r.position} onValueChange={(v) => patch(r.key, { position: v as "HA" | "TUP" })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="HA">HA</SelectItem><SelectItem value="TUP">TUP</SelectItem></SelectContent></Select></td><td className="p-2"><Input className={lowConf(r.confidence) ? "border-warning" : ""} value={r.oee} onChange={(e) => patch(r.key, { oee: e.target.value })} /></td><td className="p-2"><Input className={lowConf(r.confidence) ? "border-warning" : ""} value={r.performance} onChange={(e) => patch(r.key, { performance: e.target.value })} /></td><td className="p-2"><Input className={lowConf(r.confidence) ? "border-warning" : ""} value={r.availableTime} onChange={(e) => patch(r.key, { availableTime: e.target.value })} /></td><td className="p-2"><Input value={r.helpScore} onChange={(e) => patch(r.key, { helpScore: e.target.value })} /></td><td className="p-2">{Math.round(r.confidence * 100)} %</td><td className="p-2"><Button variant="ghost" size="sm" onClick={() => patch(r.key, { include: false })}><Trash2 className="h-4 w-4" /></Button></td></tr>)}</tbody></table></div>
      <div className="flex flex-wrap justify-end gap-2">{stage === "employees" ? <Button variant="secondary" disabled={busy || unresolvedEmployeeRows.length > 0 || !rows.length} onClick={() => void continueAfterEmployees()}>Pokračovat na hodinová data</Button> : null}<Button variant="outline" onClick={reset}>Zrušit</Button><Button disabled={confirmImport.isPending || importBlocked || !rows.some((r) => r.include && r.employeeId)} onClick={() => confirmImport.mutate()}>{confirmImport.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Potvrdit import</Button></div>
    </div>}
    <Dialog open={employeeSetupOpen} onOpenChange={(open) => { if (!busy && !createEmployee.isPending) setEmployeeSetupOpen(open); }}>
      <DialogContent className="max-h-[90vh] w-[calc(100%-2rem)] max-w-3xl overflow-y-auto">
        <DialogHeader><DialogTitle>2/3 – Zaměstnanci z OCR</DialogTitle></DialogHeader>
        <div className="grid gap-3">
          <div className="rounded-md border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">OCR přečetl pracovníky až po vyřešení Product ID. Existující zaměstnanci jsou přiřazeni automaticky. Nenalezené můžete vytvořit tlačítkem +.</div>
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full min-w-[620px] text-sm"><thead><tr className="border-b bg-muted/50"><th className="p-2 text-left">OCR jméno</th><th className="p-2 text-left">Stav</th><th className="p-2 text-left">Akce</th></tr></thead>
              <tbody>{rows.map((r) => <tr key={r.key} className="border-b last:border-0"><td className="p-2">{r.ocrName || "Jméno nebylo rozpoznáno"}</td><td className="p-2">{r.employeeId ? "✓ Evidován" : "Nenalezen"}</td><td className="p-2">{r.employeeId ? <span className="text-xs text-muted-foreground">Přiřazen automaticky</span> : <Button type="button" size="sm" variant="outline" onClick={() => openAddEmployee(r)}><Plus className="h-4 w-4" /> Vytvořit / přiřadit</Button>}</td></tr>)}</tbody>
            </table>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setEmployeeSetupOpen(false)}>Zrušit</Button><Button disabled={busy || unresolvedEmployeeRows.length > 0} onClick={() => void continueAfterEmployees()}>{busy ? <><Loader2 className="h-4 w-4 animate-spin" /> Načítám…</> : <>Pokračovat na hodinová data</>}</Button></DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
    <Dialog open={addEmployeeOpen} onOpenChange={(open) => { if (!createEmployee.isPending) { setAddEmployeeOpen(open); if (!open) { setAddEmployeeRowKey(null); setAddEmployeeName(""); setAddEmployeePersonalNo(""); } } }}><DialogContent><DialogHeader><DialogTitle>Přidat zaměstnance k importu</DialogTitle></DialogHeader><div className="grid gap-3"><div className="rounded-md border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">Jméno z OCR je předvyplněné. Po uložení bude nový zaměstnanec automaticky přiřazen k tomuto řádku importu.</div><div className="grid gap-1"><Label>Jméno a příjmení <span className="text-destructive">*</span></Label><Input value={addEmployeeName} onChange={(e) => setAddEmployeeName(e.target.value)} autoFocus disabled={createEmployee.isPending} /></div><div className="grid gap-1"><Label>Osobní číslo</Label><Input value={addEmployeePersonalNo} onChange={(e) => setAddEmployeePersonalNo(e.target.value)} disabled={createEmployee.isPending} /></div></div><DialogFooter><Button type="button" variant="outline" disabled={createEmployee.isPending} onClick={() => setAddEmployeeOpen(false)}>Zrušit</Button><Button type="button" disabled={createEmployee.isPending || !addEmployeeName.trim()} onClick={() => createEmployee.mutate()}>{createEmployee.isPending ? <><Loader2 className="h-4 w-4 animate-spin" /> Ukládám…</> : <><Plus className="h-4 w-4" /> Vytvořit a přiřadit</>}</Button></DialogFooter></DialogContent></Dialog>
    <Dialog open={newProductModalOpen} onOpenChange={(open) => { if (!productSetupSaving) setNewProductModalOpen(open); }}>
      <DialogContent className="max-h-[90vh] w-[calc(100%-2rem)] max-w-3xl overflow-y-auto">
        <DialogHeader><DialogTitle>1/3 – Kontrola / založení Product ID</DialogTitle></DialogHeader>
        <div className="grid gap-4">
          <div className="rounded-xl border bg-muted/20 p-4 text-sm">
            <div className="font-semibold">OCR našel více Product ID</div>
            <div className="mt-1 text-muted-foreground">Každý rozpoznaný kód musí být v databázi. Existující kódy se pouze zkontrolují, nové založíme všechny najednou. Norma se uloží přímo k Product ID.</div>
          </div>
          <div className="grid gap-3">
            {productSetupDrafts.map((draft) => (
              <div key={draft.key} className="rounded-lg border p-4">
                <div className="mb-3 flex items-center justify-between gap-2">
                  <div><div className="font-semibold">{draft.code}</div><div className="text-xs text-muted-foreground">jistota OCR {Math.round(draft.confidence * 100)} %</div></div>
                  <span className="text-xs text-warning">nový Product ID</span>
                </div>
                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="grid gap-1.5 sm:col-span-2"><Label>Název / popis</Label><Input value={draft.code.replace(/^[HT]_?/i, "")} disabled /></div>
                  <div className="grid gap-1.5"><Label>Kapacita / operátoři *</Label><Input type="number" min="1" step="1" inputMode="numeric" value={draft.capacity} onChange={(e) => setProductSetupDrafts((prev) => prev.map((x) => x.key === draft.key ? { ...x, capacity: e.target.value } : x))} /></div>
                  <div className="grid gap-1.5 sm:col-span-3"><Label>Norma (ks/h) *</Label><Input type="number" inputMode="decimal" min="0.1" step="0.1" value={draft.norm} onChange={(e) => setProductSetupDrafts((prev) => prev.map((x) => x.key === draft.key ? { ...x, norm: e.target.value } : x))} placeholder="např. 100" /></div>
                </div>
              </div>
            ))}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" disabled={productSetupSaving} onClick={() => setNewProductModalOpen(false)}>Zrušit</Button>
          <Button disabled={productSetupSaving || !productSetupDrafts.length} onClick={async () => { try { await createProductIds(); } catch (e) { toast.error((e as Error).message); } }}>
            <Check className="h-4 w-4" /> {productSetupSaving ? "Vytvářím…" : `Založit ${productSetupDrafts.length} Product ID a pokračovat`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </Card>;
}
