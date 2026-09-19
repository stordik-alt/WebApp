import { createFileRoute, Link, Outlet, useRouterState } from "@tanstack/react-router";
import { Activity } from "lucide-react";
import { LiveBackground } from "@/components/interaktivni/LiveBackground";
import "@/components/interaktivni/interaktivni.css";

export const Route = createFileRoute("/interaktivni")({
  component: InteraktivniLayout,
});

const SUB_NAV = [
  { to: "/interaktivni/mapa", label: "Mapa haly" },
  { to: "/interaktivni/smena-vyroba", label: "Výroba směny" },
  { to: "/interaktivni/smena-obsazeni", label: "Obsazení směny" },
  { to: "/interaktivni/smena-historie", label: "Historie" },
  { to: "/interaktivni/tymy", label: "Týmy" },
  { to: "/interaktivni/pracoviste-mapa", label: "Editace mapy" },
] as const;

function LiveClock() {
  return (
    <span className="iw-mono flex items-center gap-1.5 text-[11px] text-white/50">
      <Activity className="h-3 w-3 text-[hsl(152_65%_52%)]" aria-hidden="true" />
      LIVE
    </span>
  );
}

/**
 * Vlastní vizuální identita Interaktivního prostředí - záměrně odlišná od
 * zbytku aplikace (viz Panel/StatusBadge/LiveBackground), aby TL na první
 * pohled poznal, že přešel z klasického reportingu do živého řízení haly.
 * Hlavní AppShell (nav, role, auth) zůstává beze změny - mění se jen obsah.
 */
function InteraktivniLayout() {
  const pathname = useRouterState({ select: (st) => st.location.pathname });
  return (
    <div className="iw-scope min-h-[calc(100vh-8rem)]">
      <LiveBackground />
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-white/10 pb-3">
        <nav className="flex flex-wrap gap-1">
          {SUB_NAV.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              className="iw-label rounded-lg px-3 py-2 text-white/55 transition-colors hover:bg-white/5 hover:text-white/85"
              activeProps={{ className: "iw-label rounded-lg bg-white/10 px-3 py-2 text-[hsl(152_65%_58%)] shadow-[inset_0_-2px_0_hsl(152_65%_52%)]" }}
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <LiveClock />
      </div>
      <div key={pathname} className="animate-in fade-in duration-300">
        <Outlet />
      </div>
    </div>
  );
}
