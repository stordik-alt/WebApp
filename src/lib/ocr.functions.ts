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
Ze screenshotu výrobní tabulky vrať POUZE JSON podle schématu níže.

DŮLEŽITÉ: Screenshoty mají typicky hlavičku s datem/časem, linkou, pracovníky, produktem a tabulku po hodinách. Sloupce mohou být:
Produkt | Hodina | reálný | norma | Výkon | Kvalita | Dostupnost | Odstávky | důvod.
Hodnoty Výkon a Dostupnost v jednotlivých hodinách jsou PROCENTA. OEE v hlavičce je celkové OEE linky/směny.

Schéma:
{
  "work_date": "YYYY-MM-DD nebo null",
  "shift": "Ranní | Odpolední | Noční | null",
  "line": "označení linky nebo null",
  "product_code": "kód/název výrobku nebo null",
  "norm_per_hour": číslo (ks/h, norma CELÉ HA linky) nebo null,
  "header_confidence": 0..1,
  "hourly_metrics": [
    {
      "hour": číslo nebo null,
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
      "performance": číslo v % – PRŮMĚR ZA CELOU SMĚNU nebo null,
      "available_time": číslo v % – PRŮMĚR DOSTUPNOSTI ZA CELOU SMĚNU nebo null,
      "confidence": 0..1
    }
  ]
}

PRAVIDLA PRO SMĚNOVÉ PRŮMĚRY:
- Z každého skutečného hodinového řádku přečti Výkon (%) a Dostupnost (%).
- Do hourly_metrics vlož všechny skutečné hodinové řádky směny, které lze přečíst. Nezapisuj souhrnný řádek OEE jako hodinový řádek.
- Server následně vypočítá aritmetický průměr všech platných hodnot Výkon a Dostupnost za celou směnu. Tento výsledek použij jako performance a available_time u KAŽDÉHO pracovníka z daného screenshotu.
- Pokud je hodnota z některé hodiny nečitelná, dej ji null; průměr se počítá pouze z platných hodin.
- performance NENÍ počet kusů a available_time NENÍ počet minut. Obě hodnoty jsou procenta.
- Pro screenshot s hodinami 22,23,0,1,2,3,4,5 se počítá průměr ze všech těchto hodin, pokud jsou platné – první a poslední hodina se kvůli průměru NEVYNECHÁVAJÍ.

PRAVIDLA PRO NORMU:
- Norma je norma CELÉ HA linky v ks/h, ne norma jednoho pracovníka.
- Pokud je první nebo poslední hodinový řádek zjevně neúplný, jeho normu nepoužívej jako jediný zdroj normy. Preferuj konzistentní normu z plných hodin uprostřed směny.

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
  if (s.includes(",")) {
    s = s.replace(/\./g, "").replace(",", ".");
  } else {
    s = s.replace(/[^\d.\-]/g, "");
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function avg(values: number[]): number | null {
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
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
  if (!Number.isInteger(monthNum) || !Number.isInteger(dayNum) || monthNum < 1 || monthNum > 12 || dayNum < 1 || dayNum > 31) {
    return null;
  }
  // The screenshot format does not need a historical year when the year is not visible.
  // If the AI hallucinates a clearly implausible year for a current day/month, use the current year.
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
                  {
                    type: "text",
                    text: "Extrahuj všechny údaje z tohoto výrobního screenshotu. Zvlášť pečlivě přečti všechny hodinové řádky a vrať jejich Výkon a Dostupnost do hourly_metrics.",
                  },
                  { type: "image_url", image_url: { url: data.imageDataUrl } },
                ],
              },
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

    if (!res) {
      throw new Error(
        `AI služba je dočasně nedostupná (${attempts.join(" → ")}). Zkuste to prosím za chvíli.`,
      );
    }

    if (!res.ok) {
      const body = await res.text();
      if (res.status === 429) {
        throw new Error("AI služba je dočasně přetížená, zkuste to prosím za chvíli.");
      }
      if (res.status === 402) {
        throw new Error(
          "Vyčerpané AI kredity. Doplňte kredity (OpenRouter/Lovable) a zkuste znovu.",
        );
      }
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

    const hourlyRaw = Array.isArray(parsed["hourly_metrics"])
      ? (parsed["hourly_metrics"] as Record<string, unknown>[])
      : [];
    const performanceValues = hourlyRaw
      .map((h) => toNum(h["performance_pct"]))
      .filter((v): v is number => v !== null);
    const availabilityValues = hourlyRaw
      .map((h) => toNum(h["availability_pct"]))
      .filter((v): v is number => v !== null);

    const shiftPerformance =
      avg(performanceValues) ?? toNum(parsed["shift_performance_avg"]);
    const shiftAvailability =
      avg(availabilityValues) ?? toNum(parsed["shift_availability_avg"]);
    const lineOee = toNum(parsed["line_oee"]) ?? toNum(parsed["oee"]);

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
        oee: lineOee ?? toNum(r["oee"]),
        performance: shiftPerformance ?? toNum(r["performance"]),
        available_time: shiftAvailability ?? toNum(r["available_time"]),
        confidence: toNum(r["confidence"]) ?? 0.5,
      }))
      .filter((r) => r.employee_name.length > 0);

    const shiftRaw = parsed["shift"] ? String(parsed["shift"]) : null;
    const shift =
      shiftRaw && ["Ranní", "Odpolední", "Noční"].includes(shiftRaw) ? shiftRaw : shiftRaw;

    return {
      work_date: normalizeWorkDate(parsed["work_date"]),
      shift,
      line: parsed["line"] ? String(parsed["line"]) : null,
      product_code: parsed["product_code"] ? String(parsed["product_code"]) : null,
      norm_per_hour: toNum(parsed["norm_per_hour"]),
      header_confidence: toNum(parsed["header_confidence"]) ?? 0.5,
      rows,
    };
  });
