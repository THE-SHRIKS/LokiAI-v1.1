/**
 * Where the LokiAI workspace (dashboard) lives.
 *
 * This marketing site and the workspace are two separate applications on two
 * separate origins. That has one important consequence: **this site cannot see
 * whether the visitor is signed in.**
 *
 * The workspace deliberately keeps its access token in a module-level variable
 * in memory (never localStorage, as an XSS mitigation), and its refresh token
 * is an httpOnly cookie scoped to the backend domain. Neither is readable from
 * here, by design.
 *
 * So we do not try. Both entry actions send the visitor to the workspace's own
 * `/login`, and the workspace resolves the session itself — `ensureAuthReady()`
 * runs before any route renders and forwards an already-authenticated user
 * straight to the dashboard. An already-signed-in visitor therefore lands on
 * the dashboard after one internal redirect, without this site ever holding a
 * session, duplicating auth logic, or needing its origin added to backend CORS.
 *
 * The workspace remains the only security boundary. These links are navigation,
 * not authorization.
 */

/** Set VITE_WORKSPACE_URL to point at a different workspace deployment. */
// The public domain owns the canonical entry point. Vercel forwards this
// path to the dashboard deployment, which keeps the existing auth and device
// workflow intact while the dashboard is being hosted under this domain.
const PRODUCTION_WORKSPACE_URL = "https://lokiai.theshriks.space/workspace";

/** Local workspace dev server (see LokiAI-Desktop/stellar-dashboard-builder-main). */
const LOCAL_WORKSPACE_URL = "http://localhost:8080";

function resolveWorkspaceOrigin(): string {
  const configured = import.meta.env.VITE_WORKSPACE_URL as string | undefined;
  if (configured && configured.trim()) return configured.trim().replace(/\/$/, "");
  return import.meta.env.PROD ? PRODUCTION_WORKSPACE_URL : LOCAL_WORKSPACE_URL;
}

/**
 * Absolute URL into the workspace.
 *
 * Absolute rather than a router `<Link>` because the target is a different
 * application; a client-side route transition would 404 here (which is exactly
 * what `href="/login"` and `href="/signup"` did before this existed).
 */
export function workspaceUrl(path: string = "/"): string {
  const suffix = path.startsWith("/") ? path : `/${path}`;
  return `${resolveWorkspaceOrigin()}${suffix}`;
}

/** Sign-in entry. The workspace redirects to the dashboard if already signed in. */
export const SIGN_IN_URL = workspaceUrl("/login");

/**
 * Sign-up entry.
 *
 * The workspace has no separate `/signup` route — sign-up is a tab inside
 * `/login`. `?mode=signup` preselects that tab, so "Get Started" opens on the
 * sign-up form rather than making a new user find the tab themselves.
 */
export const GET_STARTED_URL = workspaceUrl("/login?mode=signup");

/** Direct workspace entry, for "Open Workspace"-style actions. */
export const WORKSPACE_URL = workspaceUrl("/");
