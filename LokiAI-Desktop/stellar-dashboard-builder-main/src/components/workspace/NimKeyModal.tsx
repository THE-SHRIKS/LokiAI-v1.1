import { useState } from "react";
import { KeyRound, ExternalLink } from "lucide-react";
import { saveNimKey } from "@/lib/lokiai-api";

interface NimKeyModalProps {
  onSaved: () => void;
}

/// Compulsory, non-dismissable: no X button, no backdrop-click-to-close.
/// Every account brings its own NVIDIA NIM API key — the AI assistant
/// can't call NIM on the user's behalf without one, and there's no shared
/// fallback key (see LokiAI-backend/main.py's assistant_chat, which 428s
/// without a per-user key).
export function NimKeyModal({ onSaved }: NimKeyModalProps) {
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    const key = apiKey.trim();
    if (!key) {
      setError("Enter your NVIDIA NIM API key.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await saveNimKey(key);
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-background/90 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-md border border-border bg-panel">
        <div className="flex items-center gap-2 border-b border-border px-4 py-2.5 text-sm">
          <KeyRound className="h-4 w-4 text-olive-bright" />
          <span>Add your NVIDIA NIM API key</span>
        </div>

        <div className="flex flex-col gap-3 px-4 py-5">
          <p className="text-xs text-muted-foreground">
            LokiAI's AI assistant runs on NVIDIA NIM. Every account uses its own key — there's no
            shared key, and the assistant won't respond until you add yours.
          </p>

          <a
            href="https://build.nvidia.com"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-xs text-olive-bright hover:underline"
          >
            Get a free API key at build.nvidia.com <ExternalLink className="h-3 w-3" />
          </a>

          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
            placeholder="nvapi-..."
            autoFocus
            className="rounded border border-border bg-background px-2.5 py-2 text-sm text-foreground focus:border-olive focus:outline-none"
          />

          {error && (
            <div className="rounded border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs">
              {error}
            </div>
          )}

          <button
            onClick={submit}
            disabled={busy}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
          >
            {busy ? "Saving…" : "Save and continue"}
          </button>
        </div>
      </div>
    </div>
  );
}
