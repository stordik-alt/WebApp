import { useMemo, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { AlertTriangle, Check, ImageUp, Loader2, Plus, Trash2, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { extractDailyFromScreenshot, type OcrResult } from "@/lib/ocr.functions";
import { useProductNorms, useProducts, useShiftAggregates } from "@/lib/data";
import { currentNorm, findProductByCode, type Product, type ProductNorm } from "@/lib/products";
import { SHIFTS, type Employee } from "@/lib/metrics";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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

const strip = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, "")
    .trim();

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

export function ScreenshotImport({
  employees,
  onImported,
}: {
  employees: Employee[];
  onImported?: () => void;
}) {
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
  const [rows, setRows] = useState<DraftRow[]>([]);

  // Employees created directly from an unmatched OCR name are kept locally until
  // the employees query refreshes, so the newly created employee can be selected
  // immediately in the import preview.
  const [addedEmployees, setAddedEmployees] = useState<Employee[]>([]);
  const [addEmployeeOpen, setAddEmployeeOpen] = useState(false);
  const [addEmployeeRowKey, setAddEmployeeRowKey] = useState<string | null>(null);
  const [addEmployeeName, setAddEmployeeName] = useState("");
  const [addEmployeePersonalNo, setAddEmployeePersonalNo] = useState("");

  const activeEmployees = useMemo(
    () => [...employees, ...addedEmployees].filter((e) => e.active),
    [employees, addedEmployees],
  );

  const existingProduct: Product | undefined = useMemo(
    () => findProductByCode(products, productCode),
    [products, productCode],
  );

  const haNorm: ProductNorm | undefined = existingProduct
    ? currentNorm(norms, existingProduct.id, "HA")
    : undefined;

  const normNum = normValue === "" ? null : Number(normValue);
  const isNewProduct = productCode.trim() !== "" && !existingProduct;
  const isNormChange =
    !!existingProduct && normNum !== null && !!haNorm && Number(haNorm.norm_per_hour) !== normNum;
  const isNewNorm = !!existingProduct && normNum !== null && !haNorm;

  const reset = () => {
    setResult(null);
    setRows([]);
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

      const { data, error } = await supabase
        .from("employees")
        .insert({
          full_name: fullName,
          personal_no: addEmployeePersonalNo.trim() || null,
          qual_ha: false,
          qual_tup: false,
          active: true,
          is_temporary: false,
          position_type: "standard",
        })
        .select("*")
        .single();
      if (error) throw error;
      return data as Employee;
    },
    onSuccess: (employee) => {
      setAddedEmployees((prev) =>
        prev.some((e) => e.id === employee.id) ? prev : [...prev, employee],
      );
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
      const dataUrl: string = await new Promise((res, rej) => {
        const fr = new FileReader();
        fr.onload = () => res(String(fr.result));
        fr.onerror = () => rej(new Error("Soubor se nepodařilo načíst."));
        fr.readAsDataURL(file);
      });
      setPreviewUrl(dataUrl);

      // Uložení originálu pro dohledatelnost zdroje dat (soukromé úložiště).
      const ext = (file.name.split(".").pop() || "png").toLowerCase();
      // Pravidla úložiště povolují pouze adresář `daily/`.
      const path = `daily/${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from("screenshots")
        .upload(path, file, { contentType: file.type || "image/png" });
      if (upErr) {
        toast.warning("Screenshot se nepodařilo uložit do archivu, rozpoznávání pokračuje.");
      } else {
        setScreenshotPath(path);
      }

      const r = await extract({ data: { imageDataUrl: dataUrl } });
      setResult(r);
      setWorkDate(r.work_date ?? new Date().toISOString().slice(0, 10));
      setShift(r.shift && SHIFTS.includes(r.shift as never) ? r.shift : SHIFTS[0]);
      setLine(r.line ?? "");
      setProductCode(r.product_code ?? "");
      setNormValue(r.norm_per_hour !== null ? String(r.norm_per_hour) : "");
      setRows(
        r.rows.map((row, i) => {
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
        }),
      );
      if (!r.rows.length) toast.warning("Ze screenshotu se nepodařilo přečíst žádné řádky.");
      else toast.success("Zkontrolujte importovaná data před uložením.");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const patch = (key: string, p: Partial<DraftRow>) =>
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...p } : r)));

  const confirmImport = useMutation({
    mutationFn: async () => {
      const l = line.trim().toLowerCase();
      const selected = rows.filter(
        (r) =>
          r.include &&
          r.employeeId &&
          !existingRecords.some(
            (x) =>
              x.employee_id === r.employeeId &&
              x.work_date === workDate &&
              x.shift === shift &&
              x.line.trim().toLowerCase() === l,
          ),
      );
      if (!selected.length)
        throw new Error(
          "Není co importovat – doplňte pracovníka, nebo už jsou tyto řádky uložené.",
        );
      if (!line.trim()) throw new Error("Doplňte linku.");

      // 1) Produkt a norma
      let productId: string | null = existingProduct?.id ?? null;
      if (!productId && productCode.trim()) {
        const { data, error } = await supabase
          .from("products")
          .insert({ code: productCode.trim(), first_seen_date: workDate, ...approval() })
          .select("id")
          .single();
        if (error) throw error;
        productId = data.id;
      }
      if (productId && normNum !== null) {
        const existing = currentNorm(norms, productId, "HA");
        if (!existing) {
          const { error } = await supabase.from("product_norms").insert({
            product_id: productId,
            operation: "HA",
            norm_per_hour: normNum,
            valid_from: workDate,
            source: "screenshot",
            confirmed: true,
            note: "Norma celé HA linky",
            ...approval(),
          });
          if (error) throw error;
        } else if (Number(existing.norm_per_hour) !== normNum) {
          // Nová verze normy – stará se zachová pro historii.
          const { error: e1 } = await supabase
            .from("product_norms")
            .update({ valid_to: workDate })
            .eq("id", existing.id);
          if (e1) throw e1;
          const { error: e2 } = await supabase.from("product_norms").insert({
            product_id: productId,
            operation: "HA",
            norm_per_hour: normNum,
            valid_from: workDate,
            source: "screenshot",
            confirmed: true,
            note: `Změna z ${existing.norm_per_hour} ks/h`,
            ...approval(),
          });
          if (e2) throw e2;
        }
      }

      // 2) Denní záznamy
      const batch = crypto.randomUUID();
      const payload = selected.map((r) => ({
        work_date: workDate,
        shift,
        line: line.trim(),
        product: productCode.trim() || null,
        product_id: productId,
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
      const { data: inserted, error } = await supabase
        .from("daily_records")
        .insert(payload)
        .select("id, employee_id");
      if (error) throw error;

      // 3) Spolupracovníci = ostatní pracovníci téže linky/směny ze screenshotu
      const links: { record_id: string; coworker_id: string }[] = [];
      for (const rec of inserted ?? []) {
        for (const other of inserted ?? []) {
          if (other.employee_id !== rec.employee_id)
            links.push({ record_id: rec.id, coworker_id: other.employee_id });
        }
      }
      if (links.length) {
        const { error: le } = await supabase.from("daily_record_coworkers").insert(links);
        if (le) throw le;
      }

      // Výpomoc: jedna hodnota za pracovníka + datum + směnu (nevzniká 0 za každou linku).
      const evalRows = Array.from(new Set(selected.map((r) => r.employeeId!))).map(
        (employee_id) => ({
          employee_id,
          work_date: workDate,
          shift,
          help_score: Number(selected.find((r) => r.employeeId === employee_id)?.helpScore || 0),
        }),
      );
      const { error: ee } = await supabase
        .from("shift_evaluations")
        .upsert(evalRows, { onConflict: "employee_id,work_date,shift", ignoreDuplicates: true });
      if (ee) throw ee;

      return inserted?.length ?? 0;
    },
    onSuccess: (n) => {
      qc.invalidateQueries({ queryKey: ["daily"] });
      qc.invalidateQueries({ queryKey: ["coworkers"] });
      qc.invalidateQueries({ queryKey: ["shift_evaluations"] });
      qc.invalidateQueries({ queryKey: ["products"] });
      qc.invalidateQueries({ queryKey: ["product_norms"] });
      qc.invalidateQueries({ queryKey: ["employees"] });
      toast.success(`Importováno ${n} záznamů.`);
      reset();
      onImported?.();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  /** Pracovníci, kteří v této směně už mají záznam na JINÉ lince – nejde o duplicitu. */
  const otherLineNotices = useMemo(() => {
    if (!workDate || !line.trim()) return [] as { name: string; lines: string[] }[];
    const l = line.trim().toLowerCase();
    return rows
      .filter((r) => r.include && r.employeeId)
      .map((r) => {
        const agg = existingShifts.find(
          (a) => a.employee_id === r.employeeId && a.work_date === workDate && a.shift === shift,
        );
        if (!agg) return null;
        const otherLines = agg.lines.filter((x) => x.trim().toLowerCase() !== l);
        if (!otherLines.length) return null;
        const name = employees.find((e) => e.id === r.employeeId)?.full_name ?? r.ocrName;
        return { name, lines: otherLines };
      })
      .filter((x): x is { name: string; lines: string[] } => x !== null);
  }, [rows, existingShifts, workDate, shift, line, employees]);

  /** Duplicita = stejný pracovník + datum + směna + STEJNÁ linka. */
  const duplicateNames = useMemo(() => {
    if (!workDate || !line.trim()) return [] as string[];
    const l = line.trim().toLowerCase();
    return rows
      .filter(
        (r) =>
          r.include &&
          r.employeeId &&
          existingRecords.some(
            (x) =>
              x.employee_id === r.employeeId &&
              x.work_date === workDate &&
              x.shift === shift &&
              x.line.trim().toLowerCase() === l,
          ),
      )
      .map((r) =>
        employees.find((e) => e.id === r.employeeId)?.full_name ??
        addedEmployees.find((e) => e.id === r.employeeId)?.full_name ??
        r.ocrName,
      );
  }, [rows, existingRecords, workDate, shift, line, employees, addedEmployees]);

  const lowConf = (c: number) => c < 0.7;

  return (
    <Card className="min-w-0 gap-4 overflow-hidden p-4 shadow-[var(--shadow-card)] sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Import ze screenshotu
        </h2>
        {result ? (
          <Button variant="ghost" size="sm" onClick={reset}>
            <X className="h-4 w-4" /> Zrušit
          </Button>
        ) : null}
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void onFile(f);
        }}
      />

      {!result ? (
        <div className="grid gap-2">
          <Button
            size="lg"
            className="h-12 w-full"
            disabled={busy}
            onClick={() => fileRef.current?.click()}
          >
            {busy ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" /> Rozpoznávám…
              </>
            ) : (
              <>
                <ImageUp className="h-4 w-4" /> Nahrát screenshot
              </>
            )}
          </Button>
          <p className="text-xs text-muted-foreground">
            Data se nikdy neuloží automaticky – nejprve zobrazíme návrh k odsouhlasení. Ruční
            zadávání zůstává beze změny.
          </p>
        </div>
      ) : (
        <div className="grid min-w-0 gap-4">
          <div className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm">
            <strong>Zkontrolujte importovaná data.</strong> Zvýrazněné hodnoty jsou nejisté nebo
            chybí.
          </div>

          {otherLineNotices.length > 0 ? (
            <div className="rounded-md border border-primary/40 bg-primary/5 px-3 py-2 text-sm">
              <strong>Pracovník už má v této směně jinou linku.</strong> Nový záznam se přidá jako
              další linka a do denního hodnocení se započítá jako průměr přes linky:
              <ul className="mt-1 list-disc pl-5 text-xs text-muted-foreground">
                {otherLineNotices.map((n) => (
                  <li key={n.name}>
                    {n.name} – už evidován na lince {n.lines.join(", ")}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {duplicateNames.length > 0 ? (
            <div className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm">
              <strong>Duplicita (stejný pracovník, datum, směna i linka)</strong> – tyto řádky se
              neuloží znovu: {duplicateNames.join(", ")}.
            </div>
          ) : null}

          {previewUrl ? (
            <img
              src={previewUrl}
              alt="Náhled nahraného screenshotu"
              className="max-h-40 w-full rounded-md border border-border object-contain"
            />
          ) : null}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label>Datum</Label>
              <Input type="date" value={workDate} onChange={(e) => setWorkDate(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label>Směna</Label>
              <Select value={shift} onValueChange={setShift}>
                <SelectTrigger className="h-11">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SHIFTS.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label>
                Linka{" "}
                {!result.line ? <span className="text-destructive">(nerozpoznáno)</span> : null}
              </Label>
              <Input
                value={line}
                onChange={(e) => setLine(e.target.value)}
                className={!line ? "border-destructive" : ""}
              />
            </div>
            <div className="grid gap-1.5">
              <Label>Výrobek</Label>
              <Input
                value={productCode}
                onChange={(e) => setProductCode(e.target.value)}
                placeholder="kód / název"
                list="known-products"
              />
              <datalist id="known-products">
                {products.map((p) => (
                  <option key={p.id} value={p.code} />
                ))}
              </datalist>
            </div>
            <div className="grid gap-1.5 sm:col-span-2">
              <Label>Norma HA linky (ks/h)</Label>
              <Input
                type="number"
                inputMode="decimal"
                step="0.1"
                value={normValue}
                onChange={(e) => setNormValue(e.target.value)}
                placeholder="norma celé HA linky, ne jednoho pracovníka"
              />
            </div>
          </div>

          {isNewProduct ? (
            <div className="rounded-md border border-primary/40 bg-primary/10 px-3 py-2 text-sm">
              <strong>Nový produkt rozpoznán:</strong> „{productCode}“. Před uložením můžete kód
              upravit; produkt bude založen při potvrzení importu.
            </div>
          ) : null}
          {isNewNorm ? (
            <div className="rounded-md border border-primary/40 bg-primary/10 px-3 py-2 text-sm">
              Produkt existuje, norma HA zatím není evidována – bude založena verze platná od{" "}
              {workDate}.
            </div>
          ) : null}
          {isNormChange && haNorm ? (
            <div className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm">
              <div className="flex items-center gap-2 font-semibold">
                <AlertTriangle className="h-4 w-4" /> Změna normy
              </div>
              Stávající: <strong>{haNorm.norm_per_hour} ks/h</strong> → nová:{" "}
              <strong>{normNum} ks/h</strong>. Potvrzením importu vznikne nová verze normy, původní
              zůstane v historii.
            </div>
          ) : null}
          {existingProduct && haNorm && !isNormChange ? (
            <p className="text-xs text-muted-foreground">
              Existující produkt se stejnou normou – použije se stávající záznam (
              {haNorm.norm_per_hour} ks/h).
            </p>
          ) : null}

          <div className="grid gap-3">
            {rows.map((r) => (
              <div
                key={r.key}
                className={`grid min-w-0 gap-2 rounded-md border p-3 ${
                  r.include ? "border-border" : "border-dashed border-border opacity-50"
                }`}
              >
                <div className="flex min-w-0 items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">{r.ocrName}</div>
                    <div className="text-[11px] text-muted-foreground">
                      jistota {Math.round(r.confidence * 100)} %
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    {lowConf(r.confidence) || !r.employeeId ? (
                      <Badge variant="destructive">zkontrolovat</Badge>
                    ) : null}
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label="Vyřadit řádek"
                      onClick={() => patch(r.key, { include: !r.include })}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <div className="grid gap-1">
                    <Label className="text-xs">Zaměstnanec</Label>
                    {r.employeeId ? (
                      <Select
                        value={r.employeeId}
                        onValueChange={(v) => patch(r.key, { employeeId: v })}
                      >
                        <SelectTrigger className="h-11">
                          <SelectValue placeholder="Přiřaďte pracovníka" />
                        </SelectTrigger>
                        <SelectContent>
                          {activeEmployees.map((e) => (
                            <SelectItem key={e.id} value={e.id}>
                              {e.full_name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <div className="grid gap-2">
                        <Select
                          value=""
                          onValueChange={(v) => patch(r.key, { employeeId: v })}
                        >
                          <SelectTrigger className="h-11 border-destructive">
                            <SelectValue placeholder="Přiřaďte pracovníka" />
                          </SelectTrigger>
                          <SelectContent>
                            {activeEmployees.map((e) => (
                              <SelectItem key={e.id} value={e.id}>
                                {e.full_name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="justify-start"
                          onClick={() => openAddEmployee(r)}
                        >
                          <Plus className="h-3.5 w-3.5" />
                          Přidat „{r.ocrName}“ jako zaměstnance
                        </Button>
                      </div>
                    )}
                  </div>
                  <div className="grid gap-1">
                    <Label className="text-xs">Pozice</Label>
                    <Select
                      value={r.position}
                      onValueChange={(v) => patch(r.key, { position: v as "HA" | "TUP" })}
                    >
                      <SelectTrigger className="h-11">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="HA">HA</SelectItem>
                        <SelectItem value="TUP">TUP</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid gap-1">
                    <Label className="text-xs">OEE (%)</Label>
                    <Input
                      type="number"
                      inputMode="decimal"
                      step="0.1"
                      className={`h-11 ${r.oee === "" ? "border-destructive" : ""}`}
                      value={r.oee}
                      onChange={(e) => patch(r.key, { oee: e.target.value })}
                    />
                  </div>
                  <div className="grid gap-1">
                    <Label className="text-xs">Výkon</Label>
                    <Input
                      type="number"
                      inputMode="decimal"
                      className="h-11"
                      value={r.performance}
                      onChange={(e) => patch(r.key, { performance: e.target.value })}
                    />
                  </div>
                  <div className="grid gap-1">
                    <Label className="text-xs">Dostupný čas</Label>
                    <Input
                      type="number"
                      inputMode="decimal"
                      className="h-11"
                      value={r.availableTime}
                      onChange={(e) => patch(r.key, { available_time: e.target.value })}
                    />
                  </div>
                  <div className="grid gap-1">
                    <Label className="text-xs">Výpomoc ({r.helpScore})</Label>
                    <Input
                      type="range"
                      min={-100}
                      max={100}
                      step={5}
                      value={r.helpScore}
                      onChange={(e) => patch(r.key, { helpScore: e.target.value })}
                      className="cursor-pointer p-0"
                    />
                    <div className="flex justify-between text-[10px] text-muted-foreground">
                      <span>-100</span>
                      <span>0</span>
                      <span>+100</span>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <Button
            size="lg"
            className="h-12 w-full"
            disabled={confirmImport.isPending}
            onClick={() => confirmImport.mutate()}
          >
            {confirmImport.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Check className="h-4 w-4" />
            )}
            Potvrdit import (
            {
              rows.filter(
                (r) =>
                  r.include &&
                  r.employeeId &&
                  !duplicateNames.includes(
                    employees.find((e) => e.id === r.employeeId)?.full_name ??
                    addedEmployees.find((e) => e.id === r.employeeId)?.full_name ??
                    r.ocrName,
                  ),
              ).length
            }
            )
          </Button>

          <Dialog open={addEmployeeOpen} onOpenChange={setAddEmployeeOpen}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Nový zaměstnanec z OCR</DialogTitle>
              </DialogHeader>
              <div className="grid gap-4">
                <div className="rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-sm">
                  OCR rozpoznalo jméno, které zatím není v evidenci. Zkontrolujte ho před uložením.
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="ocr-new-employee-name">Jméno a příjmení</Label>
                  <Input
                    id="ocr-new-employee-name"
                    value={addEmployeeName}
                    onChange={(e) => setAddEmployeeName(e.target.value)}
                    autoFocus
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="ocr-new-employee-personal-no">Osobní číslo (volitelné)</Label>
                  <Input
                    id="ocr-new-employee-personal-no"
                    value={addEmployeePersonalNo}
                    onChange={(e) => setAddEmployeePersonalNo(e.target.value)}
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  Zaměstnanec bude založen jako aktivní se standardní pozicí. Kvalifikaci HA/TUP lze
                  doplnit později v evidenci zaměstnanců.
                </p>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setAddEmployeeOpen(false)}>
                  Zrušit
                </Button>
                <Button
                  onClick={() => createEmployee.mutate()}
                  disabled={!addEmployeeName.trim() || createEmployee.isPending}
                >
                  {createEmployee.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Plus className="h-4 w-4" />
                  )}
                  Přidat zaměstnance
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      )}
    </Card>
  );
}
