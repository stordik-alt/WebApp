import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { HistoricalRecomputeManager } from "@/components/HistoricalRecomputeManager";

export const Route = createFileRoute("/hromadny-prepocet")({
  head: () => ({ meta: [
    { title: "Hromadný přepočet – Výkonnost operátorů" },
    { name: "description", content: "Bezpečný hromadný přepočet historických výrobních záznamů aktuální výpočtovou logikou, s náhledem před uložením." },
  ]}),
  component: HistoricalRecomputePage,
});

function HistoricalRecomputePage() {
  return (
    <AppShell title="Hromadný přepočet" subtitle="Přepočet existujících schválených záznamů aktuální výpočtovou logikou - vždy nejdřív náhled, teprve potom uložení.">
      <div className="grid min-w-0 gap-6">
        <HistoricalRecomputeManager />
      </div>
    </AppShell>
  );
}
