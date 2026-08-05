import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";

import appCss from "../styles.css?url";
import { ensureAuthReady } from "../lib/lokiai-api";
import { Toaster } from "../components/ui/sonner";

// Production browser console must not leak internal errors, API payloads,
// or anything else logged during development. Runs once at module load,
// client-side only (this module also loads during SSR, where there's no
// browser console to protect and server logs must keep working).
if (typeof window !== "undefined" && import.meta.env.PROD) {
  console.log = () => {};
  console.warn = () => {};
  console.error = () => {};
  console.info = () => {};
}

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
            href={import.meta.env.BASE_URL}
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "LokiAI — Workspace" },
      { name: "description", content: "On-device AI orchestration — wireless model deployment to your own hardware." },
      { name: "author", content: "The Shriks" },
      { property: "og:title", content: "LokiAI" },
      { property: "og:description", content: "On-device AI orchestration — wireless model deployment to your own hardware." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
    links: [
      {
        rel: "stylesheet",
        href: appCss,
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
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function AuthBootScreen() {
  const [takingLonger, setTakingLonger] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setTakingLonger(true), 5_000);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-6 text-foreground">
      <div className="flex w-full max-w-sm flex-col items-center text-center">
        <div className="font-mono text-lg tracking-[0.22em] text-foreground">LokiAI</div>
        <div className="mt-7 h-px w-32 overflow-hidden bg-border">
          <div className="h-full w-1/2 animate-pulse bg-olive" />
        </div>
        <p className="mt-5 font-mono text-xs uppercase tracking-[0.18em] text-muted-foreground">
          Restoring your secure session…
        </p>
        {takingLonger && (
          <p className="mt-3 text-sm text-muted-foreground">
            Preparing your workspace. Thanks for your patience.
          </p>
        )}
      </div>
    </main>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  // The access token lives in memory only (not localStorage), so a full
  // page load starts with none. Exchange the httpOnly refresh cookie for a
  // fresh one before any route's own auth guard runs — otherwise a signed-in
  // user hitting refresh would bounce through /login for a moment on every
  // reload. SSR has no cookies/fetch context here, so this only runs client-side.
  const [authReady, setAuthReady] = useState(false);
  useEffect(() => {
    ensureAuthReady().finally(() => setAuthReady(true));
  }, []);

  if (!authReady) return <AuthBootScreen />;

  return (
    <QueryClientProvider client={queryClient}>
      {/* Required: nested routes render here. Removing <Outlet /> breaks all child routes. */}
      <Outlet />
      <Toaster position="bottom-right" />
    </QueryClientProvider>
  );
}
