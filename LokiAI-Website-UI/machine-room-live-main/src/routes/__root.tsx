import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";
import Lenis from "lenis";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { Nav } from "../components/loki/Nav";
import { Footer } from "../components/loki/Footer";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          This page didn't load
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something went wrong on our end. You can try refreshing or head back home.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Try again
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

const SITE_URL = "https://lokiai.theshriks.space";

// Structured data: one Organization (THE SHRIKS, the venture) and one
// SoftwareApplication (LokiAI, the product) linked by @id so search engines
// and AI retrieval systems can resolve "who makes this" and "what is this"
// as a single, unambiguous entity instead of inferring it from prose.
// alternateName is a genuine known-as variant (people do type "Loki AI" as
// two words) — deliberately not gaming this with the "low-key" phonetic
// joke, which lives in prose (llms.txt, meta description) instead, where a
// human or LLM reading it can tell it's a pronunciation note, not a claimed
// second brand name.
const ORGANIZATION_JSON_LD = {
  "@context": "https://schema.org",
  "@type": "Organization",
  "@id": `${SITE_URL}/#organization`,
  name: "THE SHRIKS",
  url: SITE_URL,
  logo: `${SITE_URL}/logo.png`,
  sameAs: [
    "https://x.com/theshriks1",
    "https://www.instagram.com/times.theshriks/",
    "https://www.reddit.com/user/ShrishLoki/",
    "https://www.linkedin.com/in/laukik-rajput-95bb48300/",
  ],
};

const SOFTWARE_JSON_LD = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  "@id": `${SITE_URL}/#software`,
  name: "LokiAI",
  alternateName: "Loki AI",
  url: SITE_URL,
  applicationCategory: "DeveloperApplication",
  operatingSystem: "Android",
  description:
    "LokiAI discovers, verifies, and deploys AI models to real devices, then tracks what runs, where it runs, and why it fits. Starts with an Android agent that pairs over the network and runs models fully offline, on-device.",
  publisher: { "@id": `${SITE_URL}/#organization` },
  creator: { "@id": `${SITE_URL}/#organization` },
};

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "LokiAI - Edge AI made ridiculously simple!" },
      {
        name: "description",
        content:
          "LokiAI (pronounced \"low-key AI\") discovers, verifies and deploys AI models to real devices, fully offline — starting with the Android agent. Built by THE SHRIKS.",
      },
      { name: "author", content: "THE SHRIKS" },
      { property: "og:site_name", content: "LokiAI" },
      { property: "og:type", content: "website" },
      // No blanket og:url here, same reasoning as canonical above — each
      // route supplies its own og:url pointing at its own real path.
      { property: "og:image", content: `${SITE_URL}/logo.png` },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:site", content: "@theshriks1" },
      { name: "twitter:image", content: `${SITE_URL}/logo.png` },
      { name: "theme-color", content: "#0d0c0a" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "icon", href: "/favicon.png", type: "image/png" },
      // No blanket canonical here — that would tell search engines every
      // route is the homepage. Each route sets its own canonical in its own
      // head() (see contact.tsx etc. for the pattern), pointing at its own
      // real path.
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@300;400;500;600&family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;500;600&display=swap",
      },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
        {/* JSON-LD: rendered directly rather than through head()'s meta/links
            API, which has no first-class slot for a raw <script> tag. This
            guarantees it's present in the server-rendered HTML regardless
            of that API's shape. */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(ORGANIZATION_JSON_LD) }}
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(SOFTWARE_JSON_LD) }}
        />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();

  useEffect(() => {
    const lenis = new Lenis();

    function raf(time: number) {
      lenis.raf(time);
      requestAnimationFrame(raf);
    }

    requestAnimationFrame(raf);
    return () => {
      lenis.destroy();
    };
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      {/* Dynamic Background */}
      <div className="fixed inset-0 z-[-1] bg-background pointer-events-none">
        <div className="absolute inset-0 bg-loki-aurora opacity-30 mix-blend-screen" />
        <div className="absolute inset-0 loki-grid opacity-[0.15]" />
      </div>
      
      <div className="relative flex min-h-dvh flex-col text-foreground">
        <Nav />
        <main id="main" className="flex-1">
          {/* Required: nested routes render here. Removing <Outlet /> breaks all child routes. */}
          <Outlet />
        </main>
        <Footer />
      </div>
    </QueryClientProvider>
  );
}
