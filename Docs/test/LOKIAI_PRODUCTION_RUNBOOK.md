# LokiAI — Production Runbook

Operational reference for the real deployed stack: **Render** (backend, `LokiAI-backend/main.py`), **Neon** (managed Postgres), **Vercel** (dashboard, `lokiai-v11.vercel.app`), **HuggingFace** (model search/CDN, unauthenticated), **NVIDIA NIM** (per-user API key). This supersedes `Docs/01_ARCHITECTURE.md`'s stale references to Railway/Next.js — see `LOKIAI_DEEP_AUDIT.md` Section 0.

---

## Deploy

- **Backend (Render):** deploys from `LokiAI-backend/` on push to the connected branch (Render auto-deploy — confirm branch mapping in the Render dashboard, not verified from this repo alone). `Procfile` present in `LokiAI-backend/` defines the start command. Required env vars: see `.env.example` — `DATABASE_URL`, `JWT_SECRET_KEY`, `NVIDIA_API_KEY` is **not** required backend-wide (each user brings their own, per `615e672`), `SMTP_*` or `EMAIL_RELAY_URL`+`EMAIL_RELAY_SECRET`, `CORS_ALLOWED_ORIGINS`, `DASHBOARD_URL`, `BACKEND_PUBLIC_URL` (required in production — without it the backend falls back to Host-header/LAN-IP detection, which is wrong once off-LAN), `APK_DOWNLOAD_URL`+`APK_SIZE_MB` (Render's filesystem is ephemeral — the ~140MB APK cannot live in the repo/build output, must be hosted externally, e.g. a GitHub Release asset).
- **Startup behavior:** `lifespan()` (`main.py:127-133`) creates the DB pool with retry (handles Neon's serverless auto-suspend wake delay) and runs `_run_migrations()` unconditionally on every boot — this only patches incrementally (adds columns/tables if missing), it does not create the core schema from scratch. **A brand-new empty Neon database will NOT boot into a working app** — the core tables (`users`, `devices`, `models`, `deployments`, `pairing_tokens`) must exist already (see `LOKIAI_DEEP_AUDIT.md` P2-9). If this is ever needed (disaster recovery to a fresh DB), the live schema captured in this audit (`LOKIAI_DEEP_AUDIT.md` Section 3) is the reference to recreate it from, or restore from a Neon point-in-time/branch backup instead.
- **Dashboard (Vercel):** deploys from `LokiAI-Desktop/stellar-dashboard-builder-main/` on push. Also hosts `api/send-email.ts`, the serverless email-relay function the backend calls when `EMAIL_RELAY_URL`/`EMAIL_RELAY_SECRET` are set (works around Render's outbound-SMTP block).
- **Mobile (APK):** built via `flutter build apk`, distributed either from `LokiAI-backend/apk/lokiai.apk` (served by `GET /apk/download`) or via `APK_DOWNLOAD_URL` redirect — confirm which is actually wired up in production before assuming either path works (`LOKIAI_DEEP_AUDIT.md` P2-10 flags these as duplicated/possibly-inconsistent routes).

## Rollback

- **Backend:** Render supports rolling back to a previous deploy from its dashboard — no code action needed beyond selecting the prior successful deploy. If a bad deploy included a schema change, confirm the migration in `_run_migrations()` is additive/idempotent (it is, by design — `ADD COLUMN IF NOT EXISTS`, `CREATE TABLE IF NOT EXISTS`) before rolling the *code* back while the *schema* stays forward — this is safe because nothing in `_run_migrations()` drops or renames columns.
- **Dashboard:** Vercel keeps every deploy addressable; roll back via the Vercel dashboard or `vercel rollback`.
- **Database:** Neon supports point-in-time restore and branching — for any destructive migration, create a Neon branch first and validate against it before applying to the primary branch.

## Provider outage

- **HuggingFace down/rate-limiting:** `_hf_get`/`_hf_head` retry once on 429 using the `Retry-After` header; beyond that, `search_deployable_models` raises a 502 with the real upstream error text if *all* queries fail (`any_ok == False`). User-facing impact: model search and deployment-file-resolution fail; chat conversation (the no-task-detected path) is unaffected since it doesn't call HF. No circuit breaker exists — repeated failed searches will keep retrying HF every time, not back off. **Action:** monitor `/monitor/log` (once authenticated per Batch 2) for `502` spikes on `/models/search`/`/assistant/chat`/`/deployments`; if sustained, communicate a known-issue banner (manual, no kill-switch exists yet) rather than leaving users to hit the same 502 repeatedly.
- **NVIDIA NIM down/rate-limiting/key issues:** currently surfaces as a generic 502 with raw exception text in the response (`LOKIAI_DEEP_AUDIT.md` P1-1 — this is itself a defect to fix, but until it is, expect unstructured error text). The one well-handled case is a missing key (428 with a clear message). **Action:** check whether the failure is NIM-side (test `curl https://integrate.api.nvidia.com/v1/...` directly with a known-good key) vs. account-side (an individual user's key revoked/invalid — ask them to check https://build.nvidia.com).

## NIM key incidents

- **A user's key stops working:** they update it via `PUT /auth/nim-key` (validates `nvapi-` prefix only, does not currently validate the key actually works against NVIDIA until the next real chat call — no validate-on-save yet, a gap noted but not in the current batch plan). Old key is fully overwritten (`UPDATE users SET nvidia_api_key_encrypted = $1`), no history retained.
- **Suspected key leak (e.g. from the P0-6 `/auth/me` exposure before it's fixed, or any other channel):** the affected user should immediately revoke the key at https://build.nvidia.com and save a new one via the dashboard. Backend-side, there is no way to force-revoke a NIM key remotely (it's NVIDIA's credential, not ours) — the only backend action possible is `DELETE /auth/nim-key` to stop the app from using the (potentially compromised) key further, which does not by itself invalidate it at NVIDIA.

## WebSocket/device outage

- **Symptom: phone shows offline when it's actually online.** Root cause candidates (in order of likelihood, per this audit): (1) mobile app's reconnect loop already exhausted its fixed 30-attempt budget and needs a manual app relaunch (`LOKIAI_DEEP_AUDIT.md` P1-6, unfixed as of this writing); (2) backend restarted, wiping in-memory `ws_manager.active`, and the phone hasn't sent a heartbeat since to re-mark itself connected (P1-3, no server-side presence TTL exists yet either way). **Action until Batch 7/8 ship:** ask the user to force-close and reopen the LokiAI app (triggers the cold-start reconnect path, which does work correctly per the mobile audit).
- **Symptom: phone shows connected but deployments never complete.** Check `/monitor/status`'s `ws_connections` count (once auth-gated) against `GET /devices` for that user — if the DB says `connected` but the socket isn't actually in `ws_manager.active` (only checkable via a backend console/log inspection today, no exposed endpoint for it), the presence flag is stale; a full backend restart or the Batch 7 TTL sweep (once shipped) will correct it.

## Database saturation

- Neon connection pooling is handled by `asyncpg.create_pool` with default pool sizing (not explicitly configured in `main.py` — uses asyncpg's defaults). Under load, watch for `asyncpg.exceptions.TooManyConnectionsError` in Render logs. **Action:** confirm Neon's plan-level max-connections limit and whether `asyncpg.create_pool(DATABASE_URL, min_size=..., max_size=...)` needs explicit bounds — not currently set, meaning the pool could in theory grow unbounded under concurrent load up to whatever asyncpg's internal default caps at. Flagged as a follow-up, not in the current batch plan.

## Rate-limit event

- `slowapi`'s `RateLimitExceeded` handler (`main.py:140-144`) returns 429 with `Retry-After: 60` uniformly. Check `/monitor/log` (once auth-gated) filtered to 429s to distinguish a genuine abuse spike from a legitimate user hitting a too-tight limit — if the latter, the fix is adjusting the specific route's `@limiter.limit(...)` value, not disabling limiting.

## Suspected attack

1. Check `/monitor/log` (once Batch 2 ships and it's auth-gated — **until then, be aware this endpoint is itself readable by an anonymous attacker, so don't treat its absence of alarming entries as proof nothing is happening; also check Render's own request logs, which are outside this app's visibility**).
2. For a suspected `/admin/stats` or `/feedback` scrape (P0-1/P0-2, pre-Batch-2): there is no request logging granular enough to reconstruct exactly what an anonymous scraper retrieved beyond aggregate hit counts in `monitor_log` — Render's own access logs are the authoritative source until then.
3. For a suspected WS impersonation (P0-4, pre-Batch-3): no per-connection audit trail exists beyond the `print(f"[WS] device {device_id} connected")`/`disconnected` lines going to Render's stdout logs — check those for a `device_id` connecting from an unexpected pattern (e.g. rapid repeated connects, or a `device_id` connecting that the legitimate owner reports never having their phone online).
4. Rotate `JWT_SECRET_KEY` if session takeover (AP-5 in the threat model) is suspected — **this invalidates every currently-issued access/refresh token instantly** (all users get logged out) and also changes the Fernet key derived from it (`_fernet = Fernet(base64.urlsafe_b64encode(sha256(JWT_SECRET_KEY)))`), meaning **every currently-stored encrypted NIM key becomes undecryptable** — every user would need to re-enter their NIM key after this rotation. This is a real, non-trivial-impact rotation; do not do it reactively without understanding this blast radius.

## Secret rotation

- **`JWT_SECRET_KEY`:** see "Suspected attack" above — rotating this logs everyone out AND breaks every stored encrypted NIM key (they're both derived from/signed with this one value). If ever done, plan for: (a) a maintenance window, (b) a message to users that they'll need to re-auth and re-enter their NIM key, (c) do not silently rotate without that communication.
- **`DATABASE_URL`/Neon credentials:** rotate via the Neon console, update Render's env var, redeploy — no application-code change needed.
- **`NVIDIA_API_KEY`:** not currently used backend-wide (removed per `615e672`, each user brings their own) — nothing to rotate at the platform level.
- **SMTP/email-relay secret:** rotate via the SMTP provider / regenerate `EMAIL_RELAY_SECRET`, update both Render (backend) and Vercel (the `api/send-email.ts` function must match) simultaneously — a mismatch here silently breaks all outbound email (OTP, password reset, welcome) with no user-facing error beyond "Could not send verification email."

## Incident evidence collection

- Sanitized (no secrets, no full user PII beyond what's needed) evidence should go into `LOKIAI_TEST_AND_CHANGE_AUDIT.md` as a new dated entry, following the same format as Entry 1.
- Render logs, Neon query logs, and Vercel function logs are the three external log sources not captured by anything in this repo — none of this app's own logging (`monitor_log`, `print()` statements) is persisted beyond the in-memory 500-entry ring buffer (`MAX_LOG = 500`, `main.py:240`) or Render's own log retention window. For any incident expected to need forensic review later than Render's log retention allows, export relevant logs promptly.
