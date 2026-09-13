import { supabase } from "@/integrations/supabase/client";
import type { OcrHourlyMetric, OcrResult } from "@/lib/ocr.functions";
import type { ProductProfileContext } from "@/lib/ocr.hourly.functions";
import type { Employee } from "@/lib/metrics";
import type { Product } from "@/lib/products";

// The generated Supabase types may lag the 2.0 AUTO migration, so keep the
// staging-layer access isolated here until the generated DB types are updated.
const db = supabase as any;

export type ImportBlocker =
  | "MISSING_DATE" | "MISSING_SHIFT" | "MISSING_LINE" | "PRODUCT_NOT_FOUND"
  | "PRODUCT_PROFILE_MISSING" | "PRODUCT_PROFILE_INCOMPLETE" | "EMPLOYEE_UNMATCHED"
  | "POSITION_MISSING" | "OEE_MISSING" | "PERFORMANCE_MISSING" | "AVAILABILITY_MISSING"
  | "HOURLY_DATA_MISSING" | "HOURLY_KPI_MISSING" | "DUPLICATE_RECORD";

export type ImportItemResult = {
  itemId: string;
  status: "AUTO_APPROVED" | "PENDING_APPROVAL" | "ERROR";
  blockers: ImportBlocker[];
  duplicateRows: number;
  createdRecords: number;
};

const normalize = (v: string | null | undefined) => (v ?? "").trim().replace(/\s+/g, "").toLowerCase();

function profileForCode(profiles: ProductProfileContext[], code: string) {
  const wanted = normalize(code);
  return profiles.find((p) => normalize(p.ha_subassy) === wanted || normalize(p.tup_subassy) === wanted);
}

function profileIsComplete(profile: ProductProfileContext | undefined) {
  if (!profile) return false;
  return Boolean(profile.ha_subassy && profile.tup_subassy && Number(profile.h_norm_per_hour) > 0 && Number(profile.h_capacity) >= 1 && Number(profile.t_norm_per_hour) > 0 && Number(profile.t_capacity) >= 1);
}

export async function sha256File(file: File) {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function createImportBatch(totalItems: number) {
  const { data, error } = await db.from("import_batches").insert({ total_items: totalItems, status: "PROCESSING" }).select("*").single();
  if (error) throw error;
  return data as { id: string };
}

export async function createImportItem(batchId: string, screenshotPath: string, sourceHash: string) {
  const { data, error } = await db.from("import_items").insert({ batch_id: batchId, screenshot_path: screenshotPath, source_hash: sourceHash, status: "PROCESSING" }).select("*").single();
  if (error) throw error;
  return data as { id: string };
}

export async function markImportItemError(itemId: string, message: string) {
  await db.from("import_items").update({ status: "ERROR", error_message: message, completed_at: new Date().toISOString() }).eq("id", itemId);
  await db.from("import_item_events").insert({ import_item_id: itemId, event_type: "ERROR", to_status: "ERROR", payload: { message } });
}

export async function persistOcrResult(itemId: string, result: OcrResult, products: Product[], employees: Employee[], profiles: ProductProfileContext[]) {
  const productCode = result.product_code?.trim() || result.products?.[0]?.product_code?.trim() || null;
  const matchedProduct = productCode ? products.find((p) => normalize(p.code) === normalize(productCode)) : undefined;
  const productProfile = productCode ? profileForCode(profiles, productCode) : undefined;
  const productProfileStatus = !productProfile ? "MISSING" : profileIsComplete(productProfile) ? "VALID" : "INCOMPLETE";

  const employeeRows = (result.rows ?? []).map((row, index) => {
    const wanted = normalizeName(row.employee_name);
    const exact = employees.find((e) => normalizeName(e.full_name) === wanted);
    const parts = wanted.split(" ").filter(Boolean);
    const matched = exact ?? employees.find((e) => parts.length > 1 && parts.every((p) => normalizeName(e.full_name).includes(p)));
    return {
      import_item_id: itemId, row_index: index,
      ocr_employee_name: String(row.employee_name ?? "").trim() || null,
      employee_id: matched?.id ?? null, position: row.position ?? null,
      oee: row.oee, performance: row.performance, available_time: row.available_time,
      confidence: Number.isFinite(Number(row.confidence)) ? Number(row.confidence) : null,
      raw_data: row, match_status: matched ? (exact ? "EXACT" : "MATCHED") : "UNMATCHED",
      validation_status: matched ? "VALID" : "BLOCKED",
    };
  });
  const { error: rowError } = await db.from("import_item_rows").insert(employeeRows);
  if (rowError) throw rowError;

  const hourlyRows = (result.hourly_metrics ?? []).filter((m) => m.hour != null).map((m) => ({
    import_item_id: itemId, hour: Math.round(Number(m.hour)), product_code: m.product_code ?? null,
    role: inferRole(m.product_code), actual_output: m.actual_output,
    performance_pct: m.performance_pct, availability_pct: m.availability_pct,
    norm_per_hour: null, capacity: null, operator_count: null, actual_oee_pct: null, raw_data: m,
  }));
  if (hourlyRows.length) {
    const { error: hourlyError } = await db.from("import_item_hourly").insert(hourlyRows);
    if (hourlyError) throw hourlyError;
  }

  const { error: itemError } = await db.from("import_items").update({
    status: "VALIDATING", work_date: result.work_date || null, shift: result.shift || null,
    line: result.line?.trim() || null, product_code: productCode, product_name: matchedProduct?.name ?? null,
    norm_per_hour: result.norm_per_hour ?? result.products?.find((p) => normalize(p.product_code) === normalize(productCode))?.norm_per_hour ?? null,
    ocr_confidence: result.header_confidence ?? null, ocr_data: result,
    product_id: matchedProduct?.id ?? null,
    product_match_status: matchedProduct ? "EXACT" : "NEW", product_profile_status: productProfileStatus,
  }).eq("id", itemId);
  if (itemError) throw itemError;

  const blockers = validate(result, employeeRows, matchedProduct, productProfileStatus, hourlyRows);
  await db.from("import_items").update({ pending_reasons: blockers }).eq("id", itemId);
  return { blockers, employeeRows, hourlyRows, matchedProduct };
}

export async function finalizeImportItem(
  itemId: string,
  result: OcrResult,
  employeeRows: any[],
  matchedProduct: Product | undefined,
  blockers: ImportBlocker[],
  hourly: OcrHourlyMetric[],
  actualOee: number | null,
) {
  if (blockers.length) {
    await db.from("import_item_rows").update({ validation_status: "BLOCKED" }).eq("import_item_id", itemId).is("daily_record_id", null);
    await db.from("import_items").update({ status: "PENDING_APPROVAL", pending_reasons: blockers }).eq("id", itemId);
    await db.from("import_item_events").insert({ import_item_id: itemId, event_type: "VALIDATION_BLOCKED", to_status: "PENDING_APPROVAL", payload: { blockers } });
    return { status: "PENDING_APPROVAL" as const, duplicateRows: 0, createdRecords: 0 };
  }

  if (!matchedProduct) throw new Error("Cannot auto-process without a matched product.");
  const workDate = result.work_date!; const shift = result.shift!; const line = result.line!.trim();
  const performance = average(hourly.map((m) => m.performance_pct));
  const availability = average(hourly.map((m) => m.availability_pct));
  if (performance == null || availability == null || actualOee == null || !Number.isFinite(actualOee)) throw new Error("Required KPI values are missing.");

  const { data: itemMeta, error: metaError } = await db.from("import_items").select("screenshot_path,batch_id").eq("id", itemId).single();
  if (metaError) throw metaError;
  let duplicateRows = 0; let createdRecords = 0;

  for (const row of employeeRows) {
    const { data: existing, error: existingError } = await db.from("daily_records").select("id").eq("employee_id", row.employee_id).eq("work_date", workDate).eq("shift", shift).eq("line", line).maybeSingle();
    if (existingError) throw existingError;
    if (existing?.id) {
      duplicateRows += 1;
      await db.from("import_item_rows").update({ daily_record_id: existing.id, validation_status: "BLOCKED", admin_corrections: { duplicate: true } }).eq("id", row.id);
      continue;
    }
    const { data: record, error } = await db.from("daily_records").insert({
      employee_id: row.employee_id, work_date: workDate, shift, line, product_id: matchedProduct.id,
      product: matchedProduct.code, position: row.position, oee: actualOee,
      performance: Number(performance.toFixed(2)), available_time: Number(availability.toFixed(2)),
      help_score: 0, screenshot_path: itemMeta.screenshot_path, approval_status: "approved", import_batch_id: itemMeta.batch_id,
    }).select("id").single();
    if (error) throw error;
    await db.from("import_item_rows").update({ daily_record_id: record.id, validation_status: "VALID" }).eq("id", row.id);
    createdRecords += 1;
  }

  if (duplicateRows) {
    await db.from("import_items").update({ status: "PENDING_APPROVAL", pending_reasons: ["DUPLICATE_RECORD"] }).eq("id", itemId);
    await db.from("import_item_events").insert({ import_item_id: itemId, event_type: "DUPLICATE_DETECTED", to_status: "PENDING_APPROVAL", payload: { duplicateRows, createdRecords } });
    return { status: "PENDING_APPROVAL" as const, duplicateRows, createdRecords };
  }
  await db.from("import_items").update({ status: "AUTO_APPROVED", completed_at: new Date().toISOString() }).eq("id", itemId);
  await db.from("import_item_events").insert({ import_item_id: itemId, event_type: "AUTO_APPROVED", to_status: "AUTO_APPROVED", payload: { createdRecords } });
  return { status: "AUTO_APPROVED" as const, duplicateRows, createdRecords };
}

export async function completeImportBatch(batchId: string) {
  const { data, error } = await db.from("import_items").select("status").eq("batch_id", batchId);
  if (error) throw error;
  const statuses = (data ?? []).map((x: any) => x.status);
  const hasError = statuses.some((s: string) => s === "ERROR");
  const hasPending = statuses.some((s: string) => s === "PENDING_APPROVAL");
  await db.from("import_batches").update({ status: hasError || hasPending ? "COMPLETED_WITH_ERRORS" : "COMPLETED", completed_at: new Date().toISOString() }).eq("id", batchId);
}

function validate(result: OcrResult, rows: any[], product: Product | undefined, profileStatus: string, hourly: any[]): ImportBlocker[] {
  const blockers: ImportBlocker[] = [];
  if (!result.work_date) blockers.push("MISSING_DATE");
  if (!result.shift) blockers.push("MISSING_SHIFT");
  if (!result.line?.trim()) blockers.push("MISSING_LINE");
  if (!product) blockers.push("PRODUCT_NOT_FOUND");
  if (profileStatus === "MISSING") blockers.push("PRODUCT_PROFILE_MISSING");
  if (profileStatus === "INCOMPLETE") blockers.push("PRODUCT_PROFILE_INCOMPLETE");
  if (!rows.length) blockers.push("EMPLOYEE_UNMATCHED");
  for (const row of rows) {
    if (!row.employee_id) blockers.push("EMPLOYEE_UNMATCHED");
    if (!row.position) blockers.push("POSITION_MISSING");
    if (row.oee == null || !Number.isFinite(Number(row.oee))) blockers.push("OEE_MISSING");
    if (row.performance == null || !Number.isFinite(Number(row.performance))) blockers.push("PERFORMANCE_MISSING");
    if (row.available_time == null || !Number.isFinite(Number(row.available_time))) blockers.push("AVAILABILITY_MISSING");
  }
  if (!hourly.length) blockers.push("HOURLY_DATA_MISSING");
  if (hourly.length && !average(hourly.map((m) => m.performance_pct)) || hourly.length && !average(hourly.map((m) => m.availability_pct))) blockers.push("HOURLY_KPI_MISSING");
  return [...new Set(blockers)];
}

function normalizeName(v: string | null | undefined) { return (v ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(); }
function inferRole(code: string | null) { if (!code) return null; if (/^H_/i.test(code)) return "HA"; if (/^T_/i.test(code)) return "TUP"; return null; }
function average(values: Array<number | null | undefined>) { const valid = values.filter((v): v is number => v != null && Number.isFinite(Number(v))).map(Number); return valid.length ? valid.reduce((a, b) => a + b, 0) / valid.length : null; }
