import { Link, useRouterState } from "@tanstack/react-router";
import { useState, type ReactNode } from "react";
import { LayoutDashboard, Users, ClipboardList, CalendarRange, FileBarChart, Activity, Trophy, Package, Menu, Ruler, AlertTriangle, Info, ShieldCheck, UserCog, LogOut, BarChart3, Award, LineChart } from "lucide-react";
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
  { to: "/grafy", label: "Grafy", icon: LineChart, roles: STAFF },
  { to: "/analyza", label: "Analýza / IPI", icon: Activity, roles: STAFF },
  { to: "/hodnoceni", label: "Hodnocení handlerů", icon: Award, roles: STAFF },
  { to: "/zebricek", label: "Žebříček", icon: Trophy, roles: STAFF },
  { to: "/ke-schvaleni", label: "Ke schválení", icon: ShieldCheck, roles: ["admin" as AppRole] },
  { to: "/uzivatele", label: "Uživatelé", icon: UserCog, roles: ["admin" as AppRole] },
  { to: "/o-aplikaci", label: "O aplikaci", icon: Info, roles: ALL },
] as const;

function navFor(role: AppRole | null) {
  return NAV.filter((i) => role ? (i.roles as readonly AppRole[]).includes(role) : false);
}

function NavList({ onNavigate }: { onNavigate?: () => void }) {
  const { role } = useAuth();
  return (
    <nav className="min-h-0 flex flex-1 flex-col gap-1 overflow-y-auto overscroll-contain px-3 py-4 [scrollbar-width:thin]">
      {navFor(role).map(({ to, label, icon: Icon }) => (
        <Link
          key={to}
          to={to}
          onClick={onNavigate}
          activeOptions={{ exact: to === "/" }}
          className="group relative flex shrink-0 items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm font-medium text-sidebar-foreground/65 transition-all duration-200 hover:bg-sidebar-accent/70 hover:text-sidebar-foreground"
          activeProps={{ className: "group relative flex shrink-0 items-center gap-3 rounded-xl bg-sidebar-primary/10 px-3.5 py-2.5 text-sm font-semibold text-sidebar-primary shadow-[inset_3px_0_0_hsl(var(--sidebar-primary))] hover:bg-sidebar-primary/15" }}
        >
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-sidebar-accent/45 transition-colors group-hover:bg-sidebar-accent">
            <Icon className="h-4 w-4" />
          </span>
          <span className="truncate">{label}</span>
        </Link>
      ))}
    </nav>
  );
}

function Brand() {
  return (
    <div className="shrink-0 border-b border-sidebar-border/70 px-5 pb-5 pt-5">
      <div className="flex items-start gap-3">
        <ResideoLogo compact />
        <div className="min-w-0 pt-0.5">
          <div className="text-base font-bold tracking-tight text-sidebar-foreground">Resideo</div>
          <div className="mt-1 text-[11px] font-medium text-sidebar-foreground/55">Monitoring výkonu</div>
        </div>
      </div>
    </div>
  );
}

function SignOutButton() {
  return (
    <Button
      variant="outline"
      size="sm"
      className="w-full justify-start gap-2 rounded-xl border-sidebar-border bg-sidebar-accent/40 text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground"
      onClick={() => void supabase.auth.signOut()}
    >
      <LogOut className="h-4 w-4" />Odhlásit se
    </Button>
  );
}

export function AppShell({ title, subtitle, actions, children }: { title: string; subtitle?: string; actions?: ReactNode; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div data-app-title={title} className="min-h-screen bg-background text-foreground">
      <div className="pointer-events-none fixed inset-0 -z-10 bg-[radial-gradient(circle_at_75%_-10%,hsl(var(--primary)/0.09),transparent_30%),radial-gradient(circle_at_10%_20%,hsl(var(--primary)/0.035),transparent_28%)]" />
      <style>{`[data-app-title="Zaměstnanci"] main > div > div.grid > div.rounded-xl,[data-app-title="Zaměstnanci"] main > div > div.rounded-xl{border-color:transparent !important;}[data-app-title="Zaměstnanci"] main > div > div.rounded-xl{box-shadow:none !important;}`}</style>
      <aside className="fixed inset-y-0 left-0 z-40 hidden min-h-0 w-[270px] flex-col border-r border-sidebar-border/70 bg-sidebar/95 text-sidebar-foreground shadow-[20px_0_60px_-48px_black] backdrop-blur-xl lg:flex">
        <Brand />
        <NavList />
        <div className="shrink-0 grid gap-2 border-t border-sidebar-border/70 p-4">
          <ThemeToggle />
          <SignOutButton />
        </div>
        <div className="shrink-0 px-5 pb-5 text-[10px] leading-relaxed text-sidebar-foreground/35">Interní výrobní systém · cloudová data</div>
      </aside>
      <div className="min-w-0 lg:pl-[270px]">
        <header className="sticky top-0 z-30 border-b border-border/70 bg-background/80 px-4 py-3 backdrop-blur-xl sm:px-6 sm:py-4 lg:px-8">
          <div className="mx-auto flex max-w-[1600px] items-center justify-between gap-4">
            <div className="flex min-w-0 items-center gap-3">
              <Sheet open={open} onOpenChange={setOpen}>
                <SheetTrigger asChild><Button variant="outline" size="icon" className="rounded-xl border-border/80 bg-card/70 lg:hidden" aria-label="Menu"><Menu className="h-5 w-5" /></Button></SheetTrigger>
                <SheetContent side="left" className="flex w-[285px] flex-col border-sidebar-border bg-sidebar p-0 text-sidebar-foreground"><Brand /><NavList onNavigate={() => setOpen(false)} /><div className="shrink-0 grid gap-2 border-t border-sidebar-border/70 p-4"><ThemeToggle /><SignOutButton /></div></SheetContent>
              </Sheet>
              <div className="min-w-0">
                <div className="mb-0.5 hidden text-[10px] font-semibold uppercase tracking-[0.18em] text-primary/80 sm:block">Production monitoring</div>
                <h1 className="truncate text-lg font-bold tracking-tight sm:text-xl">{title}</h1>
                {subtitle ? <p className="mt-0.5 hidden truncate text-xs text-muted-foreground sm:block">{subtitle}</p> : null}
              </div>
            </div>
            {actions ? <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">{actions}</div> : null}
          </div>
        </header>
        <main className="mx-auto min-w-0 max-w-[1600px] flex-1 px-4 pb-6 pt-5 sm:px-6 sm:pt-6 lg:px-8 lg:pb-8"><RouteGuard>{children}</RouteGuard></main>
      </div>
      <BottomNav />
    </div>
  );
}

function RouteGuard({ children }: { children: ReactNode }) {
  const { role } = useAuth();
  const pathname = useRouterState({ select: (st) => st.location.pathname });
  const allowed = navFor(role).some((i) => i.to === pathname || (i.to !== "/" && pathname.startsWith(i.to)));
  const employeeDetailOk = role !== "operator" && pathname.startsWith("/zamestnanec/");
  if (allowed || employeeDetailOk || (role === "operator" && pathname.startsWith("/zamestnanec/"))) return <>{children}</>;
  return <div className="mx-auto mt-8 max-w-xl rounded-2xl border border-border/70 bg-card/80 p-8 text-sm text-muted-foreground shadow-xl shadow-black/5 backdrop-blur"><div className="mb-2 font-semibold text-foreground">Přístup není povolen</div>Pro tuto sekci nemáte oprávnění. Vaše úroveň přístupu: {roleLabel(role)}.</div>;
}

const BOTTOM_NAV = [{ to: "/denni-data", label: "Denní", icon: ClipboardList, roles: STAFF }, { to: "/tydenni-data", label: "Týdenní", icon: CalendarRange, roles: STAFF }, { to: "/zamestnanci", label: "Lidé", icon: Users, roles: STAFF }, { to: "/grafy", label: "Grafy", icon: LineChart, roles: STAFF }, { to: "/", label: "Domů", icon: LayoutDashboard, roles: STAFF }, { to: "/moje-vysledky", label: "Výsledky", icon: BarChart3, roles: ["operator" as AppRole] }, { to: "/o-aplikaci", label: "Více", icon: Info, roles: ["operator" as AppRole] }] as const;

function BottomNav() {
  const { role } = useAuth();
  const items = BOTTOM_NAV.filter((i) => role ? (i.roles as readonly AppRole[]).includes(role) : false);
  if (!items.length) return null;
  return <nav aria-label="Rychlá navigace" className="fixed inset-x-3 bottom-3 z-50 hidden overflow-hidden rounded-2xl border border-border/80 bg-card/90 shadow-2xl shadow-black/20 backdrop-blur-xl md:flex lg:hidden" style={{ paddingBottom: "env(safe-area-inset-bottom)" }}><ul className="grid w-full" style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}>{items.map(({ to, label, icon: Icon }) => <li key={to}><Link to={to} activeOptions={{ exact: to === "/" }} className="flex min-h-14 flex-col items-center justify-center gap-1 px-1 py-2 text-[10px] font-medium text-muted-foreground transition-all duration-200" activeProps={{ className: "flex min-h-14 flex-col items-center justify-center gap-1 rounded-xl bg-primary/10 px-1 py-2 text-[10px] font-semibold text-primary" }}><span className="grid h-7 w-7 place-items-center rounded-lg"><Icon className="h-[18px] w-[18px]" /></span><span className="truncate">{label}</span></Link></li>)}</ul></nav>;
}
