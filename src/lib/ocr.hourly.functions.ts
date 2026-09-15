import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type ProductProfileContext = { id?: string; ha_subassy: string | null; h_capacity: number | null; h_norm_per_hour: number | null; tup_subassy: string | null; t_capacity: number | null; t_norm_per_hour: number | null };
export type HourlyStageContext = { profiles?: ProductProfileContext[]; products?: Array<{ product_code: string; norm_per_hour: number | null; capacity: number | null }>; operator_count: number; role?: "HA" | "TUP" | null };
export type HourlyStageMetric = { hour: number | null; product_code: string | null; role: "HA" | "TUP" | null; actual_output: number | null; performance_pct: number | null; availability_pct: number | null; norm_per_hour: number | null; capacity: number | null; operator_count: number; actual_oee_pct: number | null; actual_minutes?: number | null; effective_norm?: number | null };
export type HourlyStageResult = { hourly_metrics: HourlyStageMetric[]; predicted_shift_output: number | null; actual_shift_oee_pct: number | null; actual_shift_performance_pct?: number | null; actual_shift_availability_pct?: number | null; operator_count: number; screenshot_time?: string | null; shift?: string | null; raw?: string };

type AiProvider = { name: string; url: string; model: string; headers: Record<string, string> };
type AiError = Error & { status?: number; provider?: string; detail?: string };

function providers(): AiProvider[] {
  const result: AiProvider[] = [];
  const key = process.env.OPENROUTER_API_KEY;
  if (key) result.push({ name: "OpenRouter", url: "https://openrouter.ai/api/v1/chat/completions", model: process.env.OPENROUTER_MODEL ?? "qwen/qwen3-vl-8b-instruct", headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` } });
  const lovableKey = process.env.LOVABLE_API_KEY;
  if (lovableKey) result.push({ name: "Lovable AI", url: "https://ai.gateway.lovable.dev/v1/chat/completions", model: "google/gemini-3.6-flash", headers: { "Content-Type": "application/json", "Lovable-API-Key": lovableKey } });
  if (!result.length) throw new Error("Chybí konfigurace AI služby (OPENROUTER_API_KEY nebo LOVABLE_API_KEY).");
  return result;
}
function num(v: unknown): number | null { if (v === null || v === undefined || v === "") return null; if (typeof v === "number") return Number.isFinite(v) ? v : null; let s = String(v).trim().replace(/\s/g, "").replace(/%/g, ""); if (s.includes(",")) s = s.replace(/\./g, "").replace(",", "."); else s = s.replace(/[^\d.\-]/g, ""); const n = Number(s); return Number.isFinite(n) ? n : null; }
function text(v: unknown): string { return String(v ?? "").trim(); }
function firstNum(row: Record<string, unknown>, keys: string[]): number | null { for (const key of keys) { const n = num(row[key]); if (n !== null) return n; } return null; }
function firstText(row: Record<string, unknown>, keys: string[]): string { for (const key of keys) { const v = text(row[key]); if (v) return v; } return ""; }
function normalize(v: string | null): string { return (v ?? "").trim().toLowerCase().replace(/\s+/g, ""); }
function normalizeRole(v: unknown): "HA" | "TUP" | null { const s = text(v).toLowerCase(); if (s === "ha" || s.includes("ha")) return "HA"; if (s === "tup" || s.includes("tup")) return "TUP"; return null; }
function providerErrorDetail(body: string): string { const fallback = body.replace(/\s+/g, " ").trim(); if (!fallback) return "prázdná odpověď"; try { const parsed = JSON.parse(body) as Record<string, unknown>; const error = parsed.error; if (error && typeof error === "object") { const e = error as Record<string, unknown>; const parts = [e.message, e.code, e.type, e.status].filter((x) => x != null && String(x).trim()); if (parts.length) return parts.map(String).join(" | ").slice(0, 600); } const message = parsed.message ?? parsed.detail; if (message) return String(message).slice(0, 600); } catch {} return fallback.slice(0, 600); }
function aiError(message: string, provider: AiProvider, status?: number, detail?: string): AiError { const e = new Error(message) as AiError; e.status = status; e.provider = provider.name; e.detail = detail; return e; }

async function loadExistingProfiles(context: HourlyStageContext): Promise<ProductProfileContext[]> {
  const contextProfiles = context.profiles ?? [];
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin.from("product_profiles").select("id,ha_subassy,h_capacity,h_norm_per_hour,tup_subassy,t_capacity,t_norm_per_hour");
  if (error) throw new Error(`Nepodařilo se načíst Product Profile: ${error.message}`);
  const dbProfiles = (data ?? []) as ProductProfileContext[];
  if (!dbProfiles.length) return contextProfiles;
  const merged: ProductProfileContext[] = [];
  const used = new Set<number>();
  for (const cp of contextProfiles) {
    const codes = [cp.ha_subassy, cp.tup_subassy].map(normalize).filter(Boolean);
    const index = dbProfiles.findIndex((p, i) => !used.has(i) && [p.ha_subassy, p.tup_subassy].map(normalize).some((c) => c && codes.includes(c)));
    if (index < 0) { merged.push(cp); continue; }
    used.add(index);
    const db = dbProfiles[index];
    merged.push({ ...cp, ...db, ha_subassy: db.ha_subassy ?? cp.ha_subassy, h_capacity: db.h_capacity ?? cp.h_capacity, h_norm_per_hour: db.h_norm_per_hour ?? cp.h_norm_per_hour, tup_subassy: db.tup_subassy ?? cp.tup_subassy, t_capacity: db.t_capacity ?? cp.t_capacity, t_norm_per_hour: db.t_norm_per_hour ?? cp.t_norm_per_hour });
  }
  dbProfiles.forEach((p, i) => { if (!used.has(i)) merged.push(p); });
  return merged;
}

async function callAi(provider: AiProvider, imageDataUrl: string, context: HourlyStageContext): Promise<Record<string, unknown>> {
  const profiles = context.profiles ?? [];
  const contextLines = profiles.map((p) => `- profil ${p.id ?? ""} | HA=${p.ha_subassy ?? "NEZNÁMÁ"}, kapacita HA=${p.h_capacity ?? "NEZNÁMÁ"}, norma HA=${p.h_norm_per_hour ?? "NEZNÁMÁ"} ks/h | TUP=${p.tup_subassy ?? "NEZNÁMÁ"}, kapacita TUP=${p.t_capacity ?? "NEZNÁMÁ"}, norma TUP=${p.t_norm_per_hour ?? "NEZNÁMÁ"} ks/h`).join("\n");
  const instruction = `Proveď 3. sekvenci OCR: přečti pouze hodinovou výrobní tabulku screenshotu.\n\nZÁVAZNÝ KONTEXT:\n${contextLines || "- žádný produktový profil"}\n- skutečný počet operátorů na lince: ${context.operator_count}\n- role pracoviště z 2. sekvence: ${context.role ?? "NEURČENA"}\n\nZ HLAVIČKY screenshotu přečti skutečný čas pořízení ve formátu HH:MM a vrať jej jako screenshot_time.\n\nPRO KAŽDOU skutečně viditelnou hodinovou řádku vrať vždy hour, product_code, actual_output, performance_pct a availability_pct. Výkon i Dostupnost jsou číselné hodnoty ze screenshotu v procentech 0–100; nevynechávej je, pokud jsou ve sloupci viditelné. Zejména musíš přečíst samostatný sloupec Dostupnost, i když je jeho hodnota stejná nebo podobná jako OEE. Pokud některá hodnota opravdu není čitelná, vrať null a nic nevymýšlej.\n\nNORMU ANI KAPACITU NIKDY NEODVOZUJ ZE SCREENSHOTU; použij pouze Product Profile z databáze. Pokud stejný kód existuje jako HA i TUP, použij roli z kontextu. Výkon musí následně přepočítat aplikace z actual_output, normy a efektivních produktivních minut. OEE musí aplikace vypočítat jako Výkon × Dostupnost × (kapacita / počet operátorů) / 100. OEE není omezené na 100 %.\n\nVrať pouze JSON a zachovej přesně klíče hourly_metrics, hour, product_code, actual_output, performance_pct, availability_pct a screenshot_time.`;
  const system = `Jsi třetí sekvence OCR pro výrobní screenshoty DPS. Čteš hodinovou tabulku a čas screenshotu. Product Profile, role a počet operátorů jsou externí kontext. Vrať pouze JSON {"screenshot_time":"HH:MM nebo null","hourly_metrics":[{"hour":číslo nebo null,"product_code":"kód nebo null","actual_output":číslo nebo null,"performance_pct":číslo nebo null,"availability_pct":číslo nebo null}]}. Hodnoty performance_pct a availability_pct čti přímo ze správných sloupců tabulky a uváděj jako čísla bez znaku %.`; 
  let res: Response;
  try { res = await fetch(provider.url, { method: "POST", headers: provider.headers, body: JSON.stringify({ model: provider.model, temperature: 0, max_tokens: 5000, response_format: { type: "json_object" }, messages: [{ role: "system", content: system }, { role: "user", content: [{ type: "text", text: instruction }, { type: "image_url", image_url: { url: imageDataUrl } }] }] }) }); }
  catch (cause) { throw aiError(`${provider.name}: nepodařilo se spojit s AI službou.`, provider, undefined, cause instanceof Error ? cause.message : String(cause)); }
  let body = "";
  try { body = await res.text(); } catch (cause) { throw aiError(`${provider.name}: nepodařilo se přečíst odpověď AI.`, provider, res.status, cause instanceof Error ? cause.message : String(cause)); }
  if (!res.ok) throw aiError(`${provider.name}: HTTP ${res.status}`, provider, res.status, providerErrorDetail(body));
  let json: { choices?: { message?: { content?: string } }[] };
  try { json = JSON.parse(body) as { choices?: { message?: { content?: string } }[] }; } catch (cause) { throw aiError(`${provider.name}: odpověď není platný JSON.`, provider, res.status, cause instanceof Error ? cause.message : String(cause)); }
  const content = json.choices?.[0]?.message?.content ?? "";
  if (!content.trim()) throw aiError(`${provider.name}: odpověď neobsahuje AI obsah.`, provider, res.status, "prázdný obsah");
  try { return JSON.parse(content.replace(/^```(?:json)?|```$/g, "").trim()) as Record<string, unknown>; } catch { throw aiError(`${provider.name}: AI vrátila neplatný JSON obsah.`, provider, res.status, content.slice(0, 600)); }
}

function profileVariant(p: ProductProfileContext, code: string | null, role: "HA" | "TUP" | null) {
  const c = normalize(code); const h = normalize(p.ha_subassy) === c; const t = normalize(p.tup_subassy) === c;
  if (role === "HA" && h) return { norm: p.h_norm_per_hour, capacity: p.h_capacity };
  if (role === "TUP" && t) return { norm: p.t_norm_per_hour, capacity: p.t_capacity };
  if (h && !t) return { norm: p.h_norm_per_hour, capacity: p.h_capacity };
  if (t && !h) return { norm: p.t_norm_per_hour, capacity: p.t_capacity };
  return null;
}
function findVariant(context: HourlyStageContext, code: string | null, role: "HA" | "TUP" | null) { for (const p of context.profiles ?? []) { const v = profileVariant(p, code, role); if (v) return v; } return null; }
function parseTime(v: unknown): string | null { const m = /^(?:[01]\d|2[0-3]):[0-5]\d$/.exec(text(v)); return m ? m[0] : null; }
function shiftFromScreenshotTime(time: string | null): string | null { if (!time) return null; const hour = Number(time.slice(0, 2)); if (hour >= 6 && hour < 14) return "Ranní"; if (hour >= 14 && hour < 22) return "Odpolední"; return "Noční"; }

function shiftForHour(hour: number): { start: number; pauseStartRel: number; pauseEndRel: number } {
  if (hour >= 6 && hour < 14) return { start: 6 * 60, pauseStartRel: 4 * 60 + 40, pauseEndRel: 5 * 60 + 10 };
  if (hour >= 14 && hour < 22) return { start: 14 * 60, pauseStartRel: 4 * 60, pauseEndRel: 4 * 60 + 30 };
  return { start: 22 * 60, pauseStartRel: 4 * 60, pauseEndRel: 4 * 60 + 30 };
}
function relativeMinuteOfHour(hour: number, shiftStart: number): number { return ((hour * 60 - shiftStart) + 1440) % 1440; }
function screenshotRelativeMinute(screenshotTime: string | null, shiftStart: number): number | null {
  if (!screenshotTime) return null;
  const [hh, mm] = screenshotTime.split(":").map(Number);
  return ((hh * 60 + mm - shiftStart) + 1440) % 1440;
}
function productiveMinutesForHour(hour: number | null, screenshotTime: string | null): number {
  if (hour == null || !Number.isFinite(hour)) return 0;
  const normalizedHour = ((Math.trunc(hour) % 24) + 24) % 24;
  const shift = shiftForHour(normalizedHour);
  const relStart = relativeMinuteOfHour(normalizedHour, shift.start);
  let relEnd = relStart + 60;
  const cutoff = screenshotRelativeMinute(screenshotTime, shift.start);
  if (cutoff != null) {
    if (cutoff < relStart) return 0;
    if (cutoff < relEnd) relEnd = cutoff;
  }
  const workStart = 7;
  const workEnd = 8 * 60 - 5;
  let productive = Math.max(0, Math.min(relEnd, workEnd) - Math.max(relStart, workStart));
  productive -= Math.max(0, Math.min(relEnd, shift.pauseEndRel) - Math.max(relStart, shift.pauseStartRel));
  return Math.max(0, Math.min(60, productive));
}
function averageWeighted(metrics: HourlyStageMetric[], field: "performance_pct" | "availability_pct"): number | null { let total = 0; let weight = 0; for (const m of metrics) { const value = m[field]; if (value == null || !Number.isFinite(Number(value))) continue; const w = m.actual_minutes ?? 0; if (w <= 0) continue; total += Number(value) * w; weight += w; } return weight > 0 ? total / weight : null; }

export const extractHourlyWithContext = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth]).validator((input: { imageDataUrl: string; context: HourlyStageContext }) => {
  if (!input?.imageDataUrl?.startsWith("data:image/")) throw new Error("Neplatný obrázek.");
  if (!input.context || !Number.isInteger(input.context.operator_count) || input.context.operator_count < 1) throw new Error("3. sekvence potřebuje skutečný počet operátorů z 2. sekvence.");
  if (!Array.isArray(input.context.profiles)) throw new Error("3. sekvence potřebuje Product Profile z databáze.");
  return input;
}).handler(async ({ data }): Promise<HourlyStageResult> => {
  const dbProfiles = await loadExistingProfiles(data.context);
  const context: HourlyStageContext = { ...data.context, profiles: dbProfiles };
  if (!(context.profiles ?? []).some((p) => (p.h_norm_per_hour != null && p.h_capacity != null) || (p.t_norm_per_hour != null && p.t_capacity != null))) throw new Error("Pro rozpoznané Product ID nebyl nalezen žádný Product Profile s normou a kapacitou.");
  const attempts: string[] = []; let parsed: Record<string, unknown> | null = null;
  for (const provider of providers()) { try { parsed = await callAi(provider, data.imageDataUrl, context); break; } catch (e) { const err = e as AiError; attempts.push(`${err.provider ?? "AI"} – ${err.status != null ? `HTTP ${err.status}` : "síťová chyba"}${err.detail ? `: ${err.detail}` : ""}`); } }
  if (!parsed) throw new Error(`AI OCR se nepodařilo dokončit. Pokusy: ${attempts.join("; ")}`);
  const screenshot_time = parseTime(firstText(parsed, ["screenshot_time", "screenshotTime", "actual_time", "time"]));
  const raw = Array.isArray(parsed.hourly_metrics) ? parsed.hourly_metrics as Record<string, unknown>[] : Array.isArray(parsed.hours) ? parsed.hours as Record<string, unknown>[] : [];
  const hourly_metrics: HourlyStageMetric[] = raw.map((row) => {
    const product_code = firstText(row, ["product_code", "product"]) || null;
    const role = context.role ?? normalizeRole(firstText(row, ["role", "position", "operation", "pozice"]));
    const variant = findVariant(context, product_code, role);
    return { hour: firstNum(row, ["hour", "hodina"]), product_code, role, actual_output: firstNum(row, ["actual_output", "actual", "realny", "real", "reálný"]), performance_pct: firstNum(row, ["performance_pct", "performance", "vykon", "výkon"]), availability_pct: firstNum(row, ["availability_pct", "availability", "dostupnost", "dostupnost_pct"]), norm_per_hour: variant?.norm ?? null, capacity: variant?.capacity ?? null, operator_count: data.context.operator_count, actual_oee_pct: null };
  });
  let actualOutputTotal = 0; let idealOutputTotal = 0;
  for (const m of hourly_metrics) {
    m.actual_minutes = productiveMinutesForHour(m.hour, screenshot_time);
    if (m.norm_per_hour != null && m.norm_per_hour > 0 && (m.actual_minutes ?? 0) > 0) {
      m.effective_norm = m.norm_per_hour * (m.actual_minutes ?? 0) / 60;
      if (m.actual_output != null) m.performance_pct = m.actual_output / m.effective_norm * 100;
      idealOutputTotal += m.effective_norm;
    } else {
      m.effective_norm = m.norm_per_hour != null && m.norm_per_hour > 0 ? 0 : null;
      if (m.actual_minutes === 0) m.performance_pct = null;
    }
    if (m.actual_output != null) actualOutputTotal += m.actual_output;
    if (m.performance_pct != null && m.availability_pct != null && m.capacity != null && m.operator_count > 0) m.actual_oee_pct = m.performance_pct * m.availability_pct * (m.capacity / m.operator_count) / 100;
  }
  const totalMinutes = hourly_metrics.reduce((sum, m) => sum + (m.actual_minutes ?? 0), 0);
  const actual_shift_performance_pct = averageWeighted(hourly_metrics, "performance_pct");
  const actual_shift_availability_pct = averageWeighted(hourly_metrics, "availability_pct");
  const weightedOee = hourly_metrics.reduce((sum, m) => sum + (m.actual_oee_pct ?? 0) * (m.actual_minutes ?? 0), 0);
  const oeeWeight = hourly_metrics.reduce((sum, m) => sum + (m.actual_oee_pct != null ? (m.actual_minutes ?? 0) : 0), 0);
  const actual_shift_oee_pct = oeeWeight > 0 ? weightedOee / oeeWeight : null;
  const predicted_shift_output = idealOutputTotal > 0 ? idealOutputTotal : null;
  return { hourly_metrics, predicted_shift_output, actual_shift_oee_pct, actual_shift_performance_pct, actual_shift_availability_pct, operator_count: data.context.operator_count, screenshot_time, shift: shiftFromScreenshotTime(screenshot_time), raw: JSON.stringify({ screenshot_time, actual_minutes_total: totalMinutes, actual_output_total: actualOutputTotal }) };
});
