import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { DowntimeReasonManager } from "@/components/DowntimeReasonManager";

export const Route = createFileRoute("/odstavky")({
  head: () => ({ meta: [
    { title: "Odstávky – Výkonnost operátorů" },
    { name: "description", content: "Klasifikace odstávek na Ovlivnitelné a Neovlivnitelné pro výpočet efektivního výrobního času." },
  ]}),
  component: DowntimeReasonsPage,
});

function DowntimeReasonsPage() {
  return (
    <AppShell title="Odstávky" subtitle="Seznam odstávek a jejich klasifikace pro TEFF výpočet efektivního výrobního času.">
      <div className="grid min-w-0 gap-6">
        <DowntimeReasonManager />
      </div>
    </AppShell>
  );
}
