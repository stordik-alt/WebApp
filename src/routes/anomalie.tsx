import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { PerformanceAnomalyReport } from "@/components/PerformanceAnomalyReport";

export const Route = createFileRoute("/anomalie")({
  head: () => ({ meta: [
    { title: "Datové anomálie – Výkonnost operátorů" },
    { name: "description", content: "Kontrola záznamů s implausibilní hodnotou nebo výraznou odchylkou od vlastní historie zaměstnance." },
  ]}),
  component: AnomaliesPage,
});

function AnomaliesPage() {
  return (
    <AppShell title="Datové anomálie" subtitle="Záznamy, které stojí za ruční kontrolu - možná chyba OCR, ne automatický blokátor.">
      <div className="grid min-w-0 gap-6">
        <PerformanceAnomalyReport />
      </div>
    </AppShell>
  );
}
