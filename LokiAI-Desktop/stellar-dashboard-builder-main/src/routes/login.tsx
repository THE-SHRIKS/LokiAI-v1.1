import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { Asterisk, LogIn, UserPlus, Mail, ArrowLeft } from "lucide-react";
import { cn } from "@/lib/utils";
import { login, register, verifyOtp, resendOtp, getToken, ApiError } from "@/lib/lokiai-api";

export const Route = createFileRoute("/login")({
  validateSearch: (search: Record<string, unknown>): { reset?: string } =>
    typeof search.reset === "string" ? { reset: search.reset } : {},
  head: () => ({
    meta: [
      { title: "LokiAI — Sign in" },
      { name: "description", content: "Sign in to your LokiAI workspace." },
    ],
  }),
  component: LoginPage,
});

type Mode = "signin" | "signup";
type Step = "form" | "otp";

function LoginPage() {
  const navigate = useNavigate();
  const { reset } = Route.useSearch();
  const [mode, setMode] = useState<Mode>("signin");
  const [step, setStep] = useState<Step>("form");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [otp, setOtp] = useState("");
  const [pendingEmail, setPendingEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(
    reset === "success" ? "Password updated successfully. Sign in with your new password." : null,
  );

  // Already signed in? Straight to the workspace.
  if (typeof window !== "undefined" && getToken()) {
    navigate({ to: "/" });
  }

  const submitForm = async (e: FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password) {
      setError("Email and password are required.");
      return;
    }
    if (mode === "signup" && !name.trim()) {
      setError("Name is required.");
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      if (mode === "signup") {
        await register(email.trim(), password, name.trim());
        setPendingEmail(email.trim());
        setNotice(`We sent a 6-digit code to ${email.trim()}. Enter it below to verify your email.`);
        setStep("otp");
      } else {
        await login(email.trim(), password);
        navigate({ to: "/" });
      }
    } catch (err) {
      // A 403 on sign-in means the account exists but was never verified —
      // route straight into the OTP step instead of a dead-end error.
      if (err instanceof ApiError && err.status === 403 && mode === "signin") {
        setPendingEmail(email.trim());
        setNotice("This account hasn't been verified yet. Enter the code from your email, or request a new one.");
        setStep("otp");
      } else {
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      setBusy(false);
    }
  };

  const submitOtp = async (e: FormEvent) => {
    e.preventDefault();
    if (otp.trim().length !== 6) {
      setError("Enter the 6-digit code.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await verifyOtp(pendingEmail, otp.trim());
      navigate({ to: "/" });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleResend = async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await resendOtp(pendingEmail);
      setNotice(`A new code was sent to ${pendingEmail}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const backToForm = () => {
    setStep("form");
    setOtp("");
    setError(null);
    setNotice(null);
  };

  return (
    <div className="flex h-screen flex-col items-center justify-center bg-background text-foreground">
      <div className="w-full max-w-sm rounded-md border border-border bg-panel">
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          <img src="/lokiai-logo.png" alt="LokiAI" style={{ height: 22, width: "auto", opacity: 0.9 }} />
          <span className="ml-auto text-[11px] text-muted-foreground">
            on-device AI, no cloud
          </span>
        </div>

        {step === "form" ? (
          <>
            <div className="flex border-b border-border text-xs">
              <TabButton active={mode === "signin"} onClick={() => { setMode("signin"); setError(null); }}>
                <LogIn className="h-3 w-3" /> Sign in
              </TabButton>
              <TabButton active={mode === "signup"} onClick={() => { setMode("signup"); setError(null); }}>
                <UserPlus className="h-3 w-3" /> Sign up
              </TabButton>
            </div>

            <form onSubmit={submitForm} className="flex flex-col gap-3 px-4 py-4">
              {mode === "signup" && (
                <label className="flex flex-col gap-1 text-[11px] uppercase tracking-wider text-muted-foreground">
                  Name
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    autoComplete="name"
                    placeholder="Your name"
                    className="rounded border border-border bg-background px-3 py-2 text-sm normal-case tracking-normal text-foreground placeholder:text-muted-foreground/60 focus:border-olive focus:outline-none"
                  />
                </label>
              )}
              <label className="flex flex-col gap-1 text-[11px] uppercase tracking-wider text-muted-foreground">
                Email
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email"
                  placeholder="you@example.com"
                  className="rounded border border-border bg-background px-3 py-2 text-sm normal-case tracking-normal text-foreground placeholder:text-muted-foreground/60 focus:border-olive focus:outline-none"
                />
              </label>
              <label className="flex flex-col gap-1 text-[11px] uppercase tracking-wider text-muted-foreground">
                Password
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete={mode === "signup" ? "new-password" : "current-password"}
                  placeholder="••••••••"
                  className="rounded border border-border bg-background px-3 py-2 text-sm tracking-normal text-foreground placeholder:text-muted-foreground/60 focus:border-olive focus:outline-none"
                />
                {mode === "signup" && (
                  <span className="mt-0.5 text-[10px] normal-case tracking-normal text-muted-foreground/70">
                    At least 8 characters.
                  </span>
                )}
              </label>

              {mode === "signin" && (
                <Link
                  to="/forgot-password"
                  className="-mt-1 self-end text-[11px] text-muted-foreground hover:text-foreground"
                >
                  Forgot password?
                </Link>
              )}

              {notice && !error && (
                <div className="rounded border border-olive/40 bg-olive/10 px-3 py-2 text-xs text-olive-glow">
                  {notice}
                </div>
              )}

              {error && (
                <div className="rounded border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive-foreground">
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={busy}
                className="mt-1 rounded bg-olive px-3 py-2 text-sm text-background hover:bg-olive-bright disabled:opacity-50"
              >
                {busy
                  ? "Working…"
                  : mode === "signin"
                    ? "Sign in"
                    : "Create account"}
              </button>
            </form>
          </>
        ) : (
          <form onSubmit={submitOtp} className="flex flex-col gap-3 px-4 py-4">
            <button
              type="button"
              onClick={backToForm}
              className="mb-1 inline-flex w-fit items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="h-3 w-3" /> Back
            </button>
            <div className="flex items-center gap-2 rounded border border-border bg-background/60 px-3 py-2 text-xs text-muted-foreground">
              <Mail className="h-3.5 w-3.5 shrink-0 text-olive-bright" />
              <span>Code sent to <span className="text-foreground">{pendingEmail}</span></span>
            </div>
            <label className="flex flex-col gap-1 text-[11px] uppercase tracking-wider text-muted-foreground">
              6-digit code
              <input
                value={otp}
                onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="000000"
                className="rounded border border-border bg-background px-3 py-2 text-center text-lg normal-case tracking-[0.4em] text-foreground placeholder:text-muted-foreground/40 focus:border-olive focus:outline-none"
              />
            </label>

            {notice && !error && (
              <div className="rounded border border-olive/40 bg-olive/10 px-3 py-2 text-xs text-olive-glow">
                {notice}
              </div>
            )}
            {error && (
              <div className="rounded border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive-foreground">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={busy}
              className="mt-1 rounded bg-olive px-3 py-2 text-sm text-background hover:bg-olive-bright disabled:opacity-50"
            >
              {busy ? "Verifying…" : "Verify"}
            </button>
            <button
              type="button"
              onClick={handleResend}
              disabled={busy}
              className="text-center text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-50"
            >
              Resend code
            </button>
          </form>
        )}

        <div className="border-t border-border px-4 py-2 text-[11px] text-muted-foreground">
          Your devices run AI locally. This account only orchestrates them.
        </div>
      </div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex flex-1 items-center justify-center gap-1.5 px-3 py-2",
        active
          ? "bg-background text-foreground"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}
