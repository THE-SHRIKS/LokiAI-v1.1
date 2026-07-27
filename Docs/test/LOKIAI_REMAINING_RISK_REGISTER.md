# LokiAI — Remaining Risk Register

**As of:** 2026-07-27, branch `chore/batch0-test-baseline` @ `f7efca6`
**Status:** all 8 audit P0s closed, plus 2 P0-class defects found during implementation. What follows is what is **still open**.

Severity uses the controlling directive's scheme.

---

## Open P0

**None.** Every P0 in `LOKIAI_DEEP_AUDIT.md` §8 is closed and covered by an automated reproducer.

Two caveats that are *not* code defects but could reintroduce a P0 if mishandled at deploy time:

| ID | Risk | Mitigation |
|---|---|---|
| DEP-1 | `ADMIN_EMAILS` is empty by default. If an operator address is added carelessly (e.g. a shared or personal mailbox), that account gets every user's PII. | Add only individually-owned The Shriks accounts. Treat it as a privileged grant. |
| DEP-2 | `CORS_ALLOWED_ORIGINS` is now **required** in production. If someone "fixes" a CORS error by re-adding a wildcard, P0-7 (session takeover) returns immediately. | Documented in `.env.example` and the deployment checklist. Never widen to a whole PaaS domain. |

---

## Open P1

| ID | Risk | Impact | Why still open |
|---|---|---|---|
| **R-1** | **Flutter code is committed but never compiled or tested.** No Flutter/Dart SDK exists on this machine. Batches 3 and 8 changed `backend_connection.dart`, `device_registration.dart`, `main.dart`, `model_downloader.dart` and added a test file. | A syntax or type error would not surface until someone builds the APK. The reconnect fix — the user's original reported symptom — has **not** been observed working on a real phone. | Installing a Flutter + Android SDK is a large, invasive environment change that was out of scope. **This is the single biggest gap before release.** |
| **R-2** | **No real-device verification of reconnect.** Presence liveness is proven server-side against a real WebSocket client; the `AppLifecycleState.resumed` handler cannot be exercised without a device or emulator. | The server half of "phone shows offline" is fixed and proven. The client half is implemented but unproven. | Requires a physical phone with a rebuilt APK. |
| **R-3** | **Mobile device credential stored in cleartext SharedPreferences**, and `android:allowBackup` is not disabled. | A rooted device or a cloud-backup restore could extract `device_token` and impersonate that phone. Strictly better than before (there was no credential at all, and the bare `device_id` was sufficient), but the new secret deserves protection. | Needs `flutter_secure_storage` + `allowBackup="false"`; both require a Flutter build to verify. |
| **R-4** | **No CI.** Every gate in this work was run manually. | A regression can land unnoticed; the reproducers only protect what someone remembers to run. | No `.github/workflows` exists; creating one was outside the batch sequence. |
| **R-5** | **No index on any tenant-scoped foreign key** (`devices.user_id`, `deployments.user_id`, `deployments.device_id`, `models.user_id`, `pairing_tokens.user_id`, `email_otps.user_id`). Every `WHERE user_id = $1` is a sequential scan. | Fine at current scale; degrades linearly with users and rows. The new presence sweep adds a recurring `UPDATE ... WHERE status='connected'` every 30s, also unindexed. | Was Batch 9, outside the requested sequence. Low risk, easy win: `CREATE INDEX CONCURRENTLY`. |
| **R-6** | **No typed NIM error taxonomy.** Every provider failure still collapses into one `except Exception` → 502 carrying raw exception text. | Users see unhelpful errors; raw provider/SDK text reaches the client (checked: no secrets, but it is internal detail). The directive requires a typed taxonomy. | Not in the requested batch sequence. |
| **R-7** | **No circuit breaker for HuggingFace or NIM.** A sustained provider outage means every request retries into a dead dependency. | Degraded assistant/search for all users during a provider incident; possible HF IP-level rate-limiting of our backend. | Rate limits (Batch 5) bound the abuse case but not the outage case. |
| **R-8** | **Deployment creation is not idempotent.** A duplicate `POST /deployments` is blocked only by the "one active deployment per device" check, not by an idempotency key. | A retried request in a narrow window could create a second deployment row. | Not in the requested sequence; the frontend has its own double-submit guard, so real-world exposure is low. |

---

## Open P2

| ID | Risk | Notes |
|---|---|---|
| R-9 | **~250 lines of dead ADB code** (`run_deployment`, `push_to_device`, `adb_shell`, `install_apk`, `check_apk_installed`, `_resolve_adb_path`) remain in `main.py` with zero call sites. | Not reachable, so not exploitable, but it is `subprocess`-invoking code contradicting `Docs/06_RULES.md` Rule 12. Deletion was Batch 9. |
| R-10 | **Core schema has no in-repo creation script.** `users`, `devices`, `models`, `deployments`, `pairing_tokens` exist only in the live database. | A clean clone cannot stand up a working database. `test_infra/schema_baseline.sql` now captures the structure (test use only) — promoting it to a real baseline migration would close this. |
| R-11 | **Duplicate/overlapping APK routes** — `/apk` + `/install` (old, references a Flutter build path) vs `/apk/download` + `/apk/info` (current). | Confusing; one set is likely dead. |
| R-12 | **Dashboard polls uncoordinated.** Multiple components independently `GET /devices` on 5s timers with `cache: no-store`; TanStack Query is installed but entirely unused. | Wasteful, not incorrect. The backend now has WebSocket infrastructure the dashboard still doesn't use for device status. |
| R-13 | **Workspace panel layout localStorage keys are not user-scoped.** | Low-sensitivity UI preferences only (which panels are open), not user content. |
| R-14 | **No `AbortController` cancellation on logout.** | Currently masked by React unmounting routes on navigation; would become a real bug if a WebSocket or query cache is added to the dashboard. |
| R-15 | **`Docs/01_ARCHITECTURE.md` is stale** — still says Railway + Next.js 14; the real stack is Render + Neon + Vite/React/TanStack Start. | Misleads future contributors and agents. |
| R-16 | **Two dangerous unlabelled scripts remain in the repo root of the backend:** `delete_device.py` (unconditional `DELETE FROM devices WHERE adb_serial='...'`) and `update_device.py` (reassigns device ownership). Both default to the **production** `DATABASE_URL`. | Not run during this work and flagged in the Batch 0 inventory. They are one careless `python delete_device.py` away from mutating production. Recommend deleting or moving to a clearly-labelled dangerous-scripts directory. |
| R-17 | **`check_auth.py` is a credential-guessing script**, not a test — it tries four hardcoded email/password pairs against `/auth/login`. | No test value; recommend deletion. |
| R-18 | **Legacy test scripts are unrunnable** — `test_task3_*.py`, `test_phase3_e2e.py`, `verify_phase3.py`, `verify_phase4.py` hardcode `S:\LokiAI\...` paths and a bundled `adb.exe` that no longer exist, and target a removed architecture. | Dead weight that looks like a test suite. |

---

## Explicitly accepted (not defects)

- **Rate-limit thresholds are judgment calls**, not load-tested. They sit far above observed interactive use. Revisit under real traffic.
- **Presence TTL of 70s** means a device can appear online for up to ~70s after it dies. Tightening trades accuracy against false offlines on flaky mobile networks.
- **Device tokens are long-lived (365d) and not individually revocable** except by deleting the device (which the socket re-checks on every connect). Appropriate for a device that must reconnect unattended after days offline; a per-device revocation list would be stronger.
- **`GET /health` remains public** by design, and is regression-guarded (`PUB-1`) so it isn't accidentally locked down — uptime monitoring depends on it.

---

## Recommended order if work continues

1. **R-1 / R-2** — get a Flutter SDK, build, analyze, test, and verify reconnect on a real phone. Nothing else matters as much: the user's originally-reported bug is only half-proven.
2. **R-4** — CI, so the 25 passing checks stay passing.
3. **R-16 / R-17** — delete the loaded-gun scripts.
4. **R-5** — indexes (cheap, `CONCURRENTLY`, no downtime).
5. **R-3** — secure storage + `allowBackup="false"` on the next mobile release.
6. **R-6 / R-7** — NIM error taxonomy and circuit breakers.
