import { createFileRoute, Link, Outlet, useRouterState } from "@tanstack/react-router";
import { Activity, CalendarDays, Plus } from "lucide-react";
import { useState } from "react";
import { localDateKey } from "@/lib/metrics";
import { useAuth } from "@/lib/auth";
import { OptiShiftLogo } from "@/components/OptiShiftLogo";
import { ShiftSelectionProvider, useShiftSelection } from "@/components/interaktivni/ShiftSelectionContext";
import { LiveBackground } from "@/components/interaktivni/LiveBackground";
import type { IwShiftName } from "@/lib/shift-windows";
import "@/components/interaktivni/interaktivni.css";

export const Route = createFileRoute("/interaktivni")({
  component: InteraktivniLayout,
});

const SHIFTS: IwShiftName[] = ["Ranní", "Odpolední", "Noční"];

const PRIMARY_NAV = [
  { to: "/interaktivni/mapa", label: "Mapa haly" },
  { to: "/interaktivni/tymy", label: "Týmy" },
  { to: "/interaktivni/rozdeleni-vyroby", label: "Rozdělení výroby" },
] as const;

const SECONDARY_NAV = [
  { to: "/interaktivni/pracoviste-mapa", label: "Pracoviště" },
  { to: "/interaktivni/smena-historie", label: "Historie" },
] as const;

function LiveClock() {
  return (
    <span className="iw-mono flex shrink-0 items-center gap-1.5 text-[10px] text-muted-foreground">
      <Activity className="h-3 w-3 text-[hsl(152_65%_52%)]" aria-hidden="true" />
      LIVE
    </span>
  );
}

function InteractiveControls() {
  const { teams, teamsLoading, teamId, setTeamId, workDate, setWorkDate, shift, setShift, addTeam, canManage } = useShiftSelection();
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");

  if (!canManage) return null;

  async function submitNewTeam() {
    if (!newName.trim()) return;
    await addTeam(newName.trim());
    setNewName("");
    setCreating(false);
  }

  return (
    <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
      <span className="iw-label hidden xl:inline">Tým</span>
      <select className="max-w-[150px]" value={teamId ?? ""} onChange={(e) => setTeamId(e.target.value)} aria-label="Vybraný tým">
        {teamsLoading ? <option>Načítám…</option> : teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
      </select>
      {creating ? (
        <>
          <input autoFocus value={newName} onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void submitNewTeam()} placeholder="Nový tým" aria-label="Název nového týmu" className="w-[130px]" />
          <button type="button" className="iw-btn iw-btn-active" onClick={() => void submitNewTeam()}>Uložit</button>
          <button type="button" className="iw-btn" onClick={() => setCreating(false)}>Zrušit</button>
        </>
      ) : (
        <button type="button" className="iw-btn hidden xl:inline-flex" onClick={() => setCreating(true)}>
          <Plus className="h-3.5 w-3.5" /> Tým
        </button>
      )}
      <span className="hidden h-5 w-px bg-border/60 lg:block" aria-hidden="true" />
      <span className="iw-label hidden xl:inline">Směna</span>
      <span className="iw-control inline-flex items-center gap-1.5">
        <CalendarDays className="h-3.5 w-3.5 opacity-70" aria-hidden="true" />
        <input type="date" value={workDate} onChange={(e) => setWorkDate(e.target.value)} aria-label="Datum směny" className="h-auto border-0 bg-transparent p-0 text-xs shadow-none focus:ring-0" />
      </span>
      <select value={shift} onChange={(e) => setShift(e.target.value as IwShiftName)} aria-label="Směna">
        {SHIFTS.map((s) => <option key={s} value={s}>{s}</option>)}
      </select>
    </div>
  );
}

function InteractiveHeader() {
  const { profile } = useAuth();
  const initials = profile ? `${profile.first_name?.[0] ?? ""}${profile.last_name?.[0] ?? ""}`.toUpperCase() : "OS";

  return (
    <header className="sticky top-0 z-40 border-b border-border/70 bg-[hsl(224_55%_6%)/0.92] shadow-[0_12px_35px_-28px_black] backdrop-blur-md">
      <div className="mx-auto flex min-h-[74px] w-full max-w-[1800px] flex-wrap items-center gap-4 px-4 py-3 lg:px-6">
        <div className="flex min-w-[185px] shrink-0 items-center">
          <OptiShiftLogo />
        </div>
        <nav className="order-3 flex min-w-0 flex-1 items-center gap-1 overflow-x-auto pb-0.5 md:order-none" aria-label="Interaktivní prostředí">
          {[...PRIMARY_NAV, ...SECONDARY_NAV].map((item) => (
            <Link
              key={item.to}
              to={item.to}
              className="iw-label shrink-0 whitespace-nowrap rounded-lg px-3 py-2.5 text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground"
              activeProps={{ className: "iw-label shrink-0 whitespace-nowrap rounded-lg bg-[hsl(200_85%_60%)/0.10] px-3 py-2.5 text-[hsl(200_85%_70%)] shadow-[inset_0_-2px_0_hsl(200_85%_60%)]" }}
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex shrink-0 items-center gap-2">
          <InteractiveControls />
          <span className="hidden h-9 w-9 place-items-center rounded-full border border-border/70 bg-muted/50 text-xs font-semibold md:grid" title={profile ? `${profile.first_name} ${profile.last_name}` : "Uživatel"}>
            {initials}
          </span>
          <LiveClock />
        </div>
      </div>
    </header>
  );
}

function InteraktivniLayout() {
  const pathname = useRouterState({ select: (st) => st.location.pathname });
  const { workDate, shift } = useShiftSelection();

  return (
    <ShiftSelectionProvider>
      <div className="iw-scope min-h-screen w-full">
        <LiveBackground />
        <InteractiveHeader />
        <main className="mx-auto w-full max-w-[1800px] px-3 pb-10 pt-4 sm:px-5 lg:px-6">
          <div className="mb-4 flex items-center justify-between gap-3 border-b border-border/60 pb-3">
            <div>
              <p className="iw-label">Prostředí · Sledování a řízení výroby</p>
              <p className="iw-mono mt-1 text-sm font-semibold text-foreground/90">{workDate} · {shift}</p>
            </div>
            <span className="hidden text-right text-[10px] text-muted-foreground md:block">Živá mapa haly · aktuální pracoviště · výroba</span>
          </div>
          <div key={pathname} className="animate-in fade-in duration-300">
            <Outlet />
          </div>
        </main>
      </div>
    </ShiftSelectionProvider>
  );
}
