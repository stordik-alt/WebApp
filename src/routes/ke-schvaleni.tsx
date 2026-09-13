import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { useAuth } from "@/lib/auth";
import { Card } from "@/components/ui/card";
import { AccountApprovalQueue } from "@/components/AccountApprovalQueue";
import { ImportApprovalQueue } from "@/components/ImportApprovalQueue";

export const Route = createFileRoute("/ke-schvaleni")({
  head: () => ({ meta: [{ title: "Ke schválení – Výkonnost operátorů" }, { name: "description", content: "Kontrola a schvalování importů a nových účtů před zařazením do aplikace." }] }),
  component: ApprovalPage,
});

function ApprovalPage() {
  const { isAdmin } = useAuth();
  return <AppShell title="Ke schválení" subtitle="Importy, nové účty a záznamy čekající na kontrolu správce">
    {!isAdmin ? <Card className="p-6 text-center"><div className="text-base font-semibold">Přístup pouze pro správce</div><div className="mt-1 text-sm text-muted-foreground">Rozhodovat o importech, záznamech a účtech může pouze administrátor.</div></Card> : <div className="grid gap-6"><ImportApprovalQueue /><AccountApprovalQueue /></div>}
  </AppShell>;
}
