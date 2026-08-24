import { useMemo, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Check, ImageUp, Loader2, Plus, Trash2, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { extractDailyFromScreenshot, type OcrProduct, type OcrResult } from "@/lib/ocr.functions";
import { useProductNorms, useProducts, useShiftAggregates } from "@/lib/data";
import { currentNorm, findProductByCode, type Product, type ProductNorm } from "@/lib/products";
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
const strip = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9 ]/g, "").trim();
function matchEmployee(name: string, employees: Employee[]): Employee | undefined { const n = strip(name); if (!n) return undefined; const exact = employees.find((e) => strip(e.full_name) === n); if (exact) return exact; const parts = n.split(/\s+/).filter(Boolean); return employees.find((e) => { const en = strip(e.full_name); return parts.length > 1 && parts.every((p) => en.includes(p)); }); }

export function ScreenshotImport({ employees, onImported }: { employees: Employee[]; onImported?: () => void }) {
  const qc = useQueryClient();
  const approval = useApprovalFields();
  const extract = useServerFn(extractDailyFromScreenshot);
  const { data: products = [] } = useProducts();
  const { data: norms = [] } = useProductNorms();
  const { records: existingRecords, shifts: existingShifts } = useShiftAggregates();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false); const [result, setResult] = useState<OcrResult | null>(null); const [screenshotPath, setScreenshotPath] = useState<string | null>(null); const [previewUrl, setPreviewUrl] = useState<string | null>(null); const [workDate, setWorkDate] = useState(""); const [shift, setShift] = useState<string>(SHIFTS[0]); const [line, setLine] = useState(""); const [productCode, setProductCode] = useState(""); const [normValue, setNormValue] = useState(""); const [productDrafts, setProductDrafts] = useState<DraftProduct[]>([]); const [rows, setRows] = useState<DraftRow[]>([]);
  const [addedEmployees, setAddedEmployees] = useState<Employee[]>([]); const [addEmployeeOpen, setAddEmployeeOpen] = useState(false); const [addEmployeeRowKey, setAddEmployeeRowKey] = useState<string | null>(null); const [addEmployeeName, setAddEmployeeName] = useState(""); const [addEmployeePersonalNo, setAddEmployeePersonalNo] = useState("");
  const [newProductModalOpen, setNewProductModalOpen] = useState(false); const [productSetupSaving, setProductSetupSaving] = useState(false); const [pendingProductCode, setPendingProductCode] = useState(""); const [familyName, setFamilyName] = useState(""); const [familyHCode, setFamilyHCode] = useState(""); const [familyTCode, setFamilyTCode] = useState(""); const [familyHNorm, setFamilyHNorm] = useState(""); const [familyTNorm, setFamilyTNorm] = useState(""); const [capacityHA, setCapacityHA] = useState("1"); const [capacityTUP, setCapacityTUP] = useState("1");
  const [productFamily, setProductFamily] = useState<{ familyId: string; hProduct: Product; tProduct: Product } | null>(null);
  const activeEmployees = useMemo(() => [...employees, ...addedEmployees].filter((e) => e.active), [employees, addedEmployees]);
  const primaryProductCode = productDrafts[0]?.product_code || productCode.trim();
  const existingProduct: Product | undefined = useMemo(() => findProductByCode(products, primaryProductCode), [products, primaryProductCode]);
  const haNorm: ProductNorm | undefined = existingProduct ? currentNorm(norms, existingProduct.id, "HA") : undefined;
  const normNum = normValue === "" ? null : Number(normValue);
  const missingProductCodes = useMemo(() => productDrafts.filter((p) => !findProductByCode(products, p.product_code)).map((p) => p.product_code), [productDrafts, products]);
  const patch = (key: string, p: Partial<DraftRow>) => setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...p } : r)));
  const reset = () => { setResult(null); setRows([]); setProductDrafts([]); setScreenshotPath(null); setPreviewUrl(null); setProductCode(""); setNormValue(""); setAddedEmployees([]); setAddEmployeeOpen(false); setAddEmployeeRowKey(null); setAddEmployeeName(""); setAddEmployeePersonalNo(""); setNewProductModalOpen(false); setProductSetupSaving(false); setPendingProductCode(""); setFamilyName(""); setFamilyHCode(""); setFamilyTCode(""); setFamilyHNorm(""); setFamilyTNorm(""); setCapacityHA("1"); setCapacityTUP("1"); setProductFamily(null); if (fileRef.current) fileRef.current.value = ""; };
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
      const existing = matchEmployee(fullName, employees);
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
    const missing = detected.filter((p) => !findProductByCode(products, p.product_code));
    if (!missing.length) return;
    const first = missing[0]; const base = first.product_code.replace(/^H_|^T_/i, "");
    const h = detected.find((p) => /^H_/i.test(p.product_code)); const t = detected.find((p) => /^T_/i.test(p.product_code));
    setPendingProductCode(first.product_code);
    setFamilyName(base ? `Produkt ${base}` : "");
    setFamilyHCode(h?.product_code || (/^H_/i.test(first.product_code) ? first.product_code : `H_${base}`));
    setFamilyTCode(t?.product_code || (/^T_/i.test(first.product_code) ? first.product_code : `T_${base}`));
    setFamilyHNorm(h?.norm_per_hour != null ? String(h.norm_per_hour) : (!/^T_/i.test(first.product_code) && first.norm_per_hour != null ? String(first.norm_per_hour) : ""));
    setFamilyTNorm(t?.norm_per_hour != null ? String(t.norm_per_hour) : (/^T_/i.test(first.product_code) && first.norm_per_hour != null ? String(first.norm_per_hour) : ""));
    setCapacityHA("1"); setCapacityTUP("1"); setProductFamily(null); setNewProductModalOpen(true);
  };

  const createProductFamily = async () => {
    const name = familyName.trim(), hCode = familyHCode.trim(), tCode = familyTCode.trim();
    const hNorm = Number(familyHNorm), tNorm = Number(familyTNorm), hCapacity = Number(capacityHA), tCapacity = Number(capacityTUP);
    if (!name) throw new Error("Zadejte název Product ID.");
    if (!/^H_/i.test(hCode)) throw new Error("H_ varianta musí začínat H_.");
    if (!/^T_/i.test(tCode)) throw new Error("T_ varianta musí začínat T_.");
    if (hCode.toLowerCase() === tCode.toLowerCase()) throw new Error("H_ a T_ varianta musí mít odlišný kód.");
    if (!Number.isFinite(hNorm) || hNorm <= 0 || !Number.isFinite(tNorm) || tNorm <= 0) throw new Error("Zadejte platnou normu H_ i T_.");
    if (!Number.isInteger(hCapacity) || hCapacity < 1 || !Number.isInteger(tCapacity) || tCapacity < 1) throw new Error("Kapacita operátorů musí být celé číslo alespoň 1.");
    setProductSetupSaving(true);
    try {
      const date = workDate || new Date().toISOString().slice(0, 10);
      const findByCode = (code: string) => products.find((p) => p.code.trim().toLowerCase() === code.toLowerCase());
      const createProduct = async (code: string, capacity: number) => { const existing = findByCode(code); if (existing) return existing; const { data, error } = await supabase.from("products").insert({ code, name, employees_per_product: capacity, first_seen_date: date, ...approval() }).select("*").single(); if (error) throw error; return data as Product; };
      const hProduct = await createProduct(hCode, hCapacity); const tProduct = await createProduct(tCode, tCapacity); if (hProduct.id === tProduct.id) throw new Error("H_ a T_ nesmí odkazovat na stejný produkt.");
      const { data: familyData, error: familyError } = await (supabase.from("product_families") as any).insert({ name, h_product_id: hProduct.id, t_product_id: tProduct.id }).select("id").single(); if (familyError) throw familyError; const familyId = familyData.id as string;
      const { error: hp } = await (supabase.from("products") as any).update({ family_id: familyId, variant_type: "H", name, employees_per_product: hCapacity }).eq("id", hProduct.id); if (hp) throw hp;
      const { error: tp } = await (supabase.from("products") as any).update({ family_id: familyId, variant_type: "T", name, employees_per_product: tCapacity }).eq("id", tProduct.id); if (tp) throw tp;
      const saveNorm = async (productId: string, operation: "HA" | "TUP", value: number, note: string) => { const current = currentNorm(norms, productId, operation); if (current && Number(current.norm_per_hour) === value) return; if (current) { const { error } = await supabase.from("product_norms").update({ valid_to: date }).eq("id", current.id); if (error) throw error; } const { error } = await supabase.from("product_norms").insert({ product_id: productId, operation, norm_per_hour: value, valid_from: date, source: "screenshot", confirmed: true, note, ...approval() }); if (error) throw error; };
      await saveNorm(hProduct.id, "HA", hNorm, "Norma H_ varianty vytvořená při importu screenshotu"); await saveNorm(tProduct.id, "TUP", tNorm, "Norma T_ varianty vytvořená při importu screenshotu");
      const { error: linkError } = await (supabase.from("product_relationships") as any).upsert({ source_product_id: hProduct.id, target_product_id: tProduct.id, relationship_type: "HA_TO_TUP", ...approval() }, { onConflict: "source_product_id,target_product_id,relationship_type" }); if (linkError && !/duplicate/i.test(linkError.message)) throw linkError;
      setProductFamily({ familyId, hProduct, tProduct }); setNewProductModalOpen(false); qc.invalidateQueries({ queryKey: ["products"] }); qc.invalidateQueries({ queryKey: ["product_norms"] }); toast.success(`Product ID „${name}" bylo vytvořeno a připraveno pro import.`);
    } finally { setProductSetupSaving(false); }
  };

  const onFile = async (file: File) => {
    setBusy(true); setResult(null);
    try {
      const dataUrl = await new Promise<string>((res, rej) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result)); fr.onerror = () => rej(new Error("Soubor se nepodařilo načíst.")); fr.readAsDataURL(file); });
      setPreviewUrl(dataUrl); const ext = (file.name.split(".").pop() || "png").toLowerCase(); const path = `daily/${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}.${ext}`; const { error: upErr } = await supabase.storage.from("screenshots").upload(path, file, { contentType: file.type || "image/png" }); if (upErr) toast.warning("Screenshot se nepodařilo uložit do archivu, rozpoznávání pokračuje."); else setScreenshotPath(path);
      const r = await extract({ data: { imageDataUrl: dataUrl } }); setResult(r); setWorkDate(r.work_date ?? new Date().toISOString().slice(0, 10)); setShift(r.shift && SHIFTS.includes(r.shift as never) ? r.shift : SHIFTS[0]); setLine(r.line ?? ""); setProductCode(r.product_code ?? ""); setNormValue(r.norm_per_hour !== null ? String(r.norm_per_hour) : "");
      const detectedProducts = r.products?.length ? r.products : (r.product_code ? [{ product_code: r.product_code, norm_per_hour: r.norm_per_hour, confidence: r.header_confidence }] : []);
      setProductDrafts(detectedProducts.map((p, i) => ({ ...p, key: `${i}-${p.product_code}`, employees_per_product: findProductByCode(products, p.product_code)?.employees_per_product ?? null })));
      const fallbackPosition: "HA" | "TUP" = detectedProducts.some((p) => /^T_/i.test(p.product_code)) ? "TUP" : "HA";
      const sourceRows = r.rows.length > 0 ? r.rows : [{ employee_name: "", position: fallbackPosition, oee: null, performance: null, available_time: null, confidence: r.header_confidence ?? 0.5 }];
      setRows(sourceRows.map((row, i) => { const emp = matchEmployee(row.employee_name, activeEmployees); return { key: `${i}-${row.employee_name || "manual"}`, ocrName: row.employee_name, employeeId: emp?.id ?? null, position: row.position ?? fallbackPosition, oee: row.oee !== null ? String(row.oee) : "", performance: row.performance !== null ? String(row.performance) : "", availableTime: row.available_time !== null ? String(row.available_time) : "", helpScore: "0", confidence: row.confidence, include: true }; }));
      const newProducts = detectedProducts.filter(p => !findProductByCode(products, p.product_code));
      if (newProducts.length > 0) openProductSetup(detectedProducts);
      if (!r.rows.length) toast.warning("Zaměstnanec nebyl ze screenshotu rozpoznán. Vyberte ho v novém řádku, nebo použijte + pro vytvoření zaměstnance."); else toast.success(`Rozpoznáno ${detectedProducts.length || 0} produktů. Zkontrolujte data před uložením.`);
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  };

  const setDraftNorm = (key: string, value: string) => setProductDrafts((prev) => prev.map((p) => p.key === key ? { ...p, norm_per_hour: value === "" ? null : Number(value) } : p));

  const confirmImport = useMutation({
    mutationFn: async () => {
      if (!line.trim()) throw new Error("Doplňte linku."); const l = line.trim().toLowerCase();
      const selected = rows.filter((r) => r.include && r.employeeId && !existingRecords.some((x) => x.employee_id === r.employeeId && x.work_date === workDate && x.shift === shift && x.line.trim().toLowerCase() === l)); if (!selected.length) throw new Error("Není co importovat – doplňte pracovníka, nebo už jsou tyto řádky uložené.");
      const drafts = productDrafts.filter((p) => p.product_code.trim()); if (!drafts.length && productCode.trim()) drafts.push({ key: "legacy", product_code: productCode.trim(), norm_per_hour: normNum, confidence: 0.5, employees_per_product: null }); if (!drafts.length) throw new Error("Screenshot neobsahuje žádný rozpoznaný produkt.");
      const productByCode = new Map<string, Product>();
      for (const d of drafts) { const existing = findProductByCode(products, d.product_code); if (existing) productByCode.set(d.product_code.toLowerCase(), existing); }
      if (productFamily) { productByCode.set(productFamily.hProduct.code.toLowerCase(), productFamily.hProduct); productByCode.set(productFamily.tProduct.code.toLowerCase(), productFamily.tProduct); }
      if (missingProductCodes.length && !productFamily) throw new Error("Nejprve dokončete založení Product ID v okně pro nový produkt.");
      const primary = productByCode.get(drafts[0].product_code.toLowerCase());
      const hProduct = productFamily?.hProduct || productByCode.get((drafts.find((d) => /^H_/i.test(d.product_code))?.product_code || "").toLowerCase());
      const tProduct = productFamily?.tProduct || productByCode.get((drafts.find((d) => /^T_/i.test(d.product_code))?.product_code || "").toLowerCase());
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
  const importBlocked = missingProductCodes.length > 0 && !productFamily;

  return <Card className="min-w-0 gap-4 overflow-hidden p-4 shadow-[var(--shadow-card)] sm:p-5">
    <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Import ze screenshotu</h2>{result ? <Button variant="ghost" size="sm" onClick={reset}><X className="h-4 w-4" /> Zrušit</Button> : null}</div>
    <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void onFile(f); }} />
    {!result ? <div className="grid gap-2"><Button size="lg" className="h-12 w-full" disabled={busy} onClick={() => fileRef.current?.click()}>{busy ? <><Loader2 className="h-4 w-4 animate-spin" /> Rozpoznávám…</> : <><ImageUp className="h-4 w-4" /> Nahrát screenshot</Button><p className="text-xs text-muted-foreground">Data se nikdy neuloží automaticky – nejprve zobrazíme návrh k odsouhlasení. Ruční zadávání zůstává beze změny.</p></div> : <div className="grid min-w-0 gap-4">
      <div className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm"><strong>Zkontrolujte importovaná data.</strong> Zvýrazněné hodnoty jsou nejisté nebo chybí.</div>
      {productDrafts.length > 0 ? <div className="rounded-md border border-primary/40 bg-primary/5 p-3"><div className="mb-2 text-sm font-semibold">Rozpoznané produkty a hodinové normy</div><div className="grid gap-2">{productDrafts.map((p) => { const existing = findProductByCode(products, p.product_code); const existingProductNorm = existing ? currentNorm(norms, existing.id, /^T_/i.test(p.product_code) ? "TUP" : "HA") : undefined; return <div key={p.key} className="grid grid-cols-1 gap-2 rounded border p-2 sm:grid-cols-[1fr_180px_auto] sm:items-center"><div><div className="font-medium">{p.product_code}</div><div className="text-[11px] text-muted-foreground">jistota {Math.round(p.confidence * 100)} %</div></div><Input type="number" inputMode="decimal" step="0.1" value={p.norm_per_hour ?? ""} onChange={(e) => setDraftNorm(p.key, e.target.value)} placeholder="ks/h" /><div className="text-xs text-muted-foreground">{existingProductNorm ? `evidováno ${existingProductNorm.norm_per_hour} ks/h` : "nová norma"}</div><div className="grid gap-1"><Label className="text-xs">Kapacita / počet operátorů</Label><Input type="number" min="1" step="1" inputMode="numeric" value={p.employees_per_product ?? ""} onChange={(e) => setProductDrafts((prev) => prev.map((x) => x.key === p.key ? { ...x, employees_per_product: e.target.value === "" ? null : Number(e.target.value) } : x))} placeholder="např. 2" disabled={!!existing} /></div></div>; })}</div></div> : null}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-4"><div className="grid gap-1"><Label>Datum</Label><Input type="date" value={workDate} onChange={(e) => setWorkDate(e.target.value)} /></div><div className="grid gap-1"><Label>Směna</Label><Select value={shift} onValueChange={setShift}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{SHIFTS.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent></Select></div><div className="grid gap-1"><Label>Linka</Label><Input value={line} onChange={(e) => setLine(e.target.value)} placeholder="např. L1" /></div><div className="grid gap-1"><Label>Kód produktu</Label><Input value={productCode} onChange={(e) => setProductCode(e.target.value)} /></div></div>
      {(duplicateNames.length || otherLineNotices.length) ? <div className="grid gap-2">{duplicateNames.length ? <div className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm"><strong>Duplicitní řádky:</strong> {duplicateNames.join(", ")}</div> : null}{otherLineNotices.length ? <div className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm"><strong>Upozornění:</strong> {otherLineNotices.map((x) => `${x.name}: ${x.lines.join(", ")}`).join("; ")}</div> : null}</div> : null}
      <div className="overflow-x-auto rounded-md border"><table className="w-full min-w-[900px] text-sm"><thead><tr className="border-b bg-muted/50"><th className="p-2 text-left">Zahrnout</th><th className="p-2 text-left">Zaměstnanec</th><th className="p-2 text-left">Pozice</th><th className="p-2 text-left">OEE</th><th className="p-2 text-left">Výkon</th><th className="p-2 text-left">Dostupný čas</th><th className="p-2 text-left">Pomoc</th><th className="p-2 text-left">Jistota</th><th className="p-2 text-left"></th></tr></thead><tbody>{rows.map((r) => <tr key={r.key} className="border-b last:border-0"><td className="p-2"><input type="checkbox" checked={r.include} onChange={(e) => patch(r.key, { include: e.target.checked })} /></td><td className="p-2"><div className="flex items-center gap-2"><Select value={r.employeeId ?? "__none"} onValueChange={(v) => patch(r.key, { employeeId: v === "__none" ? null : v })}><SelectTrigger className="min-w-[220px]"><SelectValue placeholder={r.ocrName || "Vyberte zaměstnance"} /></SelectTrigger><SelectContent><SelectItem value="__none">{r.ocrName || "Nenalezeno"}</SelectItem>{activeEmployees.map((e) => <SelectItem key={e.id} value={e.id}>{e.full_name}{e.personal_no ? ` (${e.personal_no})` : ""}</SelectItem>)}</SelectContent></Select><Button type="button" variant="outline" size="sm" onClick={() => openAddEmployee(r)}><Plus className="h-4 w-4" /></Button></div></td><td className="p-2"><Select value={r.position} onValueChange={(v) => patch(r.key, { position: v as "HA" | "TUP" })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="HA">HA</SelectItem><SelectItem value="TUP">TUP</SelectItem></SelectContent></Select></td><td className="p-2"><Input className={lowConf(r.confidence) ? "border-warning" : ""} value={r.oee} onChange={(e) => patch(r.key, { oee: e.target.value })} /></td><td className="p-2"><Input className={lowConf(r.confidence) ? "border-warning" : ""} value={r.performance} onChange={(e) => patch(r.key, { performance: e.target.value })} /></td><td className="p-2"><Input className={lowConf(r.confidence) ? "border-warning" : ""} value={r.availableTime} onChange={(e) => patch(r.key, { availableTime: e.target.value })} /></td><td className="p-2"><Input value={r.helpScore} onChange={(e) => patch(r.key, { helpScore: e.target.value })} /></td><td className="p-2">{Math.round(r.confidence * 100)} %</td><td className="p-2"><Button variant="ghost" size="sm" onClick={() => patch(r.key, { include: false })}><Trash2 className="h-4 w-4" /></Button></td></tr>)}</tbody></table></div>
      <div className="flex flex-wrap justify-end gap-2"><Button variant="outline" onClick={reset}>Zrušit</Button><Button disabled={confirmImport.isPending || importBlocked || !rows.some((r) => r.include && r.employeeId)} onClick={() => confirmImport.mutate()}>{confirmImport.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Potvrdit import</Button></div>
    </div>}
    <Dialog open={addEmployeeOpen} onOpenChange={(open) => { if (!createEmployee.isPending) { setAddEmployeeOpen(open); if (!open) { setAddEmployeeRowKey(null); setAddEmployeeName(""); setAddEmployeePersonalNo(""); } } }}><DialogContent><DialogHeader><DialogTitle>Přidat zaměstnance k importu</DialogTitle></DialogHeader><div className="grid gap-3"><div className="rounded-md border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">Jméno z OCR je předvyplněné. Po uložení bude nový zaměstnanec automaticky přiřazen k tomuto řádku importu.</div><div className="grid gap-1"><Label>Jméno a příjmení <span className="text-destructive">*</span></Label><Input value={addEmployeeName} onChange={(e) => setAddEmployeeName(e.target.value)} autoFocus disabled={createEmployee.isPending} /></div><div className="grid gap-1"><Label>Osobní číslo</Label><Input value={addEmployeePersonalNo} onChange={(e) => setAddEmployeePersonalNo(e.target.value)} disabled={createEmployee.isPending} /></div></div><DialogFooter><Button type="button" variant="outline" disabled={createEmployee.isPending} onClick={() => setAddEmployeeOpen(false)}>Zrušit</Button><Button type="button" disabled={createEmployee.isPending || !addEmployeeName.trim()} onClick={() => createEmployee.mutate()}>{createEmployee.isPending ? <><Loader2 className="h-4 w-4 animate-spin" /> Ukládám…</> : <><Plus className="h-4 w-4" /> Vytvořit a přiřadit</>}</Button></DialogFooter></DialogContent></Dialog>
    <Dialog open={newProductModalOpen} onOpenChange={(open) => { if (!productSetupSaving) setNewProductModalOpen(open); }}><DialogContent className="max-h-[90vh] w-[calc(100%-2rem)] max-w-2xl overflow-y-auto p-0"><DialogHeader className="border-b px-6 py-5"><DialogTitle className="text-lg">Vytvořit nové Product ID</DialogTitle></DialogHeader><div className="grid gap-4 px-6 py-5"><div className="rounded-xl border bg-muted/20 p-4 text-sm"><div className="font-semibold">Product ID nebylo nalezeno</div><div className="mt-1 text-muted-foreground">Screenshot rozpoznal nové varianty. Zadejte údaje pro jejich založení před dokončením importu.</div><div className="mt-2 text-xs text-muted-foreground">Rozpoznaný kód: <strong>{pendingProductCode || primaryProductCode}</strong></div></div><div className="grid gap-1.5"><Label>Název Product ID <span className="text-destructive">*</span></Label><Input value={familyName} onChange={(e) => setFamilyName(e.target.value)} placeholder="Např. Držák motoru" autoFocus /></div><div className="grid grid-cols-1 gap-4 md:grid-cols-2"><div className="rounded-lg border p-4"><div className="mb-3 font-semibold">H_ varianta</div><div className="grid gap-3"><div className="grid gap-1.5"><Label>Kód H_ <span className="text-destructive">*</span></Label><Input value={familyHCode} onChange={(e) => setFamilyHCode(e.target.value)} placeholder="H_ABC123" /></div><div className="grid gap-1.5"><Label>Norma H_ (ks/h) <span className="text-destructive">*</span></Label><Input type="number" inputMode="decimal" min="0.1" step="0.1" value={familyHNorm} onChange={(e) => setFamilyHNorm(e.target.value)} placeholder="např. 120" /></div><div className="grid gap-1.5"><Label>Kapacita H_ / operátoři <span className="text-destructive">*</span></Label><Input type="number" min="1" step="1" inputMode="numeric" value={capacityHA} onChange={(e) => setCapacityHA(e.target.value)} /></div></div></div><div className="rounded-lg border p-4"><div className="mb-3 font-semibold">T_ varianta</div><div className="grid gap-3"><div className="grid gap-3"><div className="grid gap-1.5"><Label>Kód T_ <span className="text-destructive">*</span></Label><Input value={familyTCode} onChange={(e) => setFamilyTCode(e.target.value)} placeholder="T_ABC123" /></div><div className="grid gap-1.5"><Label>Norma T_ (ks/h) <span className="text-destructive">*</span></Label><Input type="number" inputMode="decimal" min="0.1" step="0.1" value={familyTNorm} onChange={(e) => setFamilyTNorm(e.target.value)} placeholder="např. 80" /></div><div className="grid gap-1.5"><Label>Kapacita T_ / operátoři <span className="text-destructive">*</span></Label><Input type="number" min="1" step="1" inputMode="numeric" value={capacityTUP} onChange={(e) => setCapacityTUP(e.target.value)} /></div></div></div></div></div><DialogFooter className="border-t px-6 py-4"><Button variant="outline" disabled={productSetupSaving} onClick={() => setNewProductModalOpen(false)}>Zrušit</Button><Button disabled={productSetupSaving || !familyHCode.trim() || !familyTCode.trim()} onClick={async () => { try { await createProductFamily(); } catch (e) { toast.error((e as Error).message); } }}><Check className="h-4 w-4" /> {productSetupSaving ? "Vytvářím…" : "Vytvořit Product ID"}</Button></DialogFooter></DialogContent></Dialog>
  </Card>;
}
