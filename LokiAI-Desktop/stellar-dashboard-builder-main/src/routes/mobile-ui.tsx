import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Download, CheckCircle } from "lucide-react";
import { backendUrl } from "@/lib/lokiai-api";

function apkUrl(): string {
  return `${backendUrl()}/apk/download`;
}

export const Route = createFileRoute("/mobile-ui")({
  head: () => ({
    meta: [
      { title: "LokiAI — Get the App" },
      {
        name: "description",
        content:
          "Download LokiAI for Android. Run AI models entirely on your phone — no cloud required.",
      },
      { name: "theme-color", content: "#050505" },
    ],
  }),
  component: MobileUIPage,
});

function MobileUIPage() {
  const [done, setDone] = useState(false);
  const [sizeMb, setSizeMb] = useState<number | null>(null);

  // Fetch real APK size from backend
  useEffect(() => {
    fetch(`${backendUrl()}/apk/info`)
      .then((r) => r.json())
      .then((d) => { if (d.available) setSizeMb(d.size_mb); })
      .catch(() => {});
  }, []);

  const handleDownload = () => {
    setDone(true);
    window.location.href = apkUrl();
  };

  return (
    <div className="mobile-ui-root">
      {/* Top bar */}
      <header className="mobile-ui-header">
        <img src="/lokiai-logo.png" alt="LokiAI" style={{ height: 20, width: "auto", opacity: 0.9 }} />
        <span className="mobile-ui-version">v1.0 · Android</span>
      </header>

      {/* Main content */}
      <main className="mobile-ui-main">
        <div className="mobile-ui-eyebrow">Android Application</div>

        <h1 className="mobile-ui-title">Get the app.</h1>

        <p className="mobile-ui-subtitle">
          Install LokiAI on your phone, then scan the pairing QR from your
          dashboard to connect wirelessly.
        </p>

        {/* Download button */}
        <button
          id="download-apk-btn"
          onClick={handleDownload}
          className={`mobile-ui-btn${done ? " mobile-ui-btn--done" : ""}`}
        >
          {done ? (
            <>
              <CheckCircle size={15} strokeWidth={2} />
              Download started
            </>
          ) : (
            <>
              <Download size={15} strokeWidth={2} />
              Download APK
            </>
          )}
        </button>

        <p className="mobile-ui-hint">Android 8.0 or later · {sizeMb ? `~${sizeMb} MB` : "~140 MB"}</p>

        {/* Divider */}
        <hr className="mobile-ui-divider" />

        {/* Steps */}
        <ol className="mobile-ui-steps">
          <Step n={1} text="Download the APK file to your phone." />
          <Step n={2} text='Open it and tap "Install" — allow the source when prompted.' />
          <Step n={3} text="Open LokiAI, then scan the pairing QR from your dashboard." />
          <Step n={4} text="Your device appears in the fleet. Done." />
        </ol>
      </main>

      {/* Footer */}
      <footer className="mobile-ui-footer">
        LokiAI · The Shriks
      </footer>

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap');

        .mobile-ui-root {
          min-height: 100vh;
          background: oklch(0.06 0 0);
          color: oklch(0.88 0.04 90);
          font-family: 'Inter', ui-sans-serif, system-ui, -apple-system, sans-serif;
          -webkit-font-smoothing: antialiased;
          display: flex;
          flex-direction: column;
        }

        /* ── Header ── */
        .mobile-ui-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 20px 32px;
          border-bottom: 1px solid oklch(0.20 0.005 90 / 40%);
        }

        .mobile-ui-version {
          font-size: 11px;
          color: oklch(0.62 0.03 90 / 60%);
          font-family: ui-monospace, 'JetBrains Mono', monospace;
        }

        /* ── Main ── */
        .mobile-ui-main {
          flex: 1;
          max-width: 480px;
          width: 100%;
          margin: 0 auto;
          padding: 80px 24px 64px;
        }

        .mobile-ui-eyebrow {
          font-size: 11px;
          letter-spacing: 0.1em;
          text-transform: uppercase;
          color: oklch(0.68 0.13 130);
          margin-bottom: 16px;
          font-weight: 500;
        }

        .mobile-ui-title {
          font-size: clamp(36px, 7vw, 52px);
          font-weight: 600;
          letter-spacing: -0.04em;
          line-height: 1.05;
          color: oklch(0.88 0.04 90);
          margin: 0 0 20px 0;
        }

        .mobile-ui-subtitle {
          font-size: 15px;
          line-height: 1.65;
          color: oklch(0.62 0.03 90);
          margin: 0 0 36px 0;
          max-width: 380px;
        }

        /* ── Button ── */
        .mobile-ui-btn {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          background: oklch(0.68 0.13 130);
          color: oklch(0.06 0 0);
          font-weight: 600;
          font-size: 14px;
          padding: 11px 20px;
          border-radius: 8px;
          border: none;
          cursor: pointer;
          transition: background 0.15s ease, transform 0.1s ease;
          letter-spacing: -0.01em;
        }
        .mobile-ui-btn:hover {
          background: oklch(0.74 0.14 130);
          transform: translateY(-1px);
        }
        .mobile-ui-btn:active {
          transform: translateY(0);
        }
        .mobile-ui-btn--done {
          background: oklch(0.55 0.10 130);
          cursor: default;
        }
        .mobile-ui-btn--done:hover {
          background: oklch(0.55 0.10 130);
          transform: none;
        }

        .mobile-ui-hint {
          font-size: 12px;
          color: oklch(0.62 0.03 90 / 50%);
          margin: 12px 0 0 0;
        }

        /* ── Divider ── */
        .mobile-ui-divider {
          border: none;
          border-top: 1px solid oklch(0.20 0.005 90 / 40%);
          margin: 40px 0;
        }

        /* ── Steps ── */
        .mobile-ui-steps {
          list-style: none;
          padding: 0;
          margin: 0;
          display: flex;
          flex-direction: column;
          gap: 0;
        }

        /* ── Footer ── */
        .mobile-ui-footer {
          padding: 20px 32px;
          border-top: 1px solid oklch(0.20 0.005 90 / 40%);
          font-size: 11px;
          color: oklch(0.62 0.03 90 / 35%);
        }

        /* ── Step component styles ── */
        .mobile-ui-step {
          display: grid;
          grid-template-columns: 28px 1fr;
          gap: 14px;
          align-items: start;
          padding: 14px 0;
          border-bottom: 1px solid oklch(0.20 0.005 90 / 20%);
        }
        .mobile-ui-step:last-child {
          border-bottom: none;
        }
        .mobile-ui-step-n {
          width: 22px;
          height: 22px;
          border-radius: 50%;
          border: 1px solid oklch(0.20 0.005 90 / 40%);
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 11px;
          font-family: ui-monospace, monospace;
          color: oklch(0.62 0.03 90 / 60%);
          flex-shrink: 0;
          margin-top: 1px;
        }
        .mobile-ui-step-text {
          font-size: 14px;
          line-height: 1.55;
          color: oklch(0.62 0.03 90);
        }
      `}</style>
    </div>
  );
}

function Step({ n, text }: { n: number; text: string }) {
  return (
    <li className="mobile-ui-step">
      <span className="mobile-ui-step-n">{n}</span>
      <span className="mobile-ui-step-text">{text}</span>
    </li>
  );
}
