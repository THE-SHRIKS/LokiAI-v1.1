import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { Asterisk, ArrowLeft } from "lucide-react";
import { resetPassword } from "@/lib/lokiai-api";

export const Route = createFileRoute("/reset-password")({
  validateSearch: (search: Record<string, unknown>): { token?: string } =>
    typeof search.token === "string" ? { token: search.token } : {},
  head: () => ({
    meta: [
      { title: "LokiAI — Set new password" },
      { name: "description", content: "Set a new password for your LokiAI account." },
    ],
  }),
  component: ResetPasswordPage,
});

function ResetPasswordPage() {
  const navigate = useNavigate();
  const { token } = Route.useSearch();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!token) {
      setError("This reset link is missing its token. Request a new one.");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords don't match.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await resetPassword(token, password);
      navigate({ to: "/login", search: { reset: "success" } });
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
          <span className="ml-auto text-[11px] text-muted-foreground">set new password</span>
        </div>

        <form onSubmit={submit} className="flex flex-col gap-3 px-4 py-4">
          {!token && (
            <div className="rounded border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive-foreground">
              No reset token found in this link. Request a new one from the{" "}
              <Link to="/forgot-password" className="underline">
                forgot password
              </Link>{" "}
              page.
            </div>
          )}
          <label className="flex flex-col gap-1 text-[11px] uppercase tracking-wider text-muted-foreground">
            New password
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
              placeholder="••••••••"
              className="rounded border border-border bg-background px-3 py-2 text-sm tracking-normal text-foreground placeholder:text-muted-foreground/60 focus:border-olive focus:outline-none"
            />
            <span className="mt-0.5 text-[10px] normal-case tracking-normal text-muted-foreground/70">
              At least 8 characters.
            </span>
          </label>
          <label className="flex flex-col gap-1 text-[11px] uppercase tracking-wider text-muted-foreground">
            Confirm password
            <input
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              autoComplete="new-password"
              placeholder="••••••••"
              className="rounded border border-border bg-background px-3 py-2 text-sm tracking-normal text-foreground placeholder:text-muted-foreground/60 focus:border-olive focus:outline-none"
            />
          </label>

          {error && (
            <div className="rounded border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive-foreground">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={busy || !token}
            className="mt-1 rounded bg-olive px-3 py-2 text-sm text-background hover:bg-olive-bright disabled:opacity-50"
          >
            {busy ? "Updating…" : "Set new password"}
          </button>

          <Link
            to="/login"
            className="inline-flex items-center justify-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-3 w-3" /> Back to sign in
          </Link>
        </form>
      </div>
    </div>
  );
}
