import { supabase } from "@/integrations/supabase/client";
import type { OcrHourlyMetric, OcrResult } from "@/lib/ocr.functions";
import type { ProductProfileContext } from "@/lib/ocr.hourly.functions";
import type { Employee } from "@/lib/metrics";
import type { Product } from "@/lib/products";

const db = supabase as any;
export type ImportBlocker = "MISSING_DATE" | "MISSING_SHIFT" | "MISSING_LINE" | "PRODUCT_NOT_FOUND" | "PRODUCT_PROFILE_MISSING" | "PRODUCT_PROFILE_INCOMPLETE" | "EMPLOYEE_UNMATCHED" | "POSITION_MISSING" | "OEE_MISSING" | "PERFORMANCE_MISSING" | "AVAILABILITY_MISSING" | "HOURLY_DATA_MISSING" | "HOURLY_KPI_MISSING" | "DUPLICATE_RECORD";
export type ImportItemResult = { itemId: string; status: "AUTO_APPROVED" | "PENDING_APPROVAL" | "ERROR"; blockers: ImportBlocker[]; duplicateRows: number; createdRecords: number };

const normalize = (v: string | null | undefined) => (v ?? "").trim().replace(/\s+/g, "").toLowerCase();
const normalizeName = (v: string | null | undefined) => (v ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const average = (values: Array<number | null | undefined>) => { const valid = values.filter((v): v is number => v != null && Number.isFinite(Number(v))).map(Number); return valid.length ? valid.reduce((a, b) => a + b, 0) / valid.length : null; };
const inferRole = (code: string | null) => { if (!code) return null; if (/^H_/i.test(code)) return "HA"; if (/^T_/i.test(code)) return "TUP"; return null; };
const canonicalShift = (value: unknown): string | null => { const s = String(value ?? "").trim().toLowerCase(); if (!s) return null; if (s.includes("rann") || s === "r" || s === "1") return "Ranní"; if (s.includes("odpo") || s === "o" || s === "2") return "Odpolední"; if (s.includes("noc") || s === "n" || s === "3") return "Noční"; return null; };
const clockValue = (value: unknown) => { const s = String(value ?? "").trim(); return /^([01]\d|2[0-3]):[0-5]\d$/.test(s) ? s : null; };
const shiftFromHour = (hour: number | null): string | null => { if (hour == null || !Number.isFinite(Number(hour))) return null; const h = ((Math.trunc(Number(hour)) % 24) + 24) % 24; if (h >= 6 && h < 14) return "Ranní"; if (h >= 14 && h < 22) return "Odpolední"; return "Noční"; };

function normalizeImportResult(result: OcrResult): OcrResult {
  const candidate = result as OcrResult & { screenshot_time?: unknown };
  const rawShift = String(candidate.shift ?? "").trim();
  const screenshotTime = clockValue(candidate.screenshot_time) ?? clockValue(rawShift);
  let shift = canonicalShift(rawShift);
  const hours = (result.hourly_metrics ?? []).map((m) => Number(m.hour)).filter(Number.isFinite);
  if (!shift) shift = shiftFromHour(hours.length ? hours[0] : screenshotTime ? Number(screenshotTime.slice(0, 2)) : null);
  return { ...result, shift, ...(screenshotTime ? { screenshot_time: screenshotTime } : {}) } as OcrResult;
}

function isRealProductCode(code: unknown, products: Product[]) {
  const value = String(code ?? "").trim();
  if (!value) return false;
  if (products.some((p) => normalize(p.code) === normalize(value))) return true;
  return /^(?:H|T)_[A-Z0-9][A-Z0-9_-]*$/i.test(value);
}
function matchProduct(code: string | null | undefined, products: Product[]) { return code ? products.find((p) => normalize(p.code) === normalize(code)) : undefined; }
function profileForCode(profiles: ProductProfileContext[], code: string) { const wanted = normalize(code); return profiles.find((p) => normalize(p.ha_subassy) === wanted || normalize(p.tup_subassy) === wanted); }
function profileIsComplete(profile: ProductProfileContext | undefined) { return Boolean(profile?.ha_subassy && profile?.tup_subassy && Number(profile.h_norm_per_hour) > 0 && Number(profile.h_capacity) >= 1 && Number(profile.t_norm_per_hour) > 0 && Number(profile.t_capacity) >= 1); }

/** Product identity comes from real product codes in the hourly manufacturing table, never from a workstation/line label. */
function resolveProducts(result: OcrResult, products: Product[]) {
  const hourlyCodes = (result.hourly_metrics ?? []).map((m) => String(m.product_code ?? "").trim()).filter((c) => isRealProductCode(c, products));
  const listedCodes = (result.products ?? []).map((p) => String(p.product_code ?? "").trim()).filter((c) => isRealProductCode(c, products));
  const headerCode = String(result.product_code ?? "").trim();
  const candidates = [...hourlyCodes, ...listedCodes, ...(isRealProductCode(headerCode, products) ? [headerCode] : [])];
  const codes = [...new Map(candidates.map((c) => [normalize(c), c])).values()];
  const matched = codes.map((c) => matchProduct(c, products)).filter(Boolean) as Product[];
  const primaryCode = hourlyCodes[0] ?? listedCodes[0] ?? (matchProduct(headerCode, products) ? headerCode : null);
  return { codes, matched, primary: primaryCode ? matchProduct(primaryCode, products) : undefined, primaryCode };
}

export async function sha256File(file: File) { const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer()); return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join(""); }
export async function createImportBatch(totalItems: number) { const { data, error } = await db.from("import_batches").insert({ total_items: totalItems, status: "PROCESSING" }).select("*").single(); if (error) throw error; return data as { id: string }; }
export async function createImportItem(batchId: string, screenshotPath: string, sourceHash: string) { const { data, error } = await db.from("import_items").insert({ batch_id: batchId, screenshot_path: screenshotPath, source_hash: sourceHash, status: "PROCESSING" }).select("*").single(); if (error) throw error; return data as { id: string }; }
export async function completeImportBatch(batchId: string) { const [{ data: items, error: itemsError }, { data: batch, error: batchError }] = await Promise.all([db.from("import_items").select("status").eq("batch_id", batchId), db.from("import_batches").select("total_items").eq("id", batchId).single()]); if (itemsError) throw itemsError; if (batchError) throw batchError; const list = (items ?? []) as Array<{ status: string }>; const total = Number(batch?.total_items ?? list.length); const autoApproved = list.filter((x) => x.status === "AUTO_APPROVED").length; const pending = list.filter((x) => x.status === "PENDING_APPROVAL").length; const rejectedOrErrors = list.filter((x) => x.status === "ERROR" || x.status === "REJECTED").length; const approved = list.filter((x) => x.status === "APPROVED").length; const terminal = autoApproved + pending + rejectedOrErrors + approved; const missingItems = Math.max(0, total - list.length); const errors = rejectedOrErrors + missingItems; const completed = terminal + missingItems; const status = completed >= total ? (errors > 0 ? "COMPLETED_WITH_ERRORS" : "COMPLETED") : "PROCESSING"; const { error: updateError } = await db.from("import_batches").update({ status, processed_items: Math.min(total, completed), auto_items: autoApproved, pending_items: pending, error_items: errors, completed_at: completed >= total ? new Date().toISOString() : null }).eq("id", batchId); if (updateError) throw updateError; return { total, autoApproved, pending, errors, status }; }
export async function markImportItemError(itemId: string, message: string) { const { error } = await db.from("import_items").update({ status: "ERROR", error_message: message, completed_at: new Date().toISOString() }).eq("id", itemId); if (error) throw error; await db.from("import_item_events").insert({ import_item_id: itemId, event_type: "ERROR", to_status: "ERROR", payload: { message } }); }

export async function persistOcrResult(itemId: string, input: OcrResult, products: Product[], employees: Employee[], profiles: ProductProfileContext[]) {
  const result = normalizeImportResult(input);
  Object.assign(input, result);
  const resolved = resolveProducts(result, products);
  const profileStates = resolved.matched.map((p) => ({ product: p, profile: profileForCode(profiles, p.code) }));
  const productProfileStatus = profileStates.some((x) => !x.profile) ? "MISSING" : profileStates.some((x) => !profileIsComplete(x.profile)) ? "INCOMPLETE" : "VALID";

  const employeeRows = (result.rows ?? []).map((row, index) => {
    const wanted = normalizeName(row.employee_name);
    const exact = employees.find((e) => normalizeName(e.full_name) === wanted);
    const parts = wanted.split(" ").filter(Boolean);
    const candidates = employees.filter((e) => parts.length > 1 && parts.every((p) => normalizeName(e.full_name).includes(p)));
    const matched = exact ?? (candidates.length === 1 ? candidates[0] : undefined);
    return { import_item_id: itemId, row_index: index, ocr_employee_name: String(row.employee_name ?? "").trim() || null, employee_id: matched?.id ?? null, position: row.position ?? null, oee: row.oee, performance: null, available_time: null, confidence: Number.isFinite(Number(row.confidence)) ? Number(row.confidence) : null, raw_data: { ...row, performance: null, available_time: null }, match_status: matched ? (exact ? "EXACT" : "MATCHED") : "UNMATCHED", validation_status: matched ? "VALID" : "BLOCKED" };
  });
  const { data: existingRows, error: existingRowsError } = await db.from("import_item_rows").select("row_index,employee_id,position,daily_record_id,match_status,validation_status").eq("import_item_id", itemId); if (existingRowsError) throw existingRowsError;
  const existingByIndex = new Map<number, any>((existingRows ?? []).map((r: any) => [Number(r.row_index), r]));
  const mergedEmployeeRows = employeeRows.map((row) => { const existing = existingByIndex.get(Number(row.row_index)); const employee_id = existing?.employee_id ?? row.employee_id; const position = existing?.position ?? row.position; return { ...row, employee_id, position, daily_record_id: existing?.daily_record_id ?? null, match_status: employee_id ? (existing?.match_status ?? row.match_status) : "UNMATCHED", validation_status: employee_id ? "VALID" : "BLOCKED" }; });
  if (mergedEmployeeRows.length) { const { error } = await db.from("import_item_rows").upsert(mergedEmployeeRows, { onConflict: "import_item_id,row_index", ignoreDuplicates: false }); if (error) throw error; }

  // Keep every distinct product/hour pair. The previous hour-only Map could silently discard a second OCR product in the same hour.
  const hourlyByKey = new Map<string, OcrHourlyMetric>();
  for (const metric of result.hourly_metrics ?? []) {
    if (metric.hour == null) continue;
    const hour = Math.round(Number(metric.hour));
    if (!Number.isFinite(hour)) continue;
    const code = String(metric.product_code ?? "").trim();
    const key = `${hour}|${normalize(code)}`;
    if (!hourlyByKey.has(key)) hourlyByKey.set(key, { ...metric, product_code: code || null });
  }
  // 2.01: the database preserves one row per product/hour pair, so never discard a second product in the same hour.
  // Rows with the same product/hour are aggregated because one product may appear in multiple OCR fragments.
  const hourlyRows = Array.from(hourlyByKey.values()).map((m) => ({ import_item_id: itemId, hour: Math.round(Number(m.hour)), product_code: m.product_code, role: inferRole(m.product_code), actual_output: m.actual_output, performance_pct: m.performance_pct, availability_pct: m.availability_pct, norm_per_hour: null, capacity: null, operator_count: null, actual_oee_pct: m.actual_oee_pct ?? null, raw_data: m }));
  const grouped = new Map<string, typeof hourlyRows[number]>();
  for (const row of hourlyRows) {
    const key = `${row.hour}|${normalize(row.product_code)}`;
    const prev = grouped.get(key);
    if (!prev) grouped.set(key, row);
    else grouped.set(key, { ...prev, actual_output: Number(prev.actual_output ?? 0) + Number(row.actual_output ?? 0), raw_data: { ...(prev.raw_data ?? {}), fragments: [prev.raw_data, row.raw_data] } });
  }
  const persistedHourlyRows = Array.from(grouped.values()).sort((a, b) => a.hour - b.hour || String(a.product_code ?? '').localeCompare(String(b.product_code ?? '')));
  const { error: deleteError } = await db.from("import_item_hourly").delete().eq("import_item_id", itemId); if (deleteError) throw deleteError;
  if (persistedHourlyRows.length) { const { error } = await db.from("import_item_hourly").insert(persistedHourlyRows); if (error) throw error; }

  const blockers = validateBase(result, mergedEmployeeRows, resolved.primary, productProfileStatus);
  const ocrData = { ...result, product_code: resolved.primaryCode ?? null, detected_product_codes: resolved.codes } as any;
  const { error: itemError } = await db.from("import_items").update({ status: "VALIDATING", work_date: result.work_date || null, shift: result.shift || null, line: result.line?.trim() || null, product_code: resolved.primaryCode ?? null, product_name: resolved.primary?.name ?? null, norm_per_hour: null, ocr_confidence: result.header_confidence ?? null, ocr_data: ocrData, product_id: resolved.primary?.id ?? null, product_match_status: resolved.primary ? "EXACT" : "NEW", product_profile_status: productProfileStatus }).eq("id", itemId); if (itemError) throw itemError;
  const { error: blockerError } = await db.from("import_items").update({ pending_reasons: blockers }).eq("id", itemId); if (blockerError) throw blockerError;
  return { blockers, employeeRows: mergedEmployeeRows, hourlyRows: persistedHourlyRows, matchedProduct: resolved.primary };
}

export async function finalizeImportItem(itemId: string, result: OcrResult, employeeRows: any[], matchedProduct: Product | undefined, blockers: ImportBlocker[], hourly: OcrHourlyMetric[], actualOee: number | null) {
  let effectiveBlockers = [...new Set(blockers)].filter((b) => b !== "HOURLY_KPI_MISSING");
  if (effectiveBlockers.includes("MISSING_SHIFT")) { const { data } = await db.from("import_items").select("shift").eq("id", itemId).maybeSingle(); if (canonicalShift(data?.shift) || canonicalShift(result.shift)) effectiveBlockers = effectiveBlockers.filter((b) => b !== "MISSING_SHIFT"); }
  if (effectiveBlockers.length) { blockers.splice(0, blockers.length, ...effectiveBlockers); await db.from("import_item_rows").update({ validation_status: "BLOCKED" }).eq("import_item_id", itemId).is("daily_record_id", null); await db.from("import_items").update({ status: "PENDING_APPROVAL", pending_reasons: effectiveBlockers }).eq("id", itemId); await db.from("import_item_events").insert({ import_item_id: itemId, event_type: "VALIDATION_BLOCKED", to_status: "PENDING_APPROVAL", payload: { blockers: effectiveBlockers } }); return { status: "PENDING_APPROVAL" as const, duplicateRows: 0, createdRecords: 0, blockers: effectiveBlockers }; }
  if (!matchedProduct) throw new Error("Cannot auto-process without a matched product.");
  const { data: calculatedRows, error } = await db.from("import_item_hourly").select("hour,performance_pct,availability_pct,actual_oee_pct").eq("import_item_id", itemId).order("hour", { ascending: true }); if (error) throw error;
  const calculated = (calculatedRows ?? []) as Array<{ hour: number; performance_pct: number | null; availability_pct: number | null; actual_oee_pct: number | null }>;
  const calculatedPerformance = average(calculated.map((m) => m.performance_pct)); const calculatedAvailability = average(calculated.map((m) => m.availability_pct)); const calculatedOee = average(calculated.map((m) => m.actual_oee_pct));
  const kpiBlockers: ImportBlocker[] = []; if (!calculated.length) kpiBlockers.push("HOURLY_DATA_MISSING"); if (calculated.length && calculatedPerformance == null) kpiBlockers.push("PERFORMANCE_MISSING"); if (calculated.length && calculatedAvailability == null) kpiBlockers.push("AVAILABILITY_MISSING"); if (calculated.length && calculatedOee == null) kpiBlockers.push("OEE_MISSING");
  if (kpiBlockers.length) { blockers.splice(0, blockers.length, ...kpiBlockers); await db.from("import_item_rows").update({ validation_status: "BLOCKED" }).eq("import_item_id", itemId).is("daily_record_id", null); await db.from("import_items").update({ status: "PENDING_APPROVAL", pending_reasons: kpiBlockers }).eq("id", itemId); await db.from("import_item_events").insert({ import_item_id: itemId, event_type: "VALIDATION_BLOCKED", to_status: "PENDING_APPROVAL", payload: { blockers: kpiBlockers } }); return { status: "PENDING_APPROVAL" as const, duplicateRows: 0, createdRecords: 0, blockers: kpiBlockers }; }
  const { error: kpiError } = await db.from("import_item_rows").update({ oee: calculatedOee ?? actualOee, performance: calculatedPerformance, available_time: calculatedAvailability }).eq("import_item_id", itemId).is("daily_record_id", null); if (kpiError) throw kpiError;
  const { data, error: rpcError } = await db.rpc("auto_approve_import_item", { p_import_item_id: itemId }); if (rpcError) throw rpcError;
  const response = data as { status?: string; blockers?: ImportBlocker[]; created_daily_records?: number } | null;
  if (response?.status === "PENDING_APPROVAL") { const rpcBlockers = Array.isArray(response.blockers) ? response.blockers : ["DUPLICATE_RECORD"]; blockers.splice(0, blockers.length, ...rpcBlockers); return { status: "PENDING_APPROVAL" as const, duplicateRows: rpcBlockers.includes("DUPLICATE_RECORD") ? 1 : 0, createdRecords: 0, blockers: rpcBlockers }; }
  blockers.splice(0, blockers.length); return { status: "AUTO_APPROVED" as const, duplicateRows: 0, createdRecords: Number(response?.created_daily_records ?? 0), blockers: [] };
}

export async function approvePendingImport(itemId: string, actorId: string) { const { data, error } = await db.rpc("approve_import_item", { p_import_item_id: itemId, p_actor_id: actorId }); if (error) throw error; return { createdRecords: Number((data as any)?.created_daily_records ?? 0) }; }
function validateBase(result: OcrResult, rows: any[], product: Product | undefined, profileStatus: string): ImportBlocker[] { const blockers: ImportBlocker[] = []; if (!result.work_date) blockers.push("MISSING_DATE"); if (!canonicalShift(result.shift)) blockers.push("MISSING_SHIFT"); if (!result.line?.trim()) blockers.push("MISSING_LINE"); if (!product) blockers.push("PRODUCT_NOT_FOUND"); if (profileStatus === "MISSING") blockers.push("PRODUCT_PROFILE_MISSING"); if (profileStatus === "INCOMPLETE") blockers.push("PRODUCT_PROFILE_INCOMPLETE"); if (!rows.length) blockers.push("EMPLOYEE_UNMATCHED"); for (const row of rows) { if (!row.employee_id) blockers.push("EMPLOYEE_UNMATCHED"); if (!row.position) blockers.push("POSITION_MISSING"); } return [...new Set(blockers)]; }
