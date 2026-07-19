import "./lib/error-capture";

import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";

type ServerEntry = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

let serverEntryPromise: Promise<ServerEntry> | undefined;

async function getServerEntry(): Promise<ServerEntry> {
  if (!serverEntryPromise) {
    serverEntryPromise = import("@tanstack/react-start/server-entry").then(
      (m) => (m.default ?? m) as ServerEntry,
    );
  }
  return serverEntryPromise;
}

// h3 swallows in-handler throws into a normal 500 Response with body
// {"unhandled":true,"message":"HTTPError"} — try/catch alone never fires for those.
async function normalizeCatastrophicSsrResponse(response: Response): Promise<Response> {
  if (response.status < 500) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return response;

  const body = await response.clone().text();
  if (!body.includes('"unhandled":true') || !body.includes('"message":"HTTPError"')) {
    return response;
  }

  console.error(consumeLastCapturedError() ?? new Error(`h3 swallowed SSR error: ${body}`));
  return new Response(renderErrorPage(), {
    status: 500,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

// Applied to every response this server sends — the dashboard is the page
// a browser actually renders, so it needs the same header set the backend
// API applies to its own responses (see LokiAI-backend/main.py). The CSP
// is production-only: Vite's dev server injects its own HMR client script
// and eval-based transforms that a strict script-src would break, and dev
// is never the surface this hardening is protecting.
function withSecurityHeaders(response: Response): Response {
  response.headers.set("X-Content-Type-Options", "nosniff");
  // SAMEORIGIN (not DENY): the workspace's own Preview panel iframes pages
  // from this same app (e.g. /android-app) as a legitimate in-product
  // feature. DENY blocked that too, not just third-party embedding — the
  // real threat this header defends against is an attacker's site framing
  // ours for clickjacking, which SAMEORIGIN still fully blocks.
  response.headers.set("X-Frame-Options", "SAMEORIGIN");
  response.headers.set("X-XSS-Protection", "1; mode=block");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  if (import.meta.env.PROD) {
    response.headers.set("Content-Security-Policy", CSP_HEADER_VALUE);
  }
  return response;
}

// script-src needs 'unsafe-inline': TanStack Start's own SSR hydration
// bootstrap ("$tsr-stream-barrier") is an inline <script> that embeds a
// live per-request timestamp, so it's a different script body on every
// single load — a static sha256 hash allowlist can't cover it, and this
// Vinxi/TanStack Start version has no wired-up per-request CSP nonce. This
// script is framework-trusted (not attacker-controlled), and the app never
// uses dangerouslySetInnerHTML, so React's own escaping still covers any
// real user content. Job 3 originally shipped this without 'unsafe-inline'
// but never tested an actual production build (npm run dev never applies
// CSP), so the break went unnoticed until the first real Vercel deploy.
// connect-src allows the backend API — without it every fetch() to
// LokiAI-backend would be silently blocked by CSP, not CORS.
const CSP_HEADER_VALUE =
  "default-src 'self'; " +
  "script-src 'self' 'unsafe-inline'; " +
  "style-src 'self' 'unsafe-inline'; " +
  "img-src 'self' data: https:; " +
  "font-src 'self' data:; " +
  "connect-src 'self' http://localhost:8000 https:; " +
  "frame-src 'self' https:; " +
  "frame-ancestors 'self'";

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    try {
      const handler = await getServerEntry();
      const response = await handler.fetch(request, env, ctx);
      return withSecurityHeaders(await normalizeCatastrophicSsrResponse(response));
    } catch (error) {
      console.error(error);
      return withSecurityHeaders(new Response(renderErrorPage(), {
        status: 500,
        headers: { "content-type": "text/html; charset=utf-8" },
      }));
    }
  },
};
