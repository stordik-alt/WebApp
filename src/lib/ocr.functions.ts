import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type OcrProduct = {
  product_code: string;
  norm_per_hour: number | null;
  confidence: number;
};

export type OcrRow = {
  employee_name: string;
  position: "HA" | "TUP" | null;
  oee: number | null;
  performance: number | null;
  available_time: number | null;
  confidence: number;
};

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

const SYSTEM = `Jsi extrakční nástroj pro výrobní data DPS (osazování plošných spojů).
Ze screenshotu výrobní tabulky vrať POUZE JSON podle schématu níže.

DŮLEŽITÉ: Screenshoty mají typicky hlavičku s datem/časem, linkou, pracovníky, produktem a tabulku po hodinách. Sloupce mohou být:
Produkt | Hodina | reálný | norma | Výkon | Kvalita | Dostupnost | Odstávky | důvod.
Hodnoty Výkon a Dostupnost v jednotlivých hodinách jsou PROCENTA. OEE v hlavičce je celkové OEE linky/směny.
Screenshot může obsahovat více produktů během jedné směny. Při výrobním přejezdu musíš zachytit KAŽDÝ produkt a jeho hodinovou normu.

Schéma:
{
  "work_date": "YYYY-MM-DD nebo null",
  "shift": "Ranní | Odpolední | Noční | null",
  "line": "označení linky nebo null",
  "product_code": "první/hlavní produkt nebo null",
  "norm_per_hour": číslo (ks/h, norma CELÉ HA linky) nebo null,
  "products": [
    {
      "product_code": "kód/název výrobku",
      "norm_per_hour": číslo v ks/h nebo null,
      "confidence": 0..1
    }
  ],
  "header_confidence": 0..1,
  "hourly_metrics": [
    {
      "hour": číslo nebo null,
      "product_code": "produkt platný v této hodině nebo null",
      "actual_output": číslo z pole reálný (ks) nebo null,
      "performance_pct": číslo v % nebo null,
      "availability_pct": číslo v % nebo null,
      "norm_per_hour": číslo nebo null
    }
  ],
  "rows": [
    {
      "employee_name": "jméno pracovníka",
      "position": "HA | TUP | null",
      "oee": číslo v % nebo null,
      "performance": číslo v % – výkon přepočtený na 100% dostupnost za celou směnu nebo null,
      "available_time": číslo v % – PRŮMĚR DOSTUPNOSTI ZA CELOU SMĚNU nebo null,
      "confidence": 0..1
    }
  ]
}

PRAVIDLA PRO SMĚNU A PŘEDPOKLÁDANÝ VÝSTUP:
- Jedna běžná směna má 8 hodin včetně 30minutové přestávky.
- Reálně plánovaný výrobní čas při 100% dostupnosti je 7 hodin 30 minut.
- Z první hodiny odečti 10 minut přípravy před zahájením výroby.
- Z poslední hodiny odečti 5 minut na ukončení výroby a úklid linky.
- Zbývá tedy 7 hodin 15 minut = 435 produktivních minut.
- Přibližně v polovině směny je 30minutová přestávka. Pokud jsou k dispozici běžné 8 hodinové řádky, odečti ji z prostředního hodinového řádku.
- Efektivní délky 8 hodinových řádků jsou tedy: 50, 60, 60, 60, 30, 60, 60, 55 minut.
- Pokud se během směny mění produkt nebo norma, předpokládaný výstup počítej pro každý hodinový řádek s jeho vlastní normou.
- Norma při 100% dostupnosti pro hodinu = zobrazená norma / (dostupnost / 100).
- Předpokládaný výstup směny = SUM(norma_100 × efektivní_délka_hodiny).
- Předpokládaný výstup je vždy pro 100% dostupnost a nezávisí na skutečném výkonu.
- `actual_output` je skutečný počet kusů ze sloupce reálný a musí být načten pro každý hodinový řádek, pokud je čitelný.

PRAVIDLA PRO VÝPOČET VÝKONU:
- Z každého skutečného hodinového řádku přečti reálný výstup (ks), Výkon (%), Dostupnost (%) a normu (ks/h).
- Norma uvedená ve screenshotu je hodinová norma po zohlednění dostupnosti. Pro výpočet normy při 100% dostupnosti ji přepočítej: norma_100 = norma / dostupnost * 100.
- Směnový výkon při 100% dostupnosti počítej jako SUM(skutečný výstup) / předpokládaný výstup směny * 100.
- Dostupnost se nepoužívá jako další penalizace výkonu – její vliv už je zahrnut v normě dané hodiny.
- Pokud `actual_output` není čitelný, můžeš jako zálohu použít zobrazenou normu × Výkon / 100, ale preferuj vždy hodnotu ze sloupce reálný.
- Pokud některá hodina nemá dost údajů pro výpočet, vynech ji. Nikdy nevymýšlej chybějící hodnotu.

PRAVIDLA PRO DOSTUPNOST:
- Do hourly_metrics vlož všechny skutečné hodinové řádky směny, které lze přečíst. Nezapisuj souhrnný řádek OEE jako hodinový řádek.
- available_time u pracovníků je aritmetický průměr platných hodinových Dostupností, protože zde jde o reportovanou dostupnost.
- Pokud je hodnota z některé hodiny nečitelná, dej ji null; průměr se počítá pouze z platných hodin.

PRAVIDLA PRO NORMU PRODUKTU:
- Norma je norma CELÉ HA linky v ks/h, ne norma jednoho pracovníka.
- Každý hodinový řádek musí mít pokud možno product_code odpovídající výrobě v dané hodině.
- Pro KAŽDÝ produkt samostatně hledej libovolný hodinový řádek, kde je Dostupnost přesně 100 %. Z tohoto řádku vezmi norm_per_hour.
- Pokud pro daný produkt žádná hodina s Dostupností 100 % neexistuje, server přepočítá použitelnou normu z dostupnosti na 100 % jako norm / dostupnost * 100.
- Pokud je pro produkt více 100% řádků, použij první platnou normu.
- Nezaměňuj normu jednoho produktu za normu jiného produktu při výrobním přejezdu.
- Pokud první nebo poslední hodinový řádek zjevně neobsahuje celý údaj, jeho normu nepoužívej jako jediný zdroj.

DALŠÍ PRAVIDLA:
- Nikdy si nevymýšlej hodnoty. Co nelze spolehlivě přečíst, dej null a sniž confidence.
- Desetinnou čárku převeď na tečku. Procenta vracej bez znaku %.
- Datum převeď do ISO (YYYY-MM-DD). Pokud screenshot obsahuje pouze den a měsíc bez roku, vrať datum s rokem aktuálního kalendářního roku. Nikdy neodhaduj historický rok.
- Směnu normalizuj: ranní/R/1 -> "Ranní", odpolední/O/2 -> "Odpolední", noční/N/3 -> "Noční".
- OEE z barevného/souhrnného pole v hlavičce je linkové OEE; pokud existuje, použij ho pro každého pracovníka.
- Jména pracovníků čti přesně, včetně diakritiky.
- Vrať pouze JSON bez komentářů a bez markdown bloku.`;

function toNum(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  let s = String(v).trim().replace(/\s/g, "").replace(/%/g, "");
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  else s = s.replace(/[^\d.\-]/g, "");
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function avg(values: number[]): number | null {
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function effectiveHourWeights(hourlyCount: number): number[] {
  if (hourlyCount <= 0) return [];
  const weights = Array.from({ length: hourlyCount }, () => 1);
  if (hourlyCount === 1) {
    weights[0] = (SHIFT_MINUTES - START_PREP_MINUTES - BREAK_MINUTES - END_CLEANUP_MINUTES) / 60;
    return weights;
  }
  weights[0] -= START_PREP_MINUTES / 60;
  weights[hourlyCount - 1] -= END_CLEANUP_MINUTES / 60;
  if (hourlyCount >= 3) {
    const middle = Math.floor(hourlyCount / 2);
    weights[middle] -= BREAK_MINUTES / 60;
  }
  return weights;
}

/**
 * Předpokládaný výstup při 100% dostupnosti a plánovaném výrobním čase.
 * U běžné osmihodinové směny: 50 + 60 + 60 + 60 + 30 + 60 + 60 + 55 = 435 min.
 */
function predictedShiftOutput(hourly: Record<string, unknown>[]): number | null {
  if (!hourly.length) return null;
  const weights = effectiveHourWeights(hourly.length);
  let total = 0;
  let used = 0;

  for (let i = 0; i < hourly.length; i += 1) {
    const hour = hourly[i];
    const displayedNorm = toNum(hour["norm_per_hour"]);
    const availability = toNum(hour["availability_pct"]);
    if (displayedNorm === null || availability === null || availability <= 0) continue;
    const fullNorm = displayedNorm / (availability / 100);
    if (!Number.isFinite(fullNorm) || fullNorm <= 0) continue;
    total += fullNorm * weights[i];
    used += weights[i];
  }

  return used > 0 ? total : null;
}

function actualOutputForHour(hour: Record<string, unknown>): number | null {
  const actual = toNum(hour["actual_output"]);
  if (actual !== null) return actual;
  const performance = toNum(hour["performance_pct"]);
  const displayedNorm = toNum(hour["norm_per_hour"]);
  if (performance === null || displayedNorm === null) return null;
  return displayedNorm * (performance / 100);
}

function normalizedPerformanceAtFullAvailability(hourly: Record<string, unknown>[]): number | null {
  const expected = predictedShiftOutput(hourly);
  if (expected === null || expected <= 0) return null;
  const actual = hourly.map(actualOutputForHour).filter((v): v is number => v !== null).reduce((sum, value) => sum + value, 0);
  return (actual / expected) * 100;
}

function normalizeWorkDate(value: unknown): string | null {
  if (!value) return null;
  const raw = String(value).trim().slice(0, 10);
  const match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(raw);
  if (!match) return null;
  const [, year, month, day] = match;
  const now = new Date();
  const currentYear = now.getFullYear();
  const monthNum = Number(month);
  const dayNum = Number(day);
  if (!Number.isInteger(monthNum) || !Number.isInteger(dayNum) || monthNum < 1 || monthNum > 12 || dayNum < 1 || dayNum > 31) return null;
  if (Number(year) !== currentYear && monthNum === now.getMonth() + 1 && dayNum === now.getDate()) {
    return `${currentYear}-${String(monthNum).padStart(2, "0")}-${String(dayNum).padStart(2, "0")}`;
  }
  return `${year}-${String(monthNum).padStart(2, "0")}-${String(dayNum).padStart(2, "0")}`;
}

type AiProvider = {
  kind: "openrouter" | "lovable";
  url: string;
  model: string;
  headers: Record<string, string>;
};

function resolveAiProviders(): AiProvider[] {
  const providers: AiProvider[] = [];
  const openrouterKey = process.env["OPENROUTER_API_KEY"];
  if (openrouterKey) {
    providers.push({
      kind: "openrouter",
      url: "https://openrouter.ai/api/v1/chat/completions",
      model: process.env["OPENROUTER_MODEL"] ?? "qwen/qwen3-vl-8b-instruct",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${openrouterKey}` },
    });
  }
  const lovableKey = process.env["LOVABLE_API_KEY"];
  if (lovableKey) {
    providers.push({
      kind: "lovable",
      url: "https://ai.gateway.lovable.dev/v1/chat/completions",
      model: "google/gemini-3.6-flash",
      headers: { "Content-Type": "application/json", "Lovable-API-Key": lovableKey },
    });
  }
  if (!providers.length) throw new Error("Chybí konfigurace AI služby (OPENROUTER_API_KEY nebo LOVABLE_API_KEY). Rozpoznávání ze screenshotu není dostupné, ruční zadání funguje beze změny.");
  return providers;
}

export const extractDailyFromScreenshot = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: { imageDataUrl: string }) => {
    if (!input?.imageDataUrl?.startsWith("data:image/")) throw new Error("Neplatný obrázek.");
    return input;
  })
  .handler(async ({ data }): Promise<OcrResult> => {
    const providers = resolveAiProviders();
    const attempts: string[] = [];
    let res: Response | undefined;
    for (const provider of providers) {
      try {
        res = await fetch(provider.url, {
          method: "POST",
          headers: provider.headers,
          body: JSON.stringify({
            model: provider.model,
            response_format: { type: "json_object" },
            messages: [
              { role: "system", content: SYSTEM },
              { role: "user", content: [
                { type: "text", text: "Extrahuj všechny údaje z tohoto výrobního screenshotu. Zvlášť pečlivě přečti všechny hodinové řádky, skutečný výstup ze sloupce reálný, všechny produkty, jejich Výkon, Dostupnost a hodinovou normu. Při přejezdu na jiný produkt zachovej product_code u každé hodiny." },
                { type: "image_url", image_url: { url: data.imageDataUrl } },
              ] },
            ],
          }),
        });
        if (res.ok || (res.status !== 402 && res.status !== 429)) break;
        attempts.push(`${provider.kind}:${res.status}`);
        res = undefined;
      } catch {
        attempts.push(`${provider.kind}:network`);
        res = undefined;
      }
    }
    if (!res) throw new Error(`AI služba je dočasně nedostupná (${attempts.join(" → ")}). Zkuste to prosím za chvíli.`);
    if (!res.ok) {
      const body = await res.text();
      if (res.status === 429) throw new Error("AI služba je dočasně přetížená, zkuste to prosím za chvíli.");
      if (res.status === 402) throw new Error("Vyčerpané AI kredity. Doplňte kredity (OpenRouter/Lovable) a zkuste znovu.");
      throw new Error(`Rozpoznávání selhalo (${res.status}): ${body.slice(0, 300)}`);
    }

    const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const content = json.choices?.[0]?.message?.content ?? "";
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(content.replace(/^```(?:json)?|```$/g, "").trim());
    } catch {
      throw new Error("AI vrátila neočekávanou odpověď. Zkuste jiný screenshot nebo zadejte ručně.");
    }

    const hourlyRaw = Array.isArray(parsed["hourly_metrics"]) ? parsed["hourly_metrics"] as Record<string, unknown>[] : [];
    const performanceValues = hourlyRaw.map((h) => toNum(h["performance_pct"])).filter((v): v is number => v !== null);
    const availabilityValues = hourlyRaw.map((h) => toNum(h["availability_pct"])).filter((v): v is number => v !== null);
    const shiftPerformance = normalizedPerformanceAtFullAvailability(hourlyRaw) ?? avg(performanceValues);
    const shiftAvailability = avg(availabilityValues) ?? toNum(parsed["shift_availability_avg"]);
    const lineOee = toNum(parsed["line_oee"]) ?? toNum(parsed["oee"]);
    const predictedOutput = predictedShiftOutput(hourlyRaw);

    const productCodes = new Set<string>();
    for (const h of hourlyRaw) {
      const code = String(h["product_code"] ?? "").trim();
      if (code) productCodes.add(code);
    }
    if (Array.isArray(parsed["products"])) {
      for (const p of parsed["products"] as Record<string, unknown>[]) {
        const code = String(p["product_code"] ?? "").trim();
        if (code) productCodes.add(code);
      }
    }
    const headerProduct = String(parsed["product_code"] ?? "").trim();
    if (headerProduct) productCodes.add(headerProduct);

    const rawProducts = Array.isArray(parsed["products"]) ? parsed["products"] as Record<string, unknown>[] : [];
    const products: OcrProduct[] = Array.from(productCodes).map((code) => {
      const aiProduct = rawProducts.find((p) => String(p["product_code"] ?? "").trim() === code);
      const rowsForProduct = hourlyRaw.filter((h) => String(h["product_code"] ?? "").trim() === code);
      const fullAvailabilityNorm = rowsForProduct
        .filter((h) => toNum(h["availability_pct"]) === 100)
        .map((h) => toNum(h["norm_per_hour"]))
        .find((v): v is number => v !== null);
      const fallback = rowsForProduct
        .map((h) => {
          const norm = toNum(h["norm_per_hour"]);
          const availability = toNum(h["availability_pct"]);
          if (norm === null || availability === null || availability <= 0) return null;
          return (norm / availability) * 100;
        })
        .find((v): v is number => v !== null);
      const aiNorm = aiProduct ? toNum(aiProduct["norm_per_hour"]) : null;
      const norm = fullAvailabilityNorm ?? fallback ?? aiNorm;
      return {
        product_code: code,
        norm_per_hour: norm,
        confidence: toNum(aiProduct?.["confidence"]) ?? (norm !== null ? 0.85 : 0.5),
      };
    });

    const primary = products[0] ?? null;
    const rawRows = Array.isArray(parsed["rows"]) ? parsed["rows"] as Record<string, unknown>[] : [];
    const rows: OcrRow[] = rawRows
      .map((r) => ({
        employee_name: String(r["employee_name"] ?? "").trim(),
        position: r["position"] === "HA" || r["position"] === "TUP" ? r["position"] as "HA" | "TUP" : null,
        oee: lineOee ?? toNum(r["oee"]),
        performance: shiftPerformance ?? toNum(r["performance"]),
        available_time: shiftAvailability ?? toNum(r["available_time"]),
        confidence: toNum(r["confidence"]) ?? 0.5,
      }))
      .filter((r) => r.employee_name.length > 0);

    const shiftRaw = parsed["shift"] ? String(parsed["shift"]) : null;
    return {
      work_date: normalizeWorkDate(parsed["work_date"]),
      shift: shiftRaw && ["Ranní", "Odpolední", "Noční"].includes(shiftRaw) ? shiftRaw : shiftRaw,
      line: parsed["line"] ? String(parsed["line"]) : null,
      product_code: primary?.product_code ?? (headerProduct || null),
      norm_per_hour: primary?.norm_per_hour ?? toNum(parsed["norm_per_hour"]),
      products,
      header_confidence: toNum(parsed["header_confidence"]) ?? 0.5,
      rows,
      predicted_shift_output: predictedOutput,
      productive_minutes: hourlyRaw.length >= 3 ? SHIFT_MINUTES - START_PREP_MINUTES - BREAK_MINUTES - END_CLEANUP_MINUTES : null,
    };
  });
