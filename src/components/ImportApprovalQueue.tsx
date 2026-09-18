import { Fragment, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { CheckCircle2, ExternalLink, UserPlus, XCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { saveDraft, loadDraft, clearDraft } from "@/lib/form-draft";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useEmployees } from "@/lib/data";
import { useAuth } from "@/lib/auth";
import { upsertImportedProductProfile } from "@/lib/productProfiles";
import { extractHourlyWithContext } from "@/lib/ocr.hourly.functions";
import { preprocessOcrImage } from "@/lib/ocr-image";

const db = supabase as any;
type PendingImport = { id: string; batch_id: string; created_at: string; screenshot_path: string | null; work_date: string | null; shift: string | null; line: string | null; product_code: string | null; product_name: string | null; norm_per_hour: number | null; ocr_confidence: number | null; ocr_data: any; admin_corrections: any; pending_reasons: string[] | null; product_id: string | null; product_match_status: string | null; product_profile_status: string | null };
type PendingRow = { id: string; import_item_id: string; row_index: number; ocr_employee_name: string | null; employee_id: string | null; position: "HA" | "TUP" | null; oee: number | null; performance: number | null; available_time: number | null; help_score: number | null; confidence: number | null; match_status: string; validation_status: string; admin_corrections: any };
type RowDraft = { employeeName: string; position: string; helpScore: string };
type ProfileDraft = { profileName: string; haCode: string; haNorm: string; haCapacity: string; tupCode: string; tupNorm: string; tupCapacity: string; validFrom: string };
const reasonLabels: Record<string, string> = { MISSING_DATE: "Chybí datum", MISSING_SHIFT: "Chybí směna", MISSING_LINE: "Chybí linka", PRODUCT_NOT_FOUND: "Produkt není v databázi", PRODUCT_PROFILE_MISSING: "Chybí Product Profile", PRODUCT_PROFILE_INCOMPLETE: "Product Profile není kompletní", EMPLOYEE_UNMATCHED: "Zaměstnanec není přiřazen", POSITION_MISSING: "Chybí HA/TUP", OEE_MISSING: "Chybí OEE", PERFORMANCE_MISSING: "Chybí výkon", AVAILABILITY_MISSING: "Chybí dostupnost", HOURLY_DATA_MISSING: "Chybí hodinová data", HOURLY_KPI_MISSING: "Hodinová data nemají platné KPI", DUPLICATE_RECORD: "Denní záznam již existuje" };
const labelReason = (v: string) => reasonLabels[v] ?? v;
const numOrNull = (v: string) => { if (!v.trim()) return null; const n = Number(v.replace(",", ".")); return Number.isFinite(n) ? n : null; };
const normalize = (v: string | null | undefined) => (v ?? "").trim().toLowerCase().replace(/\s+/g, "");
// Same conservative suffix fallback as public.resolve_product_profile() and
// ocr.hourly.functions.ts's profileVariant(): a literal OCR-read code can
// carry a trailing 1-3 letter revision marker that isn't part of the
// profile's registered subassy code, so an exact-only comparison here would
// wrongly show "Profile MISSING" for a code that actually did resolve.
const codesMatch = (a: string, b: string) => { if (!a || !b) return false; if (a === b) return true; const stripSuffix = (s: string) => s.replace(/[a-z]{1,3}$/, ""); if (a.length > b.length && stripSuffix(a) === b) return true; if (b.length > a.length && stripSuffix(b) === a) return true; return false; };
const average = (values: Array<number | null | undefined>) => { const valid = values.filter((v): v is number => v != null && Number.isFinite(Number(v))).map(Number); return valid.length ? valid.reduce((a, b) => a + b, 0) / valid.length : null; };
// Master Prompt Problem 11's required hourly-audit field "stav hodiny vůči
// výrobě" - read straight from reconstruct_import_item_hourly()'s own
// calculation_mode, never re-derived.
const hourProductionStatusLabel = (mode: string | null | undefined) => ({ EMPTY: "Prázdná hodina", LAST_HOUR_SCREENSHOT_TIME: "Poslední hodina (čas screenshotu)", TEFF: "Začátek/konec výroby (TEFF)", CLASSIC: "Pokračující výroba" } as Record<string, string>)[mode ?? ""] ?? "–";
const dataUrlFromBlob = async (blob: Blob) => await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(new Error("Screenshot se nepodařilo načíst pro 3. sekvenci OCR.")); reader.readAsDataURL(blob); });

// Shared by "Vytvořit / upravit Product Profile" (createProfile) and the
// standalone "Znovu načíst hodinová data" action: runs the 3rd OCR sequence
// against the original screenshot and persists import_item_hourly +
// per-row KPI. Factored out so re-running the hourly extraction no longer
// requires creating/editing a Product Profile first - previously this was
// the ONLY place that could (re-)trigger it, so any item whose first pass
// never reached the hourly step (e.g. blocked earlier by MISSING_SHIFT or a
// product match that only got fixed later via "Uložit opravy") had no path
// back to valid Výkon/Dostupnost/OEE once its Product Profile was already
// VALID and there was no reason to open that dialog.
async function runHourlyExtractionForItem(params: {
  itemId: string;
  screenshotPath: string | null;
  profile: { id?: string; ha_subassy: string | null; h_capacity: number | null; h_norm_per_hour: number | null; tup_subassy: string | null; t_capacity: number | null; t_norm_per_hour: number | null };
  operatorCount: number;
  currentRows: Array<{ employee_id: string | null; position: string | null }>;
  ocrData: any;
  workDate: string | null;
  shift: string | null;
  line: string | null;
  extractHourly: (opts: { data: { imageDataUrl: string; context: any } }) => Promise<any>;
}) {
  const { itemId, screenshotPath, profile, operatorCount, currentRows, ocrData, workDate, shift, line, extractHourly } = params;
  if (!screenshotPath) throw new Error("Import nemá připojený originální screenshot pro 3. sekvenci OCR.");
  const { data: blob, error: downloadError } = await supabase.storage.from("screenshots").download(screenshotPath);
  if (downloadError) throw downloadError;
  const image = await preprocessOcrImage(await dataUrlFromBlob(blob), { scale: 1.5, quality: 0.86, maxWidth: 3072, maxHeight: 3072 });
  const hourlyResult = await extractHourly({ data: { imageDataUrl: image, context: { profiles: [profile], operator_count: operatorCount } } });
  const hourly = hourlyResult.hourly_metrics ?? [];
  const performance = average(hourly.map((m: any) => m.performance_pct));
  const availability = average(hourly.map((m: any) => m.availability_pct));
  const actualOee = hourlyResult.actual_shift_oee_pct;
  if (!hourly.length) throw new Error("3. sekvence OCR nevrátila žádná hodinová data.");
  if (performance == null || availability == null || actualOee == null || !Number.isFinite(actualOee)) throw new Error("3. sekvence OCR nevrátila platný Výkon, Dostupnost nebo OEE.");
  const hourlyRows = hourly.filter((m: any) => m.hour != null).map((m: any) => ({ import_item_id: itemId, hour: Math.round(Number(m.hour)), product_code: m.product_code ?? null, role: m.role ?? null, actual_output: m.actual_output, performance_pct: m.performance_pct, availability_pct: m.availability_pct, norm_per_hour: m.norm_per_hour, capacity: m.capacity, operator_count: m.operator_count, actual_oee_pct: m.actual_oee_pct ?? null, raw_data: m }));
  if (!hourlyRows.length) throw new Error("3. sekvence OCR neobsahuje žádné použitelné hodiny.");
  const { error: deleteHourlyError } = await db.from("import_item_hourly").delete().eq("import_item_id", itemId);
  if (deleteHourlyError) throw deleteHourlyError;
  const { error: insertHourlyError } = await db.from("import_item_hourly").insert(hourlyRows);
  if (insertHourlyError) throw insertHourlyError;
  const { error: rowKpiError } = await db.from("import_item_rows").update({ oee: actualOee, performance, available_time: availability }).eq("import_item_id", itemId).is("daily_record_id", null);
  if (rowKpiError) throw rowKpiError;
  const updatedOcr = { ...(ocrData ?? {}), hourly_metrics: hourly, actual_shift_oee_pct: actualOee };
  const baseReasons: string[] = [];
  if (!workDate) baseReasons.push("MISSING_DATE");
  if (!shift) baseReasons.push("MISSING_SHIFT");
  if (!line) baseReasons.push("MISSING_LINE");
  for (const row of currentRows) { if (!row.employee_id) baseReasons.push("EMPLOYEE_UNMATCHED"); if (!row.position || !["HA", "TUP"].includes(row.position)) baseReasons.push("POSITION_MISSING"); }
  return { updatedOcr, baseReasons: [...new Set(baseReasons)] };
}

function MultiProductDetailSummary({ item }: { item: PendingImport | null }) {
  const data = item?.ocr_data ?? {};
  const hourlyQuery = useQuery({ queryKey: ["approval-detail-hourly", item?.id], enabled: Boolean(item?.id), queryFn: async () => { const { data: dbRows, error } = await db.from("import_item_hourly").select("*").eq("import_item_id", item!.id).order("hour").order("id"); if (error) throw error; return dbRows ?? []; } });
  const hourly = hourlyQuery.data?.length ? hourlyQuery.data : (Array.isArray(data.hourly_metrics) ? data.hourly_metrics : []);
  const listed = Array.isArray(data.products) ? data.products : [];
  // Same suffix-fallback merge as resolve_product_profile()/compute_import_item_product_kpis():
  // a literal OCR spelling variance (e.g. "T_S4966V4014B" vs "T_S4966V4014") across different
  // hours of the same screenshot must not show as two separate products here when the backend
  // now correctly treats them as one.
  const rawCodes = [...hourly.map((m: any) => String(m.product_code ?? "").trim()), ...listed.map((m: any) => String(m.product_code ?? "").trim()), String(data.product_code ?? "").trim()].filter((code) => /^(?:H|T)_/i.test(String(code)));
  const codes: string[] = [];
  for (const code of rawCodes) { if (!codes.some((existing) => codesMatch(normalize(existing), normalize(code)))) codes.push(code); }
  const profileQuery = useQuery({ queryKey: ["approval-detail-product-profiles", item?.id, item?.work_date, codes.join("|")], enabled: Boolean(item && codes.length), queryFn: async () => { const { data: profiles, error } = await db.from("product_profiles").select("id,ha_subassy,h_capacity,h_norm_per_hour,tup_subassy,t_capacity,t_norm_per_hour,valid_from,valid_to,version_no").order("valid_from", { ascending: false }); if (error) throw error; return profiles ?? []; } });
  if (!item || !codes.length) return null;
  const profiles = profileQuery.data ?? [];
  const date = item.work_date ?? "9999-12-31";
  const products = codes.map((code) => {
    const rows = hourly.filter((m: any) => codesMatch(normalize(m.product_code), normalize(code)));
    const validProfiles = profiles.filter((p: any) => { const matches = codesMatch(normalize(p.ha_subassy), normalize(code)) || codesMatch(normalize(p.tup_subassy), normalize(code)); return matches && String(p.valid_from ?? "0000-01-01") <= date && (p.valid_to == null || String(p.valid_to) >= date); });
    const profile = validProfiles[0];
    const isHa = /^H_/i.test(code);
    const norm = profile ? Number(isHa ? profile.h_norm_per_hour : profile.t_norm_per_hour) : null;
    const capacity = profile ? Number(isHa ? profile.h_capacity : profile.tup_capacity) : null;
    const operatorCount = rows.reduce((max: number, r: any) => Math.max(max, Number(r.operator_count) || 0), 0) || Number(data.operator_count) || 1;
    const realRows = rows.filter((r: any) => Number(r.actual_output) > 0 && codesMatch(normalize(r.product_code), normalize(code))).sort((a: any, b: any) => Number(a.hour) - Number(b.hour) || String(a.id ?? "").localeCompare(String(b.id ?? "")));
    // Performance/availability/OEE are never recomputed here - they are read
    // straight from import_item_hourly, which the backend (V19 downtime-
    // classification reconstruction) already computed correctly. Reimplementing
    // that TEFF/CLASSIC logic in the frontend previously caused this table to
    // show different (wrong) numbers than the canonical per-employee values.
    const metrics = rows.map((r: any) => {
      const minutes = Number(r?.raw_data?.calculation?.reconstructed_productive_minutes ?? r?.actual_minutes) || 60;
      const perf = Number.isFinite(Number(r.performance_pct)) ? Number(r.performance_pct) : null;
      const availability = Number.isFinite(Number(r.availability_pct)) ? Number(r.availability_pct) : null;
      const oee = Number.isFinite(Number(r.actual_oee_pct)) ? Number(r.actual_oee_pct) : null;
      return { r, minutes, perf, availability, oee };
    }).filter((x: any) => Number(x.r.actual_output) > 0);
    const totalMinutes = metrics.reduce((sum: number, x: any) => sum + x.minutes, 0);
    const weighted = (field: "perf" | "availability" | "oee") => { const values = metrics.filter((x: any) => Number.isFinite(Number(x[field]))); const weight = values.reduce((sum: number, x: any) => sum + x.minutes, 0); return weight > 0 ? values.reduce((sum: number, x: any) => sum + Number(x[field]) * x.minutes, 0) / weight : null; };
    const output = realRows.reduce((sum: number, r: any) => sum + (Number.isFinite(Number(r.actual_output)) ? Number(r.actual_output) : 0), 0);
    const hours = realRows.map((r: any) => Number(r.hour)).filter((h: number) => Number.isFinite(h)).sort((a: number, b: number) => a - b);
    const reconstruction = rows.reduce((best: any, r: any) => { const calc = r?.raw_data?.calculation; return calc?.reconstruction_status ? calc : best; }, null);
    const expected = totalMinutes > 0 && Number.isFinite(Number(norm)) && Number(norm) > 0 ? totalMinutes / 60 * Number(norm) * (Number(operatorCount) > 0 && Number(capacity) > 0 ? Number(operatorCount) / Number(capacity) : 1) : 0;
    return { code, rows, realRows, norm: norm != null && Number.isFinite(norm) && norm > 0 ? norm : null, capacity: capacity != null && Number.isFinite(capacity) && capacity > 0 ? capacity : null, operatorCount, profileFound: Boolean(profile), output, expected, hours, reconstruction, performance: weighted("perf"), availability: weighted("availability"), oee: weighted("oee") };
  });
  // Master Prompt Problem 8: the doc explicitly requires the same hour-by-hour
  // audit breakdown available for KE SCHVÁLENÍ, not just the approved daily
  // record view - reading the identical import_item_hourly fields already
  // shown in denni-data.tsx's detail dialog, never recomputed here.
  const fmtNum = (v: number | null | undefined, digits = 2) => v == null || !Number.isFinite(Number(v)) ? "—" : Number(v).toFixed(digits);
  return <Card className="border-primary/30 bg-primary/5"><div className="flex items-center justify-between gap-3"><div><div className="font-semibold">Rozpoznané produkty</div><div className="text-xs text-muted-foreground">Kontrola všech Product ID nalezených v hodinové tabulce. Norma je vždy načtena z platného Product Profile, ne z OCR.</div></div><Badge variant="secondary">{products.length} {products.length === 1 ? "produkt" : products.length < 5 ? "produkty" : "produktů"}</Badge></div><div className="mt-3 grid gap-2">{products.map((product) => <div key={product.code} className="rounded-lg border bg-background p-3"><div className="flex flex-wrap items-center justify-between gap-2"><div className="font-semibold break-all">{product.code}</div><div className="text-sm font-medium">Norma: {product.norm != null ? `${product.norm} ks/h` : product.profileFound ? "—" : "Profile MISSING"}</div></div><div className="mt-2 grid grid-cols-2 gap-2 text-xs sm:grid-cols-7"><div><div className="text-muted-foreground">Hodiny</div><div className="font-medium">{product.hours.length ? product.hours.join(", ") : "—"}</div></div><div><div className="text-muted-foreground">Vyrobeno</div><div className="font-medium">{product.output || "—"} ks</div></div><div><div className="text-muted-foreground">Očekáváno</div><div className="font-medium">{product.expected > 0 ? `${product.expected.toFixed(0)} ks` : "—"}</div></div><div><div className="text-muted-foreground">Výkon</div><div className="font-medium">{product.performance != null ? `${product.performance.toFixed(2)} %` : "—"}</div></div><div><div className="text-muted-foreground">Dostupnost</div><div className="font-medium">{product.availability != null ? `${product.availability.toFixed(2)} %` : "—"}</div></div><div><div className="text-muted-foreground">OEE</div><div className="font-medium">{product.oee != null ? `${product.oee.toFixed(2)} %` : "—"}</div></div><div><div className="text-muted-foreground">Kapacita / operátoři</div><div className="font-medium">{product.capacity != null ? `${product.capacity} / ${product.operatorCount}` : "—"}</div></div></div>{product.reconstruction?.reconstruction_status ? <div className="mt-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-xs"><span className="font-medium">Rekonstruovaný čas:</span> {Number(product.reconstruction.reconstructed_productive_minutes).toFixed(2)} min · odvozeno z výstupu a master normy · jistota: odvozená</div> : null}{product.realRows.length ? <details className="mt-2"><summary className="cursor-pointer text-xs font-medium text-muted-foreground">Hodinový rozpis výpočtu ({product.realRows.length})</summary><div className="mt-2 overflow-x-auto"><table className="w-full min-w-[920px] text-[11px]"><thead><tr className="border-b text-left text-muted-foreground"><th className="px-1.5 py-1">Hodina</th><th className="px-1.5 py-1">Stav</th><th className="px-1.5 py-1 text-right">Výstup</th><th className="px-1.5 py-1 text-right">Očekáváno</th><th className="px-1.5 py-1 text-right">Výkon</th><th className="px-1.5 py-1 text-right">Dostupnost</th><th className="px-1.5 py-1 text-right">OEE</th><th className="px-1.5 py-1 text-right">Produktivní min.</th></tr></thead><tbody>{product.realRows.map((r: any) => { const calc = r?.raw_data?.calculation ?? {}; const linkage = calc.ha_tup_linkage; const availExcluded = calc.availability_measured != null && calc.availability_applied_to_oee != null && Number(calc.availability_measured) !== Number(calc.availability_applied_to_oee); return <Fragment key={r.id ?? r.hour}>
    <tr className="border-b border-border/40"><td className="px-1.5 py-1 font-medium">{r.hour}:00</td><td className="px-1.5 py-1"><Badge variant="outline" className="text-[9px]">{hourProductionStatusLabel(calc.calculation_mode)}</Badge></td><td className="px-1.5 py-1 text-right">{fmtNum(r.actual_output)}</td><td className="px-1.5 py-1 text-right">{fmtNum(calc.expected_output_at_current_staffing)}</td><td className="px-1.5 py-1 text-right">{fmtNum(r.performance_pct)} %</td><td className="px-1.5 py-1 text-right">{fmtNum(r.availability_pct)} %</td><td className="px-1.5 py-1 text-right">{fmtNum(r.actual_oee_pct)} %</td><td className="px-1.5 py-1 text-right">{fmtNum(calc.reconstructed_productive_minutes ?? r.actual_minutes, 0)}</td></tr>
    {linkage || availExcluded ? <tr><td colSpan={8} className="px-1.5 py-0.5 text-[10px] text-amber-300/80">
      {availExcluded ? <span className="mr-2">Dostupnost {fmtNum(calc.availability_measured, 2)} % naměřená, do OEE se nezapočítává znovu (už je ve zkráceném produktivním čase)</span> : null}
      {linkage ? <span>HA→TUP: {linkage.ha_product_code ?? "?"} · dostupné {fmtNum(linkage.ha_cumulative_available, 0)} ks{linkage.allocation_fraction != null && linkage.allocation_fraction !== 1 ? ` · alokace ${Math.round(Number(linkage.allocation_fraction) * 100)} %` : ""}{linkage.capped ? " · limitováno" : ""}</span> : null}
    </td></tr> : null}
  </Fragment>; })}</tbody></table></div></details> : null}</div>)}</div></Card>;
}

export function ImportApprovalQueue() {
  const qc = useQueryClient(); const { data: employees = [] } = useEmployees(); const { session } = useAuth(); const extractHourly = useServerFn(extractHourlyWithContext);
  const [selected, setSelected] = useState<PendingImport | null>(null); const [previewUrl, setPreviewUrl] = useState<string | null>(null); const [editing, setEditing] = useState<Record<string, string>>({}); const [rowEditing, setRowEditing] = useState<Record<string, RowDraft>>({}); const [employeeOpen, setEmployeeOpen] = useState(false); const [employeeRow, setEmployeeRow] = useState<PendingRow | null>(null); const [newEmployee, setNewEmployee] = useState({ fullName: "", firstName: "", lastName: "" }); const [profileOpen, setProfileOpen] = useState(false); const [profile, setProfile] = useState<ProfileDraft>({ profileName: "", haCode: "", haNorm: "", haCapacity: "", tupCode: "", tupNorm: "", tupCapacity: "", validFrom: new Date().toISOString().slice(0, 10) }); const [rejectOpen, setRejectOpen] = useState(false); const [rejectReason, setRejectReason] = useState("");
  const query = useQuery({ queryKey: ["import-approval-queue"], queryFn: async () => { const { data: items, error } = await db.from("import_items").select("*").eq("status", "PENDING_APPROVAL").order("created_at", { ascending: false }); if (error) throw error; const ids = (items ?? []).map((x: any) => x.id); if (!ids.length) return { items: [] as PendingImport[], rows: [] as PendingRow[] }; const { data: rows, error: rowError } = await db.from("import_item_rows").select("*").in("import_item_id", ids).order("row_index"); if (rowError) throw rowError; return { items: items as PendingImport[], rows: rows as PendingRow[] }; } });
  // Master Prompt Problem 9, option B: pick an ALREADY-EXISTING Product
  // Profile instead of always creating a new one (the fix for a misread OCR
  // code like "6264-008" when "6264-003" already exists as a profile).
  const existingProfilesQuery = useQuery({ queryKey: ["approval-existing-profiles"], queryFn: async () => { const { data, error } = await db.from("product_profiles").select("id,profile_name,ha_subassy,tup_subassy").is("valid_to", null).order("profile_name"); if (error) throw error; return data ?? []; } });
  const assignExistingProfile = (profileId: string) => {
    const profile = (existingProfilesQuery.data ?? []).find((p: any) => p.id === profileId);
    if (!profile) return;
    const currentCode = String(editing["product_code"] ?? selected?.product_code ?? "");
    const preferHa = /^H_/i.test(currentCode);
    const code = (preferHa ? profile.ha_subassy || profile.tup_subassy : profile.tup_subassy || profile.ha_subassy) ?? "";
    if (code) setEditing((p) => ({ ...p, product_code: code }));
  };
  const items = query.data?.items ?? []; const rows = query.data?.rows ?? []; const selectedRows = useMemo(() => selected ? rows.filter(r => r.import_item_id === selected.id) : [], [rows, selected]); const blockerList = selected?.pending_reasons ?? [];
  const recognizedProductCodes = useMemo(() => { const data = selected?.ocr_data ?? {}; const listed = Array.isArray(data.products) ? data.products : []; const codes = new Set<string>(); for (const p of listed) { const code = String(p?.product_code ?? "").trim(); if (code) codes.add(code); } if (selected?.product_code) codes.add(selected.product_code); return Array.from(codes); }, [selected]);
  const refreshSelected = async (itemId: string) => { const refreshed = await query.refetch(); const next = refreshed.data?.items.find((x) => x.id === itemId) ?? null; setSelected(next); };
  // A background tab discarded and reloaded by the browser would otherwise
  // silently lose in-progress OCR corrections - restore/save per import
  // item (not globally), since each item has its own independent edits.
  const approvalDraftKey = (itemId: string) => `import-approval:${itemId}`;
  useEffect(() => {
    if (!selected) return;
    if (Object.keys(editing).length || Object.keys(rowEditing).length) saveDraft(approvalDraftKey(selected.id), { editing, rowEditing });
    else clearDraft(approvalDraftKey(selected.id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, editing, rowEditing]);
  const openPreview = async (item: PendingImport) => {
    setSelected(item);
    const draft = loadDraft<{ editing: Record<string, string>; rowEditing: Record<string, RowDraft> }>(approvalDraftKey(item.id));
    setEditing(draft?.editing ?? {});
    setRowEditing(draft?.rowEditing ?? {});
    if (draft && (Object.keys(draft.editing).length || Object.keys(draft.rowEditing).length)) toast.info("Obnoveny neuložené opravy z předchozí relace.");
    if (!item.screenshot_path) return setPreviewUrl(null);
    const { data, error } = await supabase.storage.from("screenshots").createSignedUrl(item.screenshot_path, 600); if (error) { toast.error(`Screenshot nelze zobrazit: ${error.message}`); return; } setPreviewUrl(data.signedUrl);
  };
  const saveHeader = useMutation({ mutationFn: async () => {
    if (!selected) throw new Error("Není vybrán import.");
    const patch = { work_date: editing["work_date"] ?? selected.work_date, shift: editing["shift"] ?? selected.shift, line: editing["line"] ?? selected.line, product_code: editing["product_code"] ?? selected.product_code, product_name: editing["product_name"] ?? selected.product_name, norm_per_hour: editing["norm_per_hour"] === undefined ? selected.norm_per_hour : numOrNull(editing["norm_per_hour"]) } as Record<string, unknown>;
    if (!patch["work_date"] || !patch["shift"] || !patch["line"]) throw new Error("Datum, směna a linka musí být vyplněné.");
    const code = String(patch["product_code"] ?? "").trim();
    if (!code) throw new Error("Product ID musí být vyplněné.");
    // Uses the same public.resolve_product_profile() the SQL approval
    // functions call - checks product_profiles.ha_subassy/tup_subassy too,
    // not just products.code, so a header correction here can never
    // disagree with what approval will decide later. This also covers
    // "assign an existing Product Profile" (Master Prompt Problem 9): typing
    // (or picking, via the profile selector below) the correct code for a
    // misread OCR value resolves straight to an ALREADY-EXISTING profile
    // instead of requiring a new one; the original OCR value stays intact in
    // ocr_data for audit, only product_code/admin_corrections change here.
    const { data: resolvedRows, error: resolveError } = await db.rpc("resolve_product_profile", { p_code: code, p_work_date: String(patch["work_date"]) });
    if (resolveError) throw resolveError;
    const resolved = resolvedRows?.[0];
    const profileStatus: "VALID" | "MISSING" | "INCOMPLETE" = !resolved?.profile_id ? "MISSING" : resolved.profile_complete ? "VALID" : "INCOMPLETE";
    const { data: currentRows, error: rowsError } = await db.from("import_item_rows").select("employee_id,position,oee,performance,available_time").eq("import_item_id", selected.id);
    if (rowsError) throw rowsError;
    const reasons: string[] = [];
    if (!patch["work_date"]) reasons.push("MISSING_DATE");
    if (!patch["shift"]) reasons.push("MISSING_SHIFT");
    if (!patch["line"]) reasons.push("MISSING_LINE");
    if (!resolved?.product_id) reasons.push("PRODUCT_NOT_FOUND");
    else if (profileStatus === "MISSING") reasons.push("PRODUCT_PROFILE_MISSING");
    else if (profileStatus === "INCOMPLETE") reasons.push("PRODUCT_PROFILE_INCOMPLETE");
    if (!currentRows?.length) reasons.push("EMPLOYEE_UNMATCHED");
    for (const row of currentRows ?? []) { if (!row.employee_id) reasons.push("EMPLOYEE_UNMATCHED"); if (!["HA", "TUP"].includes(row.position)) reasons.push("POSITION_MISSING"); if (row.oee == null) reasons.push("OEE_MISSING"); if (row.performance == null) reasons.push("PERFORMANCE_MISSING"); if (row.available_time == null) reasons.push("AVAILABILITY_MISSING"); }
    const nextReasons = [...new Set(reasons)];
    // Master Prompt Problem 5/9: fixing the Product ID (whether it now
    // resolves to a newly-created or an already-existing profile) must
    // trigger the SAME full recompute as creating a profile from scratch -
    // not just clear the blocker and leave stale/missing hourly KPIs behind
    // for a separate manual "Znovu načíst hodinová data" click. Only take
    // this path when the profile genuinely transitions to usable AND the
    // item actually had a profile- or hourly-KPI-related blocker before, so
    // an unrelated header edit (e.g. fixing the shift) doesn't trigger an
    // unnecessary re-OCR pass.
    const priorReasons = new Set(selected.pending_reasons ?? []);
    const profileWasBlocked = ["PRODUCT_NOT_FOUND", "PRODUCT_PROFILE_MISSING", "PRODUCT_PROFILE_INCOMPLETE"].some((r) => priorReasons.has(r));
    const hourlyWasBlocked = ["HOURLY_DATA_MISSING", "HOURLY_KPI_MISSING", "OEE_MISSING", "PERFORMANCE_MISSING", "AVAILABILITY_MISSING"].some((r) => priorReasons.has(r));
    // BUG-002: picking a DIFFERENT already-existing Product Profile (the
    // "assign existing profile" dropdown, for a misread OCR code) can
    // resolve to a different profile_id even when the item wasn't
    // previously flagged as profile-blocked - it was already VALID, just
    // against the wrong profile. Keying recompute only off prior blockers
    // silently left the hourly KPIs computed against the old profile's norm.
    const codeChanged = normalize(code) !== normalize(selected.product_code ?? "");
    const shouldRecomputeHourly = profileStatus === "VALID" && Boolean(currentRows?.length) && (profileWasBlocked || hourlyWasBlocked || codeChanged);
    const { error } = await db.from("import_items").update({ ...patch, product_id: resolved?.product_id ?? null, product_match_status: resolved?.product_id ? "MATCHED" : "UNMATCHED", product_profile_status: profileStatus, pending_reasons: shouldRecomputeHourly ? selected.pending_reasons : nextReasons, admin_corrections: { ...(selected.admin_corrections ?? {}), ...patch } }).eq("id", selected.id).eq("status", "PENDING_APPROVAL");
    if (error) throw error;
    // saveHeader previously updated pending_reasons without an audit trail
    // entry, so import_item_events stopped reflecting the item's real
    // history the moment a reviewer corrected anything here.
    await db.from("import_item_events").insert({ import_item_id: selected.id, event_type: "ADMIN_HEADER_REVALIDATED", from_status: "PENDING_APPROVAL", to_status: "PENDING_APPROVAL", payload: { blockers: nextReasons, product_match_source: resolved?.match_source ?? null } });
    if (!shouldRecomputeHourly) return { itemId: selected.id, recomputed: false };
    const profileForContext = { id: resolved.profile_id, ha_subassy: resolved.profile_ha_subassy, h_capacity: resolved.h_capacity, h_norm_per_hour: resolved.h_norm_per_hour, tup_subassy: resolved.profile_tup_subassy, t_capacity: resolved.t_capacity, t_norm_per_hour: resolved.t_norm_per_hour };
    const { error: validatingError } = await db.from("import_items").update({ status: "VALIDATING" }).eq("id", selected.id).eq("status", "PENDING_APPROVAL");
    if (validatingError) throw validatingError;
    try {
      const { updatedOcr, baseReasons } = await runHourlyExtractionForItem({ itemId: selected.id, screenshotPath: selected.screenshot_path, profile: profileForContext, operatorCount: currentRows!.length, currentRows: currentRows!, ocrData: selected.ocr_data, workDate: String(patch["work_date"]), shift: String(patch["shift"]), line: String(patch["line"]), extractHourly });
      const { error: finishError } = await db.from("import_items").update({ status: "PENDING_APPROVAL", ocr_data: updatedOcr, pending_reasons: baseReasons }).eq("id", selected.id).eq("status", "VALIDATING");
      if (finishError) throw finishError;
    } catch (hourlyError) {
      await db.from("import_items").update({ status: "PENDING_APPROVAL", pending_reasons: [...new Set([...nextReasons.filter((r) => !["HOURLY_DATA_MISSING", "HOURLY_KPI_MISSING", "OEE_MISSING", "PERFORMANCE_MISSING", "AVAILABILITY_MISSING"].includes(r)), "HOURLY_KPI_MISSING"])] }).eq("id", selected.id).eq("status", "VALIDATING");
      throw hourlyError;
    }
    return { itemId: selected.id, recomputed: true };
  }, onSuccess: async ({ itemId, recomputed }) => { await refreshSelected(itemId); toast.success(recomputed ? "Product ID opraveno, profil přiřazen a KPI byla přepočítána." : "OCR opravy byly uloženy a validace přepočítána."); }, onError: (e: Error) => toast.error(e.message) });
  const saveRow = useMutation({ mutationFn: async ({ row }: { row: PendingRow }) => { const draft = rowEditing[row.id] ?? { employeeName: row.ocr_employee_name ?? "", position: row.position ?? "", helpScore: row.help_score != null ? String(row.help_score) : "" }; if (!draft.employeeName.trim()) throw new Error("OCR jméno zaměstnance nesmí být prázdné."); if (!draft.position || !["HA", "TUP"].includes(draft.position)) throw new Error("Pozice musí být HA nebo TUP."); const helpScore = numOrNull(draft.helpScore ?? ""); const { error } = await db.from("import_item_rows").update({ ocr_employee_name: draft.employeeName.trim(), position: draft.position, help_score: helpScore, admin_corrections: { ...(row.admin_corrections ?? {}), ocr_employee_name: draft.employeeName.trim(), position: draft.position, help_score: helpScore } }).eq("id", row.id); if (error) throw error; return row.import_item_id; }, onSuccess: async (itemId) => { await refreshSelected(itemId); toast.success("Řádek zaměstnance byl uložen."); }, onError: (e: Error) => toast.error(e.message) });
  const assignEmployee = useMutation({ mutationFn: async ({ row, employeeId }: { row: PendingRow; employeeId: string }) => { const { error } = await db.from("import_item_rows").update({ employee_id: employeeId, match_status: "ASSIGNED_MANUALLY", validation_status: "VALID", admin_corrections: { ...(row.admin_corrections ?? {}), employee_id: employeeId } }).eq("id", row.id); if (error) throw error; return row.import_item_id; }, onSuccess: async (itemId) => { await refreshSelected(itemId); toast.success("Zaměstnanec byl přiřazen."); }, onError: (e: Error) => toast.error(e.message) });
  const createEmployee = useMutation({ mutationFn: async ({ row }: { row: PendingRow }) => { const fullName = newEmployee.fullName.trim() || `${newEmployee.firstName.trim()} ${newEmployee.lastName.trim()}`.trim(); if (!fullName) throw new Error("Jméno zaměstnance nesmí být prázdné."); const { data, error } = await db.from("employees").insert({ full_name: fullName, active: true }).select("id").single(); if (error) throw error; const { error: rowError } = await db.from("import_item_rows").update({ employee_id: data.id, match_status: "CREATED_NEW", validation_status: "VALID", admin_corrections: { ...(row.admin_corrections ?? {}), created_employee_id: data.id, created_employee_name: fullName } }).eq("id", row.id); if (rowError) throw rowError; return row.import_item_id; }, onSuccess: async (itemId) => { setEmployeeOpen(false); setEmployeeRow(null); setNewEmployee({ fullName: "", firstName: "", lastName: "" }); await qc.invalidateQueries(); await refreshSelected(itemId); toast.success("Zaměstnanec byl vytvořen a přiřazen."); }, onError: (e: Error) => toast.error(e.message) });
  const createProfile = useMutation({ mutationFn: async () => { if (!selected) throw new Error("Není vybrán import."); const validFrom = profile.validFrom || selected.work_date || new Date().toISOString().slice(0, 10); const ha = profile.haCode.trim() ? { code: profile.haCode.trim(), norm: Number(profile.haNorm), capacity: Number(profile.haCapacity) } : undefined; const tup = profile.tupCode.trim() ? { code: profile.tupCode.trim(), norm: Number(profile.tupNorm), capacity: Number(profile.tupCapacity) } : undefined;
      // BUG-002: a Product Profile may legitimately cover only HA or only
      // TUP (a product with no separate stage on the other side) - matches
      // the DB constraint product_profiles_active_complete_check and
      // ProductProfileManagerV2's own save(), which likewise only require
      // whichever side IS present to be valid. Requiring both unconditionally
      // made it impossible to create a profile for a single-sided product.
      if (!ha && !tup) throw new Error("Product Profile musí obsahovat alespoň HA nebo TUP Product ID.");
      if (ha && (!Number.isFinite(ha.norm) || ha.norm <= 0 || !Number.isInteger(ha.capacity) || ha.capacity < 1)) throw new Error("HA norma/kapacita nejsou platné.");
      if (tup && (!Number.isFinite(tup.norm) || tup.norm <= 0 || !Number.isInteger(tup.capacity) || tup.capacity < 1)) throw new Error("TUP norma/kapacita nejsou platné.");
      const profileId = await upsertImportedProductProfile({ profileName: profile.profileName || selected.product_name, ...(ha ? { ha } : {}), ...(tup ? { tup } : {}), validFrom }); const { data: verifiedProfile, error: verifyError } = await db.from("product_profiles").select("id,ha_subassy,h_capacity,h_norm_per_hour,tup_subassy,t_capacity,t_norm_per_hour,valid_from,valid_to,version_no").eq("id", profileId).maybeSingle(); if (verifyError) throw verifyError;
      const haVerified = !ha || (verifiedProfile?.ha_subassy && Number(verifiedProfile.h_norm_per_hour) > 0 && Number(verifiedProfile.h_capacity) >= 1);
      const tupVerified = !tup || (verifiedProfile?.tup_subassy && Number(verifiedProfile.t_norm_per_hour) > 0 && Number(verifiedProfile.t_capacity) >= 1);
      if (!verifiedProfile || verifiedProfile.valid_to != null || verifiedProfile.valid_from > (selected.work_date ?? validFrom) || !haVerified || !tupVerified) throw new Error("Product Profile byl uložen, ale neprošel následnou kontrolou. Import nelze schválit.");
      for (const side of [ha, tup]) {
        if (!side) continue;
        const { data: product, error: productError } = await db.from("products").select("id,code,name,active").eq("code", side.code).maybeSingle();
        if (productError) throw productError;
        if (!product || product.active === false) throw new Error(`Product Profile je uložen, ale produkt ${side.code} není v databázi. Import nelze schválit.`);
      } const { data: currentRows, error: rowsError } = await db.from("import_item_rows").select("id,employee_id,position").eq("import_item_id", selected.id).order("row_index"); if (rowsError) throw rowsError; if (!currentRows?.length) throw new Error("Nejdříve musí být přiřazen alespoň jeden zaměstnanec."); const { error: validatingError } = await db.from("import_items").update({ status: "VALIDATING", product_profile_status: "VALID" }).eq("id", selected.id).eq("status", "PENDING_APPROVAL"); if (validatingError) throw validatingError; try { const { updatedOcr, baseReasons } = await runHourlyExtractionForItem({ itemId: selected.id, screenshotPath: selected.screenshot_path, profile: verifiedProfile, operatorCount: currentRows.length, currentRows, ocrData: selected.ocr_data, workDate: selected.work_date, shift: selected.shift, line: selected.line, extractHourly }); const { error: finishError } = await db.from("import_items").update({ status: "PENDING_APPROVAL", product_profile_status: "VALID", ocr_data: updatedOcr, pending_reasons: baseReasons }).eq("id", selected.id).eq("status", "VALIDATING"); if (finishError) throw finishError; } catch (error) { await db.from("import_items").update({ status: "PENDING_APPROVAL", product_profile_status: "VALID", pending_reasons: [...new Set([...(selected.pending_reasons ?? []).filter((r) => !["PRODUCT_PROFILE_MISSING", "PRODUCT_PROFILE_INCOMPLETE", "HOURLY_DATA_MISSING", "HOURLY_KPI_MISSING", "OEE_MISSING", "PERFORMANCE_MISSING", "AVAILABILITY_MISSING"].includes(r)) , "HOURLY_KPI_MISSING"]) ] }).eq("id", selected.id).eq("status", "VALIDATING"); throw error; } return selected.id; }, onSuccess: async (itemId) => { setProfileOpen(false); await refreshSelected(itemId); toast.success("Product Profile byl uložen a 3. sekvence znovu spočítala KPI. Import stále čeká na schválení."); }, onError: (e: Error) => toast.error(e.message) });
  const reextractHourly = useMutation({ mutationFn: async () => {
    if (!selected) throw new Error("Není vybrán import.");
    const code = String(selected.product_code ?? "").trim();
    if (!code) throw new Error("Product ID musí být vyplněné.");
    const { data: resolvedRows, error: resolveError } = await db.rpc("resolve_product_profile", { p_code: code, p_work_date: selected.work_date ?? new Date().toISOString().slice(0, 10) });
    if (resolveError) throw resolveError;
    const resolved = resolvedRows?.[0];
    if (!resolved?.profile_id) throw new Error("Pro tento Product ID nebyl nalezen žádný Product Profile.");
    if (!resolved.profile_complete) throw new Error("Product Profile existuje, ale není kompletní (chybí norma nebo kapacita).");
    const profileForContext = { id: resolved.profile_id, ha_subassy: resolved.profile_ha_subassy, tup_subassy: resolved.profile_tup_subassy, h_norm_per_hour: resolved.h_norm_per_hour, h_capacity: resolved.h_capacity, t_norm_per_hour: resolved.t_norm_per_hour, t_capacity: resolved.t_capacity };
    const { data: currentRows, error: rowsError } = await db.from("import_item_rows").select("id,employee_id,position").eq("import_item_id", selected.id).order("row_index");
    if (rowsError) throw rowsError;
    if (!currentRows?.length) throw new Error("Nejdříve musí být přiřazen alespoň jeden zaměstnanec.");
    const { error: validatingError } = await db.from("import_items").update({ status: "VALIDATING", product_id: resolved.product_id, product_match_status: resolved.product_id ? "MATCHED" : "UNMATCHED", product_profile_status: "VALID" }).eq("id", selected.id).eq("status", "PENDING_APPROVAL");
    if (validatingError) throw validatingError;
    try {
      const { updatedOcr, baseReasons } = await runHourlyExtractionForItem({ itemId: selected.id, screenshotPath: selected.screenshot_path, profile: profileForContext, operatorCount: currentRows.length, currentRows, ocrData: selected.ocr_data, workDate: selected.work_date, shift: selected.shift, line: selected.line, extractHourly });
      const { error: finishError } = await db.from("import_items").update({ status: "PENDING_APPROVAL", ocr_data: updatedOcr, pending_reasons: baseReasons }).eq("id", selected.id).eq("status", "VALIDATING");
      if (finishError) throw finishError;
    } catch (error) {
      await db.from("import_items").update({ status: "PENDING_APPROVAL", pending_reasons: [...new Set([...(selected.pending_reasons ?? []).filter((r) => !["HOURLY_DATA_MISSING", "HOURLY_KPI_MISSING", "OEE_MISSING", "PERFORMANCE_MISSING", "AVAILABILITY_MISSING"].includes(r)), "HOURLY_KPI_MISSING"])] }).eq("id", selected.id).eq("status", "VALIDATING");
      throw error;
    }
    return selected.id;
  }, onSuccess: async (itemId) => { await refreshSelected(itemId); toast.success("Hodinová data byla znovu načtena z OCR."); }, onError: (e: Error) => toast.error(e.message) });
  const approve = useMutation({ mutationFn: async (item: PendingImport) => { const { data, error } = await db.rpc("approve_import_item", { p_import_item_id: item.id, p_actor_id: session?.user?.id ?? null }); if (error) throw error; if (data?.success === false) throw new Error(data?.message ?? "Schválení importu selhalo."); if (item.batch_id) await db.rpc("evaluate_batch_ha_tup_linkage", { p_batch_id: item.batch_id }).catch(() => {}); return data; }, onSuccess: (data: any, item) => { clearDraft(approvalDraftKey(item.id)); setSelected(null); setPreviewUrl(null); qc.invalidateQueries(); toast.success(`Import byl schválen. Vytvořeno záznamů: ${data?.created_count ?? data?.created_daily_records ?? 0}.`); }, onError: (e: Error) => toast.error(`Import nebyl schválen: ${e.message}`) });
  const reject = useMutation({ mutationFn: async ({ item, reason }: { item: PendingImport; reason: string }) => { if (!reason.trim()) throw new Error("U zamítnutí je nutný důvod."); const now = new Date().toISOString(); const { error } = await db.from("import_items").update({ status: "REJECTED", rejected_by: session?.user?.id ?? null, rejected_at: now, rejection_reason: reason.trim(), completed_at: now }).eq("id", item.id).eq("status", "PENDING_APPROVAL"); if (error) throw error; const { error: eventError } = await db.from("import_item_events").insert({ import_item_id: item.id, actor_id: session?.user?.id ?? null, event_type: "ADMIN_REJECTED", from_status: "PENDING_APPROVAL", to_status: "REJECTED", payload: { reason: reason.trim() } }); if (eventError) throw eventError; }, onSuccess: (_d, { item }) => { clearDraft(approvalDraftKey(item.id)); setRejectOpen(false); setRejectReason(""); setSelected(null); setPreviewUrl(null); qc.invalidateQueries({ queryKey: ["import-approval-queue"] }); toast.success("Import byl zamítnut."); }, onError: (e: Error) => toast.error(e.message) });
  // BUG-002: the OCR-recognized code can be either the HA or the TUP side
  // of the product - route it into the matching field instead of always
  // assuming HA, or a TUP-only screenshot prefills the wrong field and the
  // reviewer has to notice and move it (and often doesn't, so the HA-only
  // validation below used to reject the whole form).
  const startProfile = () => { if (!selected) return; const main = (selected.ocr_data?.products ?? []).find((p: any) => normalize(p.product_code) === normalize(selected.product_code)) ?? selected.ocr_data?.products?.[0]; const code = main?.product_code ?? selected.product_code ?? ""; const norm = main?.norm_per_hour != null ? String(main.norm_per_hour) : ""; const isTup = /^T_/i.test(code); setProfile({ profileName: selected.product_name ?? selected.product_code ?? "", haCode: isTup ? "" : code, haNorm: isTup ? "" : norm, haCapacity: "", tupCode: isTup ? code : "", tupNorm: isTup ? norm : "", tupCapacity: "", validFrom: selected.work_date ?? new Date().toISOString().slice(0, 10) }); setProfileOpen(true); };
  const openEmployee = (row: PendingRow) => { setEmployeeRow(row); setNewEmployee({ fullName: row.ocr_employee_name ?? "", firstName: "", lastName: "" }); setEmployeeOpen(true); };
  const openRowEdit = (row: PendingRow) => setRowEditing(p => ({ ...p, [row.id]: { employeeName: row.ocr_employee_name ?? "", position: row.position ?? "", helpScore: row.help_score != null ? String(row.help_score) : "" } }));
  const updateDraft = (row: PendingRow, key: keyof RowDraft, value: string) => setRowEditing(p => ({ ...p, [row.id]: { ...(p[row.id] ?? { employeeName: row.ocr_employee_name ?? "", position: row.position ?? "", helpScore: row.help_score != null ? String(row.help_score) : "" }), [key]: value } }));
  return <div className="grid gap-4">
    <Card className="p-4"><div className="flex items-center justify-between gap-3"><div><div className="font-semibold">Importy čekající na schválení</div><div className="text-sm text-muted-foreground">OCR je pouze návrh. Výkon, Dostupnost a OEE se vždy počítají ve 3. sekvenci a nelze je ručně měnit.</div></div><Badge variant={items.length ? "default" : "outline"}>{items.length} čeká</Badge></div></Card>
    {query.isLoading ? <Card className="p-6 text-sm text-muted-foreground">Načítám importy…</Card> : query.error ? <Card className="p-6 text-sm text-destructive">Nepodařilo se načíst importy: {(query.error as Error).message}</Card> : items.length === 0 ? <Card className="p-8 text-center text-sm text-muted-foreground">Žádný import nečeká na schválení.</Card> : <div className="grid gap-3">{items.map(item => <Card key={item.id} className="p-4"><div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between"><div className="min-w-0"><div className="flex flex-wrap gap-2"><Badge variant="secondary">PENDING</Badge>{item.product_code && <Badge variant="outline">{item.product_code}</Badge>}{item.product_profile_status === "VALID" ? <Badge>Product Profile ✓</Badge> : <Badge variant="destructive">Profile {item.product_profile_status ?? "MISSING"}</Badge>}{item.ocr_confidence != null && <Badge variant="outline">OCR {Math.round(Number(item.ocr_confidence) * 100)}%</Badge>}</div><div className="mt-2 font-medium">{item.work_date ?? "Bez data"} · {item.shift ?? "Bez směny"} · {item.line ?? "Bez linky"}</div><div className="text-sm text-muted-foreground">{item.product_name || item.product_code || "Neurčený produkt"} · {rows.filter(r => r.import_item_id === item.id).length} zaměstnanců</div><div className="mt-2 flex flex-wrap gap-1">{(item.pending_reasons ?? []).map(r => <Badge key={r} variant="destructive" className="text-xs">{labelReason(r)}</Badge>)}</div></div><div className="flex flex-wrap gap-2"><Button variant="outline" onClick={() => void openPreview(item)}>Detail / screenshot</Button><Button variant="destructive" onClick={() => { setSelected(item); setRejectOpen(true); }}>Zamítnout</Button></div></div></Card>)}</div>}
    <Dialog open={!!selected && !rejectOpen} onOpenChange={v => { if (!v) { setSelected(null); setPreviewUrl(null); } }}><DialogContent className="max-h-[95vh] max-w-6xl overflow-y-auto">{selected && <><DialogHeader><DialogTitle>Kontrola importu · {selected.product_code ?? "bez produktu"}</DialogTitle></DialogHeader><MultiProductDetailSummary item={selected} /><div className="grid gap-5 lg:grid-cols-[1fr_1.2fr]"><div className="space-y-4"><Card className="overflow-hidden p-2">{previewUrl ? <a href={previewUrl} target="_blank" rel="noreferrer"><img src={previewUrl} alt="Originální screenshot importu" className="max-h-[520px] w-full rounded-lg object-contain" /></a> : <div className="p-8 text-center text-sm text-muted-foreground">Screenshot není dostupný.</div>}<div className="p-2 text-xs text-muted-foreground">Kliknutím otevřete originální screenshot ve větším zobrazení.</div></Card><Card className="p-4"><div className="font-semibold">Důvody kontroly</div><div className="mt-2 flex flex-wrap gap-2">{blockerList.length ? blockerList.map(x => <Badge key={x} variant="destructive">{labelReason(x)}</Badge>) : <Badge variant="outline">Žádný známý blocker</Badge>}</div></Card></div><div className="space-y-4"><Card className="p-4"><div className="font-semibold">OCR data – upravitelná</div>{recognizedProductCodes.length > 1 && <div className="mt-2 text-xs text-muted-foreground">Rozpoznané Product ID v hodinové tabulce: {recognizedProductCodes.map(code => <Badge key={code} variant="outline" className="ml-1">{code}</Badge>)}. Pole „Product ID" níže slouží pro hlavní/primární produkt záznamu – detail všech produktů je výše v „Rozpoznané produkty".</div>}<div className="mt-3 grid gap-3 sm:grid-cols-2">{([["work_date","Datum"],["shift","Směna"],["line","Linka"],["product_code","Product ID"],["product_name","Název produktu"],["norm_per_hour","Norma / h"]] as [string,string][]).map(([key,label]) => <label key={key} className="text-sm"><span className="mb-1 block text-xs text-muted-foreground">{label}</span><Input value={editing[key] ?? String((selected as any)[key] ?? "")} onChange={e => setEditing(p => ({ ...p, [key]: e.target.value }))} /></label>)}</div><Button className="mt-3" variant="outline" disabled={saveHeader.isPending} onClick={() => saveHeader.mutate()}>Uložit opravy a znovu validovat</Button></Card>
    <Card className="p-4"><div className="font-semibold">Zaměstnanci – OCR + opravy</div><div className="mt-3 space-y-3">{selectedRows.map(row => { const d = rowEditing[row.id] ?? { employeeName: row.ocr_employee_name ?? "", position: row.position ?? "", helpScore: row.help_score != null ? String(row.help_score) : "" }; return <div key={row.id} className="rounded-xl border p-3"><div className="grid gap-2 sm:grid-cols-2"><label className="text-sm"><span className="mb-1 block text-xs text-muted-foreground">OCR jméno – upravitelné</span><Input value={d.employeeName} onFocus={() => openRowEdit(row)} onChange={e => updateDraft(row, "employeeName", e.target.value)} /></label><div className="flex items-end gap-2"><select className="h-10 flex-1 rounded-md border bg-background px-3 text-sm" value={row.employee_id ?? ""} onChange={e => e.target.value && assignEmployee.mutate({ row, employeeId: e.target.value })}><option value="">Vyberte stávajícího zaměstnance…</option>{employees.map((e: any) => <option key={e.id} value={e.id}>{e.full_name}</option>)}</select><Button variant="outline" onClick={() => openEmployee(row)}><UserPlus className="mr-2 h-4 w-4" />Nový</Button></div></div><div className="mt-3 grid gap-2 sm:grid-cols-4"><select className="h-10 rounded-md border bg-background px-3 py-2 text-sm" value={d.position} onChange={e => updateDraft(row, "position", e.target.value)}><option value="">HA/TUP…</option><option value="HA">HA</option><option value="TUP">TUP</option></select><div className="rounded-md border bg-muted/20 px-3 py-2"><div className="text-[11px] text-muted-foreground">Výkon</div><div className="font-medium">{row.performance != null ? `${Number(row.performance).toFixed(2)} %` : "—"}</div></div><div className="rounded-md border bg-muted/20 px-3 py-2"><div className="text-[11px] text-muted-foreground">Dostupnost</div><div className="font-medium">{row.available_time != null ? `${Number(row.available_time).toFixed(2)} %` : "—"}</div></div><label className="text-sm"><span className="mb-1 block text-[11px] text-muted-foreground">Výpomoc (body)</span><Input type="number" step="1" value={d.helpScore} onFocus={() => openRowEdit(row)} onChange={e => updateDraft(row, "helpScore", e.target.value)} /></label></div><div className="mt-2 grid gap-2 sm:grid-cols-2"><div className="rounded-md border bg-muted/20 px-3 py-2"><div className="text-[11px] text-muted-foreground">Skutečné OEE</div><div className="font-medium">{row.oee != null ? `${Number(row.oee).toFixed(2)} %` : "—"}</div></div><div className="flex items-center justify-end gap-2"><div className="text-xs text-muted-foreground">Přiřazení: {row.employee_id ? "OK" : "čeká"} · OCR {row.confidence != null ? `${Math.round(Number(row.confidence) * 100)}%` : "–"}</div><Button size="sm" variant="outline" disabled={saveRow.isPending} onClick={() => saveRow.mutate({ row })}>Uložit jméno/pozici/výpomoc</Button></div></div></div>; })}</div></Card>
    <Card className="p-4"><div className="font-semibold">Product Profile</div><div className="mt-1 text-sm text-muted-foreground">Profil musí být skutečně uložen a ověřen. Po vytvoření nebo přiřazení se znovu spustí 3. sekvence, která dopočítá OEE, Výkon a Dostupnost. Samotný profil import neschvaluje.</div><div className="mt-2 flex flex-wrap items-center gap-2"><Badge variant={selected.product_profile_status === "VALID" ? "default" : "destructive"}>{selected.product_profile_status === "VALID" ? "VALID" : selected.product_profile_status ?? "MISSING"}</Badge><Button variant="outline" onClick={startProfile}><ExternalLink className="mr-2 h-4 w-4" />Vytvořit nový Product Profile</Button>{selected.product_profile_status === "VALID" && (blockerList.includes("HOURLY_DATA_MISSING") || blockerList.includes("HOURLY_KPI_MISSING") || blockerList.includes("OEE_MISSING") || blockerList.includes("PERFORMANCE_MISSING") || blockerList.includes("AVAILABILITY_MISSING")) && <Button variant="outline" disabled={reextractHourly.isPending} onClick={() => reextractHourly.mutate()}>Znovu načíst hodinová data (OCR)</Button>}</div>{selected.product_profile_status !== "VALID" && <div className="mt-3"><label className="text-sm"><span className="mb-1 block text-xs text-muted-foreground">Nebo přiřaďte existující Product Profile (oprava chybně přečteného Product ID) – po výběru klikněte na „Uložit opravy a znovu validovat" výše</span><select className="h-10 w-full rounded-md border bg-background px-3 text-sm" defaultValue="" onChange={(e) => { if (e.target.value) assignExistingProfile(e.target.value); e.target.value = ""; }}><option value="" disabled>Vyberte existující Product Profile…</option>{(existingProfilesQuery.data ?? []).map((p: any) => <option key={p.id} value={p.id}>{p.profile_name || p.ha_subassy || p.tup_subassy} (HA: {p.ha_subassy ?? "–"} / TUP: {p.tup_subassy ?? "–"})</option>)}</select></label></div>}</Card></div></div><DialogFooter className="gap-2"><Button variant="destructive" onClick={() => setRejectOpen(true)}><XCircle className="mr-2 h-4 w-4" />Zamítnout</Button><Button disabled={approve.isPending || blockerList.length > 0 || selected.product_profile_status !== "VALID"} onClick={() => approve.mutate(selected)}><CheckCircle2 className="mr-2 h-4 w-4" />Schválit a zařadit do statistik</Button></DialogFooter></>}</DialogContent></Dialog>
    <Dialog open={employeeOpen} onOpenChange={setEmployeeOpen}><DialogContent className="max-w-lg"><DialogHeader><DialogTitle>Nový zaměstnanec – kontrola OCR údajů</DialogTitle></DialogHeader><div className="grid gap-3"><label className="text-sm"><span className="mb-1 block text-xs text-muted-foreground">Celé jméno</span><Input value={newEmployee.fullName} onChange={e => setNewEmployee(p => ({ ...p, fullName: e.target.value }))} /></label><div className="grid gap-3 sm:grid-cols-2"><label className="text-sm"><span className="mb-1 block text-xs text-muted-foreground">Jméno</span><Input value={newEmployee.firstName} onChange={e => setNewEmployee(p => ({ ...p, firstName: e.target.value }))} /></label><label className="text-sm"><span className="mb-1 block text-xs text-muted-foreground">Příjmení</span><Input value={newEmployee.lastName} onChange={e => setNewEmployee(p => ({ ...p, firstName: e.target.value }))} /></label></div></div><DialogFooter><Button variant="outline" onClick={() => setEmployeeOpen(false)}>Zrušit</Button><Button disabled={!employeeRow || createEmployee.isPending} onClick={() => employeeRow && createEmployee.mutate({ row: employeeRow })}>Vytvořit a přiřadit</Button></DialogFooter></DialogContent></Dialog>
    <Dialog open={rejectOpen} onOpenChange={setRejectOpen}><DialogContent className="max-w-lg"><DialogHeader><DialogTitle>Zamítnout import</DialogTitle></DialogHeader><Textarea value={rejectReason} onChange={e => setRejectReason(e.target.value)} placeholder="Uveďte důvod zamítnutí…" rows={5} /><DialogFooter><Button variant="outline" onClick={() => setRejectOpen(false)}>Zrušit</Button><Button variant="destructive" disabled={!rejectReason.trim() || reject.isPending || !selected} onClick={() => selected && reject.mutate({ item: selected, reason: rejectReason })}>Zamítnout import</Button></DialogFooter></DialogContent></Dialog>
    <Dialog open={profileOpen} onOpenChange={setProfileOpen}><DialogContent className="max-h-[92vh] max-w-2xl overflow-y-auto"><DialogHeader><DialogTitle>Product Profile – kontrola a vytvoření</DialogTitle></DialogHeader><div className="grid gap-3 sm:grid-cols-2">{([["profileName","Název profilu"],["haCode","HA Product ID"],["haNorm","HA norma / h"],["haCapacity","HA kapacita"],["tupCode","TUP Product ID"],["tupNorm","TUP norma / h"],["tupCapacity","TUP kapacita"],["validFrom","Platnost od"]] as [keyof ProfileDraft,string][]).map(([key,label]) => <label key={key} className="text-sm"><span className="mb-1 block text-xs text-muted-foreground">{label}</span><Input value={profile[key]} onChange={e => setProfile(p => ({ ...p, [key]: e.target.value }))} /></label>)}</div><DialogFooter><Button variant="outline" onClick={() => setProfileOpen(false)}>Zrušit</Button><Button disabled={createProfile.isPending} onClick={() => createProfile.mutate()}>Vytvořit Product Profile a přepočítat</Button></DialogFooter></DialogContent></Dialog>
  </div>;
}
