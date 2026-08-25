import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type HourlyStageContextProduct = {
  product_code: string;
  norm_per_hour: number | null;
  capacity: number | null;
};

export type HourlyStageContext = {
  products: HourlyStageContextProduct[];
  operator_count: number;
};

export type HourlyStageMetric = {
  hour: number | null;
  product_code: string | null;
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
  if (openrouterKey) result.push({
    url: "https://openrouter.ai/api/v1/chat/completions",
    model: process.env.OPENROUTER_MODEL ?? "qwen/qwen3-vl-8b-instruct",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${openrouterKey}` },
  });
  const lovableKey = process.env.LOVABLE_API_KEY;
  if (lovableKey) result.push({
    url: "https://ai.gateway.lovable.dev/v1/chat/completions",
    model: "google/gemini-3.6-flash",
    headers: { "Content-Type": "application/json", "Lovable-API-Key": lovableKey },
  });
  if (!result.length) throw new Error("Chybí konfigurace AI služby (OPENROUTER_API_KEY nebo LOVABLE_API_KEY).");
  return result;
}

function num(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  let s = String(value).trim().replace(/\s/g, "").replace(/%/g, "");
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  else s = s.replace(/[^\d.\-]/g, "");
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function text(value: unknown): string { return String(value ?? "").trim(); }

function firstNum(row: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const value = num(row[key]);
    if (value !== null) return value;
  }
  return null;
}

function firstText(row: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = text(row[key]);
    if (value) return value;
  }
  return "";
}

async function callAi(provider: AiProvider, imageDataUrl: string, context: HourlyStageContext): Promise<Record<string, unknown>> {
  const contextLines = context.products.map((p) =>
    `- Product ID ${p.product_code}: norma ${p.norm_per_hour ?? "NEZNÁMÁ"} ks/h, kapacita ${p.capacity ?? "NEZNÁMÁ"} operátorů`,
  ).join("\n");
  const instruction = `Proveď 3. sekvenci OCR: přečti pouze hodinovou výrobní tabulku screenshotu.

KONTEXT Z 1. A 2. SEKQUENCE – JE ZÁVAZNÝ:
${contextLines || "- žádný produktový kontext"}
- skutečný počet operátorů na směně: ${context.operator_count}

Přečti pro KAŽDOU skutečně viditelnou hodinu:
- hour
- product_code
- actual_output = skutečný hodinový výstup linky ze sloupce Reálný
- performance_pct a availability_pct pouze pokud jsou ve screenshotu čitelné

NORMU NEODVOZUJ ZE SCREENSHOTU. Norma pro výpočet musí být převzata výhradně z Product ID v kontextu výše.
KAPACITU MUSÍŠ VZÍT VÝHRADNĚ Z KONTEXTU 1. SEKVENCE.
POČET OPERÁTORŮ MUSÍŠ VZÍT VÝHRADNĚ Z KONTEXTU 2. SEKVENCE.
Po OCR vrať JSON. Nevymýšlej hodnoty.

Výpočet skutečného OEE pro každou hodinu provede aplikace podle:
OEE = (skutečný hodinový výstup / hodinová norma z Product ID) * ((kapacita Product ID / skutečný počet operátorů) * 100)
Tento výpočet nedělej odhadem z OCR výkonu. Použij skutečný actual_output.`;

  const system = `Jsi třetí sekvence OCR pro výrobní screenshoty DPS. Tvým úkolem je přesně přečíst hodinovou výrobní tabulku. Product ID, norma, kapacita a počet operátorů jsou předané jako externí kontext a mají přednost před jakoukoli hodnotou normy na screenshotu. Vrať pouze JSON ve tvaru {"hourly_metrics":[{"hour":číslo nebo null,"product_code":"kód nebo null","actual_output":číslo nebo null,"performance_pct":číslo nebo null,"availability_pct":číslo nebo null}]}.`;

  const res = await fetch(provider.url, {
    method: "POST",
    headers: provider.headers,
    body: JSON.stringify({
      model: provider.model,
      temperature: 0,
      max_tokens: 5000,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: [{ type: "text", text: instruction }, { type: "image_url", image_url: { url: imageDataUrl } }] },
      ],
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    const error = new Error(`AI:${res.status}:${body.slice(0, 300)}`) as Error & { status?: number };
    error.status = res.status;
    throw error;
  }
  const json = await res.json() as { choices?: { message?: { content?: string } }[] };
  const content = json.choices?.[0]?.message?.content ?? "";
  try {
    return JSON.parse(content.replace(/^```(?:json)?|```$/g, "").trim()) as Record<string, unknown>;
  } catch {
    throw new Error("AI vrátila neočekávanou JSON odpověď.");
  }
}

function rawHourly(parsed: Record<string, unknown>): Record<string, unknown>[] {
  for (const key of ["hourly_metrics", "hours", "hourly", "metrics"]) {
    if (Array.isArray(parsed[key])) return parsed[key] as Record<string, unknown>[];
  }
  return [];
}

function productContext(context: HourlyStageContext, code: string | null): HourlyStageContextProduct | null {
  const normalized = code?.trim().toLowerCase() ?? "";
  return context.products.find((p) => p.product_code.trim().toLowerCase() === normalized)
    ?? context.products[0]
    ?? null;
}

function actualOutput(row: Record<string, unknown>): number | null {
  return firstNum(row, ["actual_output", "actual", "realny", "real", "reálný"]);
}

function effectiveWeights(count: number): number[] {
  if (count <= 0) return [];
  const weights = Array.from({ length: count }, () => 1);
  if (count === 1) {
    weights[0] = (8 * 60 - 10 - 30 - 5) / 60;
    return weights;
  }
  weights[0] -= 10 / 60;
  weights[count - 1] -= 5 / 60;
  if (count >= 3) weights[Math.floor(count / 2)] -= 30 / 60;
  return weights;
}

export const extractHourlyWithContext = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: { imageDataUrl: string; context: HourlyStageContext }) => {
    if (!input?.imageDataUrl?.startsWith("data:image/")) throw new Error("Neplatný obrázek.");
    if (!input.context || !Number.isInteger(input.context.operator_count) || input.context.operator_count < 1) {
      throw new Error("3. sekvence potřebuje skutečný počet operátorů z 2. sekvence.");
    }
    if (!Array.isArray(input.context.products) || !input.context.products.length) {
      throw new Error("3. sekvence potřebuje normu a kapacitu z 1. sekvence.");
    }
    return input;
  })
  .handler(async ({ data }): Promise<HourlyStageResult> => {
    const attempts: string[] = [];
    let parsed: Record<string, unknown> | null = null;
    for (const provider of providers()) {
      try {
        parsed = await callAi(provider, data.imageDataUrl, data.context);
        break;
      } catch (e) {
        const error = e as Error & { status?: number };
        attempts.push(`${error.status ?? "error"}`);
        if (error.status !== 402 && error.status !== 429) break;
      }
    }
    if (!parsed) throw new Error(`AI služba je dočasně nedostupná (${attempts.join(" → ")}).`);

    const raw = rawHourly(parsed);
    const hourly_metrics: HourlyStageMetric[] = raw.map((row) => {
      const product_code = firstText(row, ["product_code", "product"]) || null;
      const product = productContext(data.context, product_code);
      const norm_per_hour = product?.norm_per_hour ?? null;
      const capacity = product?.capacity ?? null;
      const actual_output = actualOutput(row);
      const actual_oee_pct = actual_output !== null && norm_per_hour !== null && norm_per_hour > 0 && capacity !== null && capacity > 0
        ? actual_output / norm_per_hour * (capacity / data.context.operator_count) * 100
        : null;
      return {
        hour: firstNum(row, ["hour", "hodina"]),
        product_code,
        actual_output,
        performance_pct: firstNum(row, ["performance_pct", "performance", "vykon", "výkon"]),
        availability_pct: firstNum(row, ["availability_pct", "availability", "dostupnost", "dostupnost_pct"]),
        norm_per_hour,
        capacity,
        operator_count: data.context.operator_count,
        actual_oee_pct,
      };
    });

    const weights = effectiveWeights(hourly_metrics.length);
    let weightedActual = 0;
    let weightedNorm = 0;
    hourly_metrics.forEach((metric, index) => {
      if (metric.actual_output === null || metric.norm_per_hour === null || metric.norm_per_hour <= 0) return;
      const weight = weights[index] ?? 1;
      weightedActual += metric.actual_output * weight;
      weightedNorm += metric.norm_per_hour * weight;
    });
    const capacityFactor = hourly_metrics.find((m) => m.capacity !== null)?.capacity;
    const actual_shift_oee_pct = weightedNorm > 0 && capacityFactor !== undefined && capacityFactor !== null
      ? weightedActual / weightedNorm * (capacityFactor / data.context.operator_count) * 100
      : null;
    const predicted_shift_output = weightedNorm > 0 ? weightedNorm : null;

    return {
      hourly_metrics,
      predicted_shift_output,
      actual_shift_oee_pct,
      operator_count: data.context.operator_count,
      raw: JSON.stringify({ ...parsed, stage: 3, context: data.context, attempts }),
    };
  });
