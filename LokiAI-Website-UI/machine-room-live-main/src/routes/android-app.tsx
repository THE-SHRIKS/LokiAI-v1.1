import { createFileRoute } from "@tanstack/react-router";

// Served through the public LokiAI domain; Vercel proxies the file source.
const APK_DOWNLOAD_URL = "/downloads/lokiai-android.apk";

export const Route = createFileRoute("/android-app")({
  head: () => ({
    meta: [
      { title: "Install LokiAI" },
      { name: "description", content: "Download the LokiAI Android app." },
    ],
  }),
  component: AndroidApp,
});

function AndroidApp() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-void px-6 text-center">
      <div className="max-w-md">
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-live">Android application</p>
        <h1 className="mt-5 font-serif text-5xl text-foreground">Get the app.</h1>
        <p className="mt-5 text-lg leading-relaxed text-muted-foreground">
          Download LokiAI for Android, then open it to pair with your workspace securely.
        </p>
        <a
          href={APK_DOWNLOAD_URL}
          download="lokiai.apk"
          className="mt-8 inline-flex min-h-[48px] items-center rounded-sm bg-gold px-6 font-mono text-xs uppercase tracking-[0.18em] text-primary-foreground transition-opacity hover:opacity-85"
        >
          Download APK
        </a>
      </div>
    </main>
  );
}
