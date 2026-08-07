import { createFileRoute } from "@tanstack/react-router";

// Served through the public LokiAI domain; Vercel proxies the file source.
const APK_DOWNLOAD_URL = "/downloads/lokiai-android.apk";

const TITLE = "Install LokiAI — Android app | LokiAI by THE SHRIKS";
const DESC =
  "Download the LokiAI Android app and pair it with your workspace to deploy and run AI models fully offline, on-device.";
const PAGE_URL = "https://lokiai.theshriks.space/android-app";

export const Route = createFileRoute("/android-app")({
  head: () => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESC },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESC },
      { property: "og:url", content: PAGE_URL },
      { name: "twitter:title", content: TITLE },
      { name: "twitter:description", content: DESC },
    ],
    links: [{ rel: "canonical", href: PAGE_URL }],
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
