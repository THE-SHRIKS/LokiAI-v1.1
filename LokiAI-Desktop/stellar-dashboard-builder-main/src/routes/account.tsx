import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { getMe, saveNimKey, type Me } from "@/lib/lokiai-api";
import { User, KeyRound, Smartphone, ArrowLeft, ExternalLink, Eye, EyeOff } from "lucide-react";

export const Route = createFileRoute("/account")({
  head: () => ({
    meta: [{ title: "LokiAI — Account Settings" }],
  }),
  component: AccountSettings,
});

function AccountSettings() {
  const [me, setMe] = useState<Me | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; type: "error" | "success" } | null>(null);

  const [showKey, setShowKey] = useState(false);

  useEffect(() => {
    getMe().then((m) => {
      setMe(m);
      if (m.nim_key) {
        setApiKey(m.nim_key);
      } else if (m.has_nim_key) {
        setApiKey("••••••••••••••••••••••••"); // Masked for security fallback
      }
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
      setMe((prev) => (prev ? { ...prev, has_nim_key: true, nim_key: key } : null));
    } catch (e) {
      setMessage({ text: e instanceof Error ? e.message : String(e), type: "error" });
    } finally {
      setBusy(false);
    }
  };

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

            <div className="mt-4 flex gap-3">
              <div className="relative flex-1">
                <input
                  type={showKey ? "text" : "password"}
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="nvapi-..."
                  className="w-full rounded border border-border bg-background pl-3 pr-10 py-2 text-sm text-foreground focus:border-olive focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => setShowKey(!showKey)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              <button
                onClick={handleUpdateKey}
                disabled={busy || !apiKey || apiKey.startsWith("•••")}
                className="rounded-md bg-olive px-4 py-2 text-sm font-medium text-background transition-colors hover:bg-olive-bright disabled:opacity-50"
              >
                {busy ? "Updating..." : "Update Key"}
              </button>
            </div>

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
