import { useMemo, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { AlertTriangle, Check, ImageUp, Loader2, Plus, Trash2, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { extractDailyFromScreenshot, type OcrProduct, type OcrResult } from "@/lib/ocr.functions";
import { useProductNorms, useProducts, useShiftAggregates } from "@/lib/data";
import { currentNorm, findProductByCode, type Product, type ProductNorm } from "@/lib/products";
import { SHIFTS, type Employee } from "@/lib/metrics";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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
  const [familyName, setFamilyName] = useState(""); const [familyHCode, setFamilyHCode] = useState(""); const [familyTCode, setFamilyTCode] = useState(""); const [familyHNorm, setFamilyHNorm] = useState(""); const [familyTNorm, setFamilyTNorm] = useState(""); const [familyCapacity, setFamilyCapacity] = useState("1");
  const [newProductModalOpen, setNewProductModalOpen] = useState(false); const [pendingProduct, setPendingProduct] = useState<DraftProduct | null>(null); const [capacityHA, setCapacityHA] = useState("1"); const [capacityTUP, setCapacityTUP] = useState("1"); const [productNorm, setProductNorm] = useState("");
  const activeEmployees = useMemo(() => [...employees, ...addedEmployees].filter((e) => e.active), [employees, addedEmployees]);
  const primaryProductCode = productDrafts[0]?.product_code || productCode.trim();
  const existingProduct: Product | undefined = useMemo(() => findProductByCode(products, primaryProductCode), [products, primaryProductCode]);
  const haNorm: ProductNorm | undefined = existingProduct ? currentNorm(norms, existingProduct.id, "HA") : undefined;
  const normNum = normValue === "" ? null : Number(normValue);
  const isNewProduct = !!primaryProductCode && !existingProduct;
  const isNormChange = !!existingProduct && normNum !== null && !!haNorm && Number(haNorm.norm_per_hour) !== normNum;
  const isNewNorm = !!existingProduct && normNum !== null && !haNorm;
  const allNewProducts = useMemo(() => productDrafts.filter(p => !findProductByCode(products, p.product_code)), [productDrafts, products]);
  const familyRequired = useMemo(() => {
    if (!productDrafts.length) return false;
    const hasNew = productDrafts.some(p => !findProductByCode(products, p.product_code));
    return hasNew && productDrafts.some(p => /^H_/i.test(p.product_code)) || hasNew && productDrafts.some(p => /^T_/i.test(p.product_code));
  }, [productDrafts, products]);
  const patch = (key: string, p: Partial<DraftRow>) => setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...p } : r)));
  const reset = () => { setResult(null); setRows([]); setProductDrafts([]); setScreenshotPath(null); setPreviewUrl(null); setProductCode(""); setNormValue(""); setAddedEmployees([]); setAddEmployeeOpen(false); setAddEmployeeRowKey(null); setAddEmployeeName(""); setAddEmployeePersonalNo(""); setFamilyName(""); setFamilyHCode(""); setFamilyTCode(""); setFamilyHNorm(""); setFamilyTNorm(""); setFamilyCapacity("1"); setNewProductModalOpen(false); setPendingProduct(null); setCapacityHA("1"); setCapacityTUP("1"); setProductNorm(""); if (fileRef.current) fileRef.current.value = ""; };
  const openAddEmployee = (row: DraftRow) => { setAddEmployeeRowKey(row.key); setAddEmployeeName(row.ocrName.trim()); setAddEmployeePersonalNo(""); setAddEmployeeOpen(true); };
  const createEmployee = useMutation({ mutationFn: async () => { const fullName = addEmployeeName.trim(); if (!fullName) throw new Error("Zadejte jméno zaměstnance."); const existing = matchEmployee(fullName, activeEmployees); if (existing) return existing; const { data, error } = await supabase.from("employees").insert({ full_name: fullName, personal_no: addEmployeePersonalNo.trim() || null, qual_ha: false, qual_tup: false, active: true, is_temporary: false, position_type: "standard" }).select("*").single(); if (error) throw error; return data as Employee; }, onSuccess: (employee) => { setAddedEmployees((prev) => prev.some((e) => e.id === employee.id) ? prev : [...prev, employee]); if (addEmployeeRowKey) patch(addEmployeeRowKey, { employeeId: employee.id }); qc.invalidateQueries({ queryKey: ["employees"] }); setAddEmployeeOpen(false); toast.success(`Zaměstnanec „${employee.full_name}\" byl přidán.`); }, onError: (e: Error) => toast.error(`Zaměstnance se nepodařilo přidat: ${e.message}`) });

  // Create new product function
  const createNewProduct = async (product: DraftProduct, capHA: number, capTUP: number, norm: number | null) => {
    const code = product.product_code.trim();
    if (!code) throw new Error("Zadejte kód produktu.");
    if (!Number.isInteger(capHA) || capHA < 1) throw new Error("Kapacita HA musí být celé číslo alespoň 1.");
    if (!Number.isInteger(capTUP) || capTUP < 1) throw new Error("Kapacita TUP musí být celé číslo alespoň 1.");
    
    const { data, error } = await supabase.from("products").insert({ 
      code, 
      first_seen_date: workDate, 
      employees_per_product: /^T_/i.test(code) ? capTUP : capHA,
      ...approval() 
    }).select("*").single();
    if (error) throw error;
    
    const p = data as Product;
    
    // Add norm if provided
    if (norm && Number.isFinite(norm) && norm > 0) {
      const operation: "HA" | "TUP" = /^T_/i.test(code) ? "TUP" : "HA";
      const { error: normErr } = await supabase.from("product_norms").insert({ 
        product_id: p.id, 
        operation, 
        norm_per_hour: norm, 
        valid_from: workDate, 
        source: "screenshot", 
        confirmed: true, 
        note: operation === "HA" ? "Norma OCR screenshot" : "Norma T_ OCR screenshot",
        ...approval() 
      }); 
      if (normErr) throw normErr;
    }
    
    // Update productDrafts with new product
    setProductDrafts((prev) => prev.map(d => d.key === product.key ? { ...d, employees_per_product: /^T_/i.test(code) ? capTUP : capHA } : d));
    
    toast.success(`Produkt „${code}“ byl vytvořen.`);
    return p;
  };

  // Handle next product in queue
  const handleNextProduct = () => {
    if (allNewProducts.length > 1) {
      // Find first product not yet created
      const remaining = allNewProducts.filter(p => !findProductByCode(products, p.product_code));
      if (remaining.length > 0) {
        setPendingProduct(remaining[0]);
        setCapacityHA(remaining[0].product_code.startsWith("H_") ? "3" : "1");
        setCapacityTUP(remaining[0].product_code.startsWith("T_") ? "2" : "1");
        setProductNorm(remaining[0].norm_per_hour != null ? String(remaining[0].norm_per_hour) : "");
        setNewProductModalOpen(true);
        return true;
      }
    }
    setPendingProduct(null);
    setNewProductModalOpen(false);
    return false;
  };

  const onFile = async (file: File) => {
    setBusy(true); setResult(null);
    try {
      const dataUrl = await new Promise<string>((res, rej) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result)); fr.onerror = () => rej(new Error("Soubor se nepodařilo načíst.")); fr.readAsDataURL(file); });
      setPreviewUrl(dataUrl); const ext = (file.name.split(".").pop() || "png").toLowerCase(); const path = `daily/${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}.${ext}`; const { error: upErr } = await supabase.storage.from("screenshots").upload(path, file, { contentType: file.type || "image/png" }); if (upErr) toast.warning("Screenshot se nepodařilo uložit do archivu, rozpoznávání pokračuje."); else setScreenshotPath(path);
      const r = await extract({ data: { imageDataUrl: dataUrl } }); setResult(r); setWorkDate(r.work_date ?? new Date().toISOString().slice(0, 10)); setShift(r.shift && SHIFTS.includes(r.shift as never) ? r.shift : SHIFTS[0]); setLine(r.line ?? ""); setProductCode(r.product_code ?? ""); setNormValue(r.norm_per_hour !== null ? String(r.norm_per_hour) : "");
      const detectedProducts = r.products?.length ? r.products : (r.product_code ? [{ product_code: r.product_code, norm_per_hour: r.norm_per_hour, confidence: r.header_confidence }] : []);
      setProductDrafts(detectedProducts.map((p, i) => ({ ...p, key: `${i}-${p.product_code}`, employees_per_product: findProductByCode(products, p.product_code)?.employees_per_product ?? null })));
      const h = detectedProducts.find(p => /^H_/i.test(p.product_code)); const t = detectedProducts.find(p => /^T_/i.test(p.product_code));
      if (h) { setFamilyHCode(h.product_code); setFamilyHNorm(h.norm_per_hour != null ? String(h.norm_per_hour) : ""); }
      if (t) { setFamilyTCode(t.product_code); setFamilyTNorm(t.norm_per_hour != null ? String(t.norm_per_hour) : ""); }
      setRows(r.rows.map((row, i) => { const emp = matchEmployee(row.employee_name, activeEmployees); return { key: `${i}-${row.employee_name}`, ocrName: row.employee_name, employeeId: emp?.id ?? null, position: row.position ?? "HA", oee: row.oee !== null ? String(row.oee) : "", performance: row.performance !== null ? String(row.performance) : "", availableTime: row.available_time !== null ? String(row.available_time) : "", helpScore: "0", confidence: row.confidence, include: true }; }));
      
      // Check for new products and open modal if needed
      const newProducts = allNewProducts.filter(p => !findProductByCode(products, p.product_code));
      if (newProducts.length > 0) {
        setPendingProduct(newProducts[0]);
        setCapacityHA(newProducts[0].product_code.startsWith("H_") ? "3" : "1");
        setCapacityTUP(newProducts[0].product_code.startsWith("T_") ? "2" : "1");
        setProductNorm(newProducts[0].norm_per_hour != null ? String(newProducts[0].norm_per_hour) : "");
        setNewProductModalOpen(true);
      }
      
      if (!r.rows.length) toast.warning("Ze screenshotu se nepodařilo přečíst žádné řádky."); else toast.success(`Rozpoznáno ${detectedProducts.length || 0} produktů. Zkontrolujte data před uložením.`);
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  };

  const setDraftNorm = (key: string, value: string) => setProductDrafts((prev) => prev.map((p) => p.key === key ? { ...p, norm_per_hour: value === "" ? null : Number(value) } : p));

  const confirmImport = useMutation({
    mutationFn: async () => {
      if (!line.trim()) throw new Error("Doplňte linku."); const l = line.trim().toLowerCase();
      const selected = rows.filter((r) => r.include && r.employeeId && !existingRecords.some((x) => x.employee_id === r.employeeId && x.work_date === workDate && x.shift === shift && x.line.trim().toLowerCase() === l)); if (!selected.length) throw new Error("Není co importovat – doplňte pracovníka, nebo už jsou tyto řádky uložené.");
      const drafts = productDrafts.filter((p) => p.product_code.trim()); if (!drafts.length && productCode.trim()) drafts.push({ key: "legacy", product_code: productCode.trim(), norm_per_hour: normNum, confidence: 0.5, employees_per_product: null }); if (!drafts.length) throw new Error("Screenshot neobsahuje žádný rozpoznaný produkt.");
      const productByCode = new Map<string, Product>();
      for (const d of drafts) { const existing = findProductByCode(products, d.product_code); if (existing) productByCode.set(d.product_code, existing); }
      for (const d of drafts) {
        if (productByCode.has(d.product_code)) continue;
        const created = await createNewProduct(d, d.product_code.startsWith("H_") ? (d.employees_per_product ?? 1) : 1, d.product_code.startsWith("T_") ? (d.employees_per_product ?? 1) : 1, d.norm_per_hour);
        productByCode.set(d.product_code, created);
      }
      const product = productByCode.get(drafts[0].product_code);
      if (!product) throw new Error("Produkt se nepodařilo dohledat.");
      const records = selected.map((r) => ({ employee_id: r.employeeId, work_date: workDate, shift, line: line.trim(), product_id: product.id, oee: Number(r.oee) || 0, performance: Number(r.performance) || 0, available_time: Number(r.availableTime) || 0, help_score: Number(r.helpScore) || 0, screenshot_path: screenshotPath, ...approval() }));
      const { error } = await supabase.from("shift_records").insert(records);
      if (error) throw error;
      return selected.length;
    },
    onSuccess: (count) => { qc.invalidateQueries(); toast.success(`Importováno ${count} řádků.`); onImported?.(); reset(); },
    onError: (e: Error) => toast.error(`Import se nepodařil: ${e.message}`),
  });

  const otherLineNotices = useMemo(() => { if (!workDate || !line.trim()) return [] as { name: string; lines: string[] }[]; const l = line.trim().toLowerCase(); return rows.filter((r) => r.include && r.employeeId).map((r) => { const agg = existingShifts.find((a) => a.employee_id === r.employeeId && a.work_date === workDate && a.shift === shift); if (!agg) return null; const otherLines = agg.lines.filter((x) => x.trim().toLowerCase() !== l); if (!otherLines.length) return null; const name = employees.find((e) => e.id === r.employeeId)?.full_name ?? r.ocrName; return { name, lines: otherLines }; }).filter((x): x is { name: string; lines: string[] } => x !== null); }, [workDate, line, rows, existingShifts]);
  const duplicateNames = useMemo(() => { if (!workDate || !line.trim()) return []; const l = line.trim().toLowerCase(); return rows.filter((r) => r.include && r.employeeId && existingRecords.some((x) => x.employee_id === r.employeeId && x.work_date === workDate && x.shift === shift && x.line.trim().toLowerCase() === l)).map((r) => employees.find((e) => e.id === r.employeeId)?.full_name ?? r.ocrName); }, [workDate, line, rows, existingRecords, employees]);
  const lowConf = (c: number) => c < 0.7;

  return <Card className="min-w-0 gap-4 overflow-hidden p-4 shadow-[var(--shadow-card)] sm:p-5">
    <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Import ze screenshotu</h2>{result ? <Button variant="ghost" size="sm" onClick={reset}><X className="h-4 w-4" /> Zrušit</Button> : null}</div>
    <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void onFile(f); }} />
    {!result ? <div className="grid gap-2"><Button size="lg" className="h-12 w-full" disabled={busy} onClick={() => fileRef.current?.click()}>{busy ? <><Loader2 className="h-4 w-4 animate-spin" /> Rozpoznávám…</> : <><ImageUp className="h-4 w-4" /> Nahrát screenshot</>}</Button><p className="text-xs text-muted-foreground">Data se nikdy neuloží automaticky – nejprve zobrazíme návrh k odsouhlasení. Ruční zadávání zůstává beze změny.</p></div> : <div className="grid min-w-0 gap-4">
      <div className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm"><strong>Zkontrolujte importovaná data.</strong> Zvýrazněné hodnoty jsou nejisté nebo chybí.</div>
      {productDrafts.length > 0 ? <div className="rounded-md border border-primary/40 bg-primary/5 p-3"><div className="mb-2 text-sm font-semibold">Rozpoznané produkty a hodinové normy</div><div className="grid gap-2">{productDrafts.map((p) => { const existing = findProductByCode(products, p.product_code); const existingProductNorm = existing ? currentNorm(norms, existing.id, /^T_/i.test(p.product_code) ? "TUP" : "HA") : undefined; return <div key={p.key} className="grid grid-cols-1 gap-2 rounded border p-2 sm:grid-cols-[1fr_180px_auto] sm:items-center"><div><div className="font-medium">{p.product_code}</div><div className="text-[11px] text-muted-foreground">jistota {Math.round(p.confidence * 100)} %</div></div><Input type="number" inputMode="decimal" step="0.1" value={p.norm_per_hour ?? ""} onChange={(e) => setDraftNorm(p.key, e.target.value)} placeholder="ks/h" /><div className="text-xs text-muted-foreground">{existingProductNorm ? `evidováno ${existingProductNorm.norm_per_hour} ks/h` : "nová norma"}</div><div className="grid gap-1"><Label className="text-xs">Kapacita / počet operátorů</Label><Input type="number" min="1" step="1" inputMode="numeric" value={p.employees_per_product ?? ""} onChange={(e) => setProductDrafts((prev) => prev.map((x) => x.key === p.key ? { ...x, employees_per_product: e.target.value === "" ? null : Number(e.target.value) } : x))} placeholder="např. 2" disabled={!!existing} /></div></div>; })}</div></div> : null}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-4"><div className="grid gap-1"><Label>Datum</Label><Input type="date" value={workDate} onChange={(e) => setWorkDate(e.target.value)} /></div><div className="grid gap-1"><Label>Směna</Label><Select value={shift} onValueChange={setShift}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{SHIFTS.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent></Select></div><div className="grid gap-1"><Label>Linka</Label><Input value={line} onChange={(e) => setLine(e.target.value)} placeholder="např. L1" /></div><div className="grid gap-1"><Label>Kód produktu</Label><Input value={productCode} onChange={(e) => setProductCode(e.target.value)} /></div></div>
      {(duplicateNames.length || otherLineNotices.length) ? <div className="grid gap-2">{duplicateNames.length ? <div className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm"><strong>Duplicitní řádky:</strong> {duplicateNames.join(", ")}</div> : null}{otherLineNotices.length ? <div className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm"><strong>Upozornění:</strong> {otherLineNotices.map((x) => `${x.name}: ${x.lines.join(", ")}`).join("; ")}</div> : null}</div> : null}
      <div className="overflow-x-auto rounded-md border"><table className="w-full min-w-[900px] text-sm"><thead><tr className="border-b bg-muted/50"><th className="p-2 text-left">Zahrnout</th><th className="p-2 text-left">Zaměstnanec</th><th className="p-2 text-left">Pozice</th><th className="p-2 text-left">OEE</th><th className="p-2 text-left">Výkon</th><th className="p-2 text-left">Dostupný čas</th><th className="p-2 text-left">Pomoc</th><th className="p-2 text-left">Jistota</th><th className="p-2 text-left"></th></tr></thead><tbody>{rows.map((r) => <tr key={r.key} className="border-b last:border-0"><td className="p-2"><input type="checkbox" checked={r.include} onChange={(e) => patch(r.key, { include: e.target.checked })} /></td><td className="p-2"><div className="flex items-center gap-2"><Select value={r.employeeId ?? "__none"} onValueChange={(v) => patch(r.key, { employeeId: v === "__none" ? null : v })}><SelectTrigger className="min-w-[220px]"><SelectValue placeholder={r.ocrName || "Vyberte zaměstnance"} /></SelectTrigger><SelectContent><SelectItem value="__none">{r.ocrName || "Nenalezeno"}</SelectItem>{activeEmployees.map((e) => <SelectItem key={e.id} value={e.id}>{e.full_name}{e.personal_no ? ` (${e.personal_no})` : ""}</SelectItem>)}</SelectContent></Select><Button type="button" variant="outline" size="sm" onClick={() => openAddEmployee(r)}><Plus className="h-4 w-4" /></Button></div></td><td className="p-2"><Select value={r.position} onValueChange={(v) => patch(r.key, { position: v as "HA" | "TUP" })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="HA">HA</SelectItem><SelectItem value="TUP">TUP</SelectItem></SelectContent></Select></td><td className="p-2"><Input className={lowConf(r.confidence) ? "border-warning" : ""} value={r.oee} onChange={(e) => patch(r.key, { oee: e.target.value })} /></td><td className="p-2"><Input className={lowConf(r.confidence) ? "border-warning" : ""} value={r.performance} onChange={(e) => patch(r.key, { performance: e.target.value })} /></td><td className="p-2"><Input className={lowConf(r.confidence) ? "border-warning" : ""} value={r.availableTime} onChange={(e) => patch(r.key, { availableTime: e.target.value })} /></td><td className="p-2"><Input value={r.helpScore} onChange={(e) => patch(r.key, { helpScore: e.target.value })} /></td><td className="p-2">{Math.round(r.confidence * 100)} %</td><td className="p-2"><Button variant="ghost" size="sm" onClick={() => patch(r.key, { include: false })}><Trash2 className="h-4 w-4" /></Button></td></tr>)}</tbody></table></div>
      <div className="flex flex-wrap justify-end gap-2"><Button variant="outline" onClick={reset}>Zrušit</Button><Button disabled={confirmImport.isPending || !rows.some((r) => r.include && r.employeeId)} onClick={() => confirmImport.mutate()}>{confirmImport.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Potvrdit import</Button></div>
    </div>}
    <Dialog open={addEmployeeOpen} onOpenChange={setAddEmployeeOpen}><DialogContent><DialogHeader><DialogTitle>Přidat zaměstnance</DialogTitle></DialogHeader><div className="grid gap-3"><div className="grid gap-1"><Label>Jméno</Label><Input value={addEmployeeName} onChange={(e) => setAddEmployeeName(e.target.value)} /></div><div className="grid gap-1"><Label>Osobní číslo</Label><Input value={addEmployeePersonalNo} onChange={(e) => setAddEmployeePersonalNo(e.target.value)} /></div></div><DialogFooter><Button variant="outline" onClick={() => setAddEmployeeOpen(false)}>Zrušit</Button><Button disabled={createEmployee.isPending} onClick={() => createEmployee.mutate()}>{createEmployee.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Přidat</Button></DialogFooter></DialogContent></Dialog>
    <Dialog open={newProductModalOpen} onOpenChange={setNewProductModalOpen}><DialogContent><DialogHeader><DialogTitle>Nový produkt</DialogTitle></DialogHeader>{pendingProduct ? <div className="grid gap-3"><div className="text-sm">Produkt: <strong>{pendingProduct.product_code}</strong></div><div className="grid grid-cols-2 gap-3"><div className="grid gap-1"><Label>Kapacita HA</Label><Input type="number" min="1" step="1" value={capacityHA} onChange={(e) => setCapacityHA(e.target.value)} /></div><div className="grid gap-1"><Label>Kapacita TUP</Label><Input type="number" min="1" step="1" value={capacityTUP} onChange={(e) => setCapacityTUP(e.target.value)} /></div></div><div className="grid gap-1"><Label>Norma ks/h</Label><Input type="number" inputMode="decimal" step="0.1" value={productNorm} onChange={(e) => setProductNorm(e.target.value)} /></div></div> : null}<DialogFooter><Button variant="outline" onClick={() => setNewProductModalOpen(false)}>Zrušit</Button><Button onClick={async () => { if (!pendingProduct) return; try { await createNewProduct(pendingProduct, Number(capacityHA), Number(capacityTUP), productNorm === "" ? null : Number(productNorm)); handleNextProduct(); } catch (e) { toast.error((e as Error).message); } }}>Vytvořit</Button></DialogFooter></DialogContent></Dialog>
  </Card>;
}
