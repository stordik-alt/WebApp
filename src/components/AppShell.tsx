import { Link, useRouterState } from "@tanstack/react-router";
import { useState, type ReactNode } from "react";
import { LayoutDashboard, Users, ClipboardList, CalendarRange, FileBarChart, Activity, Trophy, Package, Menu, Ruler, AlertTriangle, Info, ShieldCheck, UserCog, LogOut, BarChart3, Award, LineChart, Building2, Wrench, History, AlertOctagon } from "lucide-react";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/ThemeToggle";
import { AppearanceSettings } from "@/components/AppearanceSettings";
import { EnvironmentSwitcher } from "@/components/EnvironmentSwitcher";
import { OptiShiftLogo } from "@/components/OptiShiftLogo";
import { useAuth, roleLabel, type AppRole } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";

const ALL: AppRole[] = ["admin", "team_leader", "operator", "tester"];
const STAFF: AppRole[] = ["admin", "team_leader", "tester"];
const ADMIN_VIEW: AppRole[] = ["admin", "tester"];
const NAV = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, roles: STAFF },
  { to: "/moje-vysledky", label: "Moje výsledky", icon: BarChart3, roles: ["operator" as AppRole] },
  { to: "/zamestnanci", label: "Zaměstnanci", icon: Users, roles: STAFF },
  { to: "/denni-data", label: "Denní data", icon: ClipboardList, roles: STAFF },
  { to: "/pracoviste", label: "Pracoviště", icon: Building2, roles: STAFF },
  { to: "/tydenni-data", label: "Týdenní data", icon: CalendarRange, roles: STAFF },
  { to: "/quality-alerty", label: "Quality Alerty", icon: AlertTriangle, roles: STAFF },
  { to: "/produkty", label: "Produkty / Normy", icon: Package, roles: STAFF },
  { to: "/premereni-norem", label: "Přeměření norem", icon: Ruler, roles: STAFF },
  { to: "/reporty", label: "Reporty", icon: FileBarChart, roles: STAFF },
  { to: "/grafy", label: "Grafy", icon: LineChart, roles: STAFF },
  { to: "/analyza", label: "Analýza / IPI", icon: Activity, roles: STAFF },
  { to: "/hodnoceni", label: "Hodnocení handlerů", icon: Award, roles: STAFF },
  { to: "/zebricek", label: "Žebříček", icon: Trophy, roles: STAFF },
  { to: "/ke-schvaleni", label: "Ke schválení", icon: ShieldCheck, roles: ADMIN_VIEW },
  { to: "/uzivatele", label: "Uživatelé", icon: UserCog, roles: ADMIN_VIEW },
  { to: "/odstavky", label: "Odstávky", icon: Wrench, roles: ADMIN_VIEW },
  { to: "/hromadny-prepocet", label: "Hromadný přepočet", icon: History, roles: ADMIN_VIEW },
  { to: "/anomalie", label: "Datové anomálie", icon: AlertOctagon, roles: ADMIN_VIEW },
  { to: "/o-aplikaci", label: "O aplikaci", icon: Info, roles: ALL },
] as const;
function navFor(role: AppRole | null) { return NAV.filter((i) => role ? (i.roles as readonly AppRole[]).includes(role) : false); }

function NavList({ onNavigate }: { onNavigate?: () => void }) {
  const { role } = useAuth();
  return <nav className="min-h-0 flex flex-1 flex-col gap-1 overflow-y-auto overscroll-contain touch-pan-y px-3 py-4 [scrollbar-width:thin]" style={{ WebkitOverflowScrolling: "touch" }}>{navFor(role).map(({ to, label, icon: Icon }) => <Link key={to} to={to} onClick={onNavigate} activeOptions={{ exact: to === "/" }} className="group relative flex shrink-0 items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm font-medium text-sidebar-foreground/65 transition-all duration-200 hover:bg-sidebar-accent/70 hover:text-sidebar-foreground" activeProps={{ className: "group relative flex shrink-0 items-center gap-3 rounded-xl bg-sidebar-primary/10 px-3.5 py-2.5 text-sm font-semibold text-sidebar-primary shadow-[inset_3px_0_0_hsl(var(--sidebar-primary))] hover:bg-sidebar-primary/15" }}><span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-sidebar-accent/45 transition-colors group-hover:bg-sidebar-accent"><Icon className="h-4 w-4" /></span><span className="truncate">{label}</span></Link>)}</nav>;
}

function Brand() { return <div className="shrink-0 border-b border-sidebar-border/70 px-5 pb-5 pt-5"><OptiShiftLogo size="sidebar" /></div>; }
function SignOutButton() { return <Button variant="ghost" size="sm" className="h-10 w-full justify-start gap-3 rounded-xl px-3 py-2 text-sm text-sidebar-foreground/80 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground" onClick={() => void supabase.auth.signOut()}><span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-sidebar-accent/45"><LogOut className="h-4 w-4" /></span><span>Odhlásit se</span></Button>; }
function SidebarSettings() { return <div className="shrink-0 grid gap-1 border-t border-sidebar-border/70 p-3"><EnvironmentSwitcher /><AppearanceSettings /><ThemeToggle /><SignOutButton /></div>; }

export function AppShell({ title, subtitle, actions, children }: { title: string; subtitle?: string; actions?: ReactNode; children: ReactNode }) {
  const [open, setOpen] = useState(false); const { isTester } = useAuth();
  const pathname = useRouterState({ select: (st) => st.location.pathname });
  if (pathname.startsWith("/interaktivni")) {
    return (
      <div data-app-title={title} data-read-only={isTester ? "true" : "false"} className="min-h-screen w-full min-w-0 overflow-x-clip bg-background text-foreground">
        <RouteGuard>{children}</RouteGuard>
      </div>
    );
  }

  return <div data-app-title={title} data-read-only={isTester ? "true" : "false"} className="min-h-screen w-full min-w-0 overflow-x-clip bg-background text-foreground">
    <div className="pointer-events-none fixed inset-0 -z-10" />
    <aside className="fixed inset-y-0 left-0 z-40 hidden min-h-0 w-[248px] flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground shadow-[12px_0_30px_-24px_black] lg:flex"><Brand /><NavList /><SidebarSettings /><div className="shrink-0 px-5 pb-5 text-[10px] leading-relaxed text-sidebar-foreground/35">Interní výrobní systém · cloudová data</div></aside>
    <div className="min-w-0 w-full overflow-x-auto overscroll-x-contain lg:pl-[248px]"><header className="sticky top-0 z-30 w-full min-w-0 border-b border-border bg-background/95 px-4 py-3 sm:px-6 sm:py-3.5 lg:px-8"><div className="mx-auto flex w-full max-w-[1480px] min-w-0 flex-wrap items-center justify-between gap-3"><div className="flex min-w-0 flex-1 items-center gap-3"><Sheet open={open} onOpenChange={setOpen}><SheetTrigger asChild><Button variant="outline" size="icon" className="rounded-xl border-border/80 bg-card/70 lg:hidden" aria-label="Menu"><Menu className="h-5 w-5" /></Button></SheetTrigger><SheetContent side="left" className="flex h-dvh max-h-dvh min-h-0 w-[285px] max-w-[85vw] flex-col overflow-hidden border-sidebar-border bg-sidebar p-0 text-sidebar-foreground touch-pan-y"><Brand /><NavList onNavigate={() => setOpen(false)} /><SidebarSettings /></SheetContent></Sheet><div className="min-w-0"><div className="mb-0.5 hidden text-[10px] font-semibold uppercase tracking-[0.18em] text-primary/80 sm:block">Production monitoring</div><div className="flex items-center gap-2"><h1 className="truncate text-lg font-bold tracking-tight sm:text-xl">{title}</h1>{isTester?<span className="shrink-0 rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-primary">Tester · pouze čtení</span>:null}</div>{subtitle?<p className="mt-0.5 hidden truncate text-xs text-muted-foreground sm:block">{subtitle}</p>:null}</div></div>{!isTester&&actions?<div className="order-3 flex w-full min-w-0 flex-wrap items-center justify-center gap-2 sm:order-none sm:w-auto sm:justify-end">{actions}</div>:null}<div className="shrink-0"><span className="sm:hidden"><OptiShiftLogo compact /></span><span className="hidden sm:block"><OptiShiftLogo /></span></div></div></header><main className="mx-auto min-w-0 w-full max-w-[1600px] overflow-x-visible px-4 pb-24 pt-5 sm:px-6 sm:pt-6 md:pb-6 lg:px-8 lg:pb-8"><div key={pathname} className="animate-in fade-in duration-300"><RouteGuard>{children}</RouteGuard></div></main></div><BottomNav />
  </div>;
}

// Interaktivní prostředí (Verze 2.02) má vlastní vnořenou navigaci mimo hlavní NAV pole,
// proto se povoluje zvlášť podle role (team_leader/admin), ne podle přítomnosti v NAV.
const INTERAKTIVNI_ROLES: AppRole[] = ["admin", "team_leader"];
function RouteGuard({ children }: { children: ReactNode }) { const { role }=useAuth(); const pathname=useRouterState({select:(st)=>st.location.pathname}); const allowed=navFor(role).some((i)=>i.to===pathname||(i.to!=="/"&&pathname.startsWith(i.to))); const employeeDetailOk=role!=="operator"&&pathname.startsWith("/zamestnanec/"); const interaktivniOk=pathname.startsWith("/interaktivni")&&role!=null&&INTERAKTIVNI_ROLES.includes(role); if(allowed||employeeDetailOk||interaktivniOk||(role==="operator"&&pathname.startsWith("/zamestnanec/")))return <>{children}</>; return <div className="mx-auto mt-8 max-w-xl rounded-2xl border border-border/70 bg-card/80 p-8 text-sm text-muted-foreground shadow-xl shadow-black/5 backdrop-blur"><div className="mb-2 font-semibold text-foreground">Přístup není povolen</div>Pro tuto sekci nemáte oprávnění. Vaše úroveň přístupu: {roleLabel(role)}.</div>; }

const BOTTOM_NAV=[{to:"/denni-data",label:"Denní",icon:ClipboardList,roles:STAFF},{to:"/tydenni-data",label:"Týdenní",icon:CalendarRange,roles:STAFF},{to:"/zamestnanci",label:"Lidé",icon:Users,roles:STAFF},{to:"/grafy",label:"Grafy",icon:LineChart,roles:STAFF},{to:"/",label:"Domů",icon:LayoutDashboard,roles:STAFF},{to:"/moje-vysledky",label:"Výsledky",icon:BarChart3,roles:["operator" as AppRole]},{to:"/o-aplikaci",label:"Více",icon:Info,roles:["operator" as AppRole]}] as const;
// Interaktivní prostředí má vlastní sub-navigaci (route.tsx) - hlavní BottomNav
// by se s ní na mobilu zdvojoval a matl, do kterého prostředí uživatel patří.
function BottomNav(){const{role}=useAuth();const pathname=useRouterState({select:(st)=>st.location.pathname});if(pathname.startsWith("/interaktivni"))return null;const items=BOTTOM_NAV.filter((i)=>role?(i.roles as readonly AppRole[]).includes(role):false);if(!items.length)return null;return <nav aria-label="Rychlá navigace" className="fixed inset-x-3 bottom-3 z-50 flex overflow-hidden rounded-2xl border border-border/80 bg-card/90 shadow-2xl shadow-black/20 backdrop-blur-xl md:hidden" style={{paddingBottom:"env(safe-area-inset-bottom)"}}><ul className="grid w-full" style={{gridTemplateColumns:`repeat(${items.length},minmax(0,1fr))`}}>{items.map(({to,label,icon:Icon})=><li key={to}><Link to={to} activeOptions={{exact:to==="/"}} className="flex min-h-14 flex-col items-center justify-center gap-1 px-1 py-2 text-[10px] font-medium text-muted-foreground transition-all duration-200" activeProps={{className:"flex min-h-14 flex-col items-center justify-center gap-1 rounded-xl bg-primary/10 px-1 py-2 text-[10px] font-semibold text-primary"}}><span className="grid h-7 w-7 place-items-center rounded-lg"><Icon className="h-[18px] w-[18px]"/></span><span className="truncate">{label}</span></Link></li>)}</ul></nav>;}
