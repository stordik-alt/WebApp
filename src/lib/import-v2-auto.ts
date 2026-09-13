import { supabase } from "@/integrations/supabase/client";
import type { OcrHourlyMetric, OcrResult } from "@/lib/ocr.functions";
import type { ProductProfileContext } from "@/lib/ocr.hourly.functions";
import type { Employee } from "@/lib/metrics";
import type { Product } from "@/lib/products";

const db = supabase as any;

export type ImportBlocker = "MISSING_DATE" | "MISSING_SHIFT" | "MISSING_LINE" | "PRODUCT_NOT_FOUND" | "PRODUCT_PROFILE_MISSING" | "PRODUCT_PROFILE_INCOMPLETE" | "EMPLOYEE_UNMATCHED" | "POSITION_MISSING" | "OEE_MISSING" | "PERFORMANCE_MISSING" | "AVAILABILITY_MISSING" | "HOURLY_DATA_MISSING" | "HOURLY_KPI_MISSING" | "DUPLICATE_RECORD";
export type ImportItemResult = { itemId: string; status: "AUTO_APPROVED" | "PENDING_APPROVAL" | "ERROR"; blockers: ImportBlocker[]; duplicateRows: number; createdRecords: number };

const normalize = (v: string | null | undefined) => (v ?? "").trim().replace(/\s+/g, "").toLowerCase();
function profileForCode(profiles: ProductProfileContext[], code: string) { const wanted = normalize(code); return profiles.find((p) => normalize(p.ha_subassy) === wanted || normalize(p.tup_subassy) === wanted); }
function profileIsComplete(profile: ProductProfileContext | undefined) { return Boolean(profile?.ha_subassy && profile?.tup_subassy && Number(profile.h_norm_per_hour) > 0 && Number(profile.h_capacity) >= 1 && Number(profile.t_norm_per_hour) > 0 && Number(profile.t_capacity) >= 1); }

export async function sha256File(file: File) { const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer()); return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join(""); }
export async function createImportBatch(totalItems: number) { const { data, error } = await db.from("import_batches").insert({ total_items: totalItems, status: "PROCESSING" }).select("*").single(); if (error) throw error; return data as { id: string }; }
export async function createImportItem(batchId: string, screenshotPath: string, sourceHash: string) { const { data, error } = await db.from("import_items").insert({ batch_id: batchId, screenshot_path: screenshotPath, source_hash: sourceHash, status: "PROCESSING" }).select("*").single(); if (error) throw error; return data as { id: string }; }

export async function completeImportBatch(batchId: string) {
  const [{ data: items, error: itemsError }, { data: batch, error: batchError }] = await Promise.all([
    db.from("import_items").select("status").eq("batch_id", batchId),
    db.from("import_batches").select("total_items").eq("id", batchId).single(),
  ]);
  if (itemsError) throw itemsError;
  if (batchError) throw batchError;
  const list = (items ?? []) as Array<{ status: string }>;
  const total = Number(batch?.total_items ?? list.length);
  const autoApproved = list.filter((x) => x.status === "AUTO_APPROVED").length;
  const pending = list.filter((x) => x.status === "PENDING_APPROVAL").length;
  const rejectedOrErrors = list.filter((x) => x.status === "ERROR" || x.status === "REJECTED").length;
  const approved = list.filter((x) => x.status === "APPROVED").length;
  const terminal = autoApproved + pending + rejectedOrErrors + approved;
  const missingItems = Math.max(0, total - list.length);
  const errors = rejectedOrErrors + missingItems;
  const completed = terminal + missingItems;
  const status = completed >= total ? (errors > 0 ? "COMPLETED_WITH_ERRORS" : "COMPLETED") : "PROCESSING";
  const { error: updateError } = await db.from("import_batches").update({ status, processed_items: Math.min(total, completed), auto_items: autoApproved, pending_items: pending, error_items: errors, completed_at: completed >= total ? new Date().toISOString() : null }).eq("id", batchId);
  if (updateError) throw updateError;
  return { total, autoApproved, pending, errors, status };
}

export async function markImportItemError(itemId: string, message: string) { const { error } = await db.from("import_items").update({ status: "ERROR", error_message: message, completed_at: new Date().toISOString() }).eq("id", itemId); if (error) throw error; await db.from("import_item_events").insert({ import_item_id: itemId, event_type: "ERROR", to_status: "ERROR", payload: { message } }); }

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
    return { import_item_id: itemId, row_index: index, ocr_employee_name: String(row.employee_name ?? "").trim() || null, employee_id: matched?.id ?? null, position: row.position ?? null, oee: row.oee, performance: row.performance, available_time: row.available_time, confidence: Number.isFinite(Number(row.confidence)) ? Number(row.confidence) : null, raw_data: row, match_status: matched ? (exact ? "EXACT" : "MATCHED") : "UNMATCHED", validation_status: matched ? "VALID" : "BLOCKED" };
  });
  const { error: rowError } = await db.from("import_item_rows").insert(employeeRows); if (rowError) throw rowError;
  const hourlyRows = (result.hourly_metrics ?? []).filter((m) => m.hour != null).map((m) => ({ import_item_id: itemId, hour: Math.round(Number(m.hour)), product_code: m.product_code ?? null, role: inferRole(m.product_code), actual_output: m.actual_output, performance_pct: m.performance_pct, availability_pct: m.availability_pct, norm_per_hour: null, capacity: null, operator_count: null, actual_oee_pct: m.actual_oee_pct ?? null, raw_data: m }));
  if (hourlyRows.length) { const { error } = await db.from("import_item_hourly").insert(hourlyRows); if (error) throw error; }
  const { error: itemError } = await db.from("import_items").update({ status: "VALIDATING", work_date: result.work_date || null, shift: result.shift || null, line: result.line?.trim() || null, product_code: productCode, product_name: matchedProduct?.name ?? null, norm_per_hour: result.norm_per_hour ?? result.products?.find((p) => normalize(p.product_code) === normalize(productCode))?.norm_per_hour ?? null, ocr_confidence: result.header_confidence ?? null, ocr_data: result, product_id: matchedProduct?.id ?? null, product_match_status: matchedProduct ? "EXACT" : "NEW", product_profile_status: productProfileStatus }).eq("id", itemId); if (itemError) throw itemError;
  const blockers = validateBase(result, employeeRows, matchedProduct, productProfileStatus);
  const { error: blockerError } = await db.from("import_items").update({ pending_reasons: blockers }).eq("id", itemId); if (blockerError) throw blockerError;
  return { blockers, employeeRows, hourlyRows, matchedProduct };
}

export async function finalizeImportItem(itemId: string, result: OcrResult, employeeRows: any[], matchedProduct: Product | undefined, blockers: ImportBlocker[], hourly: OcrHourlyMetric[], actualOee: number | null) {
  if (blockers.length) {
    await db.from("import_item_rows").update({ validation_status: "BLOCKED" }).eq("import_item_id", itemId).is("daily_record_id", null);
    await db.from("import_items").update({ status: "PENDING_APPROVAL", pending_reasons: blockers }).eq("id", itemId);
    await db.from("import_item_events").insert({ import_item_id: itemId, event_type: "VALIDATION_BLOCKED", to_status: "PENDING_APPROVAL", payload: { blockers } });
    return { status: "PENDING_APPROVAL" as const, duplicateRows: 0, createdRecords: 0 };
  }
  if (!matchedProduct) throw new Error("Cannot auto-process without a matched product.");
  const performance = average(hourly.map((m) => m.performance_pct));
  const availability = average(hourly.map((m) => m.availability_pct));
  if (!hourly.length || performance == null || availability == null || actualOee == null || !Number.isFinite(actualOee)) throw new Error("Required KPI values are missing.");

  const { data, error } = await db.rpc("auto_approve_import_item", { p_import_item_id: itemId });
  if (error) throw error;
  const response = data as { success?: boolean; status?: string; blockers?: ImportBlocker[]; created_daily_records?: number } | null;
  if (response?.status === "PENDING_APPROVAL") {
    const rpcBlockers = Array.isArray(response.blockers) ? response.blockers : ["DUPLICATE_RECORD"];
    return { status: "PENDING_APPROVAL" as const, duplicateRows: rpcBlockers.includes("DUPLICATE_RECORD") ? 1 : 0, createdRecords: 0, blockers: rpcBlockers };
  }
  return { status: "AUTO_APPROVED" as const, duplicateRows: 0, createdRecords: Number(response?.created_daily_records ?? 0) };
}

export async function approvePendingImport(itemId: string, actorId: string) {
  const { data, error } = await db.rpc("approve_import_item", { p_import_item_id: itemId, p_actor_id: actorId });
  if (error) throw error;
  return { createdRecords: Number((data as any)?.created_daily_records ?? 0) };
}

function validateBase(result: OcrResult, rows: any[], product: Product | undefined, profileStatus: string): ImportBlocker[] { const blockers: ImportBlocker[] = []; if (!result.work_date) blockers.push("MISSING_DATE"); if (!result.shift) blockers.push("MISSING_SHIFT"); if (!result.line?.trim()) blockers.push("MISSING_LINE"); if (!product) blockers.push("PRODUCT_NOT_FOUND"); if (profileStatus === "MISSING") blockers.push("PRODUCT_PROFILE_MISSING"); if (profileStatus === "INCOMPLETE") blockers.push("PRODUCT_PROFILE_INCOMPLETE"); if (!rows.length) blockers.push("EMPLOYEE_UNMATCHED"); for (const row of rows) { if (!row.employee_id) blockers.push("EMPLOYEE_UNMATCHED"); if (!row.position) blockers.push("POSITION_MISSING"); if (row.oee == null || !Number.isFinite(Number(row.oee))) blockers.push("OEE_MISSING"); if (row.performance == null || !Number.isFinite(Number(row.performance))) blockers.push("PERFORMANCE_MISSING"); if (row.available_time == null || !Number.isFinite(Number(row.available_time))) blockers.push("AVAILABILITY_MISSING"); } return [...new Set(blockers)]; }
function normalizeName(v: string | null | undefined) { return (v ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(); }
function inferRole(code: string | null) { if (!code) return null; if (/^H_/i.test(code)) return "HA"; if (/^T_/i.test(code)) return "TUP"; return null; }
function average(values: Array<number | null | undefined>) { const valid = values.filter((v): v is number => v != null && Number.isFinite(Number(v))).map(Number); return valid.length ? valid.reduce((a, b) => a + b, 0) / valid.length : null; }
