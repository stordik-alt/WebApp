import "./interaktivni.css";

/**
 * Stavy pracoviště dle zadání (sekce 14) - musí být rozlišitelné i bez barev,
 * proto má každý stav vlastní text/ikonu, ne jen barvu. Puls ("iw-pulse-dot")
 * navíc vizuálně odlišuje pracoviště, kde se PRÁVĚ TEĎ vyrábí (full/under/temp)
 * od klidových stavů (bez operátora, sekundární) - puls jen tam, kde reálně
 * něco běží.
 */
export type WorkstationStatus = "full" | "under_capacity" | "no_operator" | "shortage" | "temp" | "secondary";

const CONFIG: Record<WorkstationStatus, { icon: string; label: (shortfall?: number) => string; statusClass: string; live: boolean }> = {
  full: { icon: "🟢", label: () => "Plná kapacita", statusClass: "iw-status-full", live: true },
  under_capacity: { icon: "🟡", label: () => "Pod kapacitou", statusClass: "iw-status-under", live: true },
  no_operator: { icon: "🔴", label: () => "Bez operátora", statusClass: "iw-status-none", live: false },
  shortage: { icon: "⚠️", label: (n) => `Chybí ${n ?? "?"} operátorů`, statusClass: "iw-status-under", live: false },
  temp: { icon: "🔵", label: () => "Dočasní operátoři", statusClass: "iw-status-temp", live: true },
  secondary: { icon: "⚪", label: () => "TESTY/PREP", statusClass: "iw-status-secondary", live: false },
};

export function StatusBadge({ status, shortfall }: { status: WorkstationStatus; shortfall?: number }) {
  const config = CONFIG[status];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-muted/50 px-2 py-0.5 text-[11px] font-medium text-foreground/85 ${config.statusClass}`}>
      {config.live ? <span className="iw-pulse-dot" aria-hidden="true" /> : <span aria-hidden="true">{config.icon}</span>}
      <span>{config.label(shortfall)}</span>
    </span>
  );
}

// # dělá: odvodí vizuální stav pracoviště z designované kapacity a skutečně přiřazených operátorů
export function deriveWorkstationStatus(input: { designedCapacity: number; assignedCount: number; hasTemp: boolean; isSecondary: boolean }): WorkstationStatus {
  if (input.isSecondary) return "secondary";
  if (input.hasTemp) return "temp";
  if (input.assignedCount <= 0) return "no_operator";
  if (input.assignedCount < input.designedCapacity) return "under_capacity";
  return "full";
}
