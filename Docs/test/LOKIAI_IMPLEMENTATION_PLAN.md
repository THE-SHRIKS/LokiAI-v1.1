# LokiAI — Implementation Plan

Companion to `LOKIAI_DEEP_AUDIT.md`. Ordered work packages ("batches") to fix the confirmed defects. Every batch lists exact files, the confirmed root cause it addresses, compatibility risk, rollback method, and the acceptance gate that must pass before moving to the next batch — per the controlling directive's change-control gates.

**Status: none of these batches have been implemented yet.** This plan is presented for review before any code is touched, per the controlling directive's instruction to show findings and proposed batches before authentication changes, database changes, or protocol-affecting changes. Batches 1–4 all touch authentication/authorization surfaces and are gated on your sign-off; nothing here has been applied.

General rules for every batch below:
- Work happens on a dedicated branch (e.g. `fix/p0-audit-batch-N`), not directly on `main`.
- Each batch is one narrow, reviewable diff — no bundling across batches.
- No visible user-flow change for any batch below except where explicitly called out (Batch 1).
- Every batch that removes or gates a previously-open endpoint is, by definition, an authentication change — flagged accordingly.

---

## Batch 0 — Safe baseline (no code changes)

**Goal:** get a real, safe way to establish "tests pass" before touching anything.

- Do **not** run the existing ad hoc `test_*.py` scripts against the live production database (they create real, non-cleaned-up rows under throwaway emails).
- Stand up a disposable local Postgres (or a Neon branch database, which Neon supports natively and is the least-effort safe option) pointed at by a scratch `.env`, run the ad hoc scripts there once to confirm they still function as smoke tests, and record the raw output in `LOKIAI_TEST_AND_CHANGE_AUDIT.md`.
- This does not require code changes — it requires your decision on which disposable database to point at (Neon branch vs. local Postgres vs. accept running once against prod with cleanup). **Needs your input** — see open question in Section "Open decisions" below.

**Rollback:** N/A (no code touched).
**Acceptance gate:** a documented, reproducible way to run the existing scripts safely exists and its raw output is logged.

---

## Batch 1 — `/auth/me` crash + NIM key exposure (P0-6)

**Files:** `LokiAI-backend/main.py` (route `get_me`, ~line 873-892); `LokiAI-Desktop/stellar-dashboard-builder-main/src/routes/account.tsx`; `LokiAI-Desktop/stellar-dashboard-builder-main/src/lib/lokiai-api.ts` (`Me` interface, ~line 209).

**Confirmed root cause:** `_decrypt_key` is called but never defined (only `_decrypt_secret` exists) — guaranteed `NameError` on every call for a user with a saved key, breaking `/auth/me` and everything that calls `getMe()` (Sidebar, ChatPanel, panels, account page, main workspace route).

**BLOCKED ON YOUR DECISION (see `LOKIAI_DEEP_AUDIT.md` Section 10).** Proposed default (directive-compliant, Option 1):
1. Backend: remove the `nim_key` field from `/auth/me`'s response entirely; keep only `has_nim_key: bool`. This alone fixes the crash (removes the only call to the undefined function) and restores the directive-required "status only, never the value" contract.
2. Frontend: `account.tsx` stops trying to prefill the input with a value from the server; the Eye/EyeOff toggle either is removed, or is kept but only toggles visibility of whatever the user is *currently typing* into the save field in this session (never a server-fetched value). `Me` interface drops the `nim_key?` field (or keeps it typed as always-absent for a transition period, harmless either way).
3. No other route or table changes.

**Expected behavior after fix:** `/auth/me` returns 200 for every user again (was 500 for anyone with a NIM key saved); Account Settings shows a masked placeholder when a key is configured, exactly as it did before commit `168f79b`; saving a new key still works unchanged (`PUT /auth/nim-key` is untouched and was never broken).

**Compatibility risk:** low for the backend fix (strictly removes a currently-crashing field). Frontend loses the "reveal my saved key" convenience feature the last commit added — this is a visible, intentional UX rollback and must be called out to you explicitly (it is, right here) rather than silently reverted.

**Rollback:** `git revert` the batch commit; restores the current crashing-but-as-committed state.

**Test that must fail before / pass after:** `GET /auth/me` with a bearer token for a user who has a saved NIM key. Before: 500 with `{"error": "Internal server error"}`. After: 200 with `{"has_nim_key": true, ...}` and no `nim_key` field containing the raw secret.

---

## Batch 2 — Unauthenticated cross-tenant data exposure (P0-1, P0-2, P0-3)

**Files:** `LokiAI-backend/main.py` — `get_admin_stats` (~2583), `get_feedback` (~371), `monitor_status`/`monitor_get_log` (~288-307), `get_deployment_status` fast path (~2561-2565).

**Confirmed root cause:** four handlers either have no `Depends(get_current_user)` at all, or have auth but not ownership filtering.

**Proposed fix (all four, one batch since they're the same class of bug and trivially reviewable together):**
1. `GET /admin/stats` — add `Depends(get_current_user)` **plus** an explicit allowlist check (e.g. a hardcoded set of admin emails read from an env var, since there is no `role`/`is_admin` column in `users` today) before returning cross-tenant data. Until that allowlist exists, the safest interim is to gate it behind an env var (`ADMIN_STATS_ENABLED=false` by default) so it's off in production unless deliberately turned on, with auth required either way. **Needs your input** on whether you want a real admin-role column added now (a schema change, higher-risk) or an env-var allowlist for now (lower-risk, same session).
2. `GET /feedback` — restrict to the requesting user's own submissions (`WHERE user_email = $1` using the token's `sub`), matching the pattern already used everywhere else in the file. If an admin-wide feedback view is wanted, gate it the same way as `/admin/stats` above rather than leaving it open to any authenticated user.
3. `GET /monitor/status`, `GET /monitor/log` — add `Depends(get_current_user)` at minimum; consider the same admin-allowlist gate as `/admin/stats` since these also expose cross-tenant aggregate/operational data, not just the caller's own.
4. `GET /deployments/{id}` fast path — add the same `user_id` ownership check the DB-fallback path already has, by storing `user_id` alongside status in the `deployment_status` in-memory dict (set at creation time in `POST /deployments`) and checking it before returning from the fast path.

**Expected behavior after fix:** all four endpoints require a valid session; the three "admin" ones additionally require allowlist membership; the deployment-status fast path returns 404 for a deployment_id that exists but isn't the caller's.

**Compatibility risk:** low. No legitimate current caller depends on these being open — the frontend's `admin.tsx`/`monitor.tsx` already send an `Authorization` header when a token exists (per frontend audit), they just weren't being checked. Whoever currently relies on `/admin/stats`/`/monitor/*` being callable without a session (if anyone/anything does — e.g. an external uptime monitor hitting `/monitor/status`) will need to be given a token or switched to `/health`, which stays public and unauthenticated.

**Rollback:** revert the commit; endpoints reopen immediately.

**Test that must fail before / pass after:** anonymous `curl` to each of the four endpoints. Before: 200 with cross-tenant data. After: 401.

---

## Batch 3 — WebSocket identity binding (P0-4)

**Files:** `LokiAI-backend/main.py` — `device_websocket` (~2088), `DeviceConnectionManager` (~2013), `_handle_deployment_update` (~2054), `_websocket_url` (~1162); mobile: `LokiAImobile UI/lib/backend_connection.dart`.

**Confirmed root cause:** the WS upgrade accepts any `device_id` with no credential; `_handle_deployment_update` trusts a client-supplied `deployment_id` with no ownership check against the connected `device_id`.

**Proposed fix (protocol-affecting — requires coordinated backend + mobile change, this is the highest-risk batch in this plan):**
1. `POST /devices/pair` already returns a `device_id`; extend it to also mint a short-lived, device-scoped WS credential (reuse the existing JWT machinery — a token with `type: "device"`, `sub: device_id`, tied to the owning `user_id`) alongside `websocket_url`.
2. `device_websocket` requires that credential as a query parameter or first-message auth frame; rejects the upgrade (or closes immediately with a clear code) if missing/invalid/mismatched with the path's `device_id`.
3. `_handle_deployment_update` checks the incoming `deployment_id` belongs to the authenticated `device_id` (`SELECT 1 FROM deployments WHERE id = $1 AND device_id = $2`) before writing status.
4. Duplicate-connection handling: on a new authenticated connect for a `device_id` that already has an active socket, explicitly close the old one (`await old_ws.close(code=4000, reason="superseded by new connection")`) before registering the new one.
5. Mobile: `pairing_screen.dart`/`device_registration.dart` persist the new device credential alongside `device_id` (same SharedPreferences mechanism already in place — encrypting it via `flutter_secure_storage` at the same time would additionally close the P1 finding about cleartext storage, but that's a separate, optional improvement, not required for this batch); `backend_connection.dart` sends it on connect.

**Expected behavior after fix:** an unauthenticated/mismatched WS connect attempt is rejected; a real paired phone connects exactly as before, transparently (existing devices will need to re-pair once to obtain the new credential — this is the one visible-to-users consequence of this batch and must be called out before shipping).

**Compatibility risk:** **medium-high.** This changes the WS handshake contract. Every already-paired device in production will fail to reconnect until it re-pairs (scans a new QR / re-registers), because it has no way to obtain the new credential without going through `/devices/pair` again. This needs a compatibility strategy — either (a) a grace period where the old no-credential path is still accepted but logged as deprecated, or (b) accept the one-time re-pair requirement and communicate it. **Needs your input** on which.

**Rollback:** revert the backend commit (old WS handler accepts any `device_id` again); revert the mobile commit and re-publish the APK, or simply don't ship the updated APK — old APKs keep working against a reverted backend.

**Test that must fail before / pass after:** connect to `/ws/device/{a_real_id}` with no credential. Before: connects successfully, receives `{"type": "connected"}`. After: connection rejected.

---

## Batch 4 — Device ownership hijack via `/devices/register` (P0-5)

**Files:** `LokiAI-backend/main.py` — `register_device` (~1253), `DeviceRegister` model.

**Confirmed root cause:** `ON CONFLICT (adb_serial) DO UPDATE SET user_id = EXCLUDED.user_id` reassigns an existing device to whoever calls the endpoint next, with no ownership check. This is also confirmed-dead legacy code (no current mobile/dashboard caller uses it; the real flow is `/devices/pair`).

**Proposed fix:** since this endpoint has no live caller in the current v3 architecture (confirmed: not referenced by `LokiAImobile UI/lib/` or the dashboard), the lowest-risk fix is to **remove the route entirely** rather than patch its authorization logic — it exists purely as legacy ADB-era surface area per `Docs/06_RULES.md` Rule 12. If you want to keep it for some out-of-band use, the alternative is adding an ownership check (`WHERE user_id = current_user` on the conflict target, refuse if the existing row belongs to someone else) instead of removal.

**Expected behavior after fix:** `POST /devices/register` returns 404 (route removed) or correctly refuses to reassign another user's device (if kept). Either way, `/devices/pair` (the real, already-correct flow) is completely unaffected.

**Compatibility risk:** low — confirmed zero current callers. Removing it is safe; keeping-and-fixing it is also safe but leaves ~25 lines of otherwise-legacy surface area alive for no current purpose.

**Rollback:** revert the commit; route reappears exactly as before.

**Test that must fail before / pass after:** as user B, `POST /devices/register` with user A's real `adb_serial`. Before: 200, device now belongs to B. After: 404 (removed) or 403 (kept-and-fixed).

---

## Batch 5 — Upload DoS + missing rate limits (P0-8, P1-2)

**Files:** `LokiAI-backend/main.py` — `BodySizeLimitMiddleware`/`_BODY_SIZE_EXEMPT_PATHS` (~200-217), `upload_model` (~1595), `search_models` (~1519), `create_deployment` (~2390), `verify_otp` (~708).

**Proposed fix:**
1. Give `/models/upload` its own generous-but-bounded cap (e.g. 500MB, comfortably above real GGUF/TFLite files seen in practice per `REPORT.md`'s deploy history) instead of no cap at all, enforced the same way the existing middleware enforces the general 10MB cap (check `Content-Length`, and additionally abort mid-stream if actual bytes read exceed the cap, since `Content-Length` can be absent/spoofed).
2. Add `@limiter.limit(...)` to `/models/upload` (e.g. 5/hour per user — uploads are rare, deliberate actions), `/models/search` (e.g. 20/min per user, matching `/assistant/chat`'s existing budget since it's a comparable cost), `/deployments` POST (e.g. 10/min per user), and `/auth/verify-otp` (e.g. 10/min per IP, on top of the existing per-OTP attempt cap).

**Expected behavior after fix:** normal usage (one model upload, a handful of searches/deployments per session) is completely unaffected; sustained abuse gets 429s with `Retry-After`.

**Compatibility risk:** low. Rate-limit numbers are a judgment call — proposed values are conservative relative to real observed usage patterns in `REPORT.md`, but should be confirmed against your actual usage before shipping.

**Rollback:** revert the commit; limits and cap disappear.

**Test that must fail before / pass after:** script 25 rapid `/models/search` calls as one user. Before: all 200 (or provider-rate-limited only). After: 429 after the 20th within the window.

---

## Batch 6 — CORS wildcard tightening (P0-7)

**Files:** `LokiAI-backend/main.py` — CORS middleware config (~176-183).

**Proposed fix:** replace `allow_origin_regex=r"https://.*\.vercel\.app|..."` with an explicit allowlist of the actual dashboard origin(s) (`https://lokiai-v11.vercel.app`, plus any preview-deployment domains you specifically use, pulled from `CORS_ALLOWED_ORIGINS`/a new dedicated env var) — drop the open-ended `*.vercel.app` wildcard entirely. If Vercel preview URLs (which get a random subdomain per branch/PR) are genuinely needed for staging, the safer alternative is a signed/short-lived preview-origin list maintained in an env var per deploy, not a blanket wildcard.

**Expected behavior after fix:** the real dashboard keeps working unchanged; any other `*.vercel.app` site is rejected by CORS as before any legitimate cross-origin caller expects.

**Compatibility risk:** low-medium — if you're actually relying on Vercel preview-branch URLs working against the production backend today (e.g. for testing PRs), this batch would need to add those specific preview domains to the allowlist first. **Needs your input** on whether preview-URL access to prod is something you currently use.

**Rollback:** revert the commit; wildcard regex returns.

**Test that must fail before / pass after:** CORS preflight from `https://attacker-poc.vercel.app` against `/auth/refresh`. Before: `Access-Control-Allow-Origin` present, request succeeds. After: CORS rejects it.

---

## Batch 7 — Presence TTL + duplicate-connection cleanup (P1-3, P1-4)

**Files:** `LokiAI-backend/main.py` — `DeviceConnectionManager`, `device_websocket`, add a background sweep task in `lifespan`.

**Proposed fix:** add `last_seen` TTL semantics — a background task (started in `lifespan`, cancelled on shutdown) periodically marks any device `status='connected'` whose `last_seen` is older than e.g. 60s (3x the mobile app's 20s heartbeat interval) as `offline`, closing the stale entry in `ws_manager.active` if still present. On a fresh connect for a `device_id` already in `ws_manager.active`, explicitly close the old socket before registering the new one (ties into Batch 3's duplicate-arbitration change — implement together if Batch 3 is approved, since both touch `device_websocket`).

**Expected behavior after fix:** a phone that dies uncleanly (kill, black-holed network, backend restart) shows as offline within ~60s instead of staying "connected" forever; reconnecting from a second location (or after backend restart) doesn't leave a phantom stale socket.

**Compatibility risk:** low — purely additive background cleanup, no protocol change (unless combined with Batch 3).

**Rollback:** revert the commit; sweep task removed, old always-stale behavior returns.

**Test that must fail before / pass after:** connect a WS client, send one heartbeat, then kill the client process without a clean close. Before: `devices.status` stays `'connected'` forever. After: flips to `'offline'` within the TTL window.

---

## Batch 8 — Mobile reconnect backoff + lifecycle hooks (P1-6, P1-7)

**Files:** `LokiAImobile UI/lib/backend_connection.dart`, `LokiAImobile UI/lib/main.dart`.

**Proposed fix:**
1. Replace the fixed 5s/30-attempt reconnect with exponential backoff + jitter (e.g. `min(30s, base * 2^attempt) + random_jitter`), and remove the permanent give-up — instead cap the *rate* of retries, not the total count, so a phone left offline overnight still reconnects the moment it's back on a network.
2. Add `WidgetsBindingObserver`/`didChangeAppLifecycleState` to the app's root widget: on `resumed`, verify network reachability, force a reconnect if the socket isn't currently open, and (new) send a small "state report" message with the locally-known `deployment_id`/status from `config.json` so the backend can reconcile desired-vs-actual (addresses P1-7 at the same time, same code path).
3. Backend: add a handler for this new state-report message type in `device_websocket`, reconciling `deployments` table state if it disagrees with what the phone reports.

**Expected behavior after fix:** foregrounding the app after being backgrounded/offline triggers an immediate reconnect attempt regardless of how long it's been; the backend learns the phone's real state instead of assuming.

**Compatibility risk:** medium — this changes both the mobile app (requires a new APK build/distribution) and adds a new WS message type (additive, won't break old APKs talking to the new backend, but old APKs won't get the reconciliation benefit until updated).

**Rollback:** revert both commits independently; old backend keeps serving old APKs unchanged either way since the new message type is additive-only.

**Test that must fail before / pass after:** background the app, disable Wi-Fi for 3+ minutes (exceeding the old 30-attempt/5s ≈ 2.5min budget), re-enable Wi-Fi, foreground the app. Before: stays disconnected until app relaunch. After: reconnects within one backoff interval of resume.

---

## Batch 9 — Indexes + dead code removal (P1-5, P1-9, P2-9, P2-10, P2-16)

**Files:** a real migration (new), `LokiAI-backend/main.py` (delete ADB block + duplicate APK routes), repo root (`patch.py`).

**Proposed fix:**
1. Add indexes on the six unindexed FK columns identified in Section 3 of the audit (`CREATE INDEX CONCURRENTLY` to avoid locking live tables), via a proper migration file (see also the schema-reproducibility gap, P2-9 — this is a good moment to also snapshot the full current live schema as a baseline migration so a clean clone becomes reproducible for the first time).
2. Delete the dead ADB block (`main.py:2134-2371`, functions confirmed to have zero call sites) and the legacy `/apk`+`/install` duplicate routes once confirmed `/apk/download`+`/apk/info` are what's actually linked from the dashboard (quick grep check before deleting).
3. Delete `patch.py` from the repo root (confirmed stale/no-op against current code) or, if you want to keep it as a historical record, move it under `Docs/` with a comment explaining it's superseded.

**Expected behavior after fix:** no visible behavior change; query plans improve under load; ~300 fewer lines of dead/legacy code in the main file.

**Compatibility risk:** very low. Index creation is additive; dead-code deletion has zero call sites by confirmed grep.

**Rollback:** revert the commit(s); trivial since nothing else depends on what's removed.

**Test that must fail before / pass after:** `EXPLAIN ANALYZE SELECT * FROM devices WHERE user_id = '<uuid>'` before/after — before: `Seq Scan`; after: `Index Scan`.

---

## Open decisions needed from you before implementation starts

1. **Batch 0:** which disposable database to use for running the existing ad hoc test scripts safely (Neon branch / local Postgres / accept prod-with-cleanup)?
2. **Batch 1:** confirm Option 1 (directive-compliant: status-only `/auth/me`, remove/repurpose the Eye toggle) vs. Option 2 (wire up the crash fix as originally intended, knowingly accepting the P0 secret-exposure it reinstates).
3. **Batch 2:** real `is_admin`/role column on `users` now, or an env-var email allowlist for the interim?
4. **Batch 3:** accept a one-time forced re-pair for all currently-paired devices when the WS auth change ships, or build a temporary dual-path grace period?
5. **Batch 6:** do you currently rely on Vercel preview-branch URLs (not just the main `lokiai-v11.vercel.app` domain) working against the production backend?

Once these are answered, batches can proceed in the order listed (1 → 9), each gated on the acceptance test passing before the next starts, per the controlling directive's change-control process.
