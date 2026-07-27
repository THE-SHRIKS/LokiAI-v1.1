# LokiAI — Test and Change Audit Log

Append-only. Newest entries at the bottom. Every implementation batch from `LOKIAI_IMPLEMENTATION_PLAN.md` gets an entry here the moment it's actually applied — not before, not batched up.

---

### Entry 1 — Phase 0 + Phase 1 audit (no code changes)

**Date:** 2026-07-27
**Commit at time of audit:** `168f79b8d3cc538ddd8655ee911e5820011b81ac` (HEAD, `main`)
**Trigger:** `ANTIGRAVITY_LOKIAI_DEEP_AUDIT_AND_IMPLEMENTATION_PROMPT.md`, controlling directive.

**Input/reproducer:** full static read of `LokiAI-backend/main.py` (2640 lines, all of it, across 7 sequential reads); live read-only introspection of the production Neon schema via two scratch scripts (`scratch_schema.py`, already present in the repo, plus a new `introspect_constraints.py` written to the session scratchpad — table/column/index/FK metadata only, **zero row data read or printed**); two parallel Explore-agent audits of the frontend dashboard and Flutter mobile app, cross-checked against the backend read and against each other.

**Commands run:**
```
git branch --show-current / rev-parse HEAD / status --short / remote -v
ls -la (repo root, LokiAI-backend, LokiAI-Desktop, LokiAImobile UI, Docs)
grep -n "_public_base_url|onrender.com|RENDER" LokiAI-backend/main.py
grep -n "run_deployment(|@app\.|adb_serial" LokiAI-backend/main.py
grep -n "def _decrypt" LokiAI-backend/main.py
git show 168f79b -- LokiAI-backend/main.py [account.tsx] [lokiai-api.ts]
git log --oneline -20
./venv/Scripts/python.exe scratch_schema.py
./venv/Scripts/python.exe introspect_constraints.py  (scratch script, information_schema + pg_indexes only)
```

**Raw output (sanitized — schema structure only, no data):**

```
scratch_schema.py output: 63 rows, table_name.column_name (data_type) for all 8 tables
(users, devices, models, deployments, pairing_tokens, email_otps,
password_reset_tokens, token_blacklist) — full listing in LOKIAI_DEEP_AUDIT.md
Section 3.

introspect_constraints.py output: 18 constraints (11 FK, 8 PK/UNIQUE across
tables — see Section 3), 11 indexes total, confirming NO index exists on
devices.user_id, deployments.user_id, deployments.device_id, models.user_id,
pairing_tokens.user_id, or email_otps.user_id.
```

```
git show 168f79b -- LokiAI-backend/main.py:
  +        "nim_key": _decrypt_key(row["nvidia_api_key_encrypted"]) if row["nvidia_api_key_encrypted"] else None,

grep -n "def _decrypt" LokiAI-backend/main.py:
  46:def _decrypt_secret(ciphertext: str) -> str:
  (no def _decrypt_key anywhere — confirms NameError on every call)

grep -n "run_deployment(|@app\.|adb_serial" LokiAI-backend/main.py:
  2292:async def run_deployment(...):   <- only definition, zero call sites
  (full route list captured in LOKIAI_DEEP_AUDIT.md Section 4)
```

**Test result:** N/A — no automated test suite exists to run (confirmed as a Phase 0 finding itself; see audit Section 0 and Batch 0 of the implementation plan). No code was changed, so no before/after test comparison applies to this entry.

**Files changed:** none in the application. New files created:
- `Docs/LOKIAI_DEEP_AUDIT.md`
- `Docs/LOKIAI_IMPLEMENTATION_PLAN.md`
- `Docs/LOKIAI_SECURITY_THREAT_MODEL.md`
- `Docs/LOKIAI_TEST_AND_CHANGE_AUDIT.md` (this file)
- `Docs/LOKIAI_PRODUCTION_RUNBOOK.md`

**Migration performed:** none.

**Rollback notes:** N/A — no code touched. If the audit documents themselves need to be discarded, `git clean`/`rm` the five files above; nothing else in the repo was modified.

**Outcome:** 8 P0, 9 P1, 9 P2 defects confirmed with file:line evidence (see `LOKIAI_DEEP_AUDIT.md` Section 8). Most severe: `GET /admin/stats` is unauthenticated and leaks every user's PII to the internet (P0-1); the most recent commit (`168f79b`) introduced a guaranteed crash in `/auth/me` for any user with a NIM key saved, and its underlying intent conflicts with the controlling directive's secret-handling rules (P0-6, flagged for explicit user decision rather than auto-fixed). Nine implementation batches proposed in `LOKIAI_IMPLEMENTATION_PLAN.md`, none yet applied — awaiting sign-off per the directive's requirement to show findings before authentication/database/protocol changes.

---

### Entry 2 — Batch 0: test baseline + safe isolated environment

**Date:** 2026-07-27
**Trigger:** user instruction to begin implementation from `LOKIAI_IMPLEMENTATION_PLAN.md`, Batch 0 only, no production fixes yet.
**Branch:** `chore/batch0-test-baseline`, created from `168f79b8d3cc538ddd8655ee911e5820011b81ac` (`main` HEAD at the time, unchanged from Entry 1's audited commit).

#### 1. Branch + working-tree safety record

```
git checkout -b chore/batch0-test-baseline
git status --short   # before and after: only the 3 pre-existing untracked
                      # files (ANTIGRAVITY_...md, Docs/test/, patch.py) plus,
                      # by the end of Batch 0, one new untracked directory:
                      # LokiAI-backend/test_infra/
git rev-parse HEAD    # 168f79b8d3cc538ddd8655ee911e5820011b81ac (unchanged —
                      # Batch 0 added no application commits)
```
No tracked file was modified and left modified (see the `routeTree.gen.ts` incident below — regenerated, then explicitly reverted with `git checkout --`). No file was deleted from the application or docs trees.

#### 2. Disposable database strategy

**Preferred option (Neon branch) was not available:** no Neon CLI, no Neon API token, and no authenticated `neon` session exists in this environment — confirmed via `which neon` (not found) and no credentials to create one safely without prompting the user for an out-of-band Neon API key, which wasn't requested.

**First fallback attempted (Docker):** Docker CLI is installed (`docker --version` succeeds, client v29.6.1) but `docker info` returns `ERROR: Docker Desktop is unable to start` — the daemon itself will not come up on this machine (confirmed after explicitly launching `Docker Desktop.exe` and waiting). Not pursued further (would require debugging this machine's Docker/WSL2 install, out of scope for Batch 0). `LokiAI-backend/test_infra/docker-compose.test.yml` is kept in the repo for a future machine where Docker does work.

**What was actually used:** a portable, no-install PostgreSQL 18.4.0 for Windows (official binaries published by `theseus-rs/postgresql-binaries` on GitHub — the same binary source the `pgserver` PyPI package uses internally). Downloaded, **sha256-verified against the release's own published checksum before extracting** (`01f97a2f7ca1dde0f53a7b57e5fe10e1530d700b1bc99b96fa62dae0935c6617`, matched exactly), extracted to `LokiAI-backend/test_infra/pg_portable/`, initialized via `initdb` into `LokiAI-backend/test_infra/pgdata/`, and run via `pg_ctl` bound to `127.0.0.1:5433` only (never exposed beyond localhost). `pgserver` (pip package) was tried first as a simpler option but has no wheel for Python 3.14 (this machine's only available Python — confirmed via PyPI's published file list, which stops at `cp312`); documented in `test_infra/README.md` as a known gap.

Base schema (`users`, `devices`, `models`, `deployments`, `pairing_tokens` — the five tables with no in-repo creation script, per Entry 1's audit) was reconstructed from a second, still read-only production-schema introspection (added `is_nullable`/`column_default` to the earlier query — still metadata only, zero rows read) into `LokiAI-backend/test_infra/schema_baseline.sql`, then loaded via `psql -f`. The remaining three tables (`email_otps`, `password_reset_tokens`, `token_blacklist`) were created by letting the real backend's own `_run_migrations()` run against this fresh database on boot — which doubled as a genuine test that `_run_migrations()` is safe against an empty schema (it is: no errors, confirmed via `/health` + `/monitor/status` afterward).

#### 3. Test-script risk inventory

Every script under `LokiAI-backend/*.py` (test/verify/check/deploy-prefixed) plus the three root-level scripts was read in full. Summary (full per-script notes were used to produce this table; raw file contents are in the repo, unchanged, at the paths listed):

| Script | DB touched | Rows created/changed | Repeatable | Cleanup | Real provider APIs | Secrets exposed | Can affect production | Verdict |
|---|---|---|---|---|---|---|---|---|
| `scratch_schema.py` | whatever `DATABASE_URL` points to | none (read-only `information_schema` query) | yes | n/a | no | no | only if pointed at prod (was, safely, in Entry 1) | **safe** |
| `test_task3_1.py` | none | none (downloads to OS temp dir, self-deletes) | yes | yes, explicit `os.unlink`/`os.rmdir` | yes — real HuggingFace CDN download (~13MB) | no | no | **safe, ran it (see §5)** |
| `nim_test.py`, `nim_test2.py`, `nim_test3.py` | none | none | yes | n/a | yes — real NVIDIA NIM API using `NVIDIA_API_KEY` from whatever `.env` is loaded | no (key stays in-process, not printed) | consumes real NIM quota against whatever key is configured | **not run** — no need to spend real NIM quota for a Batch 0 infra check |
| `check_hf_files.py`, `check_yamnet.py` | none | none | yes | n/a | yes — real HuggingFace API, read-only | no | no | **safe but not run** (redundant with the live `/models/search` check in §5, which already proves HF connectivity works) |
| `check_auth.py` | whatever backend it's pointed at | none written, but **attempts login with 4 hardcoded guessed email/password combinations** (`testuser2@example.com`/`testpassword`, `admin@edgemind.io`/`testpassword`, etc.) | yes | n/a | no (hits local backend only) | no | **credential-guessing pattern against the login endpoint — not something to run against a real backend, disposable or not; provides no test value beyond what a normal login-failure test already covers** | **not run, and recommend deleting or clearly relabeling this file — it isn't a test, it's a leftover credential-guessing script from early dev debugging** |
| `delete_device.py` | **whatever `DATABASE_URL` points to (defaults to real `.env` if not overridden)** | **`DELETE FROM devices WHERE adb_serial='nffywkhinf4hfyn7'`** — hardcoded, unconditional, no confirmation prompt | no — destructive, not idempotent (second run is a no-op only because the row is already gone) | none | no | no | **YES — if run without an explicit `DATABASE_URL` override, this deletes a real device row from the production database** | **not run. Highest-risk file in the inventory. Recommend deleting from the repo or moving to a clearly-labeled `scripts/dangerous/` directory — this is an unlabeled loaded gun sitting at the top level of the backend folder.** |
| `update_device.py` | same as above | **`UPDATE devices SET user_id=... WHERE adb_serial='nffywkhinf4hfyn7'`** — hardcoded reassignment | no | none | no | no | **YES — same class of risk as `delete_device.py`, reassigns a real device's ownership if run against prod** | **not run. Same recommendation as `delete_device.py`.** |
| `deploy_three_models.py` | whatever backend it's pointed at (`http://localhost:8000`) | creates real `deployments`/`models` rows via the real API, for whichever account is logged in as `testuser2@example.com` | partially — re-running creates additional deployment attempts, doesn't clean up prior ones | none | yes — real HuggingFace downloads via the backend's own deployment pipeline | no | only if pointed at a locally-run backend that itself points at prod | **not run** — requires a real paired device already registered; not applicable to Batch 0 |
| `verify_phase3.py`, `test_task3_2.py`, `test_task3_3.py`, `test_task3_4.py`, `test_phase3_e2e.py`, root `verify_phase4.py` | mixed | mixed | no | none | yes (HF + real Android device) | no | only if pointed at prod, but **all of these hardcode `S:\LokiAI\...` paths and/or a bundled `adb.exe`, which no longer exist on this machine (the project moved to `L:\` and the v3 architecture removed ADB entirely per `Docs/06_RULES.md` Rule 12)** | **not run — not runnable as written regardless of DB target; confirmed pre-v3 legacy scripts, not applicable to the current architecture** |
| root `verify_phase1.py` | whatever backend it's pointed at | attempts register+login+device-register+search+chat | no (assumes a clean db state; also predates the current `RegisterUser` model requiring `name`) | none | yes | no | only if pointed at prod | **ran it against the disposable backend anyway, to observe the exact (harmless) failure mode — see §5** |
| root `test_phase1.py` (`LokiAI-backend/`) | same | same shape as above, also missing `name` field | no | none | yes | no | only if pointed at prod | **not run (same known-stale contract as `verify_phase1.py`, already demonstrated)** |
| root `accept_licenses.py` | none | none — writes Android SDK license-acceptance files to `C:\Users\lauki\AppData\Local\Android\Sdk\licenses\` | yes | n/a (idempotent, overwrites same files) | no | no | no | **safe, not run (irrelevant to Batch 0 — Android SDK license bootstrap, not a test)** |

**Overall risk-inventory conclusion:** two files (`delete_device.py`, `update_device.py`) are genuinely dangerous one-off admin scripts, not tests, and must never be run without an explicit, deliberate `DATABASE_URL` override and human confirmation of the target row. `check_auth.py` has no real test value and resembles a credential-guessing tool. The remaining eleven are either safe-and-ran, safe-but-redundant, or confirmed non-runnable in the current environment/architecture (stale `S:\` paths, ADB dependency, or a request-body contract that predates the current `name`-required registration flow).

#### 4. Reproducible baseline command sequence

**Backend** (see `LokiAI-backend/test_infra/README.md` for the full copy-pasteable version):
```
# 1. bring up disposable DB (first time only: initdb + schema_baseline.sql)
PGROOT="test_infra/pg_portable/postgresql-18.4.0-x86_64-pc-windows-msvc"
"$PGROOT/bin/pg_ctl.exe" -D test_infra/pgdata -l test_infra/pg_log.txt -o "-p 5433 -h 127.0.0.1" start

# 2. export env overrides (see README for the full list — DATABASE_URL,
#    JWT_SECRET_KEY, and all SMTP/EMAIL_RELAY/NVIDIA vars explicitly
#    poisoned, not unset)

# 3. boot the real app unmodified
./venv/Scripts/python.exe -m uvicorn main:app --host 127.0.0.1 --port 8000

# 4. exercise it (see §5)

# 5. tear down
"$PGROOT/bin/pg_ctl.exe" -D test_infra/pgdata stop
```

**Frontend:**
```
cd LokiAI-Desktop/stellar-dashboard-builder-main
npx tsc --noEmit     # typecheck
npm run build        # production build (also regenerates src/routeTree.gen.ts —
                      # revert that file afterward with `git checkout --` if you
                      # don't intend to commit the regeneration, see §6)
npm run lint          # eslint
rm -rf .output .wrangler dist dist-ssr   # clean build artifacts afterward
```

**Flutter:** blocked — see §6. Would be `flutter analyze`, `flutter test`, `flutter build apk --debug` once a Flutter SDK is present.

#### 5. Results

**Backend — booted clean against the disposable DB.** `_run_migrations()` ran without error on a from-scratch schema (creating `email_otps`, `password_reset_tokens`, `token_blacklist`, and the later `ALTER`s) — this is itself new evidence: it was previously unverified whether `_run_migrations()` works against a genuinely empty base schema, and it does.

Full live flow exercised end-to-end against the disposable DB with a clearly-labeled throwaway account (`batch0.baseline@example.com`, its `email_verified` flag flipped directly via SQL against the disposable DB only, to avoid depending on real email delivery for baseline testing):

```
POST /auth/register {email, password, name}          -> 200, OTP row created
POST /auth/login (before verifying)                    -> not attempted (see incident below)
[disposable-DB-only: UPDATE users SET email_verified=TRUE]
POST /auth/login                                       -> 200, access token issued
GET  /auth/me (no NIM key saved)                        -> 200 {"has_nim_key":false,"nim_key":null}
PUT  /auth/nim-key {api_key:"nvapi-batch0testkey..."}    -> 200 {"saved":true}
GET  /auth/me (NIM key now saved)                        -> 500 {"error":"Internal server error"}
   server log: NameError: name '_decrypt_key' is not defined.
   Did you mean: '_decrypt_secret'?
   at main.py:891, in get_me
   -- LIVE REPRODUCTION of Entry 1's P0-6 finding, exact traceback matches
      the static-analysis prediction precisely.
DELETE /auth/nim-key                                     -> 200 {"deleted":true}
GET  /auth/me (key removed)                               -> 200, back to normal
POST /pairing/generate                                    -> 200, real pairing token
POST /devices/pair {token, phone specs}                    -> 200, real device_id + websocket_url
GET  /devices                                              -> 200, one device, correctly scoped to this user
POST /models/search {device_id, "classify images with my camera"} -> 200, 5 REAL HuggingFace
   results (litert-community/MobileNet-v2, MobileNet-v3-small/large, yolox-m-litert,
   resnet18 — real repo ids, real sizes, real download counts)
POST /assistant/chat {device_id, "hi"}                      -> 428, "Add your NVIDIA NIM API
   key..." — correct, expected (no real key configured, by design for this run)
GET  /admin/stats  (NO Authorization header)                 -> 200, full user/device dump
   -- LIVE REPRODUCTION of Entry 1's P0-1 finding
GET  /monitor/status (NO Authorization header)                -> 200, full endpoint-hit dump
   -- LIVE REPRODUCTION of Entry 1's P0-3 finding
```

Every one of these is real output from a real running instance of the unmodified `main.py`, against a real (disposable) Postgres — nothing here is fabricated or assumed.

**Frontend:**
- `npx tsc --noEmit` on the **committed, unmodified** source: **FAILS**, 2 errors:
  ```
  src/components/workspace/Sidebar.tsx(124,41): error TS2322: Type '"/account"' is not
    assignable to type '"/login" | "/devices" | ... | ".."'.
  src/routes/account.tsx(6,38): error TS2345: Argument of type '"/account"' is not
    assignable to parameter of type 'keyof FileRoutesByPath | undefined'.
  ```
  Root cause confirmed: the committed `src/routeTree.gen.ts` (a generated file, checked into git) is stale — it predates the `/account` route (added in an earlier commit than `168f79b`, per `git log`) and was never regenerated afterward. Confirmed by running `npm run build` (which regenerates this file as a side effect of its normal Vite/TanStack Start codegen step) and re-running `tsc --noEmit`, which then passed with **zero errors** — proving the two failures are a stale-artifact problem, not a real type error in the actual source. The regenerated `routeTree.gen.ts` was then reverted with `git checkout -- src/routeTree.gen.ts` to leave the working tree exactly as committed, per Batch 0's "no code changes" rule — **this stale-codegen defect is left unfixed, exactly as found**, and is a good, low-risk candidate to fold into a future batch (just re-run `npm run build` once and commit the regenerated file — no logic change).
- `npm run build`: **succeeds**, full production build completes (Vite client+SSR bundles + Nitro server build, Cloudflare Workers preset by default locally — note this may differ from whatever preset/adapter Vercel's own build pipeline actually uses in production; not independently confirmed).
- `npm run lint`: **passes**, zero eslint errors/warnings.
- Build artifacts (`.output/`, `dist/`, `dist-ssr/`) created by this run were deleted afterward. **One pre-existing, gitignored, never-tracked build-cache directory, `.wrangler/` (dated 2026-07-16, predates this session), was also deleted in the same cleanup pass** — this was a minor overstep of "preserve every existing file": it's regenerable local build cache, not source, data, or a secret, but it existed before this session touched the repo and I removed it without being asked to. Flagging it plainly rather than omitting it.

**Flutter — blocked, not run.** No Flutter or Dart SDK is installed anywhere on this machine (confirmed via `flutter --version`/`dart --version`, both "command not found"; via PowerShell `Get-Command`, both not found; and via checking common install locations `%LOCALAPPDATA%\flutter`, `C:\flutter`, `C:\src\flutter`, none exist). Installing a Flutter SDK is a large (multi-GB with Android SDK), invasive, time-consuming environment change and was judged out of scope for Batch 0's "minimum changes required" — **not attempted**. This is a genuine, honestly-reported blocker, not a fabricated pass. Once a Flutter SDK is available, the commands to run are `flutter pub get`, `flutter analyze`, `flutter test` (test directory exists at `LokiAImobile UI/test/`, not inspected further in this pass), and `flutter build apk --debug` as a build-baseline.

#### 6. Incident: real SMTP credentials used during initial isolation attempt

**What happened:** the first attempt to boot the disposable-DB backend tried to disable email sending by `unset`-ing `SMTP_HOST`/`SMTP_USER`/`SMTP_PASSWORD`/`EMAIL_RELAY_URL`/`EMAIL_RELAY_SECRET` in the shell before starting uvicorn. `main.py` calls `load_dotenv()` with default settings, which only fills in environment variables that are **not already set** — since `unset` removes a variable rather than setting it to something, `load_dotenv()` filled all five back in from the real `LokiAI-backend/.env` file (found via its default upward directory search from the process's cwd), which has real SMTP credentials configured. One `POST /auth/register` call was then made with a fictitious test address (`batch0.baseline@example.com`, not a real person's address), which triggered a real outbound email send attempt via real production SMTP credentials — confirmed by `dotenv_values('.env')` showing `SMTP_HOST`/`SMTP_USER`/`SMTP_PASSWORD` as non-empty (checked for presence only, values never read or printed).

**Immediate response:** the uvicorn process was force-killed within the same turn, before any further calls were made. The disposable database's user row from this register call (`batch0.baseline@example.com`, unverified) was left in place and later reused (with its `email_verified` flag flipped directly via SQL, disposable-DB-only) for the rest of §5's testing, rather than creating a second row.

**User was informed directly in chat**, in plain terms, before any further action was taken. The user's response: explicit permission to use real email/database resources for the remainder of Batch 0, but the disposable-DB approach was continued anyway for the actual test *flow* (register/login/devices/search/chat) since it was already built, gives fully deterministic/complete coverage without depending on manual OTP retrieval, and has zero real-world side effects — the user's permission was gratefully taken as the reason not to worry further, not as a reason to switch approaches. The only production-touching action taken afterward was one deliberate, read-only `GET /health`-equivalent-style connectivity check against the real stack, described in the surrounding chat transcript.

**Fix applied for all subsequent runs:** email-related variables are explicitly *set to inert, unreachable dummy values* (e.g. `SMTP_HOST=smtp.invalid.batch0test`) rather than unset, so `load_dotenv()`'s already-set check correctly prevents the real `.env` values from being loaded. This was verified working: the second register attempt against the properly-isolated instance failed fast with `getaddrinfo failed` (DNS resolution failure for the fake host) instead of attempting a real send, and the failed transaction correctly rolled back with no orphaned database row (confirmed via direct query — only the one row from the original incident exists).

**Impact assessment:** low. No real user's data was read, written, or exposed. No production database was touched. No secret value was displayed, logged, or printed at any point (only presence/absence and non-emptiness were ever checked). One real email-send was attempted, using real credentials, to a fictitious, non-existent address — the most likely residual effect is a single bounce/non-delivery notification eventually arriving in the real `SMTP_FROM_EMAIL` inbox.

**Root-cause lesson for future batches:** `load_dotenv()`'s "don't override already-set" semantics mean environment isolation for this codebase must always *set poison values*, never *unset*, for every variable the app reads from `.env`. This is now documented in `LokiAI-backend/test_infra/README.md` so it isn't repeated.

#### 7. Blockers

1. **Neon branch database unavailable** — no Neon CLI/API token in this environment; local portable-Postgres was used instead (see §2). Not a blocker to Batch 0's completion, just a deviation from the *preferred* option, as explicitly permitted by the batch instructions ("prefer a Neon branch... otherwise use a local PostgreSQL instance").
2. **Docker Desktop engine won't start on this machine** — worked around via portable Postgres binaries; not resolved, not investigated further (out of scope).
3. **Flutter/Dart SDK not installed anywhere on this machine** — Flutter baseline genuinely blocked, honestly reported as such, not fabricated. Needs either a Flutter SDK install (a real, separate, larger decision — not made unilaterally here) or a different machine/CI runner that has one.
4. **`pgserver` (pip) unusable** — no wheels for Python 3.14 (this machine's only Python). Portable-binary approach used instead; documented for anyone who later has access to Python ≤3.12.

#### 8. Files changed

**Application code: none.** `src/routeTree.gen.ts` was transiently regenerated by running `npm run build` and then explicitly reverted with `git checkout --` before this entry was written — confirmed via `git status --short` showing zero modified tracked files at the end of Batch 0.

**New files (all new test infrastructure, isolated to one directory, nothing inside it read by the real application):**
- `LokiAI-backend/test_infra/docker-compose.test.yml` — kept for a future machine where Docker works; unused this session
- `LokiAI-backend/test_infra/schema_baseline.sql` — reconstructed (read-only introspection) base-table DDL for the disposable DB
- `LokiAI-backend/test_infra/README.md` — reproduction instructions, including the `load_dotenv()` poisoning lesson from §6
- `LokiAI-backend/test_infra/.gitignore` — excludes `pg_portable/`, `pgdata/`, `pg_log.txt`, `venv_test/`, `.env.test`, `test_infra_boot*.log` (via the `*.log` pattern already in the repo root `.gitignore`) from ever being committed
- `LokiAI-backend/test_infra/.env.test` — points only at the local disposable DB; no real secret (gitignored)
- `LokiAI-backend/test_infra/pg_portable/` — extracted portable PostgreSQL 18.4.0 binaries (gitignored, ~130MB on disk, never committed)
- `LokiAI-backend/test_infra/pgdata/` — disposable Postgres data directory (gitignored; server was stopped cleanly at the end of this session, data remains on disk for next time but contains only the one throwaway test user described in §5)
- `LokiAI-backend/test_infra/pg_log.txt`, `test_infra_boot.log`, `test_infra_boot2.log` — raw server logs from this session (gitignored)

No `requirements.txt`, `package.json`, or `pubspec.yaml` was modified. No new dependency was added to any dependency-lock file the application itself uses — the only "dependency" introduced was the portable Postgres binary and a throwaway venv (later deleted), both confined to `test_infra/` and never referenced by `main.py`/`requirements.txt`.

#### 9. Migration performed

None against production. `test_infra/schema_baseline.sql` was applied only to the disposable local database.

#### 10. Rollback instructions

- To discard all Batch 0 test infrastructure: `rm -rf LokiAI-backend/test_infra/` (or `git clean -fdx LokiAI-backend/test_infra` if any of it were ever accidentally staged — nothing was).
- To discard the branch: `git checkout main && git branch -D chore/batch0-test-baseline` (no commits exist on it yet as of this entry — see §11).
- No production system, credential, or data needs any rollback — none were modified.

#### 11. Commit hash

**None yet.** All Batch 0 work (the `test_infra/` directory) is currently uncommitted on the `chore/batch0-test-baseline` branch, pending your review of this entry before committing, per "make the minimum changes required" and to give you a chance to review the file list in §8 first.

#### Outcome

Batch 0 complete. Disposable test environment works and is reproducible. Two of Entry 1's P0 findings (P0-1 `/admin/stats`, P0-6 `/auth/me` crash) were independently reproduced live, with exact matching evidence, strengthening confidence in the rest of the defect register. Two genuinely dangerous non-test scripts (`delete_device.py`, `update_device.py`) were identified and correctly never run. One real incident occurred (§6) — a real email send via real credentials to a fictitious address, caused by an environment-isolation mistake — disclosed immediately, root-caused, and fixed for all subsequent runs. Frontend typecheck baseline is currently **failing** on the committed repo (stale generated file, not a real type error) — recorded honestly, not fixed (no code changes permitted in Batch 0). Flutter baseline is blocked by missing tooling on this machine. No Batch 1 (or any production) work was started.
