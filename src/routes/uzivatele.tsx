import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/AppShell";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useEmployees } from "@/lib/data";
import { roleLabel, type AppRole } from "@/lib/auth";

export const Route = createFileRoute("/uzivatele")({
  head: () => ({
    meta: [
      { title: "Uživatelé a přístupy – Výkonnost operátorů" },
      {
        name: "description",
        content: "Správa účtů, rolí a propojení uživatelů se zaměstnanci ve výrobě.",
      },
      { property: "og:title", content: "Uživatelé a přístupy" },
      { property: "og:description", content: "Přidělování rolí správce, Team Leader, operátor a Tester." },
    ],
  }),
  component: UsersPage,
});

type Row = {
  id: string;
  email: string | null;
  first_name: string;
  last_name: string;
  employee_id: string | null;
  created_at: string;
  role: AppRole | null;
};

function useUsers() {
  return useQuery({
    queryKey: ["profiles"],
    queryFn: async (): Promise<Row[]> => {
      const [{ data: profiles, error }, { data: roles, error: re }] = await Promise.all([
        supabase.from("profiles").select("*").order("created_at", { ascending: false }),
        supabase.from("user_roles").select("user_id, role"),
      ]);
      if (error) throw error;
      if (re) throw re;
      return (profiles ?? []).map((p) => ({
        id: p.id,
        email: p.email,
        first_name: p.first_name,
        last_name: p.last_name,
        employee_id: p.employee_id,
        created_at: p.created_at,
        role: ((roles ?? []).find((r) => r.user_id === p.id)?.role as AppRole | undefined) ?? null,
      }));
    },
  });
}

function UsersPage() {
  const qc = useQueryClient();
  const { data: users = [], isLoading } = useUsers();
  const { data: employees = [] } = useEmployees();

  const setRole = useMutation({
    mutationFn: async ({ id, role }: { id: string; role: string }) => {
      const { error } = await supabase.rpc("admin_set_role", { _user_id: id, _role: role });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["profiles"] });
      toast.success("Role uložena");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const setEmployee = useMutation({
    mutationFn: async ({ id, employeeId }: { id: string; employeeId: string | null }) => {
      const { error } = await supabase
        .from("profiles")
        .update({ employee_id: employeeId })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["profiles"] });
      toast.success("Propojení se zaměstnancem uloženo");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const waiting = users.filter((u) => !u.role);

  return (
    <AppShell title="Uživatelé a přístupy" subtitle="Role, schválení registrací a propojení se zaměstnanci ve výrobě">
      <div className="grid gap-4">
        <Card className="p-4">
          <div className="text-sm font-medium text-foreground">Nové registrace</div>
          <p className="mt-1 text-sm text-muted-foreground">
            {waiting.length === 0
              ? "Žádné účty nečekají na přidělení role."
              : `${waiting.length} účet(ů) čeká na přidělení role. Bez role uživatel nevidí žádná data.`}
          </p>
        </Card>

        <Card className="overflow-x-auto p-0">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="border-b border-border text-left text-muted-foreground">
              <tr>
                <th className="p-3">Uživatel</th>
                <th className="p-3">E-mail</th>
                <th className="p-3">Role</th>
                <th className="p-3">Zaměstnanec</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td className="p-4 text-muted-foreground" colSpan={4}>
                    Načítám…
                  </td>
                </tr>
              ) : users.length === 0 ? (
                <tr>
                  <td className="p-4 text-muted-foreground" colSpan={4}>
                    Zatím žádné účty.
                  </td>
                </tr>
              ) : (
                users.map((u) => (
                  <tr key={u.id} className="border-b border-border/60 last:border-0">
                    <td className="p-3">
                      <div className="font-medium text-foreground">
                        {`${u.first_name} ${u.last_name}`.trim() || "(bez jména)"}
                      </div>
                      {!u.role ? (
                        <Badge variant="outline" className="mt-1">
                          {roleLabel(null)}
                        </Badge>
                      ) : null}
                    </td>
                    <td className="p-3 text-muted-foreground">{u.email ?? "–"}</td>
                    <td className="p-3">
                      <Select
                        value={u.role ?? "none"}
                        onValueChange={(role) => setRole.mutate({ id: u.id, role })}
                      >
                        <SelectTrigger className="w-44">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">Bez role</SelectItem>
                          <SelectItem value="operator">Operátor</SelectItem>
                          <SelectItem value="team_leader">Team Leader</SelectItem>
                          <SelectItem value="admin">Správce</SelectItem>
                          <SelectItem value="tester">Tester</SelectItem>
                        </SelectContent>
                      </Select>
                    </td>
                    <td className="p-3">
                      <Select
                        value={u.employee_id ?? "none"}
                        onValueChange={(v) =>
                          setEmployee.mutate({ id: u.id, employeeId: v === "none" ? null : v })
                        }
                      >
                        <SelectTrigger className="w-56">
                          <SelectValue placeholder="Nepropojeno" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">Nepropojeno</SelectItem>
                          {employees.map((e) => (
                            <SelectItem key={e.id} value={e.id}>
                              {e.full_name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </Card>
      </div>
    </AppShell>
  );
}
