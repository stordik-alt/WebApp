import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type OcrProduct = { product_code: string; norm_per_hour: number | null; confidence: number };
export type OcrRow = {
  employee_name: string;
  position: "HA" | "TUP" | null;
  oee: number | null;
  performance: number | null;
  available_time: number | null;
  confidence: number;
};
export type OcrHourlyMetric = { hour: number | null; product_code: string | null; actual_output: number | null; performance_pct: number | null; availability_pct: number | null; norm_per_hour: number | null };
export type OcrStage = "products" | "employees" | "hourly";
export type OcrResult = { work_date: string | null; shift: string | null; line: string | null; product_code: string | null; norm_per_hour: number | null; products: OcrProduct[]; header_confidence: number; rows: OcrRow[]; hourly_metrics: OcrHourlyMetric[]; predicted_shift_output: number | null; productive_minutes: number | null; raw?: string };

const SHIFT_MINUTES = 8 * 60;
const START_PREP_MINUTES = 7;
const BREAK_MINUTES = 30;
const END_CLEANUP_MINUTES = 5;

const SHIFT_START_MINUTES: Record<string, number> = {
  "Ranní": 6 * 60,
  "Odpolední": 14 * 60,
  "Noční": 22 * 60,
};

function shiftForHour(hour: number | null): string {
  if (hour !== null) {
    const h = ((Math.trunc(hour) % 24) + 24) % 24;
    if (h >= 6 && h < 14) return "Ranní";
    if (h >= 14 && h < 22) return "Odpolední";
  }
  return "Noční";
}

function parseClockMinutes(value: unknown): number | null {
  const raw = text(value);
  const match = /(?:^|\s)(\d{1,2}):(\d{2})(?:\s|$)/.exec(raw);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return hour * 60 + minute;
}

function relativeMinuteOfShift(shift: string | null, absoluteMinute: number): number {
  const start = SHIFT_START_MINUTES[shift ?? ""] ?? SHIFT_START_MINUTES[shiftForHour(Math.floor(absoluteMinute / 60))];
  return (absoluteMinute - start + 1440) % 1440;
}

function productiveMinutesForHour(shiftValue: string | null, hourValue: number | null, screenshotTime?: unknown): number {
  if (hourValue === null) return 0;
  const shift = shiftValue && SHIFT_START_MINUTES[shiftValue] !== undefined ? shiftValue : shiftForHour(hourValue);
  const hour = ((Math.trunc(hourValue) % 24) + 24) % 24;
  const startAbsolute = hour * 60;
  const startRelative = relativeMinuteOfShift(shift, startAbsolute);
  const endRelative = startRelative + 60;
  const setupStart = 0;
  const setupEnd = START_PREP_MINUTES;
  const cleanupStart = SHIFT_MINUTES - END_CLEANUP_MINUTES;
  const cleanupEnd = SHIFT_MINUTES;

  let cutoff = SHIFT_MINUTES;
  const screenshotAbsolute = parseClockMinutes(screenshotTime);
  if (screenshotAbsolute !== null) {
    cutoff = Math.max(0, Math.min(SHIFT_MINUTES, relativeMinuteOfShift(shift, screenshotAbsolute)));
  }

  const productiveStart = startRelative;
  const productiveEnd = Math.min(endRelative, cutoff);
  if (productiveEnd <= productiveStart) return 0;

  let minutes = productiveEnd - productiveStart;
  const overlap = (aStart: number, aEnd: number, bStart: number, bEnd: number) =>
    Math.max(0, Math.min(aEnd, bEnd) - Math.max(aStart, bStart));

  minutes -= overlap(productiveStart, productiveEnd, setupStart, setupEnd);
  minutes -= overlap(productiveStart, productiveEnd, cleanupStart, cleanupEnd);

  const breakStart =
    shift === "Ranní" ? 4 * 60 + 40 :
    shift === "Odpolední" ? 4 * 60 :
    4 * 60;
  const breakEnd = breakStart + BREAK_MINUTES;
  minutes -= overlap(productiveStart, productiveEnd, breakStart, breakEnd);

  return Math.max(0, Math.min(60, Math.floor(minutes)));
}

const SYSTEM = `Jsi OCR/extrakční nástroj pro výrobní screenshoty z výroby DPS.
Musíš přečíst celý screenshot. Nezastavuj se u hlavičky ani u produktu.

Vrať pouze JSON. Screenshot typicky obsahuje:
- hlavičku: datum, směna, linka, produkt,
- tabulku pracovníků: jméno, pozice HA/TUP, OEE,
- hodinovou výrobní tabulku: produkt, hodina, reálný výstup, norma, Výkon, Dostupnost.

PRACOVNÍCI:
- Pro KAŽDÉHO skutečně viditelného pracovníka vrať jeden objekt v rows.
- Nejprve identifikuj všechny řádky tabulky pracovníků a potom čti hodnoty podle stejného řádku.
- Jméno vrať přesně, včetně diakritiky. Pokud jméno není čitelné, nehádej ho.
- Pokud je jméno čitelné, vrať pracovníka i když OEE není čitelné; OEE může být null.
- V této OCR sekvenci ČTI U PRACOVNÍKŮ POUZE jméno, pozici a OEE.
- Výkon ani Dostupnost z řádku pracovníka NEČTI, NEPOŽADUJ a NEVYPLŇUJ. Pro oba údaje vrať null.
- Výkon a Dostupnost pro denní záznam se získají výhradně ve 3. sekvenci z hodinové tabulky.
- Pokud pozice není čitelná, odvoď T_ => TUP a H_ => HA.
- Existence Product ID NESMÍ měnit ani filtrovat rows.

PRODUKTY A HODINY:
- Přečti hlavní produkt i všechny produkty z hodinové tabulky.
- Pro každý produkt urč normu ks/h, pokud je čitelná.
- actual_output je hodnota ze sloupce reálný.
- Výkon a Dostupnost hodinové tabulky jsou procenta.
- Hodinová norma v hourly_metrics je vždy null; skutečná norma se doplní z Product ID v aplikaci.

DALŠÍ:
- Procenta vracej jako čísla bez %.
- Desetinnou čárku převáděj na desetinnou tečku.
- Nevymýšlej hodnoty.
- Datum vrať jako YYYY-MM-DD.
- Pokud je na screenshotu viditelný čas pořízení/screenshotu, vrať jej jako screenshot_time ve formátu HH:mm.
- Směnu normalizuj na Ranní, Odpolední nebo Noční.
- Časové hranice směn jsou přesně: Ranní 06:00–14:00, Odpolední 14:00–22:00, Noční 22:00–06:00 následujícího dne.
- Přestávky jsou přesně: Ranní 10:40–11:10, Odpolední 18:00–18:30, Noční 02:00–02:30.
- Začátek přípravy linky je 7 minut na začátku směny a úklid 5 minut na konci směny.
- Vrať pouze JSON bez markdownu.

SCHÉMA:
{
  "work_date": "YYYY-MM-DD nebo null",
  "shift": "Ranní | Odpolední | Noční | null",
  "screenshot_time": "HH:mm nebo null",
  "line": "linka nebo null",
  "product_code": "hlavní produkt nebo null",
  "norm_per_hour": číslo nebo null,
  "products": [{"product_code":"kód","norm_per_hour":číslo nebo null,"confidence":0..1}],
  "header_confidence": 0..1,
  "rows": [{"employee_name":"jméno","position":"HA | TUP | null","oee":číslo nebo null,"performance":null,"available_time":null,"confidence":0..1}],
  "hourly_metrics": [{"hour":číslo nebo null,"product_code":"produkt nebo null","actual_output":číslo nebo null,"performance_pct":číslo nebo null,"availability_pct":číslo nebo null,"norm_per_hour":null}]
}`;

const WORKER_RETRY = `Udělěj SAMOSTATNÝ DRUHÝ PRŮCHOD stejného screenshotu.
Ignoruj hlavičku a soustřeď se pouze na TABULKU PRACOVNÍKŮ.

Pro KAŽDÝ viditelný řádek vrať pouze:
- employee_name: přesné jméno zaměstnance,
- position: HA/TUP, případně odvoď z H_/T_,
- oee: OEE přímo z tohoto řádku,
- confidence.

KRITICKÉ:
- Product ID je pouze kontext a nesmí ovlivnit rozpoznání pracovníků.
- Pokud je jméno čitelné, pracovníka VŽDY vrať.
- OEE může být null, pokud není čitelné.
- Výkon a Dostupnost v této sekvenci NEČTI a vždy vrať null.
- Neber hodnoty z hodinové výrobní tabulky místo hodnot pracovníka.
- Pokud je tabulka široká nebo je část sloupců méně čitelná, stále vrať všechny skutečně viditelné řádky.
- Pokud je vidět více pracovníků, vrať všechny.
- Vrať také product_code, line, work_date a shift, pokud jsou čitelné.
- Použij stejné JSON schéma jako v hlavním průchodu.`;

function toNum(v: unknown): number | null { if (v === null || v === undefined || v === "") return null; if (typeof v === "number") return Number.isFinite(v) ? v : null; let s = String(v).trim().replace(/\s/g, "").replace(/%/g, ""); if (s.includes(",")) s = s.replace(/\./g, "").replace(",", "."); else s = s.replace(/[^\d.\-]/g, ""); const n = Number(s); return Number.isFinite(n) ? n : null; }
function text(v: unknown): string { return String(v ?? "").trim(); }
function firstNum(obj: Record<string, unknown>, keys: string[]): number | null { for (const key of keys) { const n = toNum(obj[key]); if (n !== null) return n; } return null; }
function firstText(obj: Record<string, unknown>, keys: string[]): string { for (const key of keys) { const value = text(obj[key]); if (value) return value; } return ""; }
function avg(values: number[]): number | null { return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null; }
function rawRowsFrom(parsed: Record<string, unknown>): Record<string, unknown>[] { for (const key of ["rows", "employees", "workers", "employee_rows", "employeeRows", "worker_rows"]) if (Array.isArray(parsed[key])) return parsed[key] as Record<string, unknown>[]; return []; }
function workerName(row: Record<string, unknown>): string { return firstText(row, ["employee_name", "name", "employee", "worker_name", "worker", "jmeno", "jméno", "zamestnanec", "zaměstnanec", "pracovnik", "pracovník"]); }
function workerMetricCount(row: Record<string, unknown>): number { return [firstNum(row, ["oee", "oee_pct", "OEE"])].filter((v): v is number => v !== null).length; }
function workerScore(parsed: Record<string, unknown>): number { return rawRowsFrom(parsed).reduce((sum, row) => sum + (workerName(row) ? 10 + workerMetricCount(row) * 2 : 0), 0); }
function normalizeWorkerKey(value: string): string { return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(); }
function mergeWorkerRows(...groups: Record<string, unknown>[][]): Record<string, unknown>[] { const result: Record<string, unknown>[] = []; const byName = new Map<string, Record<string, unknown>>(); for (const group of groups) { for (const row of group) { const name = workerName(row); if (!name) continue; const key = normalizeWorkerKey(name); const existing = byName.get(key); if (!existing) { const copy = { ...row, employee_name: name, performance: null, available_time: null }; byName.set(key, copy); result.push(copy); continue; } existing.employee_name = name; if (firstNum(existing, ["oee", "oee_pct", "OEE"]) === null) { const value = firstNum(row, ["oee", "oee_pct", "OEE"]); if (value !== null) existing.oee = value; } if (!firstText(existing, ["position", "operation", "role", "pozice"])) { const position = firstText(row, ["position", "operation", "role", "pozice"]); if (position) existing.position = position; } if (firstNum(existing, ["confidence", "certainty", "jistota"]) === null) { const confidence = firstNum(row, ["confidence", "certainty", "jistota"]); if (confidence !== null) existing.confidence = confidence; } } } return result; }
function normalizeWorkDate(value: unknown): string | null { const raw = text(value); if (!raw) return null; const ymd = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(raw.slice(0, 10)); if (ymd) return `${ymd[1]}-${String(Number(ymd[2])).padStart(2, "0")}-${String(Number(ymd[3])).padStart(2, "0")}`; const dm = /^(\d{1,2})[.\-/](\d{1,2})/.exec(raw); if (dm) { const now = new Date(); return `${now.getFullYear()}-${String(Number(dm[2])).padStart(2, "0")}-${String(Number(dm[1])).padStart(2, "0")}`; } return null; }
function normalizeShift(value: unknown): string | null { const s = text(value).toLowerCase(); if (!s) return null; if (s.includes("rann") || s === "r" || s === "1") return "Ranní"; if (s.includes("odpo") || s === "o" || s === "2") return "Odpolední"; if (s.includes("noč") || s === "n" || s === "3") return "Noční"; return text(value); }
function actualOutputForHour(hour: Record<string, unknown>): number | null { const actual = firstNum(hour, ["actual_output", "actual", "realny", "real"]); if (actual !== null) return actual; const performance = firstNum(hour, ["performance_pct", "performance", "vykon", "výkon"]); const norm = firstNum(hour, ["norm_per_hour", "norm", "hourly_norm"]); return performance !== null && norm !== null ? norm * performance / 100 : null; }
function predictedShiftOutput(hourly: Record<string, unknown>[], shiftValue?: string | null, screenshotTime?: unknown): number | null { if (!hourly.length) return null; let total = 0; let used = 0; hourly.forEach((row) => { const norm = firstNum(row, ["norm_per_hour", "norm", "hourly_norm"]); const hour = firstNum(row, ["hour", "hodina"]); if (norm === null || norm <= 0 || hour === null) return; const minutes = productiveMinutesForHour(shiftValue ?? normalizeShift(row.shift), hour, screenshotTime); if (minutes <= 0) return; total += norm * minutes / 60; used += minutes; }); return used > 0 ? total : null; }
function normalizedPerformance(hourly: Record<string, unknown>[], shiftValue?: string | null, screenshotTime?: unknown): number | null { const expected = predictedShiftOutput(hourly, shiftValue, screenshotTime); if (expected === null || expected <= 0) return null; const actual = hourly.map(actualOutputForHour).filter((v): v is number => v !== null).reduce((a, b) => a + b, 0); return actual / expected * 100; }
function normalizeRows(parsed: Record<string, unknown>): OcrRow[] { const productCode = firstText(parsed, ["product_code", "product", "main_product"]); const inferredPosition: "HA" | "TUP" | null = /^T_/i.test(productCode) ? "TUP" : /^H_/i.test(productCode) ? "HA" : null; const globalOee = firstNum(parsed, ["line_oee", "oee", "shift_oee", "oee_pct"]); return rawRowsFrom(parsed).map((row) => { const product = firstText(row, ["product_code", "product"]) || productCode; const positionRaw = firstText(row, ["position", "operation", "role", "pozice"]); const position: "HA" | "TUP" | null = positionRaw === "HA" || positionRaw === "TUP" ? positionRaw : /^T_/i.test(product) ? "TUP" : /^H_/i.test(product) ? "HA" : inferredPosition; const name = workerName(row); return { employee_name: name, position, oee: firstNum(row, ["oee", "oee_pct", "OEE"]) ?? globalOee, performance: null, available_time: null, confidence: firstNum(row, ["confidence", "certainty", "jistota"]) ?? (name ? 0.8 : 0.3) }; }).filter((r) => r.employee_name.length > 0); }
function normalizeProducts(parsed: Record<string, unknown>): OcrProduct[] { const hourly = Array.isArray(parsed.hourly_metrics) ? parsed.hourly_metrics as Record<string, unknown>[] : []; const rawProducts = Array.isArray(parsed.products) ? parsed.products as Record<string, unknown>[] : []; const codes = new Set<string>(); const add = (v: unknown) => { const code = text(v); if (code) codes.add(code); }; add(parsed.product_code); add(parsed.product); add(parsed.main_product); hourly.forEach((h) => add(firstText(h, ["product_code", "product"]))); rawProducts.forEach((p) => add(firstText(p, ["product_code", "product", "code"]))); return Array.from(codes).map((code) => { const ai = rawProducts.find((p) => firstText(p, ["product_code", "product", "code"]) === code); const rows = hourly.filter((h) => firstText(h, ["product_code", "product"]) === code); const direct = rows.map((h) => firstNum(h, ["norm_per_hour", "norm", "hourly_norm"])).find((v): v is number => v !== null && v > 0); const fallback = rows.map((h) => { const norm = firstNum(h, ["norm_per_hour", "norm", "hourly_norm"]); const availability = firstNum(h, ["availability_pct", "availability", "dostupnost"]); return norm !== null && availability !== null && availability > 0 ? norm / availability * 100 : null; }).find((v): v is number => v !== null && v > 0); const aiNorm = ai ? firstNum(ai, ["norm_per_hour", "norm", "hourly_norm"]) : null; return { product_code: code, norm_per_hour: direct ?? fallback ?? aiNorm, confidence: ai ? (firstNum(ai, ["confidence", "certainty"]) ?? 0.85) : 0.7 }; }); }

type AiProvider = { kind: "openrouter" | "lovable"; url: string; model: string; headers: Record<string, string> };
function resolveAiProviders(): AiProvider[] { const providers: AiProvider[] = []; const openrouterKey = process.env.OPENROUTER_API_KEY; if (openrouterKey) providers.push({ kind: "openrouter", url: "https://openrouter.ai/api/v1/chat/completions", model: process.env.OPENROUTER_MODEL ?? "qwen/qwen3-vl-8b-instruct", headers: { "Content-Type": "application/json", Authorization: `Bearer ${openrouterKey}` } }); const lovableKey = process.env.LOVABLE_API_KEY; if (lovableKey) providers.push({ kind: "lovable", url: "https://ai.gateway.lovable.dev/v1/chat/completions", model: "google/gemini-3.6-flash", headers: { "Content-Type": "application/json", "Lovable-API-Key": lovableKey } }); if (!providers.length) throw new Error("Chybí konfigurace AI služby (OPENROUTER_API_KEY nebo LOVABLE_API_KEY). Rozpoznávání ze screenshotu není dostupné, ruční zadání funguje beze změny."); return providers; }
async function callAi(provider: AiProvider, imageDataUrl: string, instruction: string, system = SYSTEM): Promise<Record<string, unknown>> { let res: Response; try { res = await fetch(provider.url, { method: "POST", headers: provider.headers, body: JSON.stringify({ model: provider.model, temperature: 0, max_tokens: 7000, response_format: { type: "json_object" }, messages: [{ role: "system", content: system }, { role: "user", content: [{ type: "text", text: instruction }, { type: "image_url", image_url: { url: imageDataUrl } }] }] }) }); } catch (cause) { const detail = cause instanceof Error ? cause.message : String(cause); const error = new Error(`AI:síťová chyba:${detail}`); (error as Error & { status?: number }).status = undefined; throw error; } if (!res.ok) { const body = await res.text(); const error = new Error(`AI:${res.status}:${body.slice(0, 300)}`); (error as Error & { status?: number }).status = res.status; throw error; } const json = await res.json() as { choices?: { message?: { content?: string } }[] }; const content = json.choices?.[0]?.message?.content ?? ""; try { return JSON.parse(content.replace(/^```(?:json)?|```$/g, "").trim()) as Record<string, unknown>; } catch { throw new Error("AI vrátila neočekávanou JSON odpověď."); } }

const PRODUCT_STAGE_SYSTEM = `${SYSTEM}

TENTO PRŮCHOD JE VÝHRADNĚ PRO PRODUKTY.
Nečti zaměstnance ani jejich metriky.
1) Nejprve přečti všechny Product ID viditelné na screenshotu, zejména hlavní produkt a produkty v hodinové tabulce.
2) Pro každý produkt vrať jeho normu ks/h, pokud je čitelná nebo ji lze bezpečně určit z hodinových hodnot.
3) Vrať také datum, směnu a linku, pokud jsou čitelné.
4) I když Product ID vypadá jako již známé, vrať ho stejně. Databáze se porovnává až v aplikaci.
Vrať JSON podle společného schématu; rows musí být prázdné a hourly_metrics může být prázdné.
`;

const EMPLOYEE_STAGE_SYSTEM = `${SYSTEM}

TENTO PRŮCHOD JE VÝHRADNĚ PRO PRACOVNÍKY.
Product ID je pouze kontext. Existence produktu NESMÍ měnit výsledek.
1) Najdi tabulku pracovníků a vrať KAŽDÝ skutečně viditelný řádek.
2) Pro každý řádek vrať pouze přesné employee_name, position a OEE.
3) Pokud je jméno čitelné, vrať pracovníka i když OEE není čitelné; OEE může být null.
4) Výkon a Dostupnost v této sekvenci NEČTI, NEPOŽADUJ a vždy vrať null.
5) Neber hodnoty z hodinové tabulky místo hodnot pracovníka.
6) Vrať také datum, směnu, linku a hlavní Product ID, pokud jsou čitelné.
Vrať JSON podle společného schématu; products a hourly_metrics mohou být prázdné.
`;

const HOURLY_STAGE_SYSTEM = `${SYSTEM}

TENTO PRŮCHOD JE VÝHRADNĚ PRO HODINOVÁ DATA.
1) Najdi hodinovou výrobní tabulku.
2) Pro KAŽDOU skutečně viditelnou hodinu vrať product_code, actual_output (reálný výstup), performance_pct a availability_pct.
3) Normu hodinové výroby NEČTI jako zdroj denního záznamu – norma se po OCR doplní z databázového Product ID.
4) Nezaměňuj hodinovou tabulku s tabulkou pracovníků.
5) Datum, směnu a linku vrať, pokud jsou čitelné.
Vrať JSON podle společného schématu; rows musí být prázdné.
`;

const stageInstruction = (stage: OcrStage): string => {
  if (stage === "products") return "Proveď první průchod: pouze Product ID, jejich normy a hlavičku (datum, směna, linka). Neřeš zaměstnance ani hodinová data.";
  if (stage === "employees") return "Proveď druhý průchod: pouze zaměstnanci, jejich jména, pozice HA/TUP a OEE. Výkon a Dostupnost NEČTI a NEVYPLŇUJ.";
  return "Proveď třetí průchod: pouze hodinová výrobní data, reálný výstup, Výkon a Dostupnost. Hodinovou normu nečti – aplikace ji doplní z Product ID.";
};

async function runStage(stage: OcrStage, imageDataUrl: string): Promise<OcrResult> { const providers = resolveAiProviders(); const attempts: string[] = []; const parsedResults: Record<string, unknown>[] = []; let primary: Record<string, unknown> | null = null; let primaryProvider: AiProvider | null = null; const system = stage === "products" ? PRODUCT_STAGE_SYSTEM : stage === "employees" ? EMPLOYEE_STAGE_SYSTEM : HOURLY_STAGE_SYSTEM; for (const provider of providers) { try { primary = await callAi(provider, imageDataUrl, stageInstruction(stage), system); primaryProvider = provider; parsedResults.push(primary); break; } catch (e) { const error = e as Error & { status?: number }; attempts.push(`${provider.kind}:${error.status ?? "error"}`); if (error.status !== 402 && error.status !== 429 && error.status !== undefined) break; } } if (!primary || !primaryProvider) throw new Error(`AI služba je dočasně nedostupná (${attempts.join(" → ")}). Zkuste to prosím za chvíli.`); if (stage === "employees") { const workerProviders = [primaryProvider, ...providers.filter((p) => p !== primaryProvider)]; for (const provider of workerProviders) { try { const worker = await callAi(provider, imageDataUrl, WORKER_RETRY, EMPLOYEE_STAGE_SYSTEM); parsedResults.push(worker); if (rawRowsFrom(worker).some((r) => workerName(r))) break; } catch (e) { const error = e as Error & { status?: number }; attempts.push(`worker-${provider.kind}:${error.status ?? "error"}`); if (error.status !== 402 && error.status !== 429 && error.status !== undefined) break; } } } else if (stage === "products" && !normalizeProducts(primary).length && providers.length > 1) { const fallbackProvider = providers.find((p) => p !== primaryProvider); if (fallbackProvider) { try { const retry = await callAi(fallbackProvider, imageDataUrl, stageInstruction(stage), system); parsedResults.push(retry); } catch (e) { const error = e as Error & { status?: number }; attempts.push(`retry-${fallbackProvider.kind}:${error.status ?? "error"}`); } } }
  const base = parsedResults.reduce((best, current) => { const score = stage === "employees" ? workerScore(current) : stage === "products" ? normalizeProducts(current).length * 10 : (Array.isArray(current.hourly_metrics) ? current.hourly_metrics.length : 0); const bestScore = stage === "employees" ? workerScore(best) : stage === "products" ? normalizeProducts(best).length * 10 : (Array.isArray(best.hourly_metrics) ? best.hourly_metrics.length : 0); return score > bestScore ? current : best; }, primary);
  const mergedRows = stage === "employees" ? mergeWorkerRows(...parsedResults.map(rawRowsFrom)) : [];
  const hourly = stage === "hourly" ? (parsedResults.map((p) => Array.isArray(p.hourly_metrics) ? p.hourly_metrics as Record<string, unknown>[] : []).sort((a, b) => b.length - a.length)[0] ?? []) : [];
  const mergedParsed: Record<string, unknown> = { ...base, rows: mergedRows, hourly_metrics: hourly, product_code: firstText(base, ["product_code", "product", "main_product"]) || parsedResults.map((p) => firstText(p, ["product_code", "product", "main_product"])).find(Boolean) || null, line: firstText(base, ["line", "line_code"]) || parsedResults.map((p) => firstText(p, ["line", "line_code"])).find(Boolean) || null, work_date: firstText(base, ["work_date", "date"]) || parsedResults.map((p) => firstText(p, ["work_date", "date"])).find(Boolean) || null, shift: base.shift ?? parsedResults.map((p) => p.shift).find(Boolean) ?? null };
  const rows = normalizeRows(mergedParsed); const products = normalizeProducts(mergedParsed);
  const hourlyMetrics: OcrHourlyMetric[] = hourly.map((h) => ({ hour: firstNum(h, ["hour", "hodina"]), product_code: firstText(h, ["product_code", "product"]) || null, actual_output: actualOutputForHour(h), performance_pct: firstNum(h, ["performance_pct", "performance", "vykon", "výkon"]), availability_pct: firstNum(h, ["availability_pct", "availability", "dostupnost", "dostupnost_pct"]), norm_per_hour: null }));
  return { work_date: normalizeWorkDate(firstText(mergedParsed, ["work_date", "date"])), shift: normalizeShift(mergedParsed.shift), line: firstText(mergedParsed, ["line", "line_code"]) || null, product_code: products[0]?.product_code ?? (firstText(mergedParsed, ["product_code", "product", "main_product"]) || null), norm_per_hour: products[0]?.norm_per_hour ?? firstNum(mergedParsed, ["norm_per_hour", "norm"]), products, header_confidence: Math.max(0, Math.min(1, firstNum(mergedParsed, ["header_confidence", "confidence"]) ?? 0.7)), rows, hourly_metrics: hourlyMetrics, predicted_shift_output: predictedShiftOutput(hourly, normalizeShift(mergedParsed.shift), firstText(mergedParsed, ["screenshot_time", "time", "čas"])), productive_minutes: hourly.length ? hourly.reduce((sum, row) => sum + productiveMinutesForHour(normalizeShift(mergedParsed.shift), firstNum(row, ["hour", "hodina"]), firstText(mergedParsed, ["screenshot_time", "time", "čas"])), 0) : null, raw: JSON.stringify({ ...mergedParsed, ocr_stage: stage, ocr_passes: parsedResults.length, ocr_attempts: attempts }) };
}

export const extractScreenshotStage = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth]).validator((input: { imageDataUrl: string; stage: OcrStage }) => { if (!input?.imageDataUrl?.startsWith("data:image/")) throw new Error("Neplatný obrázek."); if (!["products", "employees", "hourly"].includes(input.stage)) throw new Error("Neplatná OCR fáze."); return input; }).handler(async ({ data }) => runStage(data.stage, data.imageDataUrl));

export const extractDailyFromScreenshot = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth]).validator((input: { imageDataUrl: string }) => { if (!input?.imageDataUrl?.startsWith("data:image/")) throw new Error("Neplatný obrázek."); return input; }).handler(async ({ data }): Promise<OcrResult> => {
  const providers = resolveAiProviders(); const attempts: string[] = []; const parsedResults: Record<string, unknown>[] = []; let primary: Record<string, unknown> | null = null; let primaryProvider: AiProvider | null = null;
  for (const provider of providers) { try { primary = await callAi(provider, data.imageDataUrl, "Extrahuj kompletní screenshot. Nejprve najdi tabulku pracovníků a přečti jména, pozice a OEE. Výkon a Dostupnost pracovníků nečti; ty se získají ve 3. sekvenci z hodinové tabulky. Potom extrahuj hlavičku, produkty a hodinovou tabulku."); primaryProvider = provider; parsedResults.push(primary); break; } catch (e) { const error = e as Error & { status?: number }; attempts.push(`${provider.kind}:${error.status ?? "error"}`); if (error.status !== 402 && error.status !== 429 && error.status !== undefined) break; } }
  if (!primary || !primaryProvider) throw new Error(`AI služba je dočasně nedostupná (${attempts.join(" → ")}). Zkuste to prosím za chvíli.`);
  const workerProviders = [primaryProvider, ...providers.filter((p) => p !== primaryProvider)];
  for (const provider of workerProviders) { try { const worker = await callAi(provider, data.imageDataUrl, WORKER_RETRY); parsedResults.push(worker); if (rawRowsFrom(worker).some((r) => workerName(r))) break; } catch (e) { const error = e as Error & { status?: number }; attempts.push(`worker-${provider.kind}:${error.status ?? "error"}`); if (error.status !== 402 && error.status !== 429 && error.status !== undefined) break; } }
  const mergedRows = mergeWorkerRows(...parsedResults.map(rawRowsFrom)); const base = parsedResults.reduce((best, current) => workerScore(current) > workerScore(best) ? current : best, primary); const hourlyCandidates = parsedResults.map((p) => Array.isArray(p.hourly_metrics) ? p.hourly_metrics as Record<string, unknown>[] : []); const hourly = hourlyCandidates.find((h) => h.length) ?? [];
  const mergedParsed: Record<string, unknown> = { ...base, rows: mergedRows, product_code: firstText(base, ["product_code", "product", "main_product"]) || parsedResults.map((p) => firstText(p, ["product_code", "product", "main_product"])).find(Boolean) || null, line: firstText(base, ["line", "line_code"]) || parsedResults.map((p) => firstText(p, ["line", "line_code"])).find(Boolean) || null, work_date: firstText(base, ["work_date", "date"]) || parsedResults.map((p) => firstText(p, ["work_date", "date"])).find(Boolean) || null, shift: base.shift ?? parsedResults.map((p) => p.shift).find(Boolean) ?? null, hourly_metrics: hourly };
  const rows = normalizeRows(mergedParsed); const products = normalizeProducts(mergedParsed); const primaryProduct = products[0] ?? null; const productCode = primaryProduct?.product_code ?? (firstText(mergedParsed, ["product_code", "product", "main_product"]) || null);
  const detectedShift = normalizeShift(mergedParsed.shift); const screenshotTime = firstText(mergedParsed, ["screenshot_time", "time", "čas"]); const hourlyPerformance = normalizedPerformance(hourly, detectedShift, screenshotTime); const hourlyAvailability = avg(hourly.map((h) => firstNum(h, ["availability_pct", "availability", "dostupnost", "dostupny_cas", "dostupný čas"])).filter((v): v is number => v !== null));
  return { work_date: normalizeWorkDate(firstText(mergedParsed, ["work_date", "date"])), shift: normalizeShift(mergedParsed.shift), line: firstText(mergedParsed, ["line", "line_code"]) || null, product_code: productCode, norm_per_hour: primaryProduct?.norm_per_hour ?? firstNum(mergedParsed, ["norm_per_hour", "norm"]), products, header_confidence: Math.max(0, Math.min(1, firstNum(mergedParsed, ["header_confidence", "confidence"]) ?? 0.7)), rows, hourly_metrics: hourly.map((h) => ({ hour: firstNum(h, ["hour", "hodina"]), product_code: firstText(h, ["product_code", "product"]) || null, actual_output: actualOutputForHour(h), performance_pct: firstNum(h, ["performance_pct", "performance", "vykon", "výkon"]), availability_pct: firstNum(h, ["availability_pct", "availability", "dostupnost", "dostupnost_pct"]), norm_per_hour: firstNum(h, ["norm_per_hour", "norm", "hourly_norm"]) })), predicted_shift_output: predictedShiftOutput(hourly, detectedShift, screenshotTime), productive_minutes: hourly.length ? hourly.reduce((sum, row) => sum + productiveMinutesForHour(detectedShift, firstNum(row, ["hour", "hodina"]), screenshotTime), 0) : null, raw: JSON.stringify({ ...mergedParsed, ocr_passes: parsedResults.length, ocr_attempts: attempts, hourly_performance_fallback: hourlyPerformance, hourly_availability_fallback: hourlyAvailability }) };
});
