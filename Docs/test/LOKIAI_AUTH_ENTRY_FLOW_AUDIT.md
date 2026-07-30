# LokiAI — Auth Entry-Flow Audit

**Date:** 2026-07-29
**Task:** wire the landing page's SIGN IN / GET STARTED into the existing auth + dashboard flow
**Status:** **AUDIT ONLY — no code changed.** One architectural decision must be made first; it changes which implementation is correct.

---

## The blocker, stated first

There are **two separate applications**, and the new website has **no access to the session**.

| | Dashboard | New website |
|---|---|---|
| Path | `LokiAI-Desktop/stellar-dashboard-builder-main` | `LokiAI-Website-UI/machine-room-live-main` |
| Git | tracked, deployed to Vercel | **untracked — never committed** |
| Auth code | full client, `/login`, session bootstrap | **none** |
| Backend calls | yes | **zero** |
| Origin in production | `https://lokiai-v11.vercel.app` | **has none — not deployed** |

The requirement *"if the user already has a valid authenticated session, route directly to the dashboard"* **cannot be satisfied from the website as it stands**, for three independent reasons:

1. The dashboard's access token is held in a **module-level variable in memory** (`lokiai-api.ts`), deliberately not in `localStorage`. A different app cannot read it — that was an intentional XSS mitigation.
2. The refresh token is an **httpOnly cookie scoped to the backend domain** (`lokiai.onrender.com`). No JavaScript on any origin can read it.
3. The website has no API client, so it cannot ask the backend either.

The only way the website could detect a session is to call `POST /auth/refresh` with `credentials: "include"` — which needs the website's origin added to backend CORS, and duplicates session logic into a second app. **The task explicitly forbids duplicating session logic.**

### Second finding that makes this simpler than it looks

**The dashboard already has a landing page, and its buttons already work correctly.**

`stellar-dashboard-builder-main/src/routes/index.tsx:392`
```tsx
if (!isAuthenticated) {
  return <LandingPage />;
}
```

`/` serves `LandingPage` when signed out and the workspace when signed in. Its CTAs are already `<Link to="/login">` (`LandingPage.tsx:21,27,56,364`) — same app, same origin, session visible, semantic links, no wiring needed.

So the real question is not "how do I wire buttons" but **"what is the new website's relationship to the app that already does this?"**

---

## Confirmed auth architecture

Read from the repository, not assumed.

### Canonical routes (dashboard app)

| Concern | Route | Evidence |
|---|---|---|
| **Dashboard** | `/` | `src/routes/index.tsx` — workspace when authenticated |
| **Landing** | `/` | same file, line 392, when unauthenticated |
| **Sign in** | `/login` | `src/routes/login.tsx` |
| **Sign up** | `/login` | **same route**, `mode` state toggled by tabs (`login.tsx:25,133-137`) |
| Forgot password | `/forgot-password` | `src/routes/forgot-password.tsx` |
| Reset password | `/reset-password?token=…` | `src/routes/reset-password.tsx` |
| **OAuth callback** | **none** | email/password + OTP only; no OAuth provider exists |
| **Onboarding** | **none** | no route, no profile-completion state |

**There is no `/signup` route.** Sign-up is `mode: "signup"` inside `/login`, reachable only by clicking a tab — **not** by URL.

### Session source of truth

| Piece | Location |
|---|---|
| Access token | in-memory module variable, `lokiai-api.ts` (`_accessToken`) |
| Refresh token | httpOnly cookie `lokiai_refresh_token`, backend domain |
| Boot bootstrap | `ensureAuthReady()` — single-flight, awaited in `__root.tsx:132` before any route renders |
| Client check | `getToken()` |
| Server enforcement | every API route via `Depends(get_current_user)` — JWT signature, expiry, `jti`, `type`, blacklist |

### How the dashboard is actually protected

**Route rendering is client-side. Data access is server-enforced.**

- No `beforeLoad`, no `loader`, no `createServerFn` guard on any route — confirmed by grep across `src/routes/*.tsx`.
- Pages guard by rendering: `if (!isAuthenticated) return <LandingPage />`, or `if (!getToken()) navigate({ to: "/login" })` (`devices.tsx:36`, `models.tsx:57`, `monitor.tsx:66`).
- **No protected data can be obtained without a valid token**, because every endpoint validates server-side.

The task says *"do not rely only on client-side checks"* and *"dashboard protection remains server-enforced."* The honest position: **the data boundary is server-enforced today; the routing boundary is not.** For a SPA where the shell contains no secrets, that is a defensible design — but it is not what "server-side redirect" means, and I am not going to claim otherwise. Making routing server-enforced would mean adding `beforeLoad` server functions to every protected route: a real change to the app's architecture, well outside "wire two buttons".

### No safe-return mechanism exists

`/login` accepts **only** `?reset=<string>` (`login.tsx:8-9`). Grep for `returnTo`, `redirectTo`, `next` across `src/routes` and `src/lib` returns **nothing**.

So *"preserve and restore the originally attempted protected route"* has **no existing mechanism to reuse**. It would have to be added. Minimal and safe, but new — and the task says reuse what exists.

---

## Current behaviour of the new website's buttons

`machine-room-live-main/src/components/loki/Nav.tsx`

| Button | Current target | Result |
|---|---|---|
| SIGN IN | `<a href="/login">` (line 82) | **404** — no `/login` route in this app |
| GET STARTED | `<a href="/signup">` (line 86) | **404** — no `/signup` route anywhere, in either app |
| OPEN WORKSPACE | `<Link to="/product">` | goes to a marketing page, not the workspace |

Both are already semantic `<a>` elements — no div-click antipattern to fix.

Also worth flagging: the "ROUTING VIEW" panel (`1 AGENT ONLINE`, `WSS Auth Validated`, `Target OK`, `ANDROID AGENT`) is **hardcoded SVG `<text>`** in `diagrams.tsx:194-269`. It is an illustration, not telemetry. Fine as decoration; a problem only if it is ever read as live status.

---

## Tooling reality

| | Dashboard | Website |
|---|---|---|
| `lint` | yes | yes |
| `build` | yes | yes |
| `typecheck` | **no script** (I use `npx tsc --noEmit`) | **no script** |
| **test framework** | **none installed** | **none installed** |
| test files | none | none |

The task's required test matrix (14 cases) **cannot be run** — neither project has vitest, jest, playwright, or `@testing-library`. Adding a test framework to the website is a new dependency and a new toolchain, not "the smallest correct change". I will not claim tests pass when no runner exists.

---

## The decision you need to make

Everything downstream depends on this, and I am not going to guess:

### Option A — Port the new design into the dashboard app *(recommended)*

Replace `stellar-dashboard-builder-main/src/components/landing/LandingPage.tsx` with the new website's design, and bring the marketing routes across as dashboard routes.

- Buttons become `<Link to="/login">` — **already the working pattern**
- Session is natively visible; `/` already switches landing ↔ workspace
- No CORS change, no second origin, no duplicated session logic
- One deployment, one origin, no cross-app redirect
- **Cost:** porting ~7,900 lines of routes/components and reconciling two Tailwind themes

### Option B — Keep the website separate

Deploy it as its own Vercel project on its own origin.

- Buttons become absolute URLs to `https://lokiai-v11.vercel.app/login`
- **Cannot** route an already-authenticated user straight to the dashboard without either duplicating session logic or adding the website's origin to backend CORS — both explicitly out of bounds
- Realistic compromise: buttons always go to `/login`, and the dashboard's existing `ensureAuthReady()` immediately forwards an already-signed-in user to `/`. One extra hop, zero new auth code, no rule broken.
- **Cost:** two deployments; "signed-in user clicks SIGN IN → dashboard" becomes "→ `/login` → dashboard", a brief redirect rather than a direct jump

### Option C — Same origin via Vercel rewrites

Serve the website at `/` and the dashboard under a path prefix on one Vercel project.

- Preserves same-origin session visibility
- **Cost:** the dashboard's routes are all root-relative; re-basing them is a larger and riskier change than Option A

---

## What I will change once you choose (Option A or B)

Deliberately minimal, and nothing that alters the visual layer:

1. **`Nav.tsx`** — repoint `href="/login"` and `href="/signup"` to the confirmed canonical target. Identical markup, classes, spacing, focus behaviour. `/signup` becomes `/login` because no signup route exists.
2. **A `?mode=signup` search param on `/login`** so GET STARTED can preselect the Sign-up tab. Currently that tab is unreachable by URL, which is the only genuine functional gap on the auth side. Additive; `?reset=` keeps working.
3. **`sanitizeReturnTo()` + `?returnTo=`** *only if you want the restore-destination behaviour.* It does not exist today. Internal paths only; reject absolute URLs, protocol-relative `//evil.com`, and malformed values; default to `/`.
4. **No change** to `LandingPage.tsx`, the dashboard's session handling, `ensureAuthReady()`, cookies, or middleware.

## What I will not do

- Rebuild or duplicate auth, or add a provider
- Read the session from a second origin
- Reintroduce a CORS wildcard to make cross-origin session checks work
- Add `beforeLoad` server guards to every route and call it "wiring two buttons"
- Claim the 14-case test matrix passes when no test runner is installed
- Touch UI, spacing, typography, animation, or layout

---

## Unresolved blockers

| # | Blocker | Needs |
|---|---|---|
| B1 | Website is a separate app with no session access | **your choice of A / B / C** |
| B2 | No `/signup` route; sign-up tab unreachable by URL | approval for `?mode=signup` |
| B3 | No `returnTo` mechanism anywhere | decide whether restore-destination is in scope |
| B4 | No test framework in either project | decide whether adding one is in scope |
| B5 | Website is untracked in git | decide whether to commit it |
| B6 | Routing protection is client-side (data protection is server-side) | decide whether server-side route guards are in scope — they are a separate piece of work |

Nothing in the user workflow has been altered. The production remediation deployment is still pending and unaffected: `main` remains at `168f79b`.
