# LokiAI — Auth Entry-Flow Implementation Report

**Date:** 2026-07-29
**Approach:** Option B from `LOKIAI_AUTH_ENTRY_FLOW_AUDIT.md` — the two apps stay separate; the marketing site links into the workspace's own auth, which resolves the session itself.
**Commits:** `2eced97`, `d1b18e3` (dashboard). Website changes **uncommitted** — see Blockers.
**Pushed:** no. **Deployed:** no.

---

## Confirmed auth architecture

Read from the repository, not assumed.

| Concern | Canonical route | Evidence |
|---|---|---|
| Dashboard / workspace | `/` | `index.tsx` — workspace when authenticated, `LandingPage` when not (`:392`) |
| Sign in | `/login` | `login.tsx` |
| Sign up | **`/login`** — a tab, not a route | `login.tsx:25,133-137` |
| Forgot / reset password | `/forgot-password`, `/reset-password?token=` | own routes |
| OAuth callback | **none exists** | email/password + OTP only |
| Onboarding | **none exists** | no route, no profile-completion state |
| `returnTo` / `next` | **none exists** | grep across `src/routes`, `src/lib` → nothing |

**Session source of truth:** access token in a module variable in memory (`lokiai-api.ts`); refresh token in an httpOnly cookie on the backend domain; `ensureAuthReady()` single-flight, awaited in `__root.tsx:132` before any route renders; server enforcement on every API route via `Depends(get_current_user)`.

---

## Previous behaviour

| Button | Target | Result |
|---|---|---|
| SIGN IN | `href="/login"` | **404** — no such route in the marketing app |
| GET STARTED | `href="/signup"` | **404** — no such route in *either* app |

Reproduced by the user at `localhost:437/login` and `/signup`.

---

## Files changed

| File | Change |
|---|---|
| `machine-room-live-main/src/lib/workspace.ts` | **new.** Single source of truth for the workspace origin + entry URLs. |
| `machine-room-live-main/src/components/loki/Nav.tsx` | `href` values only (desktop + mobile). Markup, classes, spacing untouched. |
| `stellar-dashboard-builder-main/src/routes/login.tsx` | accept `?mode=signup`/`signin` as the tab's initial value |
| `stellar-dashboard-builder-main/src/lib/lokiai-api.ts` | read `{error}` as well as `{detail}` from error bodies |

No change to session handling, cookies, `ensureAuthReady()`, middleware, `LandingPage.tsx`, or any visual property.

## Session-resolution logic

There is deliberately **no session check on the marketing site.** It cannot have one: the access token is in another app's memory and the refresh token is an httpOnly cookie on the backend domain. Adding one would mean duplicating session logic into a second app and widening backend CORS — both explicitly out of bounds.

Instead both actions link to the workspace's `/login`, and the **workspace resolves the session**, using the guard that already existed (`login.tsx:39-40`):

```tsx
// Already signed in? Straight to the workspace.
if (typeof window !== "undefined" && getToken()) navigate({ to: "/" });
```

Net effect against the required matrix:

| State | Action | Result |
|---|---|---|
| Signed out | GET STARTED | `/login?mode=signup` → sign-up form ✅ |
| Signed out | SIGN IN | `/login` → sign-in form ✅ |
| Signed in | GET STARTED | `/login` → **immediately forwarded to `/`** ✅ (one internal hop) |
| Signed in | SIGN IN | `/login` → **immediately forwarded to `/`** ✅ (one internal hop) |

The signed-in rows are satisfied *via the workspace's own redirect*, not by a direct jump. That is the documented cost of Option B and the only deviation from the literal spec.

## Safe return path

**Not implemented.** No `returnTo`/`next` mechanism exists anywhere in the repository, so there was nothing to reuse — the task said reuse, not invent. `sanitizeReturnTo()` was not added.

Consequence: a user who is bounced from a protected page lands on `/` (the dashboard) after authenticating, not back on the page they wanted. No open-redirect risk exists precisely because no return parameter is accepted — the attack surface is absent rather than defended.

Marked as blocker **B3**.

## Dashboard protection — verified, and honestly qualified

| Check | Result |
|---|---|
| Unauthenticated `/` | renders `LandingPage`, never the workspace ✅ |
| Unauthenticated `/devices`, `/models`, `/monitor` | `navigate({ to: "/login" })` ✅ |
| Unauthenticated API call | 401 from the server ✅ |
| Authenticated `/` | workspace renders ✅ |
| Refresh preserves auth | `ensureAuthReady()` exchanges the refresh cookie ✅ |
| Operator routes | 404 for non-operators ✅ (regression suite `P0-1b`) |

**Qualification, stated rather than glossed:** route *rendering* is client-side. There is no `beforeLoad`, `loader`, or server guard on any route — confirmed by grep. The **data** boundary is server-enforced (every endpoint validates signature, expiry, `jti`, `type`, and revocation), so no protected data can be obtained without a valid token, and the SPA shell contains no secrets.

The task asked for server-enforced dashboard protection. **Today it is server-enforced at the data layer and client-enforced at the routing layer.** Making routing server-enforced means adding server guards to every protected route — real architectural work, not button wiring. Marked as blocker **B6**. I am not claiming it is done.

## Onboarding

None exists. No state was invented. Authenticated users go to `/`.

## Error handling — one real defect found and fixed

While testing, a rate-limited sign-in displayed **`HTTP 429`** with no explanation (user-reported, screenshot).

Cause: the client read only `detail` from error bodies, but the backend uses two shapes — FastAPI's `HTTPException` emits `{detail}`, while the rate-limit and global handlers emit `{error}`. Every error from the latter had its message discarded.

```
raw response : {"error":"Rate limit exceeded: 5 per 1 minute"}   HTTP 429
before       : "HTTP 429"
after        : "Rate limit exceeded: 5 per 1 minute"
```

Both shapes are now read, with a readable fallback for 429 (quoting `Retry-After`) and 502/503. No error text is invented — a backend-supplied message is shown verbatim. Fixed in `2eced97`, verified live in the browser.

This also affected the global 500 handler, so it was suppressing explanations well beyond sign-in.

## Accessibility

Both actions remain semantic `<a href>` elements — they were already, so no div-click antipattern needed fixing. Keyboard activation, focus ring, Enter behaviour, and accessible names are unchanged because the markup is unchanged; only the `href` value differs. No new tab stops, no new disabled/loading state.

## Validation

| Gate | Dashboard | Website |
|---|---|---|
| `tsc --noEmit` | **exit 0** | **exit 0** |
| `eslint .` | **exit 0** | 7 pre-existing prettier errors in files not touched; **0 in changed files** |
| `build` | **exit 0** | **exit 0** |
| tests | **no framework installed** | **no framework installed** |

### Live manual verification

Backend on `:8000` (disposable DB, real SMTP), dashboard on `:8080`, website on `:4370`. Driven in a real browser.

```
website nav, resolved hrefs:
  Sign in     -> http://localhost:8080/login
  Get Started -> http://localhost:8080/login?mode=signup

clicked Get Started -> "LokiAI — Sign in", Sign-up tab active
                       (NAME field + "Create account" rendered)
clicked Sign in     -> "LokiAI — Sign in", Sign-in tab active
                       (EMAIL/PASSWORD + "Forgot password?")

rate-limited submit -> "Rate limit exceeded: 5 per 1 minute"   (was "HTTP 429")
```

### Not verified

- **Signed-in → dashboard hop.** The redirect is the pre-existing `login.tsx:39-40` guard and was not re-exercised end-to-end in this session; a real sign-in hit the login rate limit mid-test.
- Mobile viewport, slow network, back/forward, double-click behaviour.
- The 14-case test matrix — **no test runner exists in either project.**

## Blockers

| # | Blocker | Needs |
|---|---|---|
| **B1** | Website is a separate untracked app; whether it replaces the dashboard's existing `LandingPage` (Option A) or stays standalone (Option B) is a product decision. Option B is implemented as the reversible interim. | your decision |
| B3 | No `returnTo` mechanism; protected-destination restore not implemented | in scope or not? |
| B4 | No test framework in either project — required test matrix cannot run | add one? |
| B5 | Website is untracked in git; its changes are **uncommitted** and exist only on this machine | commit it? |
| B6 | Route protection is client-side (data protection is server-side) | separate work item |

## Git / deployment

| | |
|---|---|
| Commits | `2eced97` (error messages), `d1b18e3` (`?mode=signup`) |
| Branch | `chore/batch0-test-baseline` |
| Pushed | **no** |
| Deployed | **no** |
| Website changes | **uncommitted** (project untracked — B5) |

Secrets check: no `.env`, key, or token staged. The 17 root-level file deletions in `git status` are **pre-existing user work from before this session** — verified none of my commits touched them, and they were left alone.

Production remains on `168f79b` with the old vulnerable code; unaffected by this work and still the larger outstanding risk.

## Success criteria

| Criterion | Status |
|---|---|
| UI visually unchanged | **PASS** — only `href` values changed |
| GET STARTED → auth/sign-up for new users | **PASS** — verified live, sign-up tab preselected |
| SIGN IN → sign-in for unauthenticated | **PASS** — verified live |
| GET STARTED / SIGN IN → dashboard when authenticated | **PASS by construction**, not re-verified live |
| Safe destination restored after auth | **NOT IMPLEMENTED** — no mechanism exists (B3) |
| Open redirects impossible | **PASS** — no return parameter is accepted |
| Dashboard protection server-enforced | **PARTIAL** — data yes, routing no (B6) |
| Session-loading races handled | **PASS** — `ensureAuthReady()` gates rendering |
| No duplicate auth system added | **PASS** |
| Accessibility intact | **PASS** — markup unchanged |
| Tests pass | **BLOCKED** — no test runner (B4) |
| Production deployment verified | **NOT DONE** — not pushed, not deployed |
