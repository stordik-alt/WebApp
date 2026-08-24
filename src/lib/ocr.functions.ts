import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type OcrProduct = { product_code: string; norm_per_hour: number | null; confidence: number };
export type OcrRow = { employee_name: string; position: "HA" | "TUP" | null; oee: number | null; performance: number | null; available_time: number | null; confidence: number };
export type OcrResult = {
  work_date: string | null;
  shift: string | null;
  line: string | null;
  product_code: string | null;
  norm_per_hour: number | null;
  products: OcrProduct[];
  header_confidence: number;
  rows: OcrRow[];
  predicted_shift_output: number | null;
  productive_minutes: number | null;
  raw?: string;
};

const SHIFT_MINUTES = 8 * 60;
const START_PREP_MINUTES = 10;
const BREAK_MINUTES = 30;
const END_CLEANUP_MINUTES = 5;

const SYSTEM = `Jsi přesný OCR/extrakční nástroj pro výrobní screenshoty z výroby DPS.
Musíš přečíst CELÝ screenshot. Existence nebo neexistence Product ID v databázi NESMÍ nijak ovlivnit OCR.
Nejdůležitější je tabulka PRACOVNÍKŮ: pro KAŽDÉHO viditelného pracovníka vrať jeden řádek v rows.
Z každého řádku pracovníka čti přímo jeho jméno, pozici, OEE, Výkon a Dostupnost/Dostupný čas.
Nikdy nezahoď pracovníka jen proto, že některá hodnota není čitelná. Nečitelnou hodnotu vrať jako null.
Hodnoty pracovníka NESMÍŠ nahrazovat hodnotami z hodinové výrobní tabulky, pokud nejsou na řádku pracovníka.
Čti i hlavičku: datum, směnu, linku a produkt. Čti i hodinovou tabulku a všechny její produkty.
Jména zachovej přesně včetně diakritiky. Procenta vracej jako čísla bez znaku %.
Pokud pozice není čitelná, T_ produkt znamená TUP a H_ produkt znamená HA.
Vrať pouze JSON podle tohoto schématu:
{"work_date":"YYYY-MM-DD nebo null","shift":"Ranní | Odpolední | Noční | null","line":"string nebo null","product_code":"string nebo null","norm_per_hour":0,"products":[{"product_code":"string","norm_per_hour":0,"confidence":0.9}],"header_confidence":0.9,"rows":[{"employee_name":"jméno","position":"HA | TUP | null","oee":0,"performance":0,"available_time":0,"confidence":0.9}],"hourly_metrics":[{"hour":0,"product_code":"string","actual_output":0,"performance_pct":0,"availability_pct":0,"norm_per_hour":0}]}
U hodinové tabulky nehádej hodnoty. Norma při 100% dostupnosti může být přepočtena jako norm / dostupnost * 100. Vrať pouze JSON bez markdownu.`;

const WORKER_RETRY = `Druhý, SAMOSTATNÝ průchod stejného screenshotu. Ignoruj Product ID v databázi a soustřeď se pouze na TABULKU PRACOVNÍKŮ.
Najdi všechny viditelné řádky a vrať pro každý: employee_name, position, OEE, performance, available_time.
Čísla čti ze STEJNÉHO ŘÁDKU jako jméno; nepoužívej hodinovou výrobní tabulku jako náhradu.
Pokud je číslo nečitelné, vrať null, ale jméno vrať vždy. Zachovej všechna čísla a procenta.
Sloupce mohou být Jméno/Zaměstnanec, OEE, Výkon, Dostupný čas/Dostupnost.
Současně vrať product_code, line, work_date a shift. Vrať pouze JSON.`;

const WORKER_RETRY_2 = `Třetí kontrolní průchod screenshotem. Zaměř se výhradně na tabulku PRACOVNÍKŮ a proveď vizuální kontrolu každého řádku zleva doprava.
Pro každý řádek vrať employee_name, position, oee, performance a available_time. Neopisuj souhrn OEE ani hodinové hodnoty jako pracovníkovy údaje.
Pokud jsou hodnoty malé nebo těsně vedle sebe, zkontroluj jejich sloupce znovu. Vrať všechny pracovníky. Použij null jen pokud hodnotu opravdu nelze přečíst. Pouze JSON.`;

const normalizeKey = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "").trim();
const text = (v: unknown) => String(v ?? "").trim();

function toNum(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  let s = String(v).trim().replace(/\s/g, "").replace(/%/g, "");
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  else s = s.replace(/[^\d.\-]/g, "");
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function nestedObjects(obj: Record<string, unknown>): Record<string, unknown>[] {
  const result: Record<string, unknown>[] = [];
  for (const key of ["metrics", "metric", "stats", "statistics", "values", "data", "worker", "employee"]) {
    const value = obj[key];
    if (value && typeof value === "object" && !Array.isArray(value)) result.push(value as Record<string, unknown>);
  }
  return result;
}

function firstValue(obj: Record<string, unknown>, aliases: string[]): unknown {
  const wanted = aliases.map(normalizeKey);
  const sources = [obj, ...nestedObjects(obj)];
  for (const source of sources) {
    for (const alias of aliases) if (source[alias] !== undefined && source[alias] !== null && source[alias] !== "") return source[alias];
    for (const [key, value] of Object.entries(source)) {
      if (value === undefined || value === null || value === "") continue;
      const nk = normalizeKey(key);
      if (wanted.some((w) => nk === w || nk.startsWith(w) || w.startsWith(nk))) return value;
    }
  }
  return null;
}

function firstNum(obj: Record<string, unknown>, aliases: string[]): number | null { return toNum(firstValue(obj, aliases)); }
function firstText(obj: Record<string, unknown>, aliases: string[]): string { return text(firstValue(obj, aliases)); }
function avg(values: number[]): number | null { return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null; }

function rawRowsFrom(parsed: Record<string, unknown>): Record<string, unknown>[] {
  const candidates: unknown[] = [parsed.rows, parsed.employees, parsed.workers, parsed.employee_rows, parsed.employeeRows, parsed.worker_rows];
  for (const container of [parsed.data, parsed.result, parsed.output]) {
    if (container && typeof container === "object" && !Array.isArray(container)) {
      const c = container as Record<string, unknown>;
      candidates.push(c.rows, c.employees, c.workers, c.employee_rows, c.employeeRows, c.worker_rows);
    }
  }
  for (const candidate of candidates) if (Array.isArray(candidate)) return candidate.filter((x) => x && typeof x === "object") as Record<string, unknown>[];
  return [];
}

function workerName(row: Record<string, unknown>): string { return firstText(row, ["employee_name", "name", "employee", "worker_name", "worker", "jmeno", "jméno", "zamestnanec", "zaměstnanec", "pracovnik", "pracovník"]); }
function workerOee(row: Record<string, unknown>): number | null { return firstNum(row, ["oee", "oee_pct", "OEE", "oee_percent", "OEE %"]); }
function workerPerformance(row: Record<string, unknown>): number | null { return firstNum(row, ["performance", "performance_pct", "vykon", "výkon", "výkon", "performance_percent", "Výkon %"]); }
function workerAvailability(row: Record<string, unknown>): number | null { return firstNum(row, ["available_time", "availability", "availability_pct", "dostupnost", "dostupný čas", "dostupny_cas", "Dostupnost %"]); }
function workerPosition(row: Record<string, unknown>): "HA" | "TUP" | null {
  const p = firstText(row, ["position", "operation", "role", "pozice"]).toUpperCase();
  if (p === "HA" || p === "TUP") return p;
  const product = firstText(row, ["product_code", "product"]);
  return /^T_/i.test(product) ? "TUP" : /^H_/i.test(product) ? "HA" : null;
}

function normalizeWorkerKey(value: string): string { return normalizeKey(value); }
function workerComplete(parsed: Record<string, unknown>): boolean {
  const rows = rawRowsFrom(parsed).filter((r) => workerName(r));
  return rows.length > 0 && rows.every((r) => workerOee(r) !== null && workerPerformance(r) !== null && workerAvailability(r) !== null);
}

function mergeWorkerRows(primary: Record<string, unknown>[], retry: Record<string, unknown>[]): Record<string, unknown>[] {
  if (!primary.length) return retry;
  const byName = new Map<string, Record<string, unknown>>();
  for (const row of retry) { const name = workerName(row); if (name) byName.set(normalizeWorkerKey(name), row); }
  return primary.map((row, index) => {
    const extra = (workerName(row) && byName.get(normalizeWorkerKey(workerName(row)))) || retry[index];
    if (!extra) return row;
    return {
      ...extra,
      ...row,
      employee_name: workerName(row) || workerName(extra),
      oee: workerOee(row) ?? workerOee(extra),
      performance: workerPerformance(row) ?? workerPerformance(extra),
      available_time: workerAvailability(row) ?? workerAvailability(extra),
      position: workerPosition(row) ?? workerPosition(extra),
      confidence: firstNum(row, ["confidence", "certainty", "jistota"]) ?? firstNum(extra, ["confidence", "certainty", "jistota"]),
    };
  });
}

function normalizeShift(value: unknown): string | null {
  const s = text(value).toLowerCase();
  if (!s) return null;
  if (s.includes("rann") || s === "r" || s === "1") return "Ranní";
  if (s.includes("odpo") || s === "o" || s === "2") return "Odpolední";
  if (s.includes("noč") || s === "n" || s === "3") return "Noční";
  return text(value) || null;
}

function normalizeWorkDate(value: unknown): string | null {
  const raw = text(value); if (!raw) return null;
  const iso = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(raw);
  if (iso) return `${iso[1]}-${String(Number(iso[2])).padStart(2, "0")}-${String(Number(iso[3])).padStart(2, "0")}`;
  const dm = /^(\d{1,2})[.\-/](\d{1,2})/.exec(raw);
  if (dm) return `${new Date().getFullYear()}-${String(Number(dm[2])).padStart(2, "0")}-${String(Number(dm[1])).padStart(2, "0")}`;
  return null;
}

function effectiveHourWeights(count: number): number[] {
  if (!count) return [];
  const w = Array.from({ length: count }, () => 1);
  if (count === 1) { w[0] = (SHIFT_MINUTES - START_PREP_MINUTES - BREAK_MINUTES - END_CLEANUP_MINUTES) / 60; return w; }
  w[0] -= START_PREP_MINUTES / 60; w[count - 1] -= END_CLEANUP_MINUTES / 60;
  if (count >= 3) w[Math.floor(count / 2)] -= BREAK_MINUTES / 60;
  return w;
}

function predictedShiftOutput(hourly: Record<string, unknown>[]): number | null {
  if (!hourly.length) return null;
  const weights = effectiveHourWeights(hourly.length); let total = 0; let used = 0;
  hourly.forEach((h, i) => {
    const norm = firstNum(h, ["norm_per_hour", "norm", "hourly_norm"]);
    const availability = firstNum(h, ["availability_pct", "availability", "dostupnost", "dostupnost_pct"]);
    if (norm === null || availability === null || availability <= 0) return;
    const fullNorm = norm / (availability / 100);
    if (Number.isFinite(fullNorm) && fullNorm > 0) { total += fullNorm * weights[i]; used += weights[i]; }
  });
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
  const actual = hourly.map(actualOutputForHour).filter((x): x is number => x !== null).reduce((a, b) => a + b, 0);
  return (actual / expected) * 100;
}

function normalizeRows(parsed: Record<string, unknown>): OcrRow[] {
  const raw = rawRowsFrom(parsed);
  const hourly = Array.isArray(parsed.hourly_metrics) ? parsed.hourly_metrics as Record<string, unknown>[] : [];
  const globalOee = firstNum(parsed, ["line_oee", "oee", "shift_oee", "oee_pct"]);
  const productCode = firstText(parsed, ["product_code", "product", "main_product"]);
  const performanceFallback = normalizedPerformanceAtFullAvailability(hourly) ?? avg(hourly.map((h) => firstNum(h, ["performance_pct", "performance", "vykon", "výkon"])).filter((x): x is number => x !== null));
  const availabilityFallback = avg(hourly.map((h) => firstNum(h, ["availability_pct", "availability", "dostupnost", "dostupny_cas", "dostupný čas"])).filter((x): x is number => x !== null));
  return raw.map((row) => {
    const name = workerName(row); const position = workerPosition(row) ?? (/^T_/i.test(productCode) ? "TUP" : /^H_/i.test(productCode) ? "HA" : null);
    return { employee_name: name, position, oee: workerOee(row) ?? globalOee, performance: workerPerformance(row) ?? performanceFallback, available_time: workerAvailability(row) ?? availabilityFallback, confidence: firstNum(row, ["confidence", "certainty", "jistota"]) ?? (name ? 0.8 : 0.5) };
  }).filter((row) => row.employee_name.length > 0);
}

function normalizeProducts(parsed: Record<string, unknown>): OcrProduct[] {
  const hourly = Array.isArray(parsed.hourly_metrics) ? parsed.hourly_metrics as Record<string, unknown>[] : [];
  const rawProducts = Array.isArray(parsed.products) ? parsed.products as Record<string, unknown>[] : [];
  const codes = new Set<string>();
  const add = (v: unknown) => { const c = text(v); if (c) codes.add(c); };
  add(parsed.product_code); add(parsed.product); add(parsed.main_product);
  hourly.forEach((h) => add(firstText(h, ["product_code", "product"])));
  rawProducts.forEach((p) => add(firstText(p, ["product_code", "product", "code"])));
  return [...codes].map((code) => {
    const ai = rawProducts.find((p) => firstText(p, ["product_code", "product", "code"]) === code);
    const rows = hourly.filter((h) => firstText(h, ["product_code", "product"]) === code);
    const full = rows.map((h) => firstNum(h, ["norm_per_hour", "norm", "hourly_norm"])).find((v) => v !== null && firstNum(rows.find((x) => firstNum(x, ["norm_per_hour", "norm", "hourly_norm"]) === v) ?? {}, ["availability_pct", "availability", "dostupnost"]) === 100);
    const fallback = rows.map((h) => { const n = firstNum(h, ["norm_per_hour", "norm", "hourly_norm"]); const a = firstNum(h, ["availability_pct", "availability", "dostupnost"]); return n !== null && a !== null && a > 0 ? (n / a) * 100 : null; }).find((v): v is number => v !== null);
    return { product_code: code, norm_per_hour: full ?? fallback ?? (ai ? firstNum(ai, ["norm_per_hour", "norm", "hourly_norm"]) : null), confidence: ai ? firstNum(ai, ["confidence", "certainty"]) ?? 0.85 : 0.7 };
  });
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
  const json = await res.json() as { choices?: { message?: { content?: string } }[] };
  const content = json.choices?.[0]?.message?.content ?? "";
  try { return JSON.parse(content.replace(/^```(?:json)?|```$/g, "").trim()) as Record<string, unknown>; } catch { throw new Error("AI vrátila neočekávanou JSON odpověď."); }
}

export const extractDailyFromScreenshot = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: { imageDataUrl: string }) => { if (!input?.imageDataUrl?.startsWith("data:image/")) throw new Error("Neplatný obrázek."); return input; })
  .handler(async ({ data }): Promise<OcrResult> => {
    const providers = resolveAiProviders(); const attempts: string[] = []; let parsed: Record<string, unknown> | null = null; let providerUsed: AiProvider | null = null;
    for (const provider of providers) {
      try { parsed = await callAi(provider, data.imageDataUrl, "Extrahuj kompletní výrobní screenshot. Prioritně přečti všechny pracovníky a jejich hodnoty, potom hlavičku, produkt a hodinovou tabulku."); providerUsed = provider; break; }
      catch (e) { const error = e as Error & { status?: number }; attempts.push(`${provider.kind}:${error.status ?? "error"}`); if (error.status !== 402 && error.status !== 429) break; }
    }
    if (!parsed || !providerUsed) throw new Error(`AI služba je dočasně nedostupná (${attempts.join(" → ")}). Zkuste to prosím za chvíli.`);

    let workerPass = parsed;
    if (!workerComplete(parsed)) {
      try { const retry = await callAi(providerUsed, data.imageDataUrl, WORKER_RETRY); if (rawRowsFrom(retry).length) workerPass = { ...parsed, rows: mergeWorkerRows(rawRowsFrom(parsed), rawRowsFrom(retry)) }; } catch { /* first pass remains usable */ }
    }
    if (!workerComplete(workerPass)) {
      try { const retry2 = await callAi(providerUsed, data.imageDataUrl, WORKER_RETRY_2); if (rawRowsFrom(retry2).length) workerPass = { ...workerPass, rows: mergeWorkerRows(rawRowsFrom(workerPass), rawRowsFrom(retry2)) }; } catch { /* keep previous pass */ }
    }

    const hourly = Array.isArray(parsed.hourly_metrics) ? parsed.hourly_metrics as Record<string, unknown>[] : [];
    const products = normalizeProducts(parsed);
    const rows = normalizeRows(workerPass);
    const primary = products[0] ?? null;
    const headerProduct = firstText(parsed, ["product_code", "product", "main_product"]);
    return {
      work_date: normalizeWorkDate(firstText(parsed, ["work_date", "date"])),
      shift: normalizeShift(parsed.shift),
      line: firstText(parsed, ["line", "line_code"]) || null,
      product_code: primary?.product_code ?? (headerProduct || null),
      norm_per_hour: primary?.norm_per_hour ?? firstNum(parsed, ["norm_per_hour", "norm"]),
      products,
      header_confidence: firstNum(parsed, ["header_confidence", "confidence"]) ?? 0.7,
      rows,
      predicted_shift_output: predictedShiftOutput(hourly),
      productive_minutes: hourly.length >= 3 ? SHIFT_MINUTES - START_PREP_MINUTES - BREAK_MINUTES - END_CLEANUP_MINUTES : null,
      raw: JSON.stringify(workerPass),
    };
  });
