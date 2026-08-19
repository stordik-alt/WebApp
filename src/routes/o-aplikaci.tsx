import { createFileRoute } from "@tanstack/react-router";
import { Info, ShieldCheck, Database, Mail, Tag } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const Route = createFileRoute("/o-aplikaci")({
  head: () => ({
    meta: [
      { title: "O aplikaci – Výkonnost operátorů" },
      {
        name: "description",
        content: "Informace o aplikaci Výkonnost operátorů: název, verze a kontaktní údaje správce.",
      },
      { property: "og:title", content: "O aplikaci – Výkonnost operátorů" },
      {
        property: "og:description",
        content: "Informace o aplikaci Výkonnost operátorů: název, verze a kontaktní údaje správce.",
      },
    ],
  }),
  component: AboutPage,
});

const APP_VERSION = "1.0.0";

function AboutPage() {
  return (
    <AppShell title="O aplikaci" subtitle="Informace o systému a kontakty">
      <div className="mx-auto max-w-3xl space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Info className="h-5 w-5 text-primary" />
              Přehled
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Row icon={Tag} label="Název aplikace" value="Výkonnost operátorů" />
            <Row icon={Tag} label="Verze" value={APP_VERSION} />
            <Row
              icon={Database}
              label="Úložiště dat"
              value="Cloudová databáze PostgreSQL (Lovable Cloud)"
            />
            <Row
              icon={ShieldCheck}
              label="Přístup"
              value="Interní nástroj – pouze pro správce (role admin)"
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Mail className="h-5 w-5 text-primary" />
              Správce systému
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Row label="Jméno" value="Jan Štorek" />
            <Row label="E-mail" value="jan.storek@resideo.com" />
            <Row label="Telefon" value="+420 000 000 000" />
            <p className="text-sm text-muted-foreground">
              V případě problémů, dotazů nebo žádostí o změny kontaktujte prosím správce.
            </p>
          </CardContent>
        </Card>

        <p className="text-center text-xs text-muted-foreground">
          © {new Date().getFullYear()} Resideo – Interní nástroj pro hodnocení pracovníků výroby DPS.
        </p>
      </div>
    </AppShell>
  );
}

function Row({
  icon: Icon,
  label,
  value,
}: {
  icon?: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-border/60 pb-3 last:border-0 last:pb-0">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        {Icon ? <Icon className="h-4 w-4 text-muted-foreground/70" /> : null}
        {label}
      </div>
      <div className="text-sm font-medium text-foreground">{value}</div>
    </div>
  );
}
