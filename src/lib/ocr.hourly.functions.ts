import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type ProductProfileContext = {
  id?: string;
  ha_subassy: string | null;
  h_capacity: number | null;
  h_norm_per_hour: number | null;
  tup_subassy: string | null;
  t_capacity: number | null;
  t_norm_per_hour: number | null;
};

export type HourlyStageContext = {
  profiles?: ProductProfileContext[];
  products?: Array<{ product_code: string; norm_per_hour: number | null; capacity: number | null }>;
  operator_count: number;
};

export type HourlyStageMetric = {
  hour: number | null;
  product_code: string | null;
  role: "HA" | "TUP" | null;
  actual_output: number | null;
  performance_pct: number | null;
  availability_pct: number | null;
  norm_per_hour: number | null;
  capacity: number | null;
  operator_count: number;
  actual_oee_pct: number | null;
};

export type HourlyStageResult = {
  hourly_metrics: HourlyStageMetric[];
  predicted_shift_output: number | null;
  actual_shift_oee_pct: number | null;
  operator_count: number;
  raw?: string;
};

type AiProvider = { url: string; model: string; headers: Record<string, string> };

function providers(): AiProvider[] {
  const result: AiProvider[] = [];
  const openrouterKey = process.env.OPENROUTER_API_KEY;
  if (openrouterKey) result.push({ url: "https://openrouter.ai/api/v1/chat/completions", model: process.env.OPENROUTER_MODEL ?? "qwen/qwen3-vl-8b-instruct", headers: { "Content-Type": "application/json", Authorization: `Bearer ${openrouterKey}` } });
  const lovableKey = process.env.LOVABLE_API_KEY;
  if (lovableKey) result.push({ url: "https://ai.gateway.lovable.dev/v1/chat/completions", model: "google/gemini-3.6-flash", headers: { "Content-Type": "application/json", "Lovable-API-Key": lovableKey } });
  if (!result.length) throw new Error("Chybí konfigurace AI služby (OPENROUTER_API_KEY nebo LOVABLE_API_KEY).");
  return result;
}

function num(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  let s = String(value).trim().replace(/\s/g, "").replace(/%/g, "");
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", "."); else s = s.replace(/[^\d.\-]/g, "");
  const n = Number(s); return Number.isFinite(n) ? n : null;
}
function text(value: unknown): string { return String(value ?? "").trim(); }
function firstNum(row: Record<string, unknown>, keys: string[]): number | null { for (const key of keys) { const value = num(row[key]); if (value !== null) return value; } return null; }
function firstText(row: Record<string, unknown>, keys: string[]): string { for (const key of keys) { const value = text(row[key]); if (value) return value; } return ""; }
function normalize(value: string | null): string { return (value ?? "").trim().toLowerCase(); }

function normalizedProfiles(context: HourlyStageContext): ProductProfileContext[] {
  if (context.profiles?.length) return context.profiles;
  return (context.products ?? []).map((p) => ({ id: p.product_code, ha_subassy: p.product_code, h_capacity: p.capacity, h_norm_per_hour: p.norm_per_hour, tup_subassy: null, t_capacity: null, t_norm_per_hour: null }));
}

async function loadExistingProfiles(context: HourlyStageContext): Promise<ProductProfileContext[]> {
  if (context.profiles?.length) return context.profiles;
  const codes = Array.from(new Set((context.products ?? []).map((p) => p.product_code.trim()).filter(Boolean)));
  if (!codes.length) return [];
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("product_profiles")
    .select("id,ha_subassy,h_capacity,h_norm_per_hour,tup_subassy,t_capacity,t_norm_per_hour")
    .or(codes.map((code) => `ha_subassy.eq.${code},tup_subassy.eq.${code}`).join(","));
  if (error) throw new Error(`Nepodařilo se načíst Product Profile: ${error.message}`);
  return (data ?? []) as ProductProfileContext[];
}

async function callAi(provider: AiProvider, imageDataUrl: string, context: HourlyStageContext): Promise<Record<string, unknown>> {
  const profiles = normalizedProfiles(context);
  const contextLines = profiles.map((p) => [
    `- profil ${p.id ?? ""}`,
    `HA/subassy=${p.ha_subassy ?? "NEZNÁMÁ"}, kapacita HA=${p.h_capacity ?? "NEZNÁMÁ"}, norma HA=${p.h_norm_per_hour ?? "NEZNÁMÁ"} ks/h`,
    `TUP/subassy=${p.tup_subassy ?? "NEZNÁMÁ"}, kapacita TUP=${p.t_capacity ?? "NEZNÁMÁ"}, norma TUP=${p.t_norm_per_hour ?? "NEZNÁMÁ"} ks/h`,
  ].join(" | ")).join("\n");
  const instruction = `Proveď 3. sekvenci OCR: přečti pouze hodinovou výrobní tabulku screenshotu.\n\nKONTEXT Z 1. A 2. SEKQUENCE – JE ZÁVAZNÝ:\n${contextLines || "- žádný produktový profil"}\n- skutečný počet operátorů na směně: ${context.operator_count}\n\nPřečti pro KAŽDOU skutečně viditelnou hodinu:\n- hour\n- product_code = skutečný kód/podsestava ze sloupce produktu\n- role = HA nebo TUP, pouze pokud je role/provoz na screenshotu čitelný; jinak null\n- actual_output = skutečný hodinový výstup linky ze sloupce Reálný\n- performance_pct a availability_pct pouze pokud jsou ve screenshotu čitelné\n\nNORMU ANI KAPACITU NEODVOZUJ ZE SCREENSHOTU. Pro výpočet použij výhradně existující Product Profile z databáze, případně profil předaný v kontextu 1. sekvence.\nPOČET OPERÁTORŮ VŽDY POUŽIJ VÝHRADNĚ Z 2. SEKQUENCE A PŘEDPOKLÁDEJ, ŽE SE BĚHEM SMĚNY NEMĚNÍ.\nPokud je stejná podsestava použita pro HA i TUP, nesmíš podle prefixu kódu rozhodnout roli; použij pouze skutečně čitelný kontext role.\n\nVrať pouze JSON. Nevymýšlej hodnoty.\nSkutečné OEE pak aplikace vypočítá přesně jako:\nOEE = (skutečný hodinový výstup / norma z Product Profile) * ((kapacita z Product Profile / skutečný počet operátorů) * 100)\nVýpočet se nesmí opírat o OCR výkon.`;
  const system = `Jsi třetí sekvence OCR pro výrobní screenshoty DPS. Čteš pouze hodinovou tabulku. Product Profile z 1. sekvence/databáze a počet operátorů z 2. sekvence jsou externí kontext a mají absolutní přednost. Vrať pouze JSON ve tvaru {"hourly_metrics":[{"hour":číslo nebo null,"product_code":"kód nebo null","role":"HA | TUP | null","actual_output":číslo nebo null,"performance_pct":číslo nebo null,"availability_pct":číslo nebo null}]}.`;
  const res = await fetch(provider.url, { method: "POST", headers: provider.headers, body: JSON.stringify({ model: provider.model, temperature: 0, max_tokens: 5000, response_format: { type: "json_object" }, messages: [{ role: "system", content: system }, { role: "user", content: [{ type: "text", text: instruction }, { type: "image_url", image_url: { url: imageDataUrl } }] }] }) });
  if (!res.ok) { const body = await res.text(); const error = new Error(`AI:${res.status}:${body.slice(0, 300)}`) as Error & { status?: number }; error.status = res.status; throw error; }
  const json = await res.json() as { choices?: { message?: { content?: string } }[] };
  const content = json.choices?.[0]?.message?.content ?? "";
  try { return JSON.parse(content.replace(/^```(?:json)?|```$/g, "").trim()) as Record<string, unknown>; } catch { throw new Error("AI vrátila neočekávanou JSON odpověď."); }
}

function rawHourly(parsed: Record<string, unknown>): Record<string, unknown>[] { for (const key of ["hourly_metrics", "hours", "hourly", "metrics"]) { if (Array.isArray(parsed[key])) return parsed[key] as Record<string, unknown>[]; } return []; }
function profileVariant(profile: ProductProfileContext, code: string | null, role: "HA" | "TUP" | null) {
  const codeNorm = normalize(code); const haMatch = normalize(profile.ha_subassy) === codeNorm; const tupMatch = normalize(profile.tup_subassy) === codeNorm;
  if (role === "HA" && haMatch) return { norm: profile.h_norm_per_hour, capacity: profile.h_capacity };
  if (role === "TUP" && tupMatch) return { norm: profile.t_norm_per_hour, capacity: profile.t_capacity };
  if (haMatch && !tupMatch) return { norm: profile.h_norm_per_hour, capacity: profile.h_capacity };
  if (tupMatch && !haMatch) return { norm: profile.t_norm_per_hour, capacity: profile.t_capacity };
  return null;
}
function findVariant(context: HourlyStageContext, code: string | null, role: "HA" | "TUP" | null) { for (const profile of normalizedProfiles(context)) { const variant = profileVariant(profile, code, role); if (variant) return variant; } return null; }
function actualOutput(row: Record<string, unknown>): number | null { return firstNum(row, ["actual_output", "actual", "realny", "real", "reálný"]); }
function normalizeRole(value: unknown): "HA" | "TUP" | null { const s = text(value).toLowerCase(); if (s === "ha" || s.includes("ha")) return "HA"; if (s === "tup" || s.includes("tup")) return "TUP"; return null; }
function effectiveWeights(count: number): number[] { if (count <= 0) return []; const weights = Array.from({ length: count }, () => 1); if (count === 1) { weights[0] = (8 * 60 - 10 - 30 - 5) / 60; return weights; } weights[0] -= 10 / 60; weights[count - 1] -= 5 / 60; if (count >= 3) weights[Math.floor(count / 2)] -= 30 / 60; return weights; }

export const extractHourlyWithContext = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: { imageDataUrl: string; context: HourlyStageContext }) => {
    if (!input?.imageDataUrl?.startsWith("data:image/")) throw new Error("Neplatný obrázek.");
    if (!input.context || !Number.isInteger(input.context.operator_count) || input.context.operator_count < 1) throw new Error("3. sekvence potřebuje skutečný počet operátorů z 2. sekvence.");
    if (!Array.isArray(input.context.profiles) && !Array.isArray(input.context.products)) throw new Error("3. sekvence potřebuje Product Profile nebo kontext z 1. sekvence.");
    return input;
  })
  .handler(async ({ data }): Promise<HourlyStageResult> => {
    const dbProfiles = await loadExistingProfiles(data.context);
    const resolvedContext: HourlyStageContext = { ...data.context, profiles: dbProfiles.length ? dbProfiles : data.context.profiles };
    if (!normalizedProfiles(resolvedContext).length) throw new Error("Pro rozpoznané Product ID nebyl nalezen žádný Product Profile s normou a kapacitou.");
    const attempts: string[] = []; let parsed: Record<string, unknown> | null = null;
    for (const provider of providers()) { try { parsed = await callAi(provider, data.imageDataUrl, resolvedContext); break; } catch (e) { const error = e as Error & { status?: number }; attempts.push(`${error.status ?? "error"}`); if (error.status !== 402 && error.status !== 429) break; } }
    if (!parsed) throw new Error(`AI služba je dočasně nedostupná (${attempts.join(" → ")}).`);
    const raw = rawHourly(parsed);
    const hourly_metrics: HourlyStageMetric[] = raw.map((row) => {
      const product_code = firstText(row, ["product_code", "product"]) || null;
      const role = normalizeRole(firstText(row, ["role", "position", "operation", "pozice"]));
      const variant = findVariant(resolvedContext, product_code, role); const norm_per_hour = variant?.norm ?? null; const capacity = variant?.capacity ?? null; const actual_output = actualOutput(row);
      const actual_oee_pct = actual_output !== null && norm_per_hour !== null && norm_per_hour > 0 && capacity !== null && capacity > 0 ? (actual_output / norm_per_hour) * ((capacity / data.context.operator_count) * 100) : null;
      return { hour: firstNum(row, ["hour", "hodina"]), product_code, role, actual_output, performance_pct: firstNum(row, ["performance_pct", "performance", "vykon", "výkon"]), availability_pct: firstNum(row, ["availability_pct", "availability", "dostupnost", "dostupnost_pct"]), norm_per_hour, capacity, operator_count: data.context.operator_count, actual_oee_pct };
    });
    const weights = effectiveWeights(hourly_metrics.length); let weightedActual = 0; let weightedExpected = 0; let weightedNorm = 0;
    hourly_metrics.forEach((metric, index) => { if (metric.actual_output === null || metric.norm_per_hour === null || metric.norm_per_hour <= 0) return; if (metric.capacity === null || metric.capacity <= 0) return; const weight = weights[index] ?? 1; const expectedAtCurrentStaffing = metric.norm_per_hour * (data.context.operator_count / metric.capacity); weightedActual += metric.actual_output * weight; weightedExpected += expectedAtCurrentStaffing * weight; weightedNorm += metric.norm_per_hour * weight; });
    const actual_shift_oee_pct = weightedExpected > 0 ? weightedActual / weightedExpected * 100 : null;
    const predicted_shift_output = weightedNorm > 0 ? weightedNorm : null;
    return { hourly_metrics, predicted_shift_output, actual_shift_oee_pct, operator_count: data.context.operator_count, raw: JSON.stringify({ ...parsed, stage: 3, context: resolvedContext, attempts }) };
  });
