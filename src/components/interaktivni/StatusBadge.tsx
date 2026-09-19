import { Badge } from "@/components/ui/badge";

/**
 * Stavy pracoviště dle zadání (sekce 14) - musí být rozlišitelné i bez barev,
 * proto má každý stav vlastní text/ikonu, ne jen barvu.
 */
export type WorkstationStatus = "full" | "under_capacity" | "no_operator" | "shortage" | "temp" | "secondary";

const CONFIG: Record<WorkstationStatus, { icon: string; label: (shortfall?: number) => string }> = {
  full: { icon: "🟢", label: () => "Plná kapacita" },
  under_capacity: { icon: "🟡", label: () => "Pod kapacitou" },
  no_operator: { icon: "🔴", label: () => "Bez operátora" },
  shortage: { icon: "⚠️", label: (n) => `Chybí ${n ?? "?"} operátorů`  },
  temp: { icon: "🔵", label: () => "Dočasní operátoři" },
  secondary: { icon: "⚪", label: () => "TESTY/PREP" },
};

export function StatusBadge({ status, shortfall }: { status: WorkstationStatus; shortfall?: number }) {
  const config = CONFIG[status];
  return (
    <Badge variant="outline" className="gap-1">
      <span aria-hidden="true">{config.icon}</span>
      <span>{config.label(shortfall)}</span>
    </Badge>
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
