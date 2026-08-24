import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type OcrProduct = { product_code: string; norm_per_hour: number | null; confidence: number };
export type OcrRow = { employee_name: string; position: "HA" | "TUP" | null; oee: number | null; performance: number | null; available_time: number | null; confidence: number };
export type OcrResult = { work_date: string | null; shift: string | null; line: string | null; product_code: string | null; norm_per_hour: number | null; products: OcrProduct[]; header_confidence: number; rows: OcrRow[]; predicted_shift_output: number | null; productive_minutes: number | null; raw?: string };

const SHIFT_MINUTES = 8 * 60;
const START_PREP_MINUTES = 10;
const BREAK_MINUTES = 30;
const END_CLEANUP_MINUTES = 5;

const SYSTEM = `Jsi OCR/extrakční nástroj pro výrobní screenshoty z výroby DPS.
Musíš přečíst celý screenshot. Nezastavuj se u hlavičky ani u produktu. Nejvyšší priorita jsou ŘÁDKY PRACOVNÍKŮ a jejich hodnoty.

Vrať pouze JSON. Screenshot typicky obsahuje:
- hlavičku: datum, směna, linka, produkt,
- tabulku pracovníků: jméno, případně pozice HA/TUP, OEE, Výkon, Dostupný čas/Dostupnost,
- hodinovou výrobní tabulku: produkt, hodina, reálný výstup, norma, Výkon, Dostupnost.

KRITICKÉ PRAVIDLO PRO PRACOVNÍKY:
- Pro KAŽDÉHO viditelného pracovníka vytvoř jeden objekt v rows.
- Nejprve najdi celou tabulku pracovníků a teprve potom čti čísla ve stejném řádku.
- Jméno čti přesně tak, jak je na screenshotu, včetně diakritiky.
- Nikdy nevracej rows=[] jen proto, že některá hodnota chybí. Pokud je jméno čitelné, řádek vrať a nečitelnou hodnotu dej null.
- OEE, Výkon a Dostupnost pracovníka ber přednostně přímo z jeho řádku. Neber hodnotu z jiného pracovníka.
- Pokud je OEE zobrazené jen jako společné OEE linky/směny, můžeš ho použít pro každého pracovníka.
- Pokud pozice není explicitně čitelná, odvoď ji z produktu: T_ = TUP, H_ = HA.
- Produkt je pouze kontext. To, zda Product ID již existuje, je pro OCR úplně irelevantní. Nikdy neměň nebo nevynechávej rows podle Product ID.
- Rozlišuj desetinnou čárku a procenta. Procenta vracej jako číslo bez znaku %.

KRITICKÉ PRAVIDLO PRO PRODUKTY:
- Přečti hlavní produkt z hlavičky i všechny produkty z hodinové tabulky.
- Při změně produktu během směny zachovej každý product_code.
- Pro každý produkt urč normu ks/h. Preferuj hodinový řádek s Dostupností 100 %. Pokud není, lze normu přepočítat na 100 % dostupnost.

JSON SCHÉMA:
{
  "work_date": "YYYY-MM-DD nebo null",
  "shift": "Ranní | Odpolední | Noční | null",
  "line": "označení linky nebo null",
  "product_code": "hlavní produkt nebo null",
  "norm_per_hour": číslo ks/h nebo null,
  "products": [{"product_code":"kód","norm_per_hour":číslo,"confidence":0..1}],
  "header_confidence": 0..1,
  "rows": [{"employee_name":"jméno","position":"HA | TUP | null","oee":číslo v % nebo null,"performance":číslo v % nebo null,"available_time":číslo v % nebo null,"confidence":0..1}],
  "hourly_metrics": [{"hour":číslo nebo null,"product_code":"produkt nebo null","actual_output":číslo nebo null,"performance_pct":číslo nebo null,"availability_pct":číslo nebo null,"norm_per_hour":číslo nebo null}]
}

PRAVIDLA PRO HODINOVOU TABULKU:
- Přečti všechny skutečně viditelné hodinové řádky.
- actual_output je hodnota ze sloupce reálný.
- Výkon a Dostupnost jsou procenta.
- Norma je hodinová norma linky.
- Pokud je dostupnost 100 %, je to přímý zdroj normy produktu.
- Pokud dostupnost není 100 %, norma_100 = norma / dostupnost * 100.
- Nezaměňuj normu mezi H_ a T_ produktem.

DALŠÍ PRAVIDLA:
- Nevymýšlej hodnoty. Nečitelná hodnota = null.
- Datum převeď na YYYY-MM-DD; pokud screenshot obsahuje jen den/měsíc, použij aktuální rok.
- Směnu normalizuj na Ranní, Odpolední nebo Noční.
- Vrať pouze JSON bez markdownu.`;

const WORKER_RETRY = `Udělěj DRUHÝ, SAMOSTATNÝ a velmi pečlivý průchod stejným screenshotem. Tentokrát ignoruj hlavičku a soustřeď se výhradně na viditelnou TABULKU PRACOVNÍKŮ.

Najdi všechny řádky pracovníků a pro KAŽDÝ vrať:
1. employee_name / jméno,
2. position, pokud je čitelná, jinak ji odvoď z H_ => HA nebo T_ => TUP,
3. OEE ze stejného řádku,
4. Výkon ze stejného řádku,
5. Dostupný čas / Dostupnost ze stejného řádku.

KRITICKÉ:
- Produkt ani Product ID nesmí ovlivnit to, zda pracovníka vrátíš. I když je produkt známý/existující, pracovníci se musí vyčíst.
- Pokud je jméno čitelné, pracovníka VŽDY vrať. Jednotlivé nečitelné hodnoty mohou být null.
- Nevracej prázdné rows, pokud je na obrázku pracovní tabulka.
- Nezaměňuj hodnoty mezi řádky.
- Neber Výkon/Dostupnost z hodinové výrobní tabulky jako náhradu za hodnotu pracovníka, pokud nejsou přímo na řádku pracovníka.
- Zachovej desetinná čísla a procenta jako čísla bez znaku %.
- Pokud je vidět více pracovníků, vrať všechny.

Současně vrať product_code, line, work_date a shift, pokud jsou čitelné. Vrať pouze JSON ve stejném schématu.`;

function toNum(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  let s = String(v).trim().replace(/\s/g, "").replace(/%/g, "");
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  else s = s.replace(/[^\d.\-]/g, "");
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}
function text(v: unknown): string { return String(v ?? "").trim(); }
function firstNum(obj: Record<string, unknown>, keys: string[]): number | null { for (const key of keys) { const value = toNum(obj[key]); if (value !== null) return value; } return null; }
function firstText(obj: Record<string, unknown>, keys: string[]): string { for (const key of keys) { const value = text(obj[key]); if (value) return value; } return ""; }
function avg(values: number[]): number | null { return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null; }

function effectiveHourWeights(hourlyCount: number): number[] {
  if (hourlyCount <= 0) return [];
  const weights = Array.from({ length: hourlyCount }, () => 1);
  if (hourlyCount === 1) { weights[0] = (SHIFT_MINUTES - START_PREP_MINUTES - BREAK_MINUTES - END_CLEANUP_MINUTES) / 60; return weights; }
  weights[0] -= START_PREP_MINUTES / 60;
  weights[hourlyCount - 1] -= END_CLEANUP_MINUTES / 60;
  if (hourlyCount >= 3) weights[Math.floor(hourlyCount / 2)] -= BREAK_MINUTES / 60;
  return weights;
}
function predictedShiftOutput(hourly: Record<string, unknown>[]): number | null {
  if (!hourly.length) return null;
  const weights = effectiveHourWeights(hourly.length); let total = 0; let used = 0;
  for (let i = 0; i < hourly.length; i += 1) {
    const norm = firstNum(hourly[i], ["norm_per_hour", "norm", "hourly_norm"]);
    const availability = firstNum(hourly[i], ["availability_pct", "availability", "dostupnost", "dostupnost_pct"]);
    if (norm === null || availability === null || availability <= 0) continue;
    const fullNorm = norm / (availability / 100); if (!Number.isFinite(fullNorm) || fullNorm <= 0) continue;
    total += fullNorm * weights[i]; used += weights[i];
  }
  return used > 0 ? total : null;
}
function actualOutputForHour(hour: Record<string, unknown>): number | null {
  const actual = firstNum(hour, ["actual_output", "actual", "realny", "real"]); if (actual !== null) return actual;
  const performance = firstNum(hour, ["performance_pct", "performance", "vykon", "výkon"]);
  const norm = firstNum(hour, ["norm_per_hour", "norm", "hourly_norm"]);
  return performance !== null && norm !== null ? norm * (performance / 100) : null;
}
function normalizedPerformanceAtFullAvailability(hourly: Record<string, unknown>[]): number | null {
  const expected = predictedShiftOutput(hourly); if (expected === null || expected <= 0) return null;
  const actual = hourly.map(actualOutputForHour).filter((v): v is number => v !== null).reduce((sum, value) => sum + value, 0);
  return (actual / expected) * 100;
}
function normalizeWorkDate(value: unknown): string | null {
  const raw = text(value); if (!raw) return null;
  const match = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(raw.slice(0, 10));
  if (match) return `${match[1]}-${String(Number(match[2])).padStart(2, "0")}-${String(Number(match[3])).padStart(2, "0")}`;
  const dm = /^(\d{1,2})[.\-/](\d{1,2})/.exec(raw); if (dm) { const now = new Date(); return `${now.getFullYear()}-${String(Number(dm[2])).padStart(2, "0")}-${String(Number(dm[1])).padStart(2, "0")}`; }
  return null;
}

type AiProvider = { kind: "openrouter" | "lovable"; url: string; model: string; headers: Record<string, string> };
function resolveAiProviders(): AiProvider[] {
  const providers: AiProvider[] = [];
  const openrouterKey = process.env["OPENROUTER_API_KEY"];
  if (openrouterKey) providers.push({ kind: "openrouter", url: "https://openrouter.ai/api/v1/chat/completions", model: process.env["OPENROUTER_MODEL"] ?? "qwen/qwen3-vl-8b-instruct", headers: { "Content-Type": "application/json", Authorization: `Bearer ${openrouterKey}` } });
  const lovableKey = process.env["LOVABLE_API_KEY"];
  if (lovableKey) providers.push({ kind: "lovable", url: "https://ai.gateway.lovable.dev/v1/chat/completions", model: "google/gemini-3.6-flash", headers: { "Content-Type": "application/json", "Lovable-API-Key": lovableKey } });
  if (!providers.length) throw new Error("Chybí konfigurace AI služby (OPENROUTER_API_KEY nebo LOVABLE_API_KEY). Rozpoznávání ze screenshotu není dostupné, ruční zadání funguje beze změny.");
  return providers;
}

async function callAi(provider: AiProvider, imageDataUrl: string, instruction: string): Promise<Record<string, unknown>> {
  const res = await fetch(provider.url, { method: "POST", headers: provider.headers, body: JSON.stringify({ model: provider.model, temperature: 0, max_tokens: 7000, response_format: { type: "json_object" }, messages: [{ role: "system", content: SYSTEM }, { role: "user", content: [{ type: "text", text: instruction }, { type: "image_url", image_url: { url: imageDataUrl } }] }] }) });
  if (!res.ok) { const body = await res.text(); const error = new Error(`AI:${res.status}:${body.slice(0, 300)}`); (error as Error & { status?: number }).status = res.status; throw error; }
  const json = (await res.json()) as { choices?: { message?: { content?: string } }[] }; const content = json.choices?.[0]?.message?.content ?? "";
  try { return JSON.parse(content.replace(/^```(?:json)?|```$/g, "").trim()) as Record<string, unknown>; } catch { throw new Error("AI vrátila neočekávanou JSON odpověď."); }
}

function rawRowsFrom(parsed: Record<string, unknown>): Record<string, unknown>[] {
  const candidates = [parsed["rows"], parsed["employees"], parsed["workers"], parsed["employee_rows"], parsed["employeeRows"], parsed["worker_rows"]];
  for (const candidate of candidates) if (Array.isArray(candidate)) return candidate as Record<string, unknown>[];
  return [];
}
function workerName(row: Record<string, unknown>): string { return firstText(row, ["employee_name", "name", "employee", "worker_name", "worker", "jmeno", "jméno", "zamestnanec", "zaměstnanec", "pracovnik", "pracovník"]); }
function workerMetricsComplete(parsed: Record<string, unknown>): boolean {
  const rows = rawRowsFrom(parsed).filter((row) => workerName(row)); if (!rows.length) return false;
  return rows.every((row) => firstNum(row, ["oee", "oee_pct", "OEE"]) !== null && firstNum(row, ["performance", "performance_pct", "vykon", "výkon", "výkon"]) !== null && firstNum(row, ["available_time", "availability", "availability_pct", "dostupnost", "dostupny_cas", "dostupný čas"]) !== null);
}
function normalizeWorkerKey(value: string): string { return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(); }
function mergeWorkerRows(primary: Record<string, unknown>[], retry: Record<string, unknown>[]): Record<string, unknown>[] {
  const result: Record<string, unknown>[] = [];
  const byName = new Map<string, Record<string, unknown>>();
  const add = (row: Record<string, unknown>) => { const name = workerName(row); if (!name) return; const key = normalizeWorkerKey(name); const existing = byName.get(key); if (!existing) { const copy = { ...row }; byName.set(key, copy); result.push(copy); return; }
    existing.employee_name = name || workerName(existing);
    existing.oee = firstNum(row, ["oee", "oee_pct", "OEE"]) ?? firstNum(existing, ["oee", "oee_pct", "OEE"]);
    existing.performance = firstNum(row, ["performance", "performance_pct", "vykon", "výkon", "výkon"]) ?? firstNum(existing, ["performance", "performance_pct", "vykon", "výkon", "výkon"]);
    existing.available_time = firstNum(row, ["available_time", "availability", "availability_pct", "dostupnost", "dostupny_cas", "dostupný čas"]) ?? firstNum(existing, ["available_time", "availability", "availability_pct", "dostupnost", "dostupny_cas", "dostupný čas"]);
    existing.position = firstText(row, ["position", "operation", "role", "pozice"]) || firstText(existing, ["position", "operation", "role", "pozice"]);
    existing.confidence = firstNum(row, ["confidence", "certainty", "jistota"]) ?? firstNum(existing, ["confidence", "certainty", "jistota"]);
  };
  primary.forEach(add); retry.forEach(add); return result;
}
function normalizeShift(value: unknown): string | null { const s = text(value).toLowerCase(); if (!s) return null; if (s.includes("rann") || s === "r" || s === "1") return "Ranní"; if (s.includes("odpo") || s === "o" || s === "2") return "Odpolední"; if (s.includes("noč") || s === "n" || s === "3") return "Noční"; return text(value) || null; }

function normalizeRows(parsed: Record<string, unknown>): OcrRow[] {
  const rawRows = rawRowsFrom(parsed);
  const hourly = Array.isArray(parsed["hourly_metrics"]) ? parsed["hourly_metrics"] as Record<string, unknown>[] : [];
  const performanceFallback = normalizedPerformanceAtFullAvailability(hourly) ?? avg(hourly.map((h) => firstNum(h, ["performance_pct", "performance", "vykon", "výkon"])).filter((v): v is number => v !== null));
  const availabilityFallback = avg(hourly.map((h) => firstNum(h, ["availability_pct", "availability", "dostupnost", "dostupny_cas", "dostupný čas"])).filter((v): v is number => v !== null));
  const globalOee = firstNum(parsed, ["line_oee", "oee", "shift_oee", "oee_pct"]);
  const productCode = firstText(parsed, ["product_code", "product", "main_product"]);
  const inferredPosition: "HA" | "TUP" | null = /^T_/i.test(productCode) ? "TUP" : /^H_/i.test(productCode) ? "HA" : null;
  return rawRows.map((row) => {
    const name = workerName(row);
    const rowProduct = firstText(row, ["product_code", "product"]);
    const positionValue = firstText(row, ["position", "operation", "role", "pozice"]);
    const position: "HA" | "TUP" | null = positionValue === "HA" || positionValue === "TUP" ? positionValue : (/^T_/i.test(rowProduct || productCode) ? "TUP" : /^H_/i.test(rowProduct || productCode) ? "HA" : null);
    const oee = firstNum(row, ["oee", "oee_pct", "OEE"]) ?? globalOee;
    const performance = firstNum(row, ["performance", "performance_pct", "vykon", "výkon", "výkon"]) ?? performanceFallback;
    const available = firstNum(row, ["available_time", "availability", "availability_pct", "dostupnost", "dostupny_cas", "dostupný čas"]) ?? availabilityFallback;
    return { employee_name: name, position: position ?? inferredPosition, oee, performance, available_time: available, confidence: firstNum(row, ["confidence", "certainty", "jistota"]) ?? (name ? 0.8 : 0.5) };
  }).filter((row) => row.employee_name.length > 0);
}

function normalizeProducts(parsed: Record<string, unknown>): OcrProduct[] {
  const hourly = Array.isArray(parsed["hourly_metrics"]) ? parsed["hourly_metrics"] as Record<string, unknown>[] : [];
  const rawProducts = Array.isArray(parsed["products"]) ? parsed["products"] as Record<string, unknown>[] : [];
  const codes = new Set<string>(); const add = (value: unknown) => { const code = text(value); if (code) codes.add(code); };
  add(parsed["product_code"]); add(parsed["product"]); add(parsed["main_product"]); hourly.forEach((row) => add(firstText(row, ["product_code", "product"]))); rawProducts.forEach((product) => add(firstText(product, ["product_code", "product", "code"])));
  return Array.from(codes).map((code) => {
    const ai = rawProducts.find((p) => firstText(p, ["product_code", "product", "code"]) === code);
    const rows = hourly.filter((h) => firstText(h, ["product_code", "product"]) === code);
    const fullNorm = rows.filter((h) => firstNum(h, ["availability_pct", "availability", "dostupnost"]) === 100).map((h) => firstNum(h, ["norm_per_hour", "norm", "hourly_norm"])).find((v): v is number => v !== null);
    const fallbackNorm = rows.map((h) => { const norm = firstNum(h, ["norm_per_hour", "norm", "hourly_norm"]); const availability = firstNum(h, ["availability_pct", "availability", "dostupnost"]); return norm !== null && availability !== null && availability > 0 ? (norm / availability) * 100 : null; }).find((v): v is number => v !== null);
    const aiNorm = ai ? firstNum(ai, ["norm_per_hour", "norm", "hourly_norm"]) : null;
    return { product_code: code, norm_per_hour: fullNorm ?? fallbackNorm ?? aiNorm, confidence: ai ? (firstNum(ai, ["confidence", "certainty"]) ?? 0.85) : 0.7 };
  });
}

export const extractDailyFromScreenshot = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: { imageDataUrl: string }) => { if (!input?.imageDataUrl?.startsWith("data:image/")) throw new Error("Neplatný obrázek."); return input; })
  .handler(async ({ data }): Promise<OcrResult> => {
    const providers = resolveAiProviders(); const attempts: string[] = []; let parsed: Record<string, unknown> | null = null; let providerUsed: AiProvider | null = null;
    for (const provider of providers) {
      try {
        parsed = await callAi(provider, data.imageDataUrl, "Extrahuj kompletní výrobní screenshot. Nejprve identifikuj celou tabulku pracovníků a přečti každý její řádek včetně OEE, Výkonu a Dostupnosti. Potom přečti produkt a všechny hodinové údaje. Nevynechávej pracovníky kvůli tomu, že produkt v hlavičce vypadá známě nebo existuje.");
        providerUsed = provider; break;
      } catch (e) {
        const error = e as Error & { status?: number }; attempts.push(`${provider.kind}:${error.status ?? "error"}`); if (error.status !== 402 && error.status !== 429) break;
      }
    }
    if (!parsed || !providerUsed) throw new Error(`AI služba je dočasně nedostupná (${attempts.join(" → ")}). Zkuste to prosím za chvíli.`);

    if (!workerMetricsComplete(parsed)) {
      try {
        const retry = await callAi(providerUsed, data.imageDataUrl, WORKER_RETRY);
        const retryRows = rawRowsFrom(retry);
        const primaryRows = rawRowsFrom(parsed);
        if (retryRows.length) {
          parsed = {
            ...parsed,
            rows: mergeWorkerRows(primaryRows, retryRows),
            product_code: firstText(parsed, ["product_code", "product", "main_product"]) || firstText(retry, ["product_code", "product", "main_product"]),
            line: firstText(parsed, ["line", "line_code"]) || firstText(retry, ["line", "line_code"]),
            work_date: firstText(parsed, ["work_date", "date"]) || firstText(retry, ["work_date", "date"]),
            shift: parsed["shift"] ?? retry["shift"],
            hourly_metrics: Array.isArray(parsed["hourly_metrics"]) && (parsed["hourly_metrics"] as unknown[]).length ? parsed["hourly_metrics"] : retry["hourly_metrics"],
          };
        }
      } catch {
        // První průchod zůstává použitelný, pokud druhý průchod selže.
      }
    }

    const hourly = Array.isArray(parsed["hourly_metrics"]) ? parsed["hourly_metrics"] as Record<string, unknown>[] : [];
    const products = normalizeProducts(parsed); const rows = normalizeRows(parsed); const primary = products[0] ?? null; const headerProduct = firstText(parsed, ["product_code", "product", "main_product"]); const productCode = primary?.product_code ?? (headerProduct || null);
    return {
      work_date: normalizeWorkDate(firstText(parsed, ["work_date", "date"])),
      shift: normalizeShift(parsed["shift"]),
      line: firstText(parsed, ["line", "line_code"]) || null,
      product_code: productCode,
      norm_per_hour: primary?.norm_per_hour ?? firstNum(parsed, ["norm_per_hour", "norm"]),
      products,
      header_confidence: Math.max(0, Math.min(1, firstNum(parsed, ["header_confidence", "confidence"]) ?? 0.7)),
      rows,
      predicted_shift_output: predictedShiftOutput(hourly),
      productive_minutes: hourly.length >= 3 ? SHIFT_MINUTES - START_PREP_MINUTES - BREAK_MINUTES - END_CLEANUP_MINUTES : null,
      raw: JSON.stringify(parsed),
    };
  });