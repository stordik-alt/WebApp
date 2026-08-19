import { Link, useRouterState } from "@tanstack/react-router";
import { useState, type ReactNode } from "react";
import {
  LayoutDashboard,
  Users,
  ClipboardList,
  CalendarRange,
  FileBarChart,
  Activity,
  Trophy,
  Package,
  Menu,
  Ruler,
  AlertTriangle,
  Info,
  ShieldCheck,
  UserCog,
  LogOut,
  BarChart3,
} from "lucide-react";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { ResideoLogo } from "@/components/ResideoLogo";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/ThemeToggle";
import { useAuth, roleLabel, type AppRole } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";

const ALL: AppRole[] = ["admin", "team_leader", "operator"];
const STAFF: AppRole[] = ["admin", "team_leader"];

const NAV = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, roles: STAFF },
  { to: "/moje-vysledky", label: "Moje výsledky", icon: BarChart3, roles: ["operator" as AppRole] },
  { to: "/zamestnanci", label: "Zaměstnanci", icon: Users, roles: STAFF },
  { to: "/denni-data", label: "Denní data", icon: ClipboardList, roles: STAFF },
  { to: "/tydenni-data", label: "Týdenní data", icon: CalendarRange, roles: STAFF },
  { to: "/quality-alerty", label: "Quality Alerty", icon: AlertTriangle, roles: STAFF },
  { to: "/produkty", label: "Produkty / Normy", icon: Package, roles: STAFF },
  { to: "/premereni-norem", label: "Přeměření norem", icon: Ruler, roles: STAFF },
  { to: "/reporty", label: "Reporty", icon: FileBarChart, roles: STAFF },
  { to: "/analyza", label: "Analýza / IPI", icon: Activity, roles: STAFF },
  { to: "/zebricek", label: "Žebříček", icon: Trophy, roles: STAFF },
  { to: "/ke-schvaleni", label: "Ke schválení", icon: ShieldCheck, roles: ["admin" as AppRole] },
  { to: "/uzivatele", label: "Uživatelé", icon: UserCog, roles: ["admin" as AppRole] },
  { to: "/o-aplikaci", label: "O aplikaci", icon: Info, roles: ALL },
] as const;

function navFor(role: AppRole | null) {
  return NAV.filter((i) => (role ? (i.roles as readonly AppRole[]).includes(role) : false));
}

function NavList({ onNavigate }: { onNavigate?: () => void }) {
  const { role } = useAuth();
  return (
    <nav className="flex flex-1 flex-col gap-1 overflow-y-auto p-3">
      {navFor(role).map(({ to, label, icon: Icon }) => (
        <Link
          key={to}
          to={to}
          onClick={onNavigate}
          activeOptions={{ exact: to === "/" }}
          className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-sidebar-foreground/80 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
          activeProps={{
            className:
              "bg-sidebar-primary text-sidebar-primary-foreground hover:bg-sidebar-primary hover:text-sidebar-primary-foreground font-medium shadow-[0_8px_20px_-12px_oklch(0.58_0.21_27_/_0.9)]",
          }}
        >
          <Icon className="h-4 w-4" />
          {label}
        </Link>
      ))}
    </nav>
  );
}

function Brand() {
  return (
    <div className="border-b border-sidebar-border px-4 py-5">
      <ResideoLogo />
      <div className="mt-3 text-[11px] text-sidebar-foreground/50">
        Hodnocení pracovníků výroby
      </div>
      <UserBadge />
    </div>
  );
}

function UserBadge() {
  const { profile, role } = useAuth();
  const name = `${profile?.first_name ?? ""} ${profile?.last_name ?? ""}`.trim();
  return (
    <div className="mt-3 rounded-xl bg-sidebar-accent/60 px-3 py-2">
      <div className="truncate text-xs font-medium text-sidebar-foreground">
        {name || profile?.email || "Uživatel"}
      </div>
      <div className="text-[11px] text-sidebar-foreground/60">{roleLabel(role)}</div>
    </div>
  );
}

function SignOutButton() {
  return (
    <Button
      variant="outline"
      size="sm"
      className="w-full justify-start gap-2"
      onClick={() => void supabase.auth.signOut()}
    >
      <LogOut className="h-4 w-4" />
      Odhlásit se
    </Button>
  );
}

export function AppShell({
  title,
  subtitle,
  actions,
  children,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="flex min-h-screen bg-background">
      <aside className="hidden w-64 shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground lg:flex">
        <Brand />
        <NavList />
        <div className="grid gap-2 border-t border-sidebar-border p-3">
          <ThemeToggle />
          <SignOutButton />
        </div>
        <div className="px-5 pb-4 text-[11px] leading-relaxed text-sidebar-foreground/50">
          Interní nástroj. Data jsou uložena v cloudové databázi.
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="relative sticky top-0 z-40 border-b border-border bg-card/85 px-4 py-3 pr-14 backdrop-blur-md sm:px-6 sm:py-4 sm:pr-20">
          <ResideoLogo
            variant="dark"
            compact
            className="absolute right-3 top-3 shrink-0 sm:right-6 sm:top-4"
          />
          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-center gap-3">
              <Sheet open={open} onOpenChange={setOpen}>
                <SheetTrigger asChild>
                  <Button variant="outline" size="icon" className="rounded-xl lg:hidden" aria-label="Menu">
                    <Menu className="h-5 w-5" />
                  </Button>
                </SheetTrigger>
                <SheetContent
                  side="left"
                  className="w-64 border-sidebar-border bg-sidebar p-0 text-sidebar-foreground"
                >
                  <Brand />
                  <NavList onNavigate={() => setOpen(false)} />
                  <div className="grid gap-2 border-t border-sidebar-border p-3">
                    <ThemeToggle />
                    <SignOutButton />
                  </div>
                </SheetContent>
              </Sheet>
              <div className="min-w-0 flex-1">
                <h1 className="truncate text-base font-semibold tracking-tight text-foreground sm:text-lg">
                  {title}
                </h1>
                {subtitle ? (
                  <p className="mt-0.5 hidden text-sm text-muted-foreground sm:block">{subtitle}</p>
                ) : null}
              </div>
            </div>
            {actions ? (
              <div className="flex flex-wrap items-center gap-2">{actions}</div>
            ) : null}
          </div>
        </header>
        <main className="min-w-0 flex-1 p-4 pb-24 sm:p-6 lg:pb-6">
          <RouteGuard>{children}</RouteGuard>
        </main>
      </div>

      <BottomNav />
    </div>
  );
}

function RouteGuard({ children }: { children: ReactNode }) {
  const { role } = useAuth();
  const pathname = useRouterState({ select: (st) => st.location.pathname });
  const allowed = navFor(role).some(
    (i) => i.to === pathname || (i.to !== "/" && pathname.startsWith(i.to)),
  );
  const employeeDetailOk = role !== "operator" && pathname.startsWith("/zamestnanec/");
  if (allowed || employeeDetailOk || (role === "operator" && pathname.startsWith("/zamestnanec/"))) {
    return <>{children}</>;
  }
  return (
    <div className="rounded-xl border border-border bg-card p-6 text-sm text-muted-foreground">
      Pro tuto sekci nemáte oprávnění. Vaše úroveň přístupu: {roleLabel(role)}.
    </div>
  );
}

const BOTTOM_NAV = [
  { to: "/denni-data", label: "Denní", icon: ClipboardList, roles: STAFF },
  { to: "/tydenni-data", label: "Týdenní", icon: CalendarRange, roles: STAFF },
  { to: "/zamestnanci", label: "Zaměstnanci", icon: Users, roles: STAFF },
  { to: "/", label: "Dashboard", icon: LayoutDashboard, roles: STAFF },
  { to: "/moje-vysledky", label: "Moje výsledky", icon: BarChart3, roles: ["operator" as AppRole] },
  { to: "/o-aplikaci", label: "O aplikaci", icon: Info, roles: ["operator" as AppRole] },
] as const;

function BottomNav() {
  const { role } = useAuth();
  const items = BOTTOM_NAV.filter((i) =>
    role ? (i.roles as readonly AppRole[]).includes(role) : false,
  );
  if (items.length === 0) return null;
  return (
    <nav
      aria-label="Rychlá navigace"
      className="fixed inset-x-0 bottom-0 z-50 border-t border-border bg-card/95 backdrop-blur lg:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <ul className="grid" style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}>
        {items.map(({ to, label, icon: Icon }) => (
          <li key={to}>
            <Link
              to={to}
              activeOptions={{ exact: to === "/" }}
              className="flex min-h-14 flex-col items-center justify-center gap-1 px-1 py-2 text-[11px] text-muted-foreground transition-colors"
              activeProps={{ className: "text-primary font-medium" }}
            >
              <Icon className="h-5 w-5" />
              <span className="truncate">{label}</span>
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
