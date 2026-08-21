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

type DraftRow = {
  key: string;
  ocrName: string;
  employeeId: string | null;
  position: "HA" | "TUP";
  oee: string;
  performance: string;
  availableTime: string;
  helpScore: string;
  confidence: number;
  include: boolean;
};

type DraftProduct = OcrProduct & { key: string; employees_per_product: number | null };

const strip = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9 ]/g, "").trim();

function matchEmployee(name: string, employees: Employee[]): Employee | undefined {
  const n = strip(name);
  if (!n) return undefined;
  const exact = employees.find((e) => strip(e.full_name) === n);
  if (exact) return exact;
  const parts = n.split(/\s+/).filter(Boolean);
  return employees.find((e) => {
    const en = strip(e.full_name);
    return parts.length > 1 && parts.every((p) => en.includes(p));
  });
}

export function ScreenshotImport({ employees, onImported }: { employees: Employee[]; onImported?: () => void }) {
  const qc = useQueryClient();
  const approval = useApprovalFields();
  const extract = useServerFn(extractDailyFromScreenshot);
  const { data: products = [] } = useProducts();
  const { data: norms = [] } = useProductNorms();
  const { records: existingRecords, shifts: existingShifts } = useShiftAggregates();
  const fileRef = useRef<HTMLInputElement>(null);

  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<OcrResult | null>(null);
  const [screenshotPath, setScreenshotPath] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [workDate, setWorkDate] = useState("");
  const [shift, setShift] = useState<string>(SHIFTS[0]);
  const [line, setLine] = useState("");
  const [productCode, setProductCode] = useState("");
  const [normValue, setNormValue] = useState("");
  const [productDrafts, setProductDrafts] = useState<DraftProduct[]>([]);
  const [rows, setRows] = useState<DraftRow[]>([]);
  const [addedEmployees, setAddedEmployees] = useState<Employee[]>([]);
  const [addEmployeeOpen, setAddEmployeeOpen] = useState(false);
  const [addEmployeeRowKey, setAddEmployeeRowKey] = useState<string | null>(null);
  const [addEmployeeName, setAddEmployeeName] = useState("");
  const [addEmployeePersonalNo, setAddEmployeePersonalNo] = useState("");

  const activeEmployees = useMemo(() => [...employees, ...addedEmployees].filter((e) => e.active), [employees, addedEmployees]);
  const primaryProductCode = productDrafts[0]?.product_code || productCode.trim();
  const existingProduct: Product | undefined = useMemo(() => findProductByCode(products, primaryProductCode), [products, primaryProductCode]);
  const haNorm: ProductNorm | undefined = existingProduct ? currentNorm(norms, existingProduct.id, "HA") : undefined;
  const normNum = normValue === "" ? null : Number(normValue);
  const isNewProduct = !!primaryProductCode && !existingProduct;
  const isNormChange = !!existingProduct && normNum !== null && !!haNorm && Number(haNorm.norm_per_hour) !== normNum;
  const isNewNorm = !!existingProduct && normNum !== null && !haNorm;

  const patch = (key: string, p: Partial<DraftRow>) => setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...p } : r)));

  const reset = () => {
    setResult(null);
    setRows([]);
    setProductDrafts([]);
    setScreenshotPath(null);
    setPreviewUrl(null);
    setProductCode("");
    setNormValue("");
    setAddedEmployees([]);
    setAddEmployeeOpen(false);
    setAddEmployeeRowKey(null);
    setAddEmployeeName("");
    setAddEmployeePersonalNo("");
    if (fileRef.current) fileRef.current.value = "";
  };

  const openAddEmployee = (row: DraftRow) => {
    setAddEmployeeRowKey(row.key);
    setAddEmployeeName(row.ocrName.trim());
    setAddEmployeePersonalNo("");
    setAddEmployeeOpen(true);
  };

  const createEmployee = useMutation({
    mutationFn: async () => {
      const fullName = addEmployeeName.trim();
      if (!fullName) throw new Error("Zadejte jméno zaměstnance.");
      const existing = matchEmployee(fullName, activeEmployees);
      if (existing) return existing;
      const { data, error } = await supabase.from("employees").insert({
        full_name: fullName,
        personal_no: addEmployeePersonalNo.trim() || null,
        qual_ha: false,
        qual_tup: false,
        active: true,
        is_temporary: false,
        position_type: "standard",
      }).select("*").single();
      if (error) throw error;
      return data as Employee;
    },
    onSuccess: (employee) => {
      setAddedEmployees((prev) => prev.some((e) => e.id === employee.id) ? prev : [...prev, employee]);
      if (addEmployeeRowKey) patch(addEmployeeRowKey, { employeeId: employee.id });
      qc.invalidateQueries({ queryKey: ["employees"] });
      setAddEmployeeOpen(false);
      toast.success(`Zaměstnanec „${employee.full_name}" byl přidán.`);
    },
    onError: (e: Error) => toast.error(`Zaměstnance se nepodařilo přidat: ${e.message}`),
  });

  const onFile = async (file: File) => {
    setBusy(true);
    setResult(null);
    try {
      const dataUrl = await new Promise<string>((res, rej) => {
        const fr = new FileReader();
        fr.onload = () => res(String(fr.result));
        fr.onerror = () => rej(new Error("Soubor se nepodařilo načíst."));
        fr.readAsDataURL(file);
      });
      setPreviewUrl(dataUrl);
      const ext = (file.name.split(".").pop() || "png").toLowerCase();
      const path = `daily/${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}.${ext}`;
      const { error: upErr } = await supabase.storage.from("screenshots").upload(path, file, { contentType: file.type || "image/png" });
      if (upErr) toast.warning("Screenshot se nepodařilo uložit do archivu, rozpoznávání pokračuje.");
      else setScreenshotPath(path);

      const r = await extract({ data: { imageDataUrl: dataUrl } });
      setResult(r);
      setWorkDate(r.work_date ?? new Date().toISOString().slice(0, 10));
      setShift(r.shift && SHIFTS.includes(r.shift as never) ? r.shift : SHIFTS[0]);
      setLine(r.line ?? "");
      setProductCode(r.product_code ?? "");
      setNormValue(r.norm_per_hour !== null ? String(r.norm_per_hour) : "");
      const detectedProducts = r.products?.length ? r.products : (r.product_code ? [{ product_code: r.product_code, norm_per_hour: r.norm_per_hour, confidence: r.header_confidence }] : []);
      setProductDrafts(detectedProducts.map((p, i) => ({ ...p, key: `${i}-${p.product_code}`, employees_per_product: findProductByCode(products, p.product_code)?.employees_per_product ?? null })));
      setRows(r.rows.map((row, i) => {
        const emp = matchEmployee(row.employee_name, activeEmployees);
        return {
          key: `${i}-${row.employee_name}`,
          ocrName: row.employee_name,
          employeeId: emp?.id ?? null,
          position: row.position ?? "HA",
          oee: row.oee !== null ? String(row.oee) : "",
          performance: row.performance !== null ? String(row.performance) : "",
          availableTime: row.available_time !== null ? String(row.available_time) : "",
          helpScore: "0",
          confidence: row.confidence,
          include: true,
        };
      }));
      if (!r.rows.length) toast.warning("Ze screenshotu se nepodařilo přečíst žádné řádky.");
      else toast.success(`Rozpoznáno ${detectedProducts.length || 0} produktů. Zkontrolujte data před uložením.`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const setDraftNorm = (key: string, value: string) => setProductDrafts((prev) => prev.map((p) => p.key === key ? { ...p, norm_per_hour: value === "" ? null : Number(value) } : p));

  const confirmImport = useMutation({
    mutationFn: async () => {
      if (!line.trim()) throw new Error("Doplňte linku.");
      const l = line.trim().toLowerCase();
      const selected = rows.filter((r) => r.include && r.employeeId && !existingRecords.some((x) => x.employee_id === r.employeeId && x.work_date === workDate && x.shift === shift && x.line.trim().toLowerCase() === l));
      if (!selected.length) throw new Error("Není co importovat – doplňte pracovníka, nebo už jsou tyto řádky uložené.");

      const drafts = productDrafts.filter((p) => p.product_code.trim());
      if (!drafts.length && productCode.trim()) drafts.push({ key: "legacy", product_code: productCode.trim(), norm_per_hour: normNum, confidence: 0.5, employees_per_product: null });
      if (!drafts.length) throw new Error("Screenshot neobsahuje žádný rozpoznaný produkt.");

      const savedProducts: { id: string; code: string }[] = [];
      for (const draft of drafts) {
        const code = draft.product_code.trim();
        let product = findProductByCode(products, code);
        if (!product) {
          const capacity = draft.employees_per_product;
          if (capacity === null || !Number.isInteger(capacity) || capacity < 1) throw new Error(`U nového produktu ${code} zadejte Kapacitu / počet operátorů (min. 1).`);
          const { data, error } = await supabase.from("products").insert({ code, first_seen_date: workDate, employees_per_product: capacity, ...approval() }).select("id, code").single();
          if (error) throw error;
          product = data as Product;
        }
        savedProducts.push({ id: product.id, code: product.code });

        const value = draft.norm_per_hour === null ? null : Number(draft.norm_per_hour);
        if (value === null || !Number.isFinite(value) || value <= 0) continue;
        const existing = currentNorm(norms, product.id, "HA");
        if (!existing) {
          const { error } = await supabase.from("product_norms").insert({ product_id: product.id, operation: "HA", norm_per_hour: value, valid_from: workDate, source: "screenshot", confirmed: true, note: "Norma celé HA linky – OCR screenshot", ...approval() });
          if (error) throw error;
        } else if (Number(existing.norm_per_hour) !== value) {
          const { error: e1 } = await supabase.from("product_norms").update({ valid_to: workDate }).eq("id", existing.id);
          if (e1) throw e1;
          const { error: e2 } = await supabase.from("product_norms").insert({ product_id: product.id, operation: "HA", norm_per_hour: value, valid_from: workDate, source: "screenshot", confirmed: true, note: `Změna z ${existing.norm_per_hour} ks/h`, ...approval() });
          if (e2) throw e2;
        }
      }

      const batch = crypto.randomUUID();
      const productText = savedProducts.map((p) => p.code).join(", ");
      const singleProductId = savedProducts.length === 1 ? savedProducts[0].id : null;
      const payload = selected.map((r) => ({
        work_date: workDate,
        shift,
        line: line.trim(),
        product: productText || null,
        product_id: singleProductId,
        employee_id: r.employeeId!,
        position: r.position,
        oee: r.oee === "" ? null : Number(r.oee),
        help_score: Number(r.helpScore || 0),
        performance: r.performance === "" ? null : Number(r.performance),
        available_time: r.availableTime === "" ? null : Number(r.availableTime),
        source: "screenshot",
        screenshot_path: screenshotPath,
        import_batch_id: batch,
        ...approval(),
      }));
      const { data: inserted, error } = await supabase.from("daily_records").insert(payload).select("id, employee_id");
      if (error) throw error;

      const links: { record_id: string; coworker_id: string }[] = [];
      for (const rec of inserted ?? []) for (const other of inserted ?? []) if (other.employee_id !== rec.employee_id) links.push({ record_id: rec.id, coworker_id: other.employee_id });
      if (links.length) {
        const { error: le } = await supabase.from("daily_record_coworkers").insert(links);
        if (le) throw le;
      }

      const evalRows = Array.from(new Set(selected.map((r) => r.employeeId!))).map((employee_id) => ({ employee_id, work_date: workDate, shift, help_score: Number(selected.find((r) => r.employeeId === employee_id)?.helpScore || 0) }));
      const { error: ee } = await supabase.from("shift_evaluations").upsert(evalRows, { onConflict: "employee_id,work_date,shift", ignoreDuplicates: true });
      if (ee) throw ee;
      return { count: inserted?.length ?? 0, products: savedProducts.length };
    },
    onSuccess: ({ count, products: productCount }) => {
      qc.invalidateQueries({ queryKey: ["daily"] });
      qc.invalidateQueries({ queryKey: ["coworkers"] });
      qc.invalidateQueries({ queryKey: ["shift_evaluations"] });
      qc.invalidateQueries({ queryKey: ["products"] });
      qc.invalidateQueries({ queryKey: ["product_norms"] });
      qc.invalidateQueries({ queryKey: ["employees"] });
      toast.success(`Importováno ${count} záznamů a uloženo ${productCount} produktů.`);
      reset();
      onImported?.();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const otherLineNotices = useMemo(() => {
    if (!workDate || !line.trim()) return [] as { name: string; lines: string[] }[];
    const l = line.trim().toLowerCase();
    return rows.filter((r) => r.include && r.employeeId).map((r) => {
      const agg = existingShifts.find((a) => a.employee_id === r.employeeId && a.work_date === workDate && a.shift === shift);
      if (!agg) return null;
      const otherLines = agg.lines.filter((x) => x.trim().toLowerCase() !== l);
      if (!otherLines.length) return null;
      const name = employees.find((e) => e.id === r.employeeId)?.full_name ?? r.ocrName;
      return { name, lines: otherLines };
    }).filter((x): x is { name: string; lines: string[] } => x !== null);
  }, [rows, existingShifts, workDate, shift, line, employees]);

  const duplicateNames = useMemo(() => {
    if (!workDate || !line.trim()) return [] as string[];
    const l = line.trim().toLowerCase();
    return rows.filter((r) => r.include && r.employeeId && existingRecords.some((x) => x.employee_id === r.employeeId && x.work_date === workDate && x.shift === shift && x.line.trim().toLowerCase() === l)).map((r) => employees.find((e) => e.id === r.employeeId)?.full_name ?? addedEmployees.find((e) => e.id === r.employeeId)?.full_name ?? r.ocrName);
  }, [rows, existingRecords, workDate, shift, line, employees, addedEmployees]);

  const lowConf = (c: number) => c < 0.7;

  return (
    <Card className="min-w-0 gap-4 overflow-hidden p-4 shadow-[var(--shadow-card)] sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Import ze screenshotu</h2>
        {result ? <Button variant="ghost" size="sm" onClick={reset}><X className="h-4 w-4" /> Zrušit</Button> : null}
      </div>
      <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void onFile(f); }} />
      {!result ? (
        <div className="grid gap-2">
          <Button size="lg" className="h-12 w-full" disabled={busy} onClick={() => fileRef.current?.click()}>
            {busy ? <><Loader2 className="h-4 w-4 animate-spin" /> Rozpoznávám…</> : <><ImageUp className="h-4 w-4" /> Nahrát screenshot</>}
          </Button>
          <p className="text-xs text-muted-foreground">Data se nikdy neuloží automaticky – nejprve zobrazíme návrh k odsouhlasení. Ruční zadávání zůstává beze změny.</p>
        </div>
      ) : (
        <div className="grid min-w-0 gap-4">
          <div className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm"><strong>Zkontrolujte importovaná data.</strong> Zvýrazněné hodnoty jsou nejisté nebo chybí.</div>
          {productDrafts.length > 0 ? (
            <div className="rounded-md border border-primary/40 bg-primary/5 p-3">
              <div className="mb-2 text-sm font-semibold">Rozpoznané produkty a hodinové normy</div>
              <div className="grid gap-2">
                {productDrafts.map((p) => {
                  const existing = findProductByCode(products, p.product_code);
                  const existingProductNorm = existing ? currentNorm(norms, existing.id, "HA") : undefined;
                  return (
                    <div key={p.key} className="grid grid-cols-1 gap-2 rounded border p-2 sm:grid-cols-[1fr_180px_auto] sm:items-center">
                      <div><div className="font-medium">{p.product_code}</div><div className="text-[11px] text-muted-foreground">jistota {Math.round(p.confidence * 100)} %</div></div>
                      <Input type="number" inputMode="decimal" step="0.1" value={p.norm_per_hour ?? ""} onChange={(e) => setDraftNorm(p.key, e.target.value)} placeholder="ks/h" />
                      <div className="text-xs text-muted-foreground">{existingProductNorm ? `evidováno ${existingProductNorm.norm_per_hour} ks/h` : "nová norma"}</div><div className="grid gap-1 sm:col-span-1"><Label className="text-xs">Kapacita / počet operátorů</Label><Input type="number" min="1" step="1" inputMode="numeric" value={p.employees_per_product ?? ""} onChange={(e) => setProductDrafts((prev) => prev.map((x) => x.key === p.key ? { ...x, employees_per_product: e.target.value === "" ? null : Number(e.target.value) } : x))} placeholder="např. 2" disabled={!!existing} /></div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}

          {otherLineNotices.length > 0 ? <div className="rounded-md border border-primary/40 bg-primary/5 px-3 py-2 text-sm"><strong>Pracovník už má v této směně jinou linku.</strong><ul className="mt-1 list-disc pl-5 text-xs text-muted-foreground">{otherLineNotices.map((n) => <li key={n.name}>{n.name} – už evidován na lince {n.lines.join(", ")}</li>)}</ul></div> : null}
          {duplicateNames.length > 0 ? <div className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm"><strong>Duplicita</strong> – tyto řádky se neuloží znovu: {duplicateNames.join(", ")}.</div> : null}
          {previewUrl ? <img src={previewUrl} alt="Náhled nahraného screenshotu" className="max-h-40 w-full rounded-md border border-border object-contain" /> : null}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5"><Label>Datum</Label><Input type="date" value={workDate} onChange={(e) => setWorkDate(e.target.value)} /></div>
            <div className="grid gap-1.5"><Label>Směna</Label><Select value={shift} onValueChange={setShift}><SelectTrigger className="h-11"><SelectValue /></SelectTrigger><SelectContent>{SHIFTS.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent></Select></div>
            <div className="grid gap-1.5"><Label>Linka {!result.line ? <span className="text-destructive">(nerozpoznáno)</span> : null}</Label><Input value={line} onChange={(e) => setLine(e.target.value)} className={!line ? "border-destructive" : ""} /></div>
            <div className="grid gap-1.5"><Label>Výrobky</Label><Input value={productDrafts.map((p) => p.product_code).join(", ") || productCode} onChange={(e) => { const v = e.target.value; setProductCode(v); if (productDrafts.length === 1) setProductDrafts([{ ...productDrafts[0], product_code: v }]); }} placeholder="kódy / názvy" /></div>
            {productDrafts.length <= 1 ? <div className="grid gap-1.5 sm:col-span-2"><Label>Norma HA linky (ks/h)</Label><Input type="number" inputMode="decimal" step="0.1" value={normValue} onChange={(e) => { setNormValue(e.target.value); if (productDrafts.length === 1) setDraftNorm(productDrafts[0].key, e.target.value); }} placeholder="norma celé HA linky" /></div> : null}
          </div>

          {isNewProduct ? <div className="rounded-md border border-primary/40 bg-primary/10 px-3 py-2 text-sm"><strong>Nový produkt rozpoznán:</strong> „{primaryProductCode}“. Při potvrzení bude založen.</div> : null}
          {isNewNorm ? <div className="rounded-md border border-primary/40 bg-primary/10 px-3 py-2 text-sm">Produkt existuje, norma HA zatím není evidována – bude založena verze platná od {workDate}.</div> : null}
          {isNormChange && haNorm ? <div className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm"><div className="flex items-center gap-2 font-semibold"><AlertTriangle className="h-4 w-4" /> Změna normy</div>Stávající: <strong>{haNorm.norm_per_hour} ks/h</strong> → nová: <strong>{normNum} ks/h</strong>.</div> : null}

          <div className="grid gap-3">
            {rows.map((r) => <div key={r.key} className={`grid min-w-0 gap-2 rounded-md border p-3 ${r.include ? "border-border" : "border-dashed border-border opacity-50"}`}>
              <div className="flex min-w-0 items-center justify-between gap-2"><div className="min-w-0"><div className="truncate text-sm font-medium">{r.ocrName}</div><div className="text-[11px] text-muted-foreground">jistota {Math.round(r.confidence * 100)} %</div></div><div className="flex shrink-0 items-center gap-1">{lowConf(r.confidence) || !r.employeeId ? <Badge variant="destructive">zkontrolovat</Badge> : null}<Button size="sm" variant="ghost" aria-label="Vyřadit řádek" onClick={() => patch(r.key, { include: !r.include })}><Trash2 className="h-3.5 w-3.5" /></Button></div></div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <div className="grid gap-1"><Label className="text-xs">Zaměstnanec</Label>{r.employeeId ? <Select value={r.employeeId} onValueChange={(v) => patch(r.key, { employeeId: v })}><SelectTrigger className="h-11"><SelectValue /></SelectTrigger><SelectContent>{activeEmployees.map((e) => <SelectItem key={e.id} value={e.id}>{e.full_name}</SelectItem>)}</SelectContent></Select> : <div className="grid gap-2"><Select value="" onValueChange={(v) => patch(r.key, { employeeId: v })}><SelectTrigger className="h-11 border-destructive"><SelectValue placeholder="Přiřaďte pracovníka" /></SelectTrigger><SelectContent>{activeEmployees.map((e) => <SelectItem key={e.id} value={e.id}>{e.full_name}</SelectItem>)}</SelectContent></Select><Button type="button" size="sm" variant="outline" className="justify-start" onClick={() => openAddEmployee(r)}><Plus className="h-3.5 w-3.5" /> Přidat „{r.ocrName}“ jako zaměstnance</Button></div>}</div>
                <div className="grid gap-1"><Label className="text-xs">Pozice</Label><Select value={r.position} onValueChange={(v) => patch(r.key, { position: v as "HA" | "TUP" })}><SelectTrigger className="h-11"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="HA">HA</SelectItem><SelectItem value="TUP">TUP</SelectItem></SelectContent></Select></div>
                <div className="grid gap-1"><Label className="text-xs">OEE (%)</Label><Input type="number" inputMode="decimal" step="0.1" className="h-11" value={r.oee} onChange={(e) => patch(r.key, { oee: e.target.value })} /></div>
                <div className="grid gap-1"><Label className="text-xs">Výkon</Label><Input type="number" inputMode="decimal" className="h-11" value={r.performance} onChange={(e) => patch(r.key, { performance: e.target.value })} /></div>
                <div className="grid gap-1"><Label className="text-xs">Dostupný čas</Label><Input type="number" inputMode="decimal" className="h-11" value={r.availableTime} onChange={(e) => patch(r.key, { availableTime: e.target.value })} /></div>
                <div className="grid gap-1"><Label className="text-xs">Výpomoc ({r.helpScore})</Label><Input type="range" min={-100} max={100} step={5} value={r.helpScore} onChange={(e) => patch(r.key, { helpScore: e.target.value })} className="cursor-pointer p-0" /><div className="flex justify-between text-[10px] text-muted-foreground"><span>-100</span><span>0</span><span>+100</span></div></div>
              </div>
            </div>)}
          </div>

          <Button size="lg" className="h-12 w-full" disabled={confirmImport.isPending} onClick={() => confirmImport.mutate()}>{confirmImport.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Potvrdit import ({rows.filter((r) => r.include && r.employeeId && !duplicateNames.includes(employees.find((e) => e.id === r.employeeId)?.full_name ?? addedEmployees.find((e) => e.id === r.employeeId)?.full_name ?? r.ocrName)).length})</Button>

          <Dialog open={addEmployeeOpen} onOpenChange={setAddEmployeeOpen}><DialogContent><DialogHeader><DialogTitle>Nový zaměstnanec z OCR</DialogTitle></DialogHeader><div className="grid gap-4"><div className="rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-sm">OCR rozpoznalo jméno, které zatím není v evidenci. Zkontrolujte ho před uložením.</div><div className="grid gap-2"><Label htmlFor="ocr-new-employee-name">Jméno a příjmení</Label><Input id="ocr-new-employee-name" value={addEmployeeName} onChange={(e) => setAddEmployeeName(e.target.value)} autoFocus /></div><div className="grid gap-2"><Label htmlFor="ocr-new-employee-personal-no">Osobní číslo (volitelné)</Label><Input id="ocr-new-employee-personal-no" value={addEmployeePersonalNo} onChange={(e) => setAddEmployeePersonalNo(e.target.value)} /></div></div><DialogFooter><Button variant="outline" onClick={() => setAddEmployeeOpen(false)}>Zrušit</Button><Button onClick={() => createEmployee.mutate()} disabled={!addEmployeeName.trim() || createEmployee.isPending}>{createEmployee.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Přidat zaměstnance</Button></DialogFooter></DialogContent></Dialog>
        </div>
      )}
    </Card>
  );
}
