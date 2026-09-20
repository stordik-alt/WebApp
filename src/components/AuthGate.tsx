import { useState, type ReactNode } from "react";
import { ArrowLeft, ArrowRight, Eye, EyeOff, LockKeyhole, LogIn, Mail, UserPlus } from "lucide-react";
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
  const [mode, setMode] = useState<"welcome" | "in" | "up">("welcome");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [acceptedTerms, setAcceptedTerms] = useState(false);

  const signIn = async () => {
    setBusy(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (error) toast.error(error.message);
  };

  const signUp = async () => {
    const nameParts = fullName.trim().split(/\s+/).filter(Boolean);
    if (nameParts.length < 2) {
      toast.error("Vyplňte prosím jméno i příjmení.");
      return;
    }
    if (password !== confirmPassword) {
      toast.error("Hesla se neshodují.");
      return;
    }
    if (!acceptedTerms) {
      toast.error("Pro pokračování potvrďte souhlas s podmínkami.");
      return;
    }

    const firstName = nameParts[0];
    const lastName = nameParts.slice(1).join(" ");
    setBusy(true);
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${window.location.origin}/`,
        data: { first_name: firstName, last_name: lastName },
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
    const decorativeBars = (
      <>
        <span className="pointer-events-none absolute -left-24 -top-16 h-[34rem] w-16 -rotate-[28deg] rounded-[1.5rem] bg-gradient-to-b from-blue-500/20 to-blue-500/5 blur-[1px]" />
        <span className="pointer-events-none absolute -left-5 -top-20 h-[36rem] w-20 -rotate-[28deg] rounded-[1.5rem] bg-gradient-to-b from-cyan-400/14 to-cyan-400/4" />
        <span className="pointer-events-none absolute -right-24 -bottom-36 h-[34rem] w-20 -rotate-[28deg] rounded-[1.5rem] bg-gradient-to-b from-emerald-400/16 to-emerald-400/4" />
        <span className="pointer-events-none absolute -right-4 -bottom-44 h-[31rem] w-16 -rotate-[28deg] rounded-[1.5rem] bg-gradient-to-b from-blue-500/16 to-blue-500/3" />
      </>
    );

    if (mode === "welcome") {
      return (
        <main className="relative flex min-h-[100dvh] w-full items-center justify-center overflow-hidden bg-background px-6 py-10 text-foreground">
          {decorativeBars}
          <div className="relative z-10 flex w-full max-w-xl flex-col items-center">
            <ResideoLogo variant="dark" className="mb-16" />
            <div className="w-full text-center">
              <p className="mb-3 text-xs font-semibold uppercase tracking-[0.28em] text-muted-foreground">
                Vítejte v OptiShift
              </p>
              <h1 className="text-4xl font-bold leading-[1.08] tracking-[-0.04em] sm:text-5xl">
                Chytřejší směny.
                <br />
                Lepší výkon.
              </h1>
            </div>
            <div className="mt-12 grid w-full gap-3">
              <Button
                type="button"
                disabled={busy}
                onClick={() => setMode("in")}
                className="h-16 rounded-2xl bg-[linear-gradient(135deg,hsl(166_76%_58%),hsl(157_72%_57%))] text-lg font-semibold text-slate-950 shadow-[0_16px_38px_-20px_hsl(160_80%_55%_/_0.7)] hover:brightness-105"
              >
                <LogIn className="mr-3 h-6 w-6" />
                Přihlásit se
                <ArrowRight className="ml-auto h-6 w-6" />
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() => setMode("up")}
                className="h-16 rounded-2xl border-slate-500/80 bg-slate-950/10 text-lg font-medium text-foreground hover:bg-muted/60"
              >
                <UserPlus className="mr-3 h-6 w-6" />
                Registrovat se
                <ArrowRight className="ml-auto h-6 w-6" />
              </Button>
            </div>
          </div>
        </main>
      );
    }

    const isRegister = mode === "up";

    return (
      <main className="relative min-h-[100dvh] w-full overflow-hidden bg-background px-5 py-7 text-foreground sm:px-8">
        {decorativeBars}
        <div className="relative z-10 mx-auto flex min-h-[calc(100dvh-3.5rem)] w-full max-w-xl flex-col">
          <button
            type="button"
            onClick={() => setMode("welcome")}
            className="flex w-fit items-center gap-2 rounded-lg px-1 py-2 text-base text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-5 w-5" />
            Zpět
          </button>

          <div className="mt-10 flex justify-center sm:mt-12">
            <ResideoLogo variant="dark" />
          </div>

          <section className="mt-12 flex-1">
            <div className="text-center">
              <h1 className="text-4xl font-bold tracking-[-0.035em] sm:text-5xl">
                {isRegister ? "Vytvořit účet" : "Přihlásit se"}
              </h1>
              <p className="mt-3 text-lg text-muted-foreground">
                {isRegister
                  ? "Připojte se k OptiShift a získejte přístup k chytrému řízení směn."
                  : "Zadejte své přihlašovací údaje."}
              </p>
            </div>

            {sentTo ? (
              <div className="mt-8 rounded-2xl border border-emerald-400/30 bg-emerald-400/8 p-4 text-sm text-muted-foreground">
                Na <span className="font-semibold text-foreground">{sentTo}</span> jsme poslali ověřovací e-mail. Po potvrzení adresy se můžete přihlásit.
              </div>
            ) : null}

            <form
              className="mt-8 grid gap-4"
              onSubmit={(e) => {
                e.preventDefault();
                void (isRegister ? signUp() : signIn());
              }}
            >
              {isRegister ? (
                <div className="grid gap-2">
                  <Label htmlFor="fullName">Jméno a příjmení</Label>
                  <div className="relative">
                    <UserPlus className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      id="fullName"
                      autoComplete="name"
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      className="h-14 rounded-2xl border-slate-500/70 bg-slate-950/15 pl-12 text-base"
                      placeholder="Jan Novák"
                      required
                    />
                  </div>
                </div>
              ) : null}

              <div className="grid gap-2">
                <Label htmlFor="email">E-mail</Label>
                <div className="relative">
                  <Mail className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="email"
                    type="email"
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="h-14 rounded-2xl border-slate-500/70 bg-slate-950/15 pl-12 text-base"
                    placeholder="vas@email.cz"
                    required
                  />
                </div>
              </div>

              <div className="grid gap-2">
                <Label htmlFor="password">Heslo</Label>
                <div className="relative">
                  <LockKeyhole className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    autoComplete={isRegister ? "new-password" : "current-password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="h-14 rounded-2xl border-slate-500/70 bg-slate-950/15 pl-12 pr-12 text-base"
                    required
                  />
                  <button
                    type="button"
                    aria-label={showPassword ? "Skrýt heslo" : "Zobrazit heslo"}
                    onClick={() => setShowPassword((value) => !value)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 rounded-lg p-2 text-muted-foreground hover:text-foreground"
                  >
                    {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                  </button>
                </div>
              </div>

              {isRegister ? (
                <>
                  <div className="grid gap-2">
                    <Label htmlFor="confirmPassword">Potvrdit heslo</Label>
                    <div className="relative">
                      <LockKeyhole className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        id="confirmPassword"
                        type={showConfirmPassword ? "text" : "password"}
                        autoComplete="new-password"
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        className="h-14 rounded-2xl border-slate-500/70 bg-slate-950/15 pl-12 pr-12 text-base"
                        required
                      />
                      <button
                        type="button"
                        aria-label={showConfirmPassword ? "Skrýt heslo" : "Zobrazit heslo"}
                        onClick={() => setShowConfirmPassword((value) => !value)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 rounded-lg p-2 text-muted-foreground hover:text-foreground"
                      >
                        {showConfirmPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                      </button>
                    </div>
                  </div>

                  <label className="mt-1 flex cursor-pointer items-start gap-3 text-sm text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={acceptedTerms}
                      onChange={(e) => setAcceptedTerms(e.target.checked)}
                      className="mt-0.5 h-5 w-5 shrink-0 accent-emerald-400"
                    />
                    <span>
                      Souhlasím s <span className="text-emerald-400">podmínkami použití</span> a <span className="text-emerald-400">zásadami ochrany osobních údajů</span>
                    </span>
                  </label>
                </>
              ) : null}

              <Button
                type="submit"
                disabled={busy}
                className="mt-2 h-16 rounded-2xl bg-[linear-gradient(135deg,hsl(166_76%_58%),hsl(157_72%_57%))] text-lg font-semibold text-slate-950 shadow-[0_16px_38px_-20px_hsl(160_80%_55%_/_0.7)] hover:brightness-105"
              >
                {isRegister ? "Vytvořit účet" : "Přihlásit se"}
                <ArrowRight className="ml-auto h-6 w-6" />
              </Button>

              <div className="my-1 flex items-center gap-4 text-xs font-medium uppercase tracking-[0.24em] text-muted-foreground">
                <span className="h-px flex-1 bg-border" />
                nebo
                <span className="h-px flex-1 bg-border" />
              </div>

              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() => {
                  setSentTo(null);
                  setMode(isRegister ? "in" : "up");
                }}
                className="h-14 rounded-2xl border-slate-500/80 bg-slate-950/10 text-base hover:bg-muted/60"
              >
                {isRegister ? <LogIn className="mr-3 h-5 w-5" /> : <UserPlus className="mr-3 h-5 w-5" />}
                {isRegister ? "Již mám účet – přihlásit se" : "Nemám účet – registrovat se"}
              </Button>
            </form>
          </section>
        </div>
      </main>
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
