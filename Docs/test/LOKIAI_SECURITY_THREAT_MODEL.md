# LokiAI — Security Threat Model

Companion to `LOKIAI_DEEP_AUDIT.md`. Assumes a hostile internet-wide attacker and an authenticated-but-malicious LokiAI user, per the controlling directive.

---

## ⚠ Three distinct states — do not conflate them

This document was originally written against the pre-remediation code. It now tracks **three separate states**, because they genuinely differ, and the most important row is the one that is still exploitable.

| | **A. Original** (`168f79b`) | **B. Remediation branch** (`chore/batch0-test-baseline`) | **C. Deployed production** |
|---|---|---|---|
| AP-1 anonymous PII via `/admin/stats` | OPEN | **CLOSED** | **OPEN — LIVE** |
| AP-2 cross-account feedback / deployment status | OPEN | **CLOSED** | **OPEN — LIVE** |
| AP-3 WebSocket device impersonation | OPEN | **CLOSED** | **OPEN — LIVE** |
| AP-4 device ownership hijack | OPEN | **CLOSED** (route removed) | **OPEN — LIVE** |
| AP-5 CORS session takeover via `*.vercel.app` | OPEN | **CLOSED** | **OPEN — LIVE** |
| AP-6 disk exhaustion via unbounded upload | OPEN | **CLOSED** | **OPEN — LIVE** |
| AP-7 provider quota abuse (search unthrottled) | OPEN | **CLOSED** | **OPEN — LIVE** |
| Internal prompt text reaching the UI | OPEN | **CLOSED** | **OPEN — LIVE** |
| Fabricated model size/filename on direct-repo path | OPEN | **CLOSED** | **OPEN — LIVE** |
| Device credential in plaintext + backup-eligible | OPEN | **CLOSED** | **OPEN — LIVE** |

**State C is state A.** `origin/main` is still `168f79b`; the remediation branch has been pushed but never deployed. Verified live 2026-07-28 by probing the production backend:

```
GET  /admin/stats     (no auth)  -> HTTP 200   [returns every user's PII]
GET  /monitor/status  (no auth)  -> HTTP 200
POST /devices/register           -> HTTP 401   [route still present]
OPTIONS /auth/refresh  Origin: https://evil-poc-check.vercel.app
   -> access-control-allow-origin: https://evil-poc-check.vercel.app
```

Response bodies were deliberately discarded rather than captured, to avoid collecting real user data while proving the exposure.

**Nothing in this document should be read as "fixed in production" until a deployment is recorded in `LOKIAI_PREPRODUCTION_DEPLOYMENT_REPORT.md`.**

---

---

## Assets

| Asset | Where it lives | Sensitivity |
|---|---|---|
| User credentials (password hash) | `users.password_hash` (bcrypt) | High |
| Session tokens (access/refresh JWT) | in-memory (frontend) / httpOnly cookie / bearer header in transit | High |
| Per-user NVIDIA NIM API key | `users.nvidia_api_key_encrypted` (Fernet, key derived from `JWT_SECRET_KEY`) | High — billable third-party credential |
| User PII (email, name, activity) | `users` table | Medium-high |
| Device pairing state / `device_id` | `devices` table; phone's SharedPreferences | Medium — controls what a device can receive |
| Chat history | frontend `localStorage` only (no server-side chat storage) | Medium — may contain what a user's phone is used for |
| Deployment/model metadata | `deployments`, `models` tables | Low-medium |
| Uploaded model files | `LokiAI-backend/uploaded_models/` on Render's disk | Low (not secret) but a DoS target (disk exhaustion) |
| Server compute/DB/NIM quota | Render process, Neon connections, per-user NIM billing | Medium — abuse costs real money/availability |

## Actors

- **Anonymous internet user** — no account, no credentials.
- **Registered-but-not-device-owning user** — has an account, may or may not have paired a device or configured a NIM key.
- **Malicious authenticated user** — a real registered account being used to attack other accounts or the platform itself, not just their own data.
- **Network-adjacent attacker** — can observe/tamper with traffic between phone and backend (relevant to WS auth and TLS enforcement).
- **The LokiAI operator (you)** — trusted, holds `.env` secrets, Render/Neon/Vercel console access.

## Trust boundaries (see also `LOKIAI_DEEP_AUDIT.md` Section 2)

1. **Internet ↔ Backend** — should require nothing beyond `/health`, `/install`, `/apk/*`, `/system/info`, and the auth-issuance endpoints (`register`/`login`/`verify-otp`/`forgot-password`/`reset-password`) to be reachable anonymously. **Currently also anonymously reachable: `/admin/stats`, `/monitor/status`, `/monitor/log` — confirmed boundary violation (P0-1, P0-3).**
2. **Authenticated user ↔ other users' data** — every resource read/write must filter by the authenticated `user_id`, never a client-supplied one. **Currently violated by `/feedback` GET and the `/deployments/{id}` in-memory fast path (P0-2), and by `/devices/register`'s cross-account reassignment (P0-5).**
3. **Paired device ↔ backend** — a WebSocket connection should only be acceptable from a device that actually completed `/devices/pair` and can prove it. **Currently unenforced entirely (P0-4)** — any `device_id` is accepted.
4. **Dashboard origin ↔ backend, with credentials** — only the real dashboard origin(s) should be able to make credentialed (cookie-bearing) cross-origin requests. **Currently over-broadened to all of `*.vercel.app` (P0-7).**
5. **Backend ↔ external providers (HuggingFace, NVIDIA NIM, SMTP)** — outbound only, backend-initiated, using backend-held or per-user-decrypted-at-request-time credentials. No user-supplied URL is fetched arbitrarily (HF calls are always to `huggingface.co` with backend-constructed paths; the "direct model_url" deploy path lets a user supply an arbitrary CDN URL, but that URL is only ever handed to the *phone* to download, not fetched server-side — so this is not an SSRF vector today. Confirmed by reading `create_deployment`: the `model_url` branch never issues an HTTP request to that URL from the backend itself, only from the client-supplied string embedded in the WS push to the phone).

## Attack paths (confirmed, code-verified)

### AP-1: Anonymous PII harvest via `/admin/stats`
Attacker (anonymous) → `GET /admin/stats` → receives every user's email, name, signup date, device count, last-active timestamp, latest deployment model/status. No authentication, no rate limit observed on this specific route. **Impact:** full user-base enumeration, targeted phishing/credential-stuffing list, business-confidential usage data (who's active, what they're deploying) exposed to competitors or attackers. **Mitigation:** Batch 2.

### AP-2: Cross-account feedback/deployment-status read
Malicious authenticated user → `GET /feedback` → reads every other user's feedback text + email. Same actor → guesses/enumerates a `deployment_id` UUID (36 chars, effectively unguessable by brute force, but leakable via other channels e.g. shared screenshots, browser history, referrer headers) → `GET /deployments/{id}` while it's still "hot" in the in-memory `deployment_status` dict → reads another user's live deployment progress/error text. **Impact:** low-to-medium (feedback text/email disclosure; deployment status is lower sensitivity but still cross-tenant). **Mitigation:** Batch 2.

### AP-3: Device impersonation via WebSocket
Attacker obtains a `device_id` (via: physical access to a rooted/backed-up phone's SharedPreferences per mobile audit; a leaked screenshot/log containing it; or — more concerning — since device IDs are sequential-looking UUIDs from Postgres `gen_random_uuid()`, they are not practically guessable, so the realistic vector is compromise of one specific target device, not mass scanning) → connects to `wss://.../ws/device/{that_id}` with zero credentials → receives the next `deploy` push (containing a CDN model URL, not itself secret) → can send forged `heartbeat` to keep the real device "looking connected" even if it's actually offline, hiding a real outage from the legitimate owner → can send forged `deployment_id`-bearing messages to corrupt that user's deployment status. **Impact:** presence-spoofing (denial of accurate service state) and deployment-status corruption for a targeted victim; not a path to reading other users' NIM keys or chat (those never traverse the device WS). **Mitigation:** Batch 3.

### AP-4: Device ownership hijack
Malicious authenticated user, knowing/guessing a victim's `adb_serial` (a device-hardware-derived string, more guessable than a UUID if the format is predictable, e.g. real Android serials often follow vendor patterns) → `POST /devices/register` → the device silently moves to the attacker's account, WHERE it now shows in the attacker's `GET /devices` and is a valid target for the attacker's own `/deployments` calls, effectively locking the real owner out (their next `GET /devices/{id}` 404s since `user_id` no longer matches). **Impact:** account-adjacent device takeover, denial of service to the real owner. **Mitigation:** Batch 4.

### AP-5: Cross-origin session theft via `*.vercel.app` CORS wildcard
Attacker deploys `evil.vercel.app` (free, self-serve, no verification required by Vercel) → lures a logged-in LokiAI user to visit it (phishing link, malicious ad, compromised third-party site embedding an iframe/script) → page JS does `fetch('https://lokiai-backend.onrender.com/auth/refresh', {credentials:'include'})` → browser attaches the `SameSite=None` refresh cookie (sent cross-site by design) → CORS allows `evil.vercel.app` to read the response (matches the wildcard regex) → attacker JS extracts the fresh `access_token` → attacker now has a valid session, can call any authenticated endpoint as the victim (read their devices, chats stored client-side aren't accessible this way since they're localStorage on the *victim's* browser not exposed via API, but device control / deployment creation / NIM key status are all reachable). **Impact:** full session takeover requiring only that the victim visit a page, no XSS on the real LokiAI origin needed. **This is the most severe attack path in this audit that requires no prior foothold at all** — AP-1 requires no foothold either but is read-only PII; this one is a full account-action takeover. **Mitigation:** Batch 6.

### AP-6: Disk-exhaustion DoS via unbounded uploads
Malicious authenticated user (any registered account, including a freshly self-registered throwaway one — registration has no identity verification beyond email OTP) → repeatedly `POST /models/upload` with large files, no rate limit, no total-size cap → fills Render's disk → backend crashes or starts failing writes for every user. **Impact:** platform-wide availability loss caused by a single authenticated actor. **Mitigation:** Batch 5.

### AP-7: NIM quota exhaustion (partially mitigated already)
Malicious authenticated user hammers `/assistant/chat` → already rate-limited at 20/min per user (`main.py:1767`) — this specific path is reasonably protected. `/models/search`, however, has no rate limit and triggers multiple live HuggingFace API calls + CDN HEAD requests per call — an attacker could drive sustained HF-API load (not backend-billed, but could get the backend's IP rate-limited/blocked by HuggingFace, degrading search for all users) with no throttle. **Mitigation:** Batch 5.

## Residual risks (not eliminated even after all batches in the implementation plan)

- **HuggingFace and NVIDIA NIM availability are external dependencies with no circuit breaker today.** Even after Batch 5's rate limits, a sustained NIM outage or HF rate-limiting event degrades the assistant for everyone with no automatic fallback/backoff beyond the single-retry-on-429 already in `_hf_get`/`_hf_head`. A real circuit breaker (trip after N consecutive failures, fail fast for a cooldown window) is out of scope for the batches above and should be a follow-up.
- **No WAF/CDN/DDoS layer is documented or confirmed configured in front of Render.** Application-level rate limiting (slowapi, per-IP/user) does not stop a volumetric network-layer DDoS. This audit found no evidence of Cloudflare/similar in front of the backend — confirm with you whether one exists; if not, it's a real gap the directive explicitly calls out as required ("Do not claim that application-level rate limiting alone prevents volumetric DDoS").
- **Device credential storage remains cleartext SharedPreferences even after Batch 3** unless the optional `flutter_secure_storage` migration mentioned in that batch is also done — Batch 3's core fix (server-side auth check) closes the *impersonation-without-any-secret* hole, but a device-scoped credential is still worth protecting at rest once it exists.
- **`adb_serial`'s predictability was not independently verified in this pass** (would require inspecting real captured Android serial formats) — Batch 4 removes the vulnerable endpoint regardless, so this residual risk is moot once that batch ships, but is noted for completeness since it was assumed rather than proven during AP-4's writeup.
- **Rate-limit values proposed in the implementation plan are judgment calls, not load-tested** — they should be validated against real usage before being treated as final.

## Production controls checklist (status, not yet implemented where marked)

- [ ] CDN/WAF in front of origin — **status unknown, needs confirmation from you**
- [ ] HTTPS enforced — confirmed via `SecurityHeadersMiddleware`'s HSTS header and cookie `secure` flag tied to `is_https` detection
- [x] Security headers (X-Content-Type-Options, X-Frame-Options, CSP `default-src 'self'`, Referrer-Policy) — present, `main.py:186-198`
- [x] Rate limiting on auth endpoints (login/register/forgot-password) — present
- [ ] Rate limiting on expensive/sensitive endpoints (search, deployments, uploads, OTP) — **missing, Batch 5**
- [x] JWT short-lived access + rotated refresh + real revocation — present, confirmed correct
- [ ] Per-request WS authentication — **missing, Batch 3**
- [x] SQL injection — all queries confirmed parameterized (`$1`/`$2` asyncpg placeholders), no string-interpolated SQL found anywhere in `main.py`
- [ ] SSRF on external URL handling — confirmed not currently exploitable (no server-side fetch of user-supplied URLs), but worth a dedicated allowlist check if the deploy-time `model_url` handling ever grows to include server-side validation/fetching
- [x] Upload path traversal — confirmed safe (`os.path.basename()` on both write and read paths)
- [ ] Upload size/rate bounds — **missing, Batch 5**
- [x] Secret redaction in generic error handler — confirmed (`_generic_exception_handler` logs server-side, returns only "Internal server error" to the client)
- [ ] Structured logging with trace IDs — partially present (`monitor_log` has request ids) but not correlated end-to-end through NIM/HF calls
- [ ] Abuse-detection alerting (auth spikes, WS floods, etc.) — **not found, out of scope for this pass, flag as future work**
- [ ] Documented incident response / key rotation runbook — **now created, see `LOKIAI_PRODUCTION_RUNBOOK.md`**
