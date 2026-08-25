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
export type OcrHourlyMetric = {
  hour: number | null;
  product_code: string | null;
  actual_output: number | null;
  performance_pct: number | null;
  availability_pct: number | null;
  norm_per_hour: number | null;
};
export type OcrStage = "products" | "employees" | "hourly";
export type OcrStageContext = {
  products?: OcrProduct[];
  rows?: OcrRow[];
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
  hourly_metrics: OcrHourlyMetric[];
  predicted_shift_output: number | null;
  productive_minutes: number | null;
  raw?: string;
};

// ... existing constants, helpers and prompts remain unchanged ...

const HOURLY_STAGE_SYSTEM = `${SYSTEM}

TENTO PRŮCHOD JE VÝHRADNĚ PRO HODINOVÁ DATA.
Před zpracováním screenshotu použij jako kontext výsledky prvních dvou průchodů.
1) Najdi hodinovou výrobní tabulku.
2) Pro KAŽDOU skutečně viditelnou hodinu vrať product_code, actual_output (reálný výstup), performance_pct a availability_pct.
3) Pokud je Product ID v kontextu z první sekvence, použij ho k jednoznačnému přiřazení hodinových řádků. Nevymýšlej ale Product ID, které není vidět ani v kontextu.
4) Normu hodinové výroby NEČTI jako zdroj denního záznamu – norma se po OCR doplní z databázového Product ID; pokud je norma dostupná v kontextu produktů, použij ji pouze jako referenční kontext.
5) Kontext zaměstnanců slouží k pochopení stejného screenshotu a směny; NEMĚŇ podle něj hodinové hodnoty a nekopíruj metriky pracovníků do hourly_metrics.
6) Datum, směnu a linku vrať, pokud jsou čitelné; pokud je předchozí průchod poskytl a screenshot je nečitelný, můžeš použít hodnotu z kontextu.
Vrať JSON podle společného schématu; rows musí být prázdné.
`;

function stageInstruction(stage: OcrStage, context?: OcrStageContext): string {
  if (stage === "products") return "Proveď první průchod: pouze Product ID, jejich normy a hlavičku (datum, směna, linka). Neřeš zaměstnance ani hodinová data.";
  if (stage === "employees") return "Proveď druhý průchod: pouze zaměstnanci a hodnoty z jejich řádků (OEE, Výkon, Dostupnost). Product ID ber jen jako kontext.";

  const productContext = context?.products?.length
    ? JSON.stringify(context.products)
    : "[]";
  const employeeContext = context?.rows?.length
    ? JSON.stringify(context.rows)
    : "[]";

  return `Proveď třetí průchod: pouze hodinová výrobní data, reálný výstup, Výkon a Dostupnost.

VÝSLEDKY PŘEDCHOZÍCH DVOU SEKVENCI:
PRODUCTS (1. sekvence): ${productContext}
EMPLOYEES (2. sekvence): ${employeeContext}

Tyto výsledky jsou pouze kontext z předchozích OCR průchodů stejného screenshotu. Použij je při identifikaci produktů a přiřazení hodin, ale hodnoty hodinové tabulky vždy ověřuj proti aktuálnímu screenshotu. Pokud se kontext a screenshot rozcházejí, screenshot má přednost.
Hodinovou normu nečti jako zdroj denního záznamu – aplikace ji doplní z Product ID.`;
}

async function runStage(stage: OcrStage, imageDataUrl: string, context?: OcrStageContext): Promise<OcrResult> {
  const providers = resolveAiProviders();
  const attempts: string[] = [];
  const parsedResults: Record<string, unknown>[] = [];
  let primary: Record<string, unknown> | null = null;
  let primaryProvider: AiProvider | null = null;
  const system = stage === "products" ? PRODUCT_STAGE_SYSTEM : stage === "employees" ? EMPLOYEE_STAGE_SYSTEM : HOURLY_STAGE_SYSTEM;

  for (const provider of providers) {
    try {
      primary = await callAi(provider, imageDataUrl, stageInstruction(stage, context), system);
      primaryProvider = provider;
      parsedResults.push(primary);
      break;
    } catch (e) {
      const error = e as Error & { status?: number };
      attempts.push(`${provider.kind}:${error.status ?? "error"}`);
      if (error.status !== 402 && error.status !== 429) break;
    }
  }
  if (!primary || !primaryProvider) {
    throw new Error(`AI služba je dočasně nedostupná (${attempts.join(" → ")}). Zkuste to prosím za chvíli.`);
  }

  // ... existing stage-specific retry/normalization logic remains unchanged ...
  throw new Error("UNCHANGED_REMAINDER");
}

// ... existing exported server functions remain unchanged ...
