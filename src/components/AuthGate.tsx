import { useState, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { ResideoLogo } from "@/components/ResideoLogo";
import { toast } from "sonner";
import { useAuth, roleLabel } from "@/lib/auth";

/** Ochrana aplikace – data jsou dostupná jen přihlášenému uživateli s přidělenou rolí. */
export function AuthGate({ children }: { children: ReactNode }) {
  const { session, role, profile, ready } = useAuth();
  const [mode, setMode] = useState<"in" | "up">("in");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);

  const signIn = async () => {
    setBusy(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (error) toast.error(error.message);
  };

  const signUp = async () => {
    if (!firstName.trim() || !lastName.trim()) {
      toast.error("Vyplňte prosím jméno i příjmení.");
      return;
    }
    setBusy(true);
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${window.location.origin}/`,
        data: { first_name: firstName.trim(), last_name: lastName.trim() },
      },
    });
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    if (!data.session) {
      setSentTo(email);
      toast.success("Potvrzovací e-mail odeslán.");
    }
  };

  if (!ready && !session) {
    return <div className="min-h-screen bg-background" />;
  }

  if (!session) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4 py-8">
        <Card className="w-full max-w-sm gap-5 rounded-2xl border-border/70 p-7 shadow-[var(--shadow-card)]">
          <div>
            <ResideoLogo variant="dark" />
            {mode === "up" ? (
              <p className="mt-4 text-sm text-muted-foreground">
                Registrace nového účtu. Přístup přidělí správce.
              </p>
            ) : null}
          </div>

          {sentTo ? (
            <div className="rounded-xl border border-border bg-muted/40 p-3 text-sm text-muted-foreground">
              Na <span className="font-medium text-foreground">{sentTo}</span> jsme poslali
              ověřovací e-mail. Po potvrzení adresy se přihlaste – přístup k datům vám následně
              přidělí správce.
            </div>
          ) : null}

          <form
            className="grid gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              void (mode === "in" ? signIn() : signUp());
            }}
          >
            {mode === "up" ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="grid gap-1.5 form-row">
                  <Label htmlFor="firstName">Jméno</Label>
                  <Input
                    id="firstName"
                    autoComplete="given-name"
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    required
                  />
                </div>
                <div className="grid gap-1.5 form-row">
                  <Label htmlFor="lastName">Příjmení</Label>
                  <Input
                    id="lastName"
                    autoComplete="family-name"
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    required
                  />
                </div>
              </div>
            ) : null}

            <div className="grid gap-1.5 form-row">
              <Label htmlFor="email">E-mail</Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <div className="grid gap-1.5 form-row">
              <Label htmlFor="password">Heslo</Label>
              <Input
                id="password"
                type="password"
                autoComplete={mode === "in" ? "current-password" : "new-password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            <Button type="submit" disabled={busy} className="shadow-md">
              {mode === "in" ? "Přihlásit se" : "Vytvořit účet"}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => {
                setSentTo(null);
                setMode(mode === "in" ? "up" : "in");
              }}
            >
              {mode === "in" ? "Nemám účet – registrovat se" : "Zpět na přihlášení"}
            </Button>
          </form>
        </Card>
      </div>
    );
  }

  if (!ready) {
    return <div className="min-h-screen bg-background" />;
  }

  if (!role) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <Card className="w-full max-w-sm gap-4 p-6 text-center shadow-[var(--shadow-card)]">
          <h1 className="text-lg font-semibold tracking-tight text-foreground">Čeká se na schválení</h1>
          <p className="text-sm text-muted-foreground">
            Účet {profile?.email ?? ""} zatím nemá přidělenou úroveň přístupu ({roleLabel(null)}).
            Požádejte prosím správce aplikace o přidělení role.
          </p>
          <Button variant="outline" onClick={() => void supabase.auth.signOut()}>
            Odhlásit se
          </Button>
        </Card>
      </div>
    );
  }

  return <>{children}</>;
}
