import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

export type AppRole = "admin" | "team_leader" | "operator";

export type AppProfile = {
  id: string;
  email: string | null;
  first_name: string;
  last_name: string;
  employee_id: string | null;
};

type AuthValue = {
  session: Session | null;
  profile: AppProfile | null;
  role: AppRole | null;
  ready: boolean;
  isAdmin: boolean;
  isTeamLeader: boolean;
  isOperator: boolean;
  refresh: () => Promise<void>;
};

const ROLE_LABEL: Record<AppRole, string> = {
  admin: "Správce",
  team_leader: "Team Leader",
  operator: "Operátor",
};

export function roleLabel(role: AppRole | null) {
  return role ? ROLE_LABEL[role] : "Bez role (čeká na schválení)";
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<AppProfile | null>(null);
  const [role, setRole] = useState<AppRole | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    void supabase.auth.getSession().then(({ data }) => setSession(data.session));
    return () => sub.subscription.unsubscribe();
  }, []);

  const load = useCallback(async (current: Session | null) => {
    if (!current) {
      setProfile(null);
      setRole(null);
      setReady(true);
      return;
    }
    const meta = (current.user.user_metadata ?? {}) as { first_name?: string; last_name?: string };
    const { data: prof } = await supabase.rpc("ensure_profile", {
      _first_name: meta.first_name ?? "",
      _last_name: meta.last_name ?? "",
    });
    const row = Array.isArray(prof) ? (prof[0] as AppProfile | undefined) : (prof as AppProfile | null);
    setProfile(row ?? null);

    const { data: roles } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", current.user.id);
    const found = (roles ?? []).map((r) => r.role as AppRole);
    setRole(
      found.includes("admin")
        ? "admin"
        : found.includes("team_leader")
          ? "team_leader"
          : found.includes("operator")
            ? "operator"
            : null,
    );
    setReady(true);
  }, []);

  useEffect(() => {
    setReady(false);
    void load(session);
  }, [session, load]);

  const value: AuthValue = {
    session,
    profile,
    role,
    ready,
    isAdmin: role === "admin",
    isTeamLeader: role === "team_leader",
    isOperator: role === "operator",
    refresh: () => load(session),
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth musí být uvnitř AuthProvider");
  return ctx;
}

/**
 * Pole pro schvalovací proces – správce ukládá rovnou, Team Leader
 * vždy jen jako návrh čekající na kontrolu.
 */
export function useApprovalFields() {
  const { isAdmin, session } = useAuth();
  return () =>
    isAdmin
      ? { approval_status: "approved" as const }
      : { approval_status: "pending" as const, submitted_by: session?.user.id ?? null };
}
