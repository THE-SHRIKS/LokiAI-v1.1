import { createFileRoute } from "@tanstack/react-router";
import { Download } from "lucide-react";

// GitHub Release asset — the APK is ~139MB, too large to serve from this
// app's own deploy (and Render's filesystem is ephemeral anyway). This is
// the page the "Add Device" QR code and phone browsers land on.
const APK_DOWNLOAD_URL = "https://lokiai.onrender.com/apk/download";
const APK_SIZE_MB = 141.4;

export const Route = createFileRoute("/android-app")({
  head: () => ({
    meta: [
      { title: "Install LokiAI" },
      { name: "description", content: "Download the LokiAI Android app." },
    ],
  }),
  component: AndroidAppPage,
});

function AndroidAppPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-background px-4 text-center">
      <div className="flex items-center gap-2 text-lg font-semibold text-foreground">
        <span className="text-olive-bright">*</span> LokiAI
      </div>
      <p className="max-w-xs text-sm text-muted-foreground">
        On-device AI for your phone. Tap below to download the app ({APK_SIZE_MB} MB), then open
        the downloaded file and allow the install when prompted.
      </p>
      <a
        href={APK_DOWNLOAD_URL}
        className="inline-flex items-center gap-2 rounded-md bg-primary px-6 py-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
      >
        <Download className="h-4 w-4" />
        Download LokiAI
      </a>
    </div>
  );
}
