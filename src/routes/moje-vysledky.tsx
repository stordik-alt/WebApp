import { createFileRoute, Link } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";

export const Route = createFileRoute("/moje-vysledky")({
  head: () => ({
    meta: [
      { title: "Moje výsledky – Výkonnost operátorů" },
      {
        name: "description",
        content: "Osobní přehled výkonnosti operátora: OEE, Quality Score a výpomoc v čase.",
      },
      { property: "og:title", content: "Moje výsledky" },
      { property: "og:description", content: "Osobní přehled OEE, Quality Score a výpomoci." },
    ],
  }),
  component: MyResults,
});

function MyResults() {
  const { profile } = useAuth();

  return (
    <AppShell title="Moje výsledky" subtitle="Osobní přehled výkonnosti">
      {profile?.employee_id ? (
        <Card className="flex flex-col gap-3 p-6">
          <p className="text-sm text-muted-foreground">
            Váš účet je propojen s kartou zaměstnance. Otevřete si detailní přehled s grafy OEE,
            Quality Score a výpomoci.
          </p>
          <Button asChild className="w-fit">
            <Link to="/zamestnanec/$id" params={{ id: profile.employee_id }}>
              Otevřít moje výsledky
            </Link>
          </Button>
        </Card>
      ) : (
        <Card className="p-6 text-sm text-muted-foreground">
          Váš účet zatím není propojen s kartou zaměstnance. Požádejte prosím správce o propojení –
          poté zde uvidíte své výsledky.
        </Card>
      )}
    </AppShell>
  );
}
