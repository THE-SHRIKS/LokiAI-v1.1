import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { Asterisk, ArrowLeft, Mail } from "lucide-react";
import { forgotPassword } from "@/lib/lokiai-api";

export const Route = createFileRoute("/forgot-password")({
  head: () => ({
    meta: [
      { title: "LokiAI — Reset password" },
      { name: "description", content: "Request a password reset link." },
    ],
  }),
  component: ForgotPasswordPage,
});

function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!email.trim()) {
      setError("Enter your email.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await forgotPassword(email.trim());
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-screen flex-col items-center justify-center bg-background text-foreground">
      <div className="w-full max-w-sm rounded-md border border-border bg-panel">
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          <Asterisk className="h-4 w-4 text-olive-bright" />
          <span className="text-sm font-medium">LokiAI</span>
          <span className="ml-auto text-[11px] text-muted-foreground">reset password</span>
        </div>

        {sent ? (
          <div className="flex flex-col gap-3 px-4 py-4">
            <div className="flex items-center gap-2 rounded border border-olive/40 bg-olive/10 px-3 py-2 text-xs text-olive-glow">
              <Mail className="h-3.5 w-3.5 shrink-0" />
              <span>
                If <span className="text-foreground">{email.trim()}</span> exists, a reset link
                was just sent. It expires in 15 minutes.
              </span>
            </div>
            <Link
              to="/login"
              className="mt-1 inline-flex items-center justify-center gap-1 rounded bg-olive px-3 py-2 text-sm text-background hover:bg-olive-bright"
            >
              Back to sign in
            </Link>
          </div>
        ) : (
          <form onSubmit={submit} className="flex flex-col gap-3 px-4 py-4">
            <Link
              to="/login"
              className="mb-1 inline-flex w-fit items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="h-3 w-3" /> Back to sign in
            </Link>
            <p className="text-xs text-muted-foreground">
              Enter the email on your account. We'll send a link to set a new password.
            </p>
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
              {busy ? "Sending…" : "Send reset link"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
