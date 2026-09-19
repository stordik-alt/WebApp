import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Ban, UserMinus, UserPlus, Users } from "lucide-react";
import { useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/lib/auth";
import { useEmployees } from "@/lib/data";
import { listWorkstations } from "@/lib/floorMap";
import {
  addShiftException,
  addTeamMember,
  ensureTeamForLeader,
  listShiftExceptions,
  listTeamMembers,
  removeShiftException,
  removeTeamMember,
  resolveEffectiveRoster,
  type IwShiftName,
} from "@/lib/teams";
import { clearWorkstationRestriction, listRestrictionsForEmployees, setWorkstationRestriction, toExclusionMap } from "@/lib/workstationRestrictions";

export const Route = createFileRoute("/interaktivni/tymy")({
  head: () => ({
    meta: [
      { title: "Týmy – Interaktivní prostředí" },
      { name: "description", content: "Týdenní základní tým Team Leadera a výjimky pro konkrétní směnu." },
    ],
  }),
  component: TeamsPage,
});

const SHIFTS: IwShiftName[] = ["Ranní", "Odpolední", "Noční"];

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function TeamsPage() {
  const { session, isTeamLeader, isAdmin } = useAuth();
  const queryClient = useQueryClient();
  const [workDate, setWorkDate] = useState(todayIso());
  const [shift, setShift] = useState<IwShiftName>("Ranní");

  const leaderUserId = session?.user.id ?? null;
  const canManage = isTeamLeader || isAdmin;

  const teamQuery = useQuery({
    queryKey: ["iw_team", leaderUserId],
    queryFn: () => ensureTeamForLeader(leaderUserId as string),
    enabled: Boolean(leaderUserId) && canManage,
  });

  const membersQuery = useQuery({
    queryKey: ["iw_team_members", teamQuery.data?.id],
    queryFn: () => listTeamMembers(teamQuery.data!.id),
    enabled: Boolean(teamQuery.data),
  });

  const exceptionsQuery = useQuery({
    queryKey: ["iw_shift_exceptions", teamQuery.data?.id, workDate, shift],
    queryFn: () => listShiftExceptions(teamQuery.data!.id, workDate, shift),
    enabled: Boolean(teamQuery.data),
  });

  const employeesQuery = useEmployees();
  const workstationsQuery = useQuery({ queryKey: ["iw_workstations"], queryFn: listWorkstations });
  const secondaryWorkstations = (workstationsQuery.data ?? []).filter((w) => w.is_secondary);

  const members = membersQuery.data ?? [];
  const exceptions = exceptionsQuery.data ?? [];
  const memberIds = useMemo(() => new Set(members.map((m) => m.employee_id)), [members]);
  const effectiveRosterIds = useMemo(() => new Set(resolveEffectiveRoster(members, exceptions)), [members, exceptions]);

  const restrictionsQuery = useQuery({
    queryKey: ["iw_workstation_restrictions", [...effectiveRosterIds].join(",")],
    queryFn: () => listRestrictionsForEmployees([...effectiveRosterIds]),
    enabled: effectiveRosterIds.size > 0,
  });
  const exclusionMap = useMemo(() => toExclusionMap(restrictionsQuery.data ?? []), [restrictionsQuery.data]);

  async function toggleRestriction(employeeId: string, workstationId: string, currentlyRestricted: boolean) {
    if (currentlyRestricted) await clearWorkstationRestriction(employeeId, workstationId);
    else await setWorkstationRestriction({ employeeId, workstationId, createdBy: leaderUserId });
    await queryClient.invalidateQueries({ queryKey: ["iw_workstation_restrictions", [...effectiveRosterIds].join(",")] });
  }
  const employeesById = useMemo(() => new Map((employeesQuery.data ?? []).map((e) => [e.id, e])), [employeesQuery.data]);
  const nonMembers = (employeesQuery.data ?? []).filter((e) => e.active && !memberIds.has(e.id));

  async function invalidateAll() {
    await queryClient.invalidateQueries({ queryKey: ["iw_team_members", teamQuery.data?.id] });
    await queryClient.invalidateQueries({ queryKey: ["iw_shift_exceptions", teamQuery.data?.id, workDate, shift] });
  }

  if (!canManage) {
    return (
      <AppShell title="Týmy" subtitle="Týdenní základní tým Team Leadera.">
        <Card className="p-5 text-sm text-muted-foreground">Tato stránka je určena pro Team Leadery a administrátory.</Card>
      </AppShell>
    );
  }

  return (
    <AppShell title="Týmy" subtitle="Základní tým se mění administrativně; výjimky platí jen pro vybranou směnu.">
      <div className="grid min-w-0 gap-4 sm:gap-6">
        <Card className="overflow-hidden p-0">
          <div className="flex items-center gap-3 border-b border-border px-4 py-4 sm:px-5">
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-primary/10 text-primary">
              <Users className="h-5 w-5" />
            </span>
            <div>
              <h2 className="text-lg font-semibold">Základní týdenní tým</h2>
              <p className="text-xs text-muted-foreground">{members.length} členů</p>
            </div>
          </div>
          <div className="divide-y divide-border">
            {members.map((member) => {
              const employee = employeesById.get(member.employee_id);
              return (
                <div key={member.id} className="flex items-center justify-between gap-3 px-4 py-3 sm:px-5">
                  <span className="truncate font-medium">{employee?.full_name ?? member.employee_id}</span>
                  <Button size="sm" variant="ghost" onClick={() => void removeTeamMember(member.team_id, member.employee_id).then(invalidateAll)}>
                    <UserMinus className="mr-1 h-4 w-4" /> Odebrat
                  </Button>
                </div>
              );
            })}
            {members.length === 0 ? <div className="px-4 py-4 text-sm text-muted-foreground sm:px-5">Tým zatím nemá žádné členy.</div> : null}
          </div>
          {nonMembers.length > 0 ? (
            <div className="border-t border-border px-4 py-3 sm:px-5">
              <Label className="text-xs">Přidat do základního týmu</Label>
              <div className="mt-2 flex flex-wrap gap-2">
                {nonMembers.map((employee) => (
                  <Button
                    key={employee.id}
                    size="sm"
                    variant="outline"
                    onClick={() => void addTeamMember(teamQuery.data!.id, employee.id).then(invalidateAll)}
                  >
                    <UserPlus className="mr-1 h-4 w-4" /> {employee.full_name}
                  </Button>
                ))}
              </div>
            </div>
          ) : null}
        </Card>

        <Card className="overflow-hidden p-0">
          <div className="border-b border-border px-4 py-4 sm:px-5">
            <h2 className="text-lg font-semibold">Výjimky pro konkrétní směnu</h2>
            <p className="text-xs text-muted-foreground">Základní tým se výjimkou nemění – platí jen pro tento work_date + směnu.</p>
            <div className="mt-3 flex flex-wrap items-end gap-2">
              <div>
                <Label className="text-xs">Datum</Label>
                <input type="date" className="block h-9 rounded-md border border-input bg-background px-2 text-sm" value={workDate} onChange={(e) => setWorkDate(e.target.value)} />
              </div>
              <div>
                <Label className="text-xs">Směna</Label>
                <select className="block h-9 rounded-md border border-input bg-background px-2 text-sm" value={shift} onChange={(e) => setShift(e.target.value as IwShiftName)}>
                  {SHIFTS.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>
          <div className="px-4 py-4 sm:px-5">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Efektivní obsazení pro tuto směnu ({effectiveRosterIds.size})</p>
            <div className="flex flex-wrap gap-2">
              {[...effectiveRosterIds].map((employeeId) => {
                const employee = employeesById.get(employeeId);
                const isException = exceptions.some((e) => e.employee_id === employeeId && e.exception_type === "add");
                return (
                  <Badge key={employeeId} variant={isException ? "secondary" : "default"}>
                    {employee?.full_name ?? employeeId}
                  </Badge>
                );
              })}
            </div>
          </div>
          <div className="border-t border-border px-4 py-4 sm:px-5">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Přidat výjimku</p>
            <div className="flex flex-wrap gap-2">
              {(employeesQuery.data ?? [])
                .filter((e) => e.active)
                .map((employee) => {
                  const inRoster = effectiveRosterIds.has(employee.id);
                  return (
                    <Button
                      key={employee.id}
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        void addShiftException({
                          teamId: teamQuery.data!.id,
                          workDate,
                          shift,
                          employeeId: employee.id,
                          type: inRoster ? "remove" : "add",
                          createdBy: leaderUserId,
                        }).then(invalidateAll)
                      }
                    >
                      {inRoster ? <UserMinus className="mr-1 h-4 w-4" /> : <UserPlus className="mr-1 h-4 w-4" />}
                      {employee.full_name}
                    </Button>
                  );
                })}
            </div>
          </div>
          {exceptions.length > 0 ? (
            <div className="border-t border-border px-4 py-4 sm:px-5">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Aktivní výjimky</p>
              <div className="space-y-2">
                {exceptions.map((exception) => (
                  <div key={exception.id} className="flex items-center justify-between gap-3 text-sm">
                    <span>
                      {exception.exception_type === "add" ? "+ přidán" : "− odebrán"} {employeesById.get(exception.employee_id)?.full_name ?? exception.employee_id}
                    </span>
                    <Button size="sm" variant="ghost" onClick={() => void removeShiftException(exception.id).then(invalidateAll)}>
                      Zrušit výjimku
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </Card>

        {secondaryWorkstations.length > 0 ? (
          <Card className="overflow-hidden p-0">
            <div className="flex items-center gap-3 border-b border-border px-4 py-4 sm:px-5">
              <span className="grid h-10 w-10 place-items-center rounded-xl bg-primary/10 text-primary">
                <Ban className="h-5 w-5" />
              </span>
              <div>
                <h2 className="text-lg font-semibold">Omezení pracovišť</h2>
                <p className="text-xs text-muted-foreground">Zaměstnanec s omezením nesmí být na dané sekundární pracoviště (TESTY/PREP) přiřazen - důvod se neeviduje.</p>
              </div>
            </div>
            <div className="divide-y divide-border">
              {[...effectiveRosterIds].map((employeeId) => {
                const employee = employeesById.get(employeeId);
                const excluded = exclusionMap.get(employeeId) ?? new Set<string>();
                return (
                  <div key={employeeId} className="flex flex-wrap items-center gap-3 px-4 py-3 sm:px-5">
                    <span className="min-w-[10rem] truncate text-sm font-medium">{employee?.full_name ?? employeeId}</span>
                    <div className="flex flex-wrap gap-2">
                      {secondaryWorkstations.map((workstation) => {
                        const restricted = excluded.has(workstation.id);
                        return (
                          <Button
                            key={workstation.id}
                            size="sm"
                            variant={restricted ? "destructive" : "outline"}
                            onClick={() => void toggleRestriction(employeeId, workstation.id, restricted)}
                          >
                            {restricted ? "Zakázáno: " : "Povoleno: "}
                            {workstation.display_name}
                          </Button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
              {effectiveRosterIds.size === 0 ? <div className="px-4 py-4 text-sm text-muted-foreground sm:px-5">Nejprve přidej členy do základního týmu.</div> : null}
            </div>
          </Card>
        ) : null}
      </div>
    </AppShell>
  );
}
