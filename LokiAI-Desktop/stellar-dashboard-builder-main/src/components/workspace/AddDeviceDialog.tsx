import { useCallback, useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { Download, RefreshCw, ScanLine, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { generatePairingToken } from "@/lib/lokiai-api";

interface AddDeviceDialogProps {
  open: boolean;
  onClose: () => void;
}

type Step = "install" | "pair";

/// "Add Device" flow: real one-time pairing token from POST /pairing/generate.
/// Step 1 QR: the canonical Android download page in production, with the
/// local dashboard origin retained for LAN development.
/// Step 2 QR: the pairing payload (scanned from inside the LokiAI app).
export function AddDeviceDialog({ open, onClose }: AddDeviceDialogProps) {
  const [step, setStep] = useState<Step>("install");
  const [qrData, setQrData] = useState<string | null>(null);
  const [installUrl, setInstallUrl] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<Date | null>(null);
  const [secondsLeft, setSecondsLeft] = useState<number>(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const generate = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const installPageUrl =
        window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1"
          ? `${window.location.origin}/android-app`
          : "https://lokiai.theshriks.space/android-app";

      const res = await generatePairingToken();
      setQrData(res.qr_data);
      setInstallUrl(installPageUrl);
      setExpiresAt(new Date(res.expires_at));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    if (open) {
      setStep("install");
      generate();
    }
  }, [open, generate]);

  useEffect(() => {
    if (!expiresAt) return;
    const t = setInterval(() => {
      setSecondsLeft(Math.max(0, Math.floor((expiresAt.getTime() - Date.now()) / 1000)));
    }, 1000);
    return () => clearInterval(t);
  }, [expiresAt]);

  if (!open) return null;

  const expired = expiresAt !== null && secondsLeft <= 0;

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-background/80 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-md border border-border bg-panel">
        <div className="flex items-center gap-2 border-b border-border px-4 py-2.5 text-sm">
          <ScanLine className="h-4 w-4 text-olive-bright" />
          <span>Add Device</span>
          <button
            onClick={onClose}
            className="ml-auto rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="flex border-b border-border text-xs">
          <StepTab active={step === "install"} onClick={() => setStep("install")}>
            <Download className="h-3 w-3" /> 1 · Get the app
          </StepTab>
          <StepTab active={step === "pair"} onClick={() => setStep("pair")}>
            <ScanLine className="h-3 w-3" /> 2 · Pair phone
          </StepTab>
        </div>

        <div className="flex flex-col items-center gap-3 px-4 py-5">
          {error ? (
            <div className="rounded border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs">
              {error}
            </div>
          ) : busy || !qrData ? (
            <div className="py-10 text-xs text-muted-foreground">Generating code…</div>
          ) : step === "install" ? (
            <>
              {installUrl && (
                <div className="rounded-md border border-border bg-background p-3">
                  <QRCodeSVG value={installUrl} size={208} bgColor="transparent" fgColor="#e8ede0" />
                </div>
              )}
              <div className="text-center text-xs text-muted-foreground">
                Scan with your phone's <span className="text-foreground">default camera</span>.
                <br />
                It opens {installUrl ?? "the install page"} — download and install LokiAI.
                <br />
                Already installed? Skip to step 2.
              </div>
            </>
          ) : (
            <>
              <div className="rounded-md border border-border bg-background p-3">
                <QRCodeSVG value={qrData} size={208} bgColor="transparent" fgColor="#e8ede0" />
              </div>
              <div className="text-center text-xs text-muted-foreground">
                Open the <span className="text-foreground">LokiAI app</span> on your phone and
                scan this code.
                <br />
                The phone reads its own specs and appears in your fleet automatically.
              </div>
              <div
                className={cn(
                  "text-[11px]",
                  expired ? "text-destructive-foreground" : "text-muted-foreground",
                )}
              >
                {expired ? "This code has expired — generate a new one." : `Expires in ${Math.floor(secondsLeft / 60)}:${String(secondsLeft % 60).padStart(2, "0")}`}
              </div>
            </>
          )}

          <button
            onClick={generate}
            disabled={busy}
            className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-xs text-muted-foreground hover:border-olive hover:text-foreground disabled:opacity-50"
          >
            <RefreshCw className={cn("h-3 w-3", busy && "animate-spin")} /> New code
          </button>
        </div>
      </div>
    </div>
  );
}

function StepTab({
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
        active ? "bg-background text-foreground" : "text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}
