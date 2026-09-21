import { createFileRoute, Link, Outlet, useRouterState } from "@tanstack/react-router";
import { Activity, Plus } from "lucide-react";
import { useState } from "react";
import { localDateKey } from "@/lib/metrics";
import { ShiftSelectionProvider, useShiftSelection } from "@/components/interaktivni/ShiftSelectionContext";
import { LiveBackground } from "@/components/interaktivni/LiveBackground";
import { AppShell } from "@/components/AppShell";
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
  { to: "/interaktivni/pracoviste-mapa", label: "Editace mapy" },
  { to: "/interaktivni/smena-historie", label: "Historie" },
] as const;

function LiveClock() {
  return (
    <span className="iw-mono flex items-center gap-1.5 text-[11px] text-muted-foreground">
      <Activity className="h-3 w-3 text-[hsl(152_65%_52%)]" aria-hidden="true" />
      LIVE
    </span>
  );
}

// # dělá: přepínač mezi TL týmy + rychlé založení nového; datum a směna platí napříč celým modulem
function SelectionBar() {
  const { teams, teamsLoading, teamId, setTeamId, workDate, setWorkDate, shift, setShift, addTeam, canManage } = useShiftSelection();
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");

  if (!canManage) return null;

  async function submitNewTeam() {
    if (!newName.trim()) return;
    await addTeam(newName);
    setNewName("");
    setCreating(false);
  }

  return (
    <div className="iw-panel mb-4 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="iw-label">Tým</span>
        {teamsLoading ? (
          <span className="text-xs text-muted-foreground">Načítám…</span>
        ) : (
          <select value={teamId ?? ""} onChange={(e) => setTeamId(e.target.value)} aria-label="Vybraný tým">
            {teams.map((team) => (
              <option key={team.id} value={team.id}>
                {team.name}
              </option>
            ))}
          </select>
        )}
        {creating ? (
          <>
            <input
              autoFocus
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void submitNewTeam()}
              placeholder="Název týmu"
              aria-label="Název nového týmu"
            />
            <button type="button" className="iw-btn iw-btn-active" onClick={() => void submitNewTeam()}>
              Uložit
            </button>
            <button type="button" className="iw-btn" onClick={() => setCreating(false)}>
              Zrušit
            </button>
          </>
        ) : (
          <button type="button" className="iw-btn" onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" /> Nový tým
          </button>
        )}

        <span className="iw-label ml-0 sm:ml-4">Směna</span>
        <input type="date" value={workDate} onChange={(e) => setWorkDate(e.target.value)} />
        <select value={shift} onChange={(e) => setShift(e.target.value as IwShiftName)}>
          {SHIFTS.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>
    </div>
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
  const currentSection = [...PRIMARY_NAV, ...SECONDARY_NAV].find((item) => pathname === item.to)?.label ?? "Interaktivní prostředí";
  return (
    <AppShell title="Výrobní linky" subtitle="Živé řízení výrobní haly." environment backTo="/" backLabel="Zpět do hodnocení">
      <ShiftSelectionProvider>
        <div className="iw-scope min-h-[calc(100vh-8rem)]">
        <LiveBackground />
        <div className="mb-3 flex items-center gap-3 border-b border-border pb-3">
          {/* Na mobilu horizontální scroll místo zalamování - běžný vzor mobilních aplikací,
              ne "wrapované" menu, které by na malé obrazovce vypadalo jako klasický web. */}
          <nav className="iw-scrollbar-none flex flex-1 items-center gap-1 overflow-x-auto">
            {PRIMARY_NAV.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                className="iw-label shrink-0 whitespace-nowrap rounded-lg px-3 py-2.5 text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
                activeProps={{ className: "iw-label shrink-0 whitespace-nowrap rounded-lg bg-muted px-3 py-2.5 text-[hsl(152_65%_45%)] dark:text-[hsl(152_65%_58%)] shadow-[inset_0_-2px_0_hsl(152_65%_52%)]" }}
              >
                {item.label}
              </Link>
            ))}
            <span className="mx-1 h-4 w-px shrink-0 bg-border/70" aria-hidden="true" />
            {SECONDARY_NAV.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                className="shrink-0 whitespace-nowrap rounded-lg px-2.5 py-2.5 text-[10px] uppercase tracking-wider text-muted-foreground/70 transition-colors hover:bg-muted/40 hover:text-foreground/80"
                activeProps={{ className: "shrink-0 whitespace-nowrap rounded-lg bg-muted/60 px-2.5 py-2.5 text-[10px] uppercase tracking-wider text-foreground/80" }}
              >
                {item.label}
              </Link>
            ))}
          </nav>
          <LiveClock />
        </div>
        <SelectionBar />
        <div key={pathname} className="animate-in fade-in duration-300">
          <Outlet />
        </div>
        </div>
      </ShiftSelectionProvider>
    </AppShell>
  );
}
