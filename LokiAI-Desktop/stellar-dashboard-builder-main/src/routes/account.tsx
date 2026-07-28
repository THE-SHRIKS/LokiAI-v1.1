import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { getMe, saveNimKey, deleteNimKey, type Me } from "@/lib/lokiai-api";
import { User, KeyRound, Smartphone, ArrowLeft, ExternalLink } from "lucide-react";

export const Route = createFileRoute("/account")({
  head: () => ({
    meta: [{ title: "LokiAI — Account Settings" }],
  }),
  component: AccountSettings,
});

function AccountSettings() {
  const [me, setMe] = useState<Me | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [replacing, setReplacing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; type: "error" | "success" } | null>(null);

  useEffect(() => {
    getMe().then((m) => {
      setMe(m);
      // Never pre-fill a saved key — the backend never sends it back.
      // We only track whether one exists (has_nim_key boolean).
    });
  }, []);

  const handleUpdateKey = async () => {
    const key = apiKey.trim();
    if (!key.startsWith("nvapi-")) {
      setMessage({ text: "NVIDIA NIM API keys must start with 'nvapi-'.", type: "error" });
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      await saveNimKey(key);
      setMessage({ text: "API key updated successfully.", type: "success" });
      setMe((prev) => (prev ? { ...prev, has_nim_key: true } : null));
      // Clear the field immediately — the key must not persist in state.
      setApiKey("");
      setReplacing(false);
    } catch (e) {
      setMessage({ text: e instanceof Error ? e.message : String(e), type: "error" });
    } finally {
      setBusy(false);
    }
  };

  const handleRemoveKey = async () => {
    if (!confirm("Remove your NVIDIA NIM API key? The AI assistant will stop working until you add a new one.")) return;
    setBusy(true);
    setMessage(null);
    try {
      await deleteNimKey();
      setMe((prev) => (prev ? { ...prev, has_nim_key: false } : null));
      setApiKey("");
      setReplacing(false);
      setMessage({ text: "API key removed.", type: "success" });
    } catch (e) {
      setMessage({ text: e instanceof Error ? e.message : String(e), type: "error" });
    } finally {
      setBusy(false);
    }
  };

  const hasKey = me?.has_nim_key ?? false;
  const showInput = !hasKey || replacing;

  return (
    <div className="flex h-screen flex-col bg-background text-foreground overflow-y-auto">
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-border bg-panel px-6 py-4">
        <Link
          to="/"
          className="inline-flex h-8 w-8 items-center justify-center rounded border border-border bg-background text-muted-foreground transition-colors hover:border-olive hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <h1 className="text-lg font-semibold text-foreground">Account Settings</h1>
      </div>

      <div className="mx-auto mt-8 w-full max-w-2xl px-6 pb-20">
        {/* Profile Section */}
        <section className="mb-10">
          <h2 className="mb-4 flex items-center gap-2 text-sm font-medium uppercase tracking-wider text-muted-foreground">
            <User className="h-4 w-4" /> User Profile
          </h2>
          <div className="rounded-lg border border-border bg-panel p-6">
            <div className="mb-4 grid grid-cols-[120px_1fr] items-center gap-4">
              <span className="text-sm text-muted-foreground">Name</span>
              <span className="text-sm font-medium text-foreground">{me?.name ?? "Loading..."}</span>
            </div>
            <div className="grid grid-cols-[120px_1fr] items-center gap-4">
              <span className="text-sm text-muted-foreground">Email</span>
              <span className="text-sm font-medium text-foreground">{me?.email ?? "Loading..."}</span>
            </div>
          </div>
        </section>

        {/* API Key Management */}
        <section className="mb-10">
          <h2 className="mb-4 flex items-center gap-2 text-sm font-medium uppercase tracking-wider text-muted-foreground">
            <KeyRound className="h-4 w-4" /> API Integrations
          </h2>
          <div className="rounded-lg border border-border bg-panel p-6">
            <h3 className="text-base font-semibold text-foreground">NVIDIA NIM API Key</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              LokiAI's AI assistant uses this key to fetch model recommendations and answer queries.
            </p>
            <a
              href="https://build.nvidia.com"
              target="_blank"
              rel="noreferrer"
              className="mt-2 inline-flex items-center gap-1 text-xs text-olive-bright hover:underline"
            >
              Get a free API key at build.nvidia.com <ExternalLink className="h-3 w-3" />
            </a>

            {/* Configured state — key exists and user is not replacing */}
            {hasKey && !replacing && (
              <div className="mt-4 rounded border border-olive/30 bg-olive/5 px-4 py-3">
                <div className="mb-3 text-sm text-olive-glow">NVIDIA NIM API key configured</div>
                <div className="flex gap-2">
                  <button
                    id="nim-key-replace-btn"
                    onClick={() => { setReplacing(true); setMessage(null); setApiKey(""); }}
                    disabled={busy}
                    className="rounded border border-border bg-background px-3 py-1.5 text-xs text-foreground transition-colors hover:border-olive hover:text-foreground disabled:opacity-50"
                  >
                    Replace key
                  </button>
                  <button
                    id="nim-key-remove-btn"
                    onClick={handleRemoveKey}
                    disabled={busy}
                    className="rounded border border-destructive/40 bg-destructive/10 px-3 py-1.5 text-xs text-destructive-foreground transition-colors hover:bg-destructive/20 disabled:opacity-50"
                  >
                    {busy ? "Removing…" : "Remove key"}
                  </button>
                </div>
              </div>
            )}

            {/* Input — shown when no key exists or user clicked Replace */}
            {showInput && (
              <div className="mt-4 flex gap-3">
                {/* type=password: value is always masked while typing.
                    No reveal button — a saved key must never be retrievable. */}
                <input
                  id="nim-key-input"
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="nvapi-..."
                  autoComplete="new-password"
                  className="flex-1 rounded border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-olive focus:outline-none"
                />
                <button
                  id="nim-key-save-btn"
                  onClick={handleUpdateKey}
                  disabled={busy || !apiKey}
                  className="rounded-md bg-olive px-4 py-2 text-sm font-medium text-background transition-colors hover:bg-olive-bright disabled:opacity-50"
                >
                  {busy ? "Saving…" : "Save key"}
                </button>
                {replacing && (
                  <button
                    onClick={() => { setReplacing(false); setApiKey(""); setMessage(null); }}
                    className="rounded border border-border px-3 py-2 text-xs text-muted-foreground hover:text-foreground"
                  >
                    Cancel
                  </button>
                )}
              </div>
            )}

            {message && (
              <div className={`mt-4 rounded border px-3 py-2 text-xs ${
                message.type === "error" ? "border-destructive/40 bg-destructive/10 text-destructive-foreground" : "border-olive/40 bg-olive/10 text-olive-glow"
              }`}>
                {message.text}
              </div>
            )}
          </div>
        </section>

        {/* Devices Section */}
        <section>
          <h2 className="mb-4 flex items-center gap-2 text-sm font-medium uppercase tracking-wider text-muted-foreground">
            <Smartphone className="h-4 w-4" /> Connected Hardware
          </h2>
          <div className="rounded-lg border border-border bg-panel p-6">
            <p className="mb-4 text-sm text-muted-foreground">
              Manage all Android devices currently paired with your LokiAI account for offline inference.
            </p>
            <Link
              to="/devices"
              className="inline-flex h-9 items-center justify-center rounded-md border border-border bg-background px-4 text-sm font-medium text-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              Manage Connected Devices
            </Link>
          </div>
        </section>
      </div>
    </div>
  );
}
