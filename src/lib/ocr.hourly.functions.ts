import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type ProductProfileContext = { id?: string; ha_subassy: string | null; h_capacity: number | null; h_norm_per_hour: number | null; tup_subassy: string | null; t_capacity: number | null; t_norm_per_hour: number | null };
export type HourlyStageContext = { profiles?: ProductProfileContext[]; products?: Array<{ product_code: string; norm_per_hour: number | null; capacity: number | null }>; operator_count: number; role?: "HA" | "TUP" | null };
export type HourlyStageMetric = {
  hour: number | null; product_code: string | null; role: "HA" | "TUP" | null; actual_output: number | null; performance_pct: number | null; availability_pct: number | null; norm_per_hour: number | null; capacity: number | null; operator_count: number; actual_oee_pct: number | null; actual_minutes?: number | null; effective_norm?: number | null; ocr_norm_per_hour?: number | null; downtime_minutes?: number | null; downtime_before_production?: boolean | null; downtime_reason?: string | null;
};
export type HourlyStageResult = { hourly_metrics: HourlyStageMetric[]; predicted_shift_output: number | null; actual_shift_oee_pct: number | null; actual_shift_performance_pct?: number | null; actual_shift_availability_pct?: number | null; operator_count: number; screenshot_time?: string | null; shift?: string | null; raw?: string };

type AiProvider = { name: string; url: string; model: string; headers: Record<string, string> };
function providers(): AiProvider[] { const result: AiProvider[] = []; const key = process.env.OPENROUTER_API_KEY; if (key) result.push({ name: "OpenRouter", url: "https://openrouter.ai/api/v1/chat/completions", model: process.env.OPENROUTER_MODEL ?? "qwen/qwen3-vl-8b-instruct", headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` } }); const lovableKey = process.env.LOVABLE_API_KEY; if (lovableKey) result.push({ name: "Lovable AI", url: "https://ai.gateway.lovable.dev/v1/chat/completions", model: "google/gemini-3.6-flash", headers: { "Content-Type": "application/json", "Lovable-API-Key": lovableKey } }); if (!result.length) throw new Error("Chybí konfigurace AI služby (OPENROUTER_API_KEY nebo LOVABLE_API_KEY)."); return result; }
function text(v: unknown): string { return String(v ?? "").trim(); }
function num(v: unknown): number | null { if (v === null || v === undefined || v === "") return null; if (typeof v === "number") return Number.isFinite(v) ? v : null; let s = String(v).trim().replace(/\s/g, "").replace(/%/g, ""); if (s.includes(",")) s = s.replace(/\./g, "").replace(",", "."); else s = s.replace(/[^\d.\-]/g, ""); const n = Number(s); return Number.isFinite(n) ? n : null; }
function firstNum(row: Record<string, unknown>, keys: string[]): number | null { for (const key of keys) { const n = num(row[key]); if (n !== null) return n; } return null; }
function firstText(row: Record<string, unknown>, keys: string[]): string { for (const key of keys) { const v = text(row[key]); if (v) return v; } return ""; }
function normalize(v: string | null): string { return (v ?? "").trim().toLowerCase().replace(/\s+/g, ""); }
function normalizeRole(v: unknown): "HA" | "TUP" | null { const s = text(v).toLowerCase(); if (s === "ha" || s.includes("ha")) return "HA"; if (s === "tup" || s.includes("tup")) return "TUP"; return null; }
function parseTime(v: unknown): string | null { const m = /^(?:[01]\d|2[0-3]):[0-5]\d$/.exec(text(v)); return m ? m[0] : null; }
function shiftFromScreenshotTime(time: string | null): string | null { if (!time) return null; const hour = Number(time.slice(0, 2)); if (hour >= 6 && hour < 14) return "Ranní"; if (hour >= 14 && hour < 22) return "Odpolední"; return "Noční"; }
function profileVariant(p: ProductProfileContext, code: string | null, role: "HA" | "TUP" | null) { const c = normalize(code); const h = normalize(p.ha_subassy) === c; const t = normalize(p.tup_subassy) === c; if (role === "HA" && h) return { norm: p.h_norm_per_hour, capacity: p.h_capacity }; if (role === "TUP" && t) return { norm: p.t_norm_per_hour, capacity: p.t_capacity }; if (h && !t) return { norm: p.h_norm_per_hour, capacity: p.h_capacity }; if (t && !h) return { norm: p.t_norm_per_hour, capacity: p.t_capacity }; return null; }
function findVariant(context: HourlyStageContext, code: string | null, role: "HA" | "TUP" | null) { for (const p of context.profiles ?? []) { const v = profileVariant(p, code, role); if (v) return v; } return null; }
function shiftForHour(hour: number): { start: number; pauseStartRel: number; pauseEndRel: number } { if (hour >= 6 && hour < 14) return { start: 360, pauseStartRel: 280, pauseEndRel: 310 }; if (hour >= 14 && hour < 22) return { start: 840, pauseStartRel: 240, pauseEndRel: 270 }; return { start: 1320, pauseStartRel: 240, pauseEndRel: 270 }; }
function relativeMinuteOfShift(hour: number, shiftStart: number): number { return ((hour * 60 - shiftStart) + 1440) % 1440; }
function screenshotRelativeMinute(time: string | null, shiftStart: number): number | null { if (!time) return null; const [h, m] = time.split(":").map(Number); return ((h * 60 + m - shiftStart) + 1440) % 1440; }
function baseProductiveMinutesForHour(hour: number | null, screenshotTime: string | null): number { if (hour == null || !Number.isFinite(hour)) return 0; const h = ((Math.trunc(hour) % 24) + 24) % 24; const shift = shiftForHour(h); const start = relativeMinuteOfShift(h, shift.start); let end = start + 60; const cutoff = screenshotRelativeMinute(screenshotTime, shift.start); if (cutoff != null) { if (cutoff <= start) return 0; if (cutoff < end) end = cutoff; } let minutes = Math.max(0, end - start); minutes -= Math.max(0, Math.min(end, shift.pauseEndRel) - Math.max(start, shift.pauseStartRel)); minutes -= Math.max(0, Math.min(end, 7) - Math.max(start, 0)); minutes -= Math.max(0, Math.min(end, 475) - Math.max(start, 475)); return Math.max(0, Math.min(60, minutes)); }
function averageWeighted(metrics: HourlyStageMetric[], field: "performance_pct" | "availability_pct"): number | null { let total = 0; let weight = 0; for (const m of metrics) { const value = m[field]; const w = m.actual_minutes ?? 0; if (value == null || !Number.isFinite(Number(value)) || w <= 0) continue; total += Number(value) * w; weight += w; } return weight > 0 ? total / weight : null; }
async function loadExistingProfiles(context: HourlyStageContext): Promise<ProductProfileContext[]> { const contextProfiles = context.profiles ?? []; const { supabaseAdmin } = await import("@/integrations/supabase/client.server"); const { data, error } = await supabaseAdmin.from("product_profiles").select("id,ha_subassy,h_capacity,h_norm_per_hour,tup_subassy,t_capacity,t_norm_per_hour"); if (error) throw new Error(`Nepodařilo se načíst Product Profile: ${error.message}`); const dbProfiles = (data ?? []) as ProductProfileContext[]; if (!dbProfiles.length) return contextProfiles; const merged = [...contextProfiles]; for (const db of dbProfiles) { if (!merged.some((p) => [p.ha_subassy, p.tup_subassy].map(normalize).some((c) => c && [db.ha_subassy, db.tup_subassy].map(normalize).includes(c)))) merged.push(db); } return merged; }
function providerError(body: string): string { try { const parsed = JSON.parse(body) as any; return String(parsed?.error?.message ?? parsed?.message ?? body).replace(/\s+/g, " ").slice(0, 500); } catch { return body.replace(/\s+/g, " ").slice(0, 500); } }

async function callAi(provider: AiProvider, imageDataUrl: string, context: HourlyStageContext, mode: "full" | "availability"): Promise<Record<string, unknown>> {
  const profiles = context.profiles ?? [];
  const contextLines = profiles.map((p) => `HA=${p.ha_subassy ?? "?"}, kapacita HA=${p.h_capacity ?? "?"}, norma HA=${p.h_norm_per_hour ?? "?"} | TUP=${p.tup_subassy ?? "?"}, kapacita TUP=${p.t_capacity ?? "?"}, norma TUP=${p.t_norm_per_hour ?? "?"}`).join("\n");
  const instruction = mode === "full"
    ? `Proveď 3. sekvenci OCR hodinové tabulky. Skutečně přečti KAŽDOU viditelnou řádku. Pro každou vrať hour, product_code, actual_output, norm_per_hour, performance_pct, availability_pct a downtime_minutes. U každé řádky vrať také downtime_reason: doslovný nebo co nejpřesnější text důvodu ze sloupce Odstávka/Odstávky; pokud důvod není uveden, vrať null. Downtime_minutes čti výhradně ze sloupce Odstávka/Odstávky a vrať pouze konkrétní počet minut, pokud je v řádku skutečně uveden. Pokud je u odstávky pouze důvod nebo čas bez konkrétního počtu minut, vrať null. Vrať také downtime_before_production=true pouze tehdy, když je z tabulky zřejmé, že tato odstávka nastala před začátkem výroby v dané hodině; jinak false/null. Pokud jde o změnu výrobku na stejném pracovišti a odstávka je spojena s touto změnou, zachovej downtime_minutes. Dostupnost je SAMOSTATNÝ sloupec tabulky; nesmí být nahrazena OEE, výkonem ani null, pokud je číslo ve sloupci viditelné. Nejprve si vizuálně najdi hlavičku sloupce Dostupnost a potom čti hodnotu ve stejném sloupci pro každou řádku. Vrať také screenshot_time z hlavičky. Role pracoviště: ${context.role ?? "NEURČENA"}. Počet operátorů: ${context.operator_count}. Product Profile: ${contextLines || "žádný"}. Vrať pouze JSON.`
    : `Toto je DRUHÝ KONTROLNÍ PRŮCHOD. IGNORUJ výkon a OEE. Soustřeď se výhradně na samostatný sloupec DOSTUPNOST a sloupec Odstávka/Odstávky v hodinové tabulce. Najdi hlavičku Dostupnost a Odstávka/Odstávky. Pro každou viditelnou hodinu vrať přesně availability_pct, downtime_minutes a downtime_reason. downtime_minutes vrať jen při konkrétním počtu minut; důvod nebo čas bez minut není číslo. downtime_reason vrať jako text důvodu, pokud je uveden, jinak null. Vrať také hour a product_code, aby šly hodnoty přiřadit ke správné řádce. Vrať downtime_before_production=true jen pokud je odstávka před začátkem výroby v dané hodině. Vrať pouze JSON.`;
  const system = mode === "full"
    ? `Jsi přesný OCR nástroj výrobní tabulky. Vrať pouze JSON {"screenshot_time":"HH:MM nebo null","hourly_metrics":[{"hour":číslo nebo null,"product_code":"kód nebo null","actual_output":číslo nebo null,"norm_per_hour":číslo nebo null,"performance_pct":číslo nebo null,"availability_pct":číslo nebo null,"downtime_minutes":číslo nebo null,"downtime_reason":"důvod nebo null","downtime_before_production":true|false|null}]}. Hodnoty procent vracej jako čísla bez %. Nikdy nezaměňuj sloupce. Norma je OCR norma přímo ze screenshotu, nikoli Product Profile.`
    : `Jsi kontrolní OCR nástroj. Vrať pouze JSON {"hourly_metrics":[{"hour":číslo nebo null,"product_code":"kód nebo null","availability_pct":číslo nebo null,"downtime_minutes":číslo nebo null,"downtime_reason":"důvod nebo null","downtime_before_production":true|false|null}]}. Čti pouze Dostupnost a Odstávku/Odstávky.`;
  const res = await fetch(provider.url, { method: "POST", headers: provider.headers, body: JSON.stringify({ model: provider.model, temperature: 0, max_tokens: 5000, response_format: { type: "json_object" }, messages: [{ role: "system", content: system }, { role: "user", content: [{ type: "text", text: instruction }, { type: "image_url", image_url: { url: imageDataUrl } }] }] }) });
  const body = await res.text(); if (!res.ok) throw new Error(`${provider.name}: HTTP ${res.status}: ${providerError(body)}`); const json = JSON.parse(body) as any; const content = json?.choices?.[0]?.message?.content ?? ""; if (!content.trim()) throw new Error(`${provider.name}: prázdná odpověď`); return JSON.parse(content.replace(/^```(?:json)?|```$/g, "").trim()) as Record<string, unknown>;
}

export const extractHourlyWithContext = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth]).validator((input: { imageDataUrl: string; context: HourlyStageContext }) => { if (!input?.imageDataUrl?.startsWith("data:image/")) throw new Error("Neplatný obrázek."); if (!input.context || !Number.isInteger(input.context.operator_count) || input.context.operator_count < 1) throw new Error("3. sekvence potřebuje skutečný počet operátorů."); if (!Array.isArray(input.context.profiles)) throw new Error("3. sekvence potřebuje Product Profile."); return input; }).handler(async ({ data }): Promise<HourlyStageResult> => {
  const dbProfiles = await loadExistingProfiles(data.context); const context = { ...data.context, profiles: dbProfiles }; if (!(context.profiles ?? []).some((p) => (p.h_norm_per_hour != null && p.h_capacity != null) || (p.t_norm_per_hour != null && p.t_capacity != null))) throw new Error("Pro rozpoznané Product ID nebyl nalezen Product Profile s normou a kapacitou.");
  let parsed: Record<string, unknown> | null = null; let providerUsed: AiProvider | null = null; const errors: string[] = []; for (const provider of providers()) { try { parsed = await callAi(provider, data.imageDataUrl, context, "full"); providerUsed = provider; break; } catch (error) { errors.push(error instanceof Error ? error.message : String(error)); } }
  if (!parsed || !providerUsed) throw new Error(`3. sekvence OCR selhala: ${errors.join(" | ")}`);
  const screenshot_time = parseTime(parsed.screenshot_time);
  const parsedRows = Array.isArray(parsed.hourly_metrics) ? parsed.hourly_metrics as Record<string, unknown>[] : [];
  const hourly_metrics: HourlyStageMetric[] = parsedRows.map((row) => {
    const product_code = firstText(row, ["product_code", "product", "produkt", "product_id"]) || null;
    const role = normalizeRole(row.role) ?? context.role ?? null;
    const variant = findVariant(context, product_code, role);
    const downtime_minutes = firstNum(row, ["downtime_minutes", "downtime_min", "odstavka_minutes", "odstavky_minutes", "odstavka_min", "odstavky_min"]);
    const downtimeFlagRaw = row.downtime_before_production;
    const downtime_before_production = typeof downtimeFlagRaw === "boolean" ? downtimeFlagRaw : null;
    return {
      hour: firstNum(row, ["hour", "hodina"]), product_code, role,
      actual_output: firstNum(row, ["actual_output", "actual", "realny", "real", "reálný"]),
      performance_pct: firstNum(row, ["performance_pct", "performance", "vykon", "výkon"]),
      availability_pct: firstNum(row, ["availability_pct", "availability", "dostupnost", "dostupnost_pct"]),
      norm_per_hour: variant?.norm ?? null, capacity: variant?.capacity ?? null,
      operator_count: data.context.operator_count, actual_oee_pct: null,
      ocr_norm_per_hour: firstNum(row, ["norm_per_hour", "ocr_norm_per_hour", "ocr_norm", "norma"]),
      downtime_minutes, downtime_before_production,
      downtime_reason: firstText(row, ["downtime_reason", "reason", "odstavka_reason", "odstavky_reason", "duvod_odstavky", "důvod_odstávky"]) || null,
    };
  });
  const missingAvailability = hourly_metrics.some((m) => m.hour != null && m.availability_pct == null);
  if (missingAvailability) {
    try {
      const recovery = await callAi(providerUsed, data.imageDataUrl, context, "availability");
      const recoveryRows = Array.isArray(recovery.hourly_metrics) ? recovery.hourly_metrics as Record<string, unknown>[] : [];
      type RecoveryRow = { product_code: string | null; availability: number | null; downtime: number | null; beforeProduction: boolean | null };
      const byKey = new Map<string, RecoveryRow>();
      const byHour = new Map<number, RecoveryRow[]>();
      for (const row of recoveryRows) {
        const h = firstNum(row, ["hour", "hodina"]); if (h == null) continue;
        const productCode = firstText(row, ["product_code", "product", "produkt", "product_id"]);
        const a = firstNum(row, ["availability_pct", "availability", "dostupnost", "dostupnost_pct"]);
        const d = firstNum(row, ["downtime_minutes", "downtime_min", "odstavka_minutes", "odstavky_minutes", "odstavka_min", "odstavky_min"]);
        const flag = typeof row.downtime_before_production === "boolean" ? row.downtime_before_production : null;
        const recoveredRow: RecoveryRow = { product_code: productCode || null, availability: a, downtime: d, beforeProduction: flag };
        const hour = Math.round(h); const candidates = byHour.get(hour) ?? []; candidates.push(recoveredRow); byHour.set(hour, candidates);
        if (productCode) byKey.set(`${hour}|${normalize(productCode)}`, recoveredRow);
      }
      for (const metric of hourly_metrics) {
        const hour = metric.hour != null ? Math.round(metric.hour) : null;
        const exact = hour != null && metric.product_code ? byKey.get(`${hour}|${normalize(metric.product_code)}`) : undefined;
        const candidates = hour != null ? (byHour.get(hour) ?? []) : [];
        const recovered = exact ?? (candidates.length === 1 ? candidates[0] : undefined);
        if (metric.availability_pct == null) metric.availability_pct = recovered?.availability ?? null;
        if (metric.downtime_minutes == null) metric.downtime_minutes = recovered?.downtime ?? null;
        if (metric.downtime_before_production == null) metric.downtime_before_production = recovered?.beforeProduction ?? null;
        if (!metric.downtime_reason && recovered) {
          const rr = recoveryRows.find((x) => firstNum(x, ["hour", "hodina"]) != null && Math.round(firstNum(x, ["hour", "hodina"])!) === hour && normalize(firstText(x, ["product_code", "product", "produkt", "product_id"])) === normalize(metric.product_code));
          if (rr) metric.downtime_reason = firstText(rr, ["downtime_reason", "reason", "odstavka_reason", "odstavky_reason", "duvod_odstavky", "důvod_odstávky"]) || null;
        }
      }
    } catch { /* keep values from the primary OCR pass */ }
  }

  const realMetrics = hourly_metrics.filter((m) => (m.actual_output ?? 0) > 0 && m.product_code && m.norm_per_hour != null && m.norm_per_hour > 0).sort((a, b) => Number(a.hour ?? 0) - Number(b.hour ?? 0));
  const firstProductionMetric = realMetrics[0] ?? null;
  let actualOutputTotal = 0; let idealOutputTotal = 0;
  let previousProduct: string | null = null; let previousRole: "HA" | "TUP" | null = null;
  for (const m of hourly_metrics) {
    const isReal = (m.actual_output ?? 0) > 0 && !!m.product_code && m.norm_per_hour != null && m.norm_per_hour > 0;
    if (!isReal) { m.actual_minutes = 0; m.performance_pct = null; m.effective_norm = null; m.actual_oee_pct = null; continue; }
    const availability = m.availability_pct != null && Number.isFinite(Number(m.availability_pct)) ? Math.max(0, Math.min(100, Number(m.availability_pct))) : null;
    const availabilityMinutes = availability != null ? 60 * availability / 100 : null;
    const downtime = m.downtime_minutes != null && Number.isFinite(Number(m.downtime_minutes)) && m.downtime_minutes > 0 ? Math.min(60, Number(m.downtime_minutes)) : null;
    const normalizedProduct = normalize(m.product_code); const sameRole = previousRole === m.role;
    const productChanged = previousProduct != null && sameRole && normalizedProduct !== previousProduct;
    const isFirstProductionHour = firstProductionMetric === m;
    const downtimeReason = normalize(m.downtime_reason);
    const isChangeoverReason = downtimeReason.includes("zmenaproduktu") || downtimeReason.includes("změnaproduktu");
    const downtimeRelevant = downtime != null && (m.downtime_before_production === true || productChanged || isChangeoverReason);
    const measuredMinutes = downtimeRelevant ? Math.min(availabilityMinutes ?? 60, Math.max(0, 60 - downtime)) : availabilityMinutes;
    const canUseTeff = isFirstProductionHour && (downtime == null || downtime <= 0) && m.ocr_norm_per_hour != null && m.ocr_norm_per_hour > 0 && m.norm_per_hour > 0;
    if (canUseTeff) {
      const availabilityFactor = availability != null && availability > 0 ? availability / 100 : 1;
      const normAt100Availability = m.ocr_norm_per_hour! / availabilityFactor;
      const teff = Math.max(0, Math.min(60, normAt100Availability / m.norm_per_hour! * 60));
      m.actual_minutes = teff; m.effective_norm = m.norm_per_hour! * teff / 60;
    } else {
      m.actual_minutes = Math.max(0, Math.min(60, measuredMinutes ?? baseProductiveMinutesForHour(m.hour, screenshot_time)));
      m.effective_norm = m.norm_per_hour! * (m.actual_minutes ?? 0) / 60;
    }
    if (m.effective_norm > 0 && m.actual_output != null) m.performance_pct = m.actual_output / m.effective_norm * 100; else m.performance_pct = null;
    if (m.performance_pct != null && availability != null && m.capacity != null && m.capacity > 0 && m.operator_count > 0) m.actual_oee_pct = m.performance_pct * availability * (m.operator_count / m.capacity) / 100;
    if (m.actual_output != null) actualOutputTotal += m.actual_output; if (m.effective_norm != null) idealOutputTotal += m.effective_norm;
    previousProduct = normalizedProduct; previousRole = m.role;
  }
  const actual_shift_performance_pct = averageWeighted(hourly_metrics, "performance_pct");
  const actual_shift_availability_pct = averageWeighted(hourly_metrics, "availability_pct");
  const weightedOee = hourly_metrics.reduce((sum, m) => sum + (m.actual_oee_pct ?? 0) * (m.actual_minutes ?? 0), 0);
  const oeeWeight = hourly_metrics.reduce((sum, m) => sum + (m.actual_oee_pct != null ? (m.actual_minutes ?? 0) : 0), 0);
  const actual_shift_oee_pct = oeeWeight > 0 ? weightedOee / oeeWeight : null;
  return { hourly_metrics, predicted_shift_output: idealOutputTotal > 0 ? idealOutputTotal : null, actual_shift_oee_pct, actual_shift_performance_pct, actual_shift_availability_pct, operator_count: data.context.operator_count, screenshot_time, shift: shiftFromScreenshotTime(screenshot_time), raw: JSON.stringify({ screenshot_time, actual_minutes_total: hourly_metrics.reduce((s, m) => s + (m.actual_minutes ?? 0), 0), actual_output_total: actualOutputTotal, availability_recovery: missingAvailability, downtime_rule: "Concrete downtime affects production time only before production starts or during a product change on the same workplace; product change is evaluated per same-role sequence and recovery data is attributed by hour + product when available.", hourly_metrics: hourly_metrics.map((m) => ({ hour: m.hour, product_code: m.product_code, actual_output: m.actual_output, ocr_norm_per_hour: m.ocr_norm_per_hour, downtime_minutes: m.downtime_minutes, downtime_reason: m.downtime_reason, downtime_before_production: m.downtime_before_production, availability_pct: m.availability_pct, actual_minutes: m.actual_minutes, effective_norm: m.effective_norm })) }) };
});
