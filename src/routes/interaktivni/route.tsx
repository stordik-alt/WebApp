import { createFileRoute, Link, Outlet, useRouterState } from "@tanstack/react-router";

export const Route = createFileRoute("/interaktivni")({
  component: InteraktivniLayout,
});

const SUB_NAV = [
  { to: "/interaktivni/mapa", label: "Mapa haly" },
  { to: "/interaktivni/smena-vyroba", label: "Výroba směny" },
  { to: "/interaktivni/smena-obsazeni", label: "Obsazení směny" },
  { to: "/interaktivni/tymy", label: "Týmy" },
  { to: "/interaktivni/pracoviste-mapa", label: "Editace mapy" },
] as const;

// # dělá: lokální sub-navigace modulu, odděleně od hlavního NAV v AppShell (viz EnvironmentSwitcher)
function InteraktivniLayout() {
  const pathname = useRouterState({ select: (st) => st.location.pathname });
  return (
    <div className="grid gap-3">
      <nav className="flex flex-wrap gap-2 border-b border-border pb-2">
        {SUB_NAV.map((item) => (
          <Link
            key={item.to}
            to={item.to}
            className="rounded-lg px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            activeProps={{ className: "rounded-lg bg-primary/10 px-3 py-1.5 text-sm font-semibold text-primary" }}
          >
            {item.label}
          </Link>
        ))}
      </nav>
      <div key={pathname}>
        <Outlet />
      </div>
    </div>
  );
}
