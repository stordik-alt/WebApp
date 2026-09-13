import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAuth, type AppRole } from "@/lib/auth";

type PendingUser = { id: string; email: string | null; first_name: string; last_name: string; created_at: string };

export function AccountApprovalQueue() {
  const qc = useQueryClient();
  const { session, isAdmin } = useAuth();
  const [role, setRole] = useState<AppRole>("operator");
  const query = useQuery({
    queryKey: ["pending-accounts"],
    queryFn: async (): Promise<PendingUser[]> => {
      const { data: profiles, error } = await supabase.from("profiles").select("id,email,first_name,last_name,created_at").order("created_at", { ascending: false });
      if (error) throw error;
      const { data: roles, error: roleError } = await supabase.from("user_roles").select("user_id,role");
      if (roleError) throw roleError;
      const roleIds = new Set((roles ?? []).map(r => r.user_id));
      return (profiles ?? []).filter(p => !roleIds.has(p.id)) as PendingUser[];
    },
  });
  const users = query.data ?? [];
  const approve = useMutation({
    mutationFn: async ({ user, userRole }: { user: PendingUser; userRole: AppRole }) => {
      if (!isAdmin) throw new Error("Schvalovat účty může pouze správce.");
      const { error } = await supabase.rpc("admin_set_role", { _user_id: user.id, _role: userRole });
      if (error) throw error;
    },
    onSuccess: (_, v) => { qc.invalidateQueries({ queryKey: ["pending-accounts"] }); toast.success(`Účet ${v.user.email ?? ""} byl schválen.`); },
    onError: (e: Error) => toast.error(e.message),
  });
  const reject = useMutation({
    mutationFn: async (user: PendingUser) => {
      if (!isAdmin) throw new Error("Zamítnout účet může pouze správce.");
      const reason = window.prompt("Uveďte důvod zamítnutí registrace:", "");
      if (!reason?.trim()) throw new Error("Zamítnutí bylo zrušeno.");
      const { error } = await supabase.from("profiles").delete().eq("id", user.id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["pending-accounts"] }); toast.success("Registrace byla zamítnuta."); },
    onError: (e: Error) => { if (e.message !== "Zamítnutí bylo zrušeno.") toast.error(e.message); },
  });
  if (!isAdmin) return null;
  return <div className="grid gap-3"><div className="text-sm font-semibold">Nové registrace účtů</div>{query.isLoading ? <Card className="p-4 text-sm text-muted-foreground">Načítám…</Card> : users.length === 0 ? <Card className="p-4 text-sm text-muted-foreground">Žádná nová registrace.</Card> : users.map(user => <Card key={user.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"><div><div className="flex flex-wrap gap-2"><Badge variant="outline">Nový účet</Badge><Badge variant="secondary">ČEKÁ NA SCHVÁLENÍ</Badge></div><div className="mt-2 font-medium">{`${user.first_name} ${user.last_name}`.trim() || "(bez jména)"}</div><div className="text-sm text-muted-foreground">{user.email ?? "–"}</div></div><div className="flex flex-wrap items-center gap-2"><Select value={role} onValueChange={v => setRole(v as AppRole)}><SelectTrigger className="w-40"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="operator">Operátor</SelectItem><SelectItem value="team_leader">Team Leader</SelectItem><SelectItem value="tester">Tester</SelectItem><SelectItem value="admin">Správce</SelectItem></SelectContent></Select><Button disabled={approve.isPending} onClick={() => approve.mutate({ user, userRole: role })}>Schválit účet</Button><Button variant="destructive" disabled={reject.isPending} onClick={() => reject.mutate(user)}>Zamítnout</Button></div></Card>)}</div>;
}
