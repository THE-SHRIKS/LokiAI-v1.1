# LokiAI — Production Deployment Checklist

**For:** branch `chore/batch0-test-baseline` @ `f7efca6807a2d715b9a3337fedf4c3b7d7f9b975`
**Status:** NOT merged, NOT deployed. This is the checklist to do so safely.

Two items in this branch will break production if deployed without the corresponding configuration change. Both are marked **STOP**.

---

## 0. Before you start

- [ ] Read `LOKIAI_REMAINING_RISK_REGISTER.md` R-1 and R-2 — the Flutter code in this branch has never been compiled, and the mobile reconnect fix has never run on a real phone. Decide whether to ship backend-only first (safe: old APKs keep working against the new backend **only if** you accept that already-paired devices must re-pair — see §3).
- [ ] Confirm you have a Neon restore point / branch from immediately before deploy.
- [ ] Confirm Render can roll back to the currently-deployed image.

---

## 1. STOP — configuration that must land *before or with* the backend deploy

### 1a. `CORS_ALLOWED_ORIGINS` (breaks the dashboard if missed)

The `*.vercel.app` wildcard is gone (P0-7). Without an explicit origin the production dashboard's every API call fails CORS.

- [ ] Set on the Render service:
      `CORS_ALLOWED_ORIGINS=https://lokiai-v11.vercel.app`
      (comma-separate additional origins you actually own; add any preview origin you need.)
- [ ] Do **not** re-add a wildcard for a whole PaaS domain. That is the exact defect being fixed.

### 1b. `ADMIN_EMAILS` (operator pages return 404 until set)

Empty by default, which closes `/admin/stats`, `/admin/feedback`, `/monitor/status`, `/monitor/log` to everyone — the safe failure mode, not a bug.

- [ ] Set to the individually-owned The Shriks accounts that need operator access:
      `ADMIN_EMAILS=someone@theshriks...,someone-else@theshriks...`
- [ ] Anyone listed here can read **every user's email and activity**. Treat as a privileged grant; no shared mailboxes.

### 1c. Optional new variables (safe defaults, set only to override)

- [ ] `MAX_UPLOAD_MB` — default `600`.
- [ ] `PRESENCE_TTL_SECONDS` — default `70` (~3 missed 20s heartbeats).

---

## 2. Database

- [ ] **No migration required.** No batch changed the schema. Nothing to apply, nothing to revert.
- [ ] Note the presence sweep adds a recurring `UPDATE devices ... WHERE status='connected'` every 30s on an unindexed column (R-5). Harmless at current scale; watch if the devices table grows.

---

## 3. STOP — device re-pairing (protocol change)

The device WebSocket now requires a credential that only `POST /devices/pair` issues (P0-4).

- [ ] Understand the consequence: **every already-paired phone will fail to reconnect until it re-pairs once** (scan a fresh QR from the dashboard). There is no grace period in this branch.
- [ ] Decide and communicate: either accept the one-time re-pair, or add a temporary dual-path grace period before deploying (not implemented here).
- [ ] Old APKs against the new backend: **will not connect** until re-paired with a build that stores `device_token`. Plan the APK release alongside, or accept device downtime.

---

## 4. Backend deploy (Render)

- [ ] Confirm §1 variables are set on the service **first**.
- [ ] Deploy the backend.
- [ ] Watch the startup log for:
      `[presence] startup reconciliation: UPDATE n` — expected; the restart invalidated the in-memory socket registry, so previously-`connected` rows are reset to `offline` and will return to `connected` as devices reconnect and heartbeat.
- [ ] Smoke-test in order:
  - [ ] `GET /health` → 200 (must remain **public**)
  - [ ] `GET /admin/stats` **without** a token → 404 (was a full user dump)
  - [ ] `GET /monitor/status` **without** a token → 404
  - [ ] `GET /admin/stats` as an `ADMIN_EMAILS` account → 200
  - [ ] Sign in on the dashboard → loads without CORS errors
  - [ ] `GET /auth/me` for an account **with a NIM key saved** → 200, and the body contains `has_nim_key` but **no** `nim_key` (this endpoint was returning 500 for exactly these users)
  - [ ] Account Settings shows the masked placeholder and saving a new key still works
  - [ ] Submit feedback → 200 (was 500), and `GET /feedback` returns only your own

---

## 5. Frontend deploy (Vercel)

- [ ] Deploy after the backend (it expects the operator routes to 404 for non-operators).
- [ ] Verify `/account`, `/admin`, `/monitor` render; `/admin` and `/monitor` should show "restricted to LokiAI operators" for a non-operator account rather than a raw error.
- [ ] Note `src/routeTree.gen.ts` was regenerated in this branch (it was stale and failing typecheck). No action needed; just don't revert it.

---

## 6. Mobile (only if shipping the APK)

- [ ] **Blocked on R-1** — this code has never been compiled. Before building a release APK:
  - [ ] `flutter pub get`
  - [ ] `flutter analyze` → must be clean
  - [ ] `flutter test` → the 14 new sanitizer cases must pass
  - [ ] `flutter build apk`
- [ ] Verify on a real phone: pair, background the app, disable Wi-Fi > 3 minutes (past the old 30-attempt budget), re-enable, foreground → device returns to online in the dashboard without relaunching the app. **This is the user's originally-reported bug and is the one thing that cannot be signed off from this machine.**
- [ ] Publish the APK wherever `APK_DOWNLOAD_URL` points.

---

## 7. Post-deploy monitoring (first hour)

- [ ] `/monitor/log` (as operator) — watch for 500s. There should be none from `/auth/me` or `/feedback`; both were guaranteed 500s before.
- [ ] Watch for 429 spikes: new limits are `/models/search` 20/min, `/deployments` 10/min, `/models/upload` 5/hr, `/pairing/generate` 20/min, `/auth/verify-otp` 10/min, `/auth/resend-otp` 5/min, all per user where authenticated. A legitimate user hitting these means the threshold is wrong, not that the user is abusive — adjust the specific limit rather than disabling limiting.
- [ ] Watch device presence: devices should settle to accurate online/offline within ~70s of reconnecting. A device stuck offline after re-pairing means the device-token path needs investigation.
- [ ] Grep logs for `nvapi-`, `postgresql://`, `JWT_SECRET` — must be zero (verified zero in testing).

---

## 8. Rollback

Fastest safe rollback is Render's "roll back to previous deploy" — no migration to undo.

Per-batch revert, if only one change is at fault (each is independent and reverts cleanly):

```bash
git revert f7efca6   # Batch 8 — mobile reconnect/lifecycle/path-safety
git revert 0611669   # Batch 3+7 — WS auth + presence  (reopens P0-4; devices reconnect without a token again)
git revert 1680e38   # Batch 4 — restores /devices/register AND its takeover path
git revert 01e6df0   # Batch 5 — removes upload cap and rate limits
git revert da14ee7   # Batch 6 — restores the *.vercel.app CORS wildcard (reopens session takeover)
git revert d87881b   # Batch 2 — reopens /admin/stats, /monitor/*, /feedback to the world
git revert e584bca   # Batch 1 — restores the /auth/me and /feedback 500s
```

Reverting Batches 2, 4, or 6 **reintroduces a P0**. Prefer fixing forward. If Batch 3+7 must be reverted, deployed phones keep working (they connect with a token the old handler simply ignores).

---

## 9. Release gate

Do **not** describe this as production-ready until:

- [ ] §1 variables set and verified in production
- [ ] §4 smoke tests pass against production
- [ ] §6 Flutter build + real-device reconnect verified, **or** an explicit decision recorded to ship backend-only and accept that device reconnect is fixed server-side but unproven client-side
- [ ] Someone other than the author has reviewed the 8 commits

The current honest status is in `LOKIAI_RELEASE_READINESS_REPORT.md`.
