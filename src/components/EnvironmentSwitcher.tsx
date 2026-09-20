import { Link, useRouterState } from "@tanstack/react-router";
import { ArrowLeftRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth, type AppRole } from "@/lib/auth";

const ALLOWED_ROLES: AppRole[] = ["admin", "team_leader"];

/**
 * Přechod mezi "Sledování a hodnocení" a "Interaktivní prostředí". Aktuální prostředí se
 * odvozuje čistě z prefixu cesty (`/interaktivni/*`) - žádný uložený flag, žádný druhý
 * zdroj dat, přechod nikdy nic nezapisuje do databáze.
 */
export function EnvironmentSwitcher() {
  const { role } = useAuth();
  const pathname = useRouterState({ select: (st) => st.location.pathname });
  if (!role || !ALLOWED_ROLES.includes(role)) return null;

  const inInteraktivni = pathname.startsWith("/interaktivni");
  return (
    <Button asChild variant="outline" size="sm" className="h-10 w-full justify-start gap-3 rounded-xl px-3 py-2 text-sm">
      <Link to={inInteraktivni ? "/" : "/interaktivni"}>
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-sidebar-accent/45">
          <ArrowLeftRight className="h-4 w-4" />
        </span>
        <span>{inInteraktivni ? "Sledování a hodnocení" : "Výrobní linky a rotace"}</span>
      </Link>
    </Button>
  );
}
