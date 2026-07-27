# LokiAI — Full Implementation Report

**Date:** 2026-07-27
**Branch:** `chore/batch0-test-baseline` (NOT merged to `main`, NOT deployed)
**Base commit:** `168f79b8d3cc538ddd8655ee911e5820011b81ac`
**Head commit:** `f7efca6807a2d715b9a3337fedf4c3b7d7f9b975`
**Scope:** implementation of the batches defined in `LOKIAI_IMPLEMENTATION_PLAN.md`, derived from `LOKIAI_DEEP_AUDIT.md`.

---

## Executive summary

All 8 P0 defects in the audit register are closed and verified by automated reproducers. Two additional P0-class defects not in the original register were found *during* implementation and fixed. Four P1 defects are closed. The regression suite went from **6 failing / 14** at baseline to **22 passing / 22**.

Nothing was regenerated, redesigned, or rewritten. No route was renamed, no response shape changed except where a defect required it, and the documented v3 user flow (sign in → configure NIM key → pair phone → search → deploy → run offline) is verified intact by an end-to-end check in every regression run.

**One breaking change, devices only:** already-paired phones must re-pair once to obtain a device credential for the now-authenticated WebSocket. No user-facing dashboard flow changed.

---

## Batch-by-batch

| Batch | Commit | Defects closed | Result |
|---|---|---|---|
| 0 — test baseline | `c3f6093` | none (infrastructure) | disposable DB + regression harness; baseline captured |
| 1 — undefined-name crashes + key exposure | `e584bca` | P0-6, **P0-9 (new)** | 9/14 → suite advanced |
| 2 — cross-tenant exposure | `d87881b` | P0-1, P0-1b, P0-2, **P0-2b (new)**, P0-3 | 13/14 |
| 6 — CORS wildcard | `da14ee7` | P0-7 | 15/16 |
| 5 — upload bounds + rate limits | `01e6df0` | P0-8, P1-2 | 17/18 |
| 4 — device hijack | `1680e38` | P0-5 | **18/18 — all P0 closed** |
| 3 + 7 — WS identity + presence | `0611669` | P0-4, P1-3, P1-4, P1-7 | 22/22 |
| 8 — mobile reconnect/lifecycle | `f7efca6` | P1-6, P1-8 | 22/22 |

Full commit hashes:
```
c3f6093ac23d880419bd7a8c4d73ed8c875cfc3a  Batch 0
e584bcaeaf74a82403b5fc1ddc216d0821f8a495  Batch 1
d87881b9a735ba442e6e8c3575654b4d7835c95a  Batch 2
da14ee72b4c93135f3ee0def0df3dada5e8a1af1  Batch 6
01e6df024cf4196c8c24b0891bf12a14ff2d3e0d  Batch 5
1680e385fc658641fb95c1ff67d64ce0ba3e6425  Batch 4
06116699d0ceae23152335cdfd22fcc08a38c2a2  Batch 3+7
f7efca6807a2d715b9a3337fedf4c3b7d7f9b975  Batch 8
```

---

## Defects fixed

### P0 — all closed

**P0-1 `/admin/stats` fully anonymous.** Returned every user's id, name, email, signup date, device count and latest deployment to any internet caller. Now requires authentication *and* membership of an `ADMIN_EMAILS` allowlist; non-operators receive 404 (not 403) so the route isn't confirmed to exist. Empty by default — with the variable unset nobody is an operator, which is the safe failure mode.

**P0-2 `/feedback` cross-tenant read.** Any valid token returned every user's feedback text and email. Now returns the caller's own submissions only; the cross-tenant view moved to the operator-gated `/admin/feedback`.

**P0-2b `/deployments/{id}` ownership bypass (found during implementation).** The handler checked ownership only on its database fallback path; the in-memory fast path returned first. Any authenticated user holding a deployment id could read another account's live progress and error text. Ownership is now checked against the database before the in-memory map is consulted.

**P0-3 `/monitor/*` anonymous.** Exposed aggregate user/device/deployment counts and up to 500 recent request-log entries. Now operator-gated.

**P0-4 WebSocket accepted any `device_id` with no credential.** Anyone who learned a device id could impersonate that phone — receive its deployment instructions, forge heartbeats to show it online while the real device was off, and rewrite the status/progress/error of any deployment in the system by naming its id. `POST /devices/pair` now issues a device-scoped token (`type="device"`, bound to that device and owner); the socket requires it, verifies it matches the path's `device_id`, and re-checks the device still exists and is still owned by the same user, so deleting a device revokes its socket. Deployment updates must name a deployment belonging to the reporting device. Frames are size-capped and must be JSON objects.

**P0-5 `/devices/register` device takeover.** Upserted on the globally-unique `adb_serial` and reassigned `user_id` on conflict with no owner check — any authenticated account that knew another user's serial could move that device into its own account, locking the real owner out. Removed: it was ADB-era v2 surface with no callers in either the dashboard or the Flutter app (verified before removal), superseded by the token-scoped `/devices/pair`.

**P0-6 `/auth/me` 500 + NIM key exposure.** Called `_decrypt_key`, which never existed, so the endpoint 500'd for every user who had saved a NIM key — and since `getMe()` runs on nearly every dashboard screen, the app was broken for exactly the users who had completed setup. Now returns `has_nim_key` only; the key is decrypted solely inside the NIM provider call and never serialized to a client.

**P0-7 CORS trusted all of `*.vercel.app` with credentials.** Combined with the production `SameSite=None` refresh cookie, any free Vercel deployment could call `/auth/refresh` from a logged-in victim's browser and read a fresh access token — full session takeover with no XSS on our origin. Wildcard removed; production origins must be listed explicitly.

**P0-8 unbounded uploads.** `/models/upload` was exempt from the body-size cap entirely and had no rate limit, letting any account exhaust the server's disk. Now capped (`MAX_UPLOAD_MB`, default 600) on both the declared `Content-Length` and bytes actually received, with partial files cleaned up on failure.

**P0-9 `/feedback` undefined `verify_token` (found during implementation).** Both feedback endpoints called a function that was never defined, returning 500 on every request. Not in the original audit register — found by running the Batch 0 regression suite. Now uses the same `get_current_user` dependency as every other authenticated route.

### P1 — closed

- **P1-2** No rate limits on `/models/search`, `/deployments`, `/models/upload`, `/pairing/generate`, `/auth/verify-otp`, `/auth/resend-otp`. All now limited, per authenticated user where one exists.
- **P1-3** No presence liveness. Only an orderly disconnect ever wrote `offline`, so a killed/black-holed/restart-orphaned device stayed `connected` forever. Added a heartbeat TTL sweep plus startup reconciliation.
- **P1-4** Duplicate connections silently overwrote the registry entry without closing the old socket. A reconnect now supersedes and explicitly closes the previous socket, and a superseded socket's teardown can no longer evict the connection that replaced it.
- **P1-6** Mobile reconnect was a flat 5s retry that gave up permanently after 30 attempts, and the app had no lifecycle handling at all — the direct cause of "phone is on but shows offline". Now exponential backoff with full jitter that never gives up, plus an `AppLifecycleState.resumed` handler that reconnects immediately.
- **P1-7** The app never told the backend what it actually had deployed, so the two sides could diverge permanently after any missed message. Added a `state_report` on every connect and server-side reconciliation.
- **P1-8** Server-supplied `model_name` was concatenated straight into a filesystem path. Now sanitized to a bare filename.

---

## Files changed

```
LokiAI-backend/main.py                             555 +/-
LokiAI-backend/.env.example                         22 +/-
LokiAI-Desktop/.../src/lib/lokiai-api.ts             3 +/-
LokiAI-Desktop/.../src/routes/account.tsx           13 +/-
LokiAI-Desktop/.../src/routes/admin.tsx             13 +/-
LokiAI-Desktop/.../src/routes/monitor.tsx            6 +
LokiAI-Desktop/.../src/routeTree.gen.ts             21 +   (stale codegen)
LokiAImobile UI/lib/backend_connection.dart        144 +/-
LokiAImobile UI/lib/device_registration.dart         9 +
LokiAImobile UI/lib/main.dart                       23 +/-
LokiAImobile UI/lib/model_downloader.dart           31 +/-
LokiAImobile UI/test/model_downloader_test.dart     46 +   (new)
LokiAI-backend/test_infra/*                       ~970 +   (new, test-only)
```
Total: 25 files, +3542 / −135.

---

## User-flow changes

**None user-facing.** Verified every regression run by `FLOW-1`, which exercises sign-in → `/auth/me` → pairing token → device pair → device list → real HuggingFace model search end to end.

Two deliberate, documented behaviour changes:

1. **Account Settings no longer pre-fills the saved NIM key.** It shows a masked placeholder when a key is configured; the reveal toggle now shows only what the user types in the current session. This reverses the intent of commit `168f79b` because returning the decrypted key to the browser is a P0 secret exposure under the controlling directive. Saving a key is unchanged.
2. **Already-paired phones must re-pair once.** The WebSocket now requires a device credential that only `/devices/pair` issues. Old installs log that a re-pair is required rather than failing silently.

---

## API and protocol changes

See `LOKIAI_API_AND_PROTOCOL_CHANGELOG.md` for the full list. Summary: one route removed (`POST /devices/register`), one added (`GET /admin/feedback`), one response field removed (`/auth/me.nim_key`), two added (`/devices/pair.device_token`, token in `websocket_url`), four routes newly requiring operator auth, one new WebSocket message type in each direction (`state_report` / `state_ack`).

---

## Migrations

**None.** No schema change was required by any batch. `test_infra/schema_baseline.sql` reconstructs the existing production schema for the disposable test database only and is never applied to production.

---

## What was NOT done

- **Flutter tests were not executed** — no Flutter/Dart SDK exists on this machine. The new test file is committed and its logic verified by an exact port, but a real `flutter analyze` / `flutter test` / `flutter build apk` run is still outstanding. See the risk register.
- **No real-device verification.** The reconnect fix is proven against a real WebSocket client and a real database, not against a physical phone.
- **No deployment.** Not merged to `main`, not pushed, not deployed to Render or Vercel, per instruction.
- **Remaining P1/P2 items** (indexes, dead ADB code removal, schema-reproducibility, NIM error taxonomy, polling coalescing) were out of the requested batch sequence and remain open. See `LOKIAI_REMAINING_RISK_REGISTER.md`.
