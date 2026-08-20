import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

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
  header_confidence: number;
  rows: OcrRow[];
  raw?: string;
};

const SYSTEM = `Jsi extrakční nástroj pro výrobní data DPS (osazování plošných spojů).
Ze screenshotu (tabulka, výkaz, foto obrazovky) přečti dostupné údaje a vrať POUZE JSON.

Schéma:
{
  "work_date": "YYYY-MM-DD nebo null",
  "shift": "Ranní | Odpolední | Noční | null",
  "line": "označení linky nebo null",
  "product_code": "kód/název výrobku nebo null",
  "norm_per_hour": číslo (hodinová norma ks/h, norma CELÉ HA linky) nebo null,
  "header_confidence": 0..1,
  "rows": [
    {
      "employee_name": "jméno pracovníka",
      "position": "HA | TUP | null",
      "oee": číslo v % (může být >100) nebo null,
      "performance": číslo (výkon, ks) nebo null,
      "available_time": číslo (dostupný čas v minutách nebo hodinách, jak je uvedeno) nebo null,
      "confidence": 0..1
    }
  ]
}

Pravidla:
- Nikdy si nevymýšlej hodnoty. Co nelze spolehlivě přečíst, dej null a sniž confidence.
- Desetinnou čárku převeď na tečku. Procenta bez znaku %.
- Datum převeď do ISO (YYYY-MM-DD). Pokud chybí rok, použij aktuální.
- Směnu normalizuj: ranní/R/1 -> "Ranní", odpolední/O/2 -> "Odpolední", noční/N/3 -> "Noční".
- Vrať pouze JSON bez komentářů a bez markdown bloku.`;

function toNum(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n =
    typeof v === "number"
      ? v
      : Number(
          String(v)
            .replace(",", ".")
            .replace(/[^\d.\-]/g, ""),
        );
  return Number.isFinite(n) ? n : null;
}

type AiProvider = {
  kind: "openrouter" | "lovable";
  url: string;
  model: string;
  headers: Record<string, string>;
};

/** Fallback řetěz AI providerů pro OCR obrázků — zkouší se v pořadí, při chybě
 * vyčerpání kreditů/rate-limitu (402/429) nebo síťové chybě se přejde na dalšího.
 * OpenRouter: qwen/qwen3-vl-8b-instruct (lze přepsat přes OPENROUTER_MODEL). */
function resolveAiProviders(): AiProvider[] {
  const providers: AiProvider[] = [];
  const openrouterKey = process.env["OPENROUTER_API_KEY"];
  if (openrouterKey) {
    providers.push({
      kind: "openrouter",
      url: "https://openrouter.ai/api/v1/chat/completions",
      model: process.env["OPENROUTER_MODEL"] ?? "qwen/qwen3-vl-8b-instruct",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${openrouterKey}`,
      },
    });
  }
  const lovableKey = process.env["LOVABLE_API_KEY"];
  if (lovableKey) {
    providers.push({
      kind: "lovable",
      url: "https://ai.gateway.lovable.dev/v1/chat/completions",
      model: "google/gemini-3.6-flash",
      headers: {
        "Content-Type": "application/json",
        "Lovable-API-Key": lovableKey,
      },
    });
  }
  if (providers.length === 0) {
    throw new Error(
      "Chybí konfigurace AI služby (OPENROUTER_API_KEY nebo LOVABLE_API_KEY). Rozpoznávání ze screenshotu není dostupné, ruční zadání funguje beze změny.",
    );
  }
  return providers;
}

/**
 * Integrační vrstva pro OCR/vision. Používá Lovable AI Gateway (klíč je součástí projektu).
 * Vrací pouze NÁVRH – zápis do databáze provádí až uživatel po potvrzení v UI.
 */
export const extractDailyFromScreenshot = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: { imageDataUrl: string }) => {
    if (!input?.imageDataUrl?.startsWith("data:image/")) {
      throw new Error("Neplatný obrázek.");
    }
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
              {
                role: "user",
                content: [
                  { type: "text", text: "Extrahuj data z tohoto screenshotu." },
                  { type: "image_url", image_url: { url: data.imageDataUrl } },
                ],
              },
            ],
          }),
        });
        // 402/429 = vyčerpané kredity / rate-limit → zkus dalšího providera
        if (res.ok || (res.status !== 402 && res.status !== 429)) break;
        attempts.push(`${provider.kind}:${res.status}`);
        res = undefined;
      } catch {
        // síťová chyba / nedostupnost → zkus dalšího providera
        attempts.push(`${provider.kind}:network`);
        res = undefined;
      }
    }

    if (!res) {
      throw new Error(
        `AI služba je dočasně nedostupná (${attempts.join(" → ")}). Zkuste to prosím za chvíli.`,
      );
    }

    if (!res.ok) {
      const body = await res.text();
      if (res.status === 429)
        throw new Error("AI služba je dočasně přetížena, zkuste to prosím za chvíli.");
      if (res.status === 402)
        throw new Error(
          "Vyčerpané AI kredity. Doplňte kredity (OpenRouter/Lovable) a zkuste znovu.",
        );
      throw new Error(`Rozpoznávání selhalo (${res.status}): ${body.slice(0, 300)}`);
    }

    const json = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const content = json.choices?.[0]?.message?.content ?? "";
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(content.replace(/^```(?:json)?|```$/g, "").trim());
    } catch {
      throw new Error(
        "AI vrátila neočekávanou odpověď. Zkuste jiný screenshot nebo zadejte ručně.",
      );
    }

    const rawRows = Array.isArray(parsed["rows"])
      ? (parsed["rows"] as Record<string, unknown>[])
      : [];
    const rows: OcrRow[] = rawRows
      .map((r) => ({
        employee_name: String(r["employee_name"] ?? "").trim(),
        position:
          r["position"] === "HA" || r["position"] === "TUP"
            ? (r["position"] as "HA" | "TUP")
            : null,
        oee: toNum(r["oee"]),
        performance: toNum(r["performance"]),
        available_time: toNum(r["available_time"]),
        confidence: toNum(r["confidence"]) ?? 0.5,
      }))
      .filter((r) => r.employee_name.length > 0);

    const shiftRaw = parsed["shift"] ? String(parsed["shift"]) : null;
    const shift =
      shiftRaw && ["Ranní", "Odpolední", "Noční"].includes(shiftRaw) ? shiftRaw : shiftRaw;

    return {
      work_date: parsed["work_date"] ? String(parsed["work_date"]).slice(0, 10) : null,
      shift,
      line: parsed["line"] ? String(parsed["line"]) : null,
      product_code: parsed["product_code"] ? String(parsed["product_code"]) : null,
      norm_per_hour: toNum(parsed["norm_per_hour"]),
      header_confidence: toNum(parsed["header_confidence"]) ?? 0.5,
      rows,
    };
  });
