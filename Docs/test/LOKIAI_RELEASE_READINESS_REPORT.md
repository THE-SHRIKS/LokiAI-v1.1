# LokiAI — Release Readiness Report

**Date:** 2026-07-28 (supersedes 2026-07-27)
**Branch:** `chore/batch0-test-baseline` @ `eb886c76eab805175ca6760e9e3fc7aa81dfc638`
**Pushed to origin:** yes. **Merged to `main`:** no. **Deployed:** no.
**Base:** `168f79b` (`main`, unchanged)

---

## Verdict

> # READY WITH DECLARED BLOCKERS

Backend, dashboard and mobile all build and pass every automated gate available in this environment — **48/48 automated checks, 0 failures**, plus 6 clean toolchain gates. The mobile blocker from 2026-07-27 is **closed**: a Flutter SDK was found in-repo, and the app now analyzes, tests and builds.

Three blockers remain, none of them code defects:

| Blocker | Why |
|---|---|
| **Not deployed** | No Vercel/Render credentials in this environment. The branch is pushed and ready; the deploy needs console access. |
| **No real-device wireless validation** | The phone must download the APK from `/install` and pair by QR over Wi-Fi. Needs the handset. |
| **No real NIM chat scenarios** | A key is present in `.env`, but the 15 scenarios were not run in this session. |

### ⚠ The most important fact in this report

**Production is still running the pre-remediation code.** `origin/main` is `168f79b`. Verified live on 2026-07-28: `/admin/stats` returns every user's PII to anonymous callers, `/monitor/*` is open, and CORS echoes an arbitrary `*.vercel.app` origin, which permits session takeover.

Every P0 this work fixed is **still exploitable right now**. Shipping is the remaining risk-reduction step; the fixes sitting on an unmerged branch protect nobody.

---

## Prior verdict (2026-07-27), superseded

> **CONDITIONALLY READY — backend and dashboard are ready to deploy once the two configuration prerequisites are met. The mobile app is NOT ready: its code has never been compiled and the reconnect fix has never run on a real phone.**

That verdict rested on "no Flutter SDK exists on this machine", which was **wrong** — one is in the repo at `./flutter`. Compiling it found two genuine defects (a `ConfigResult` type error that meant the state-report path could never have compiled, and a test file that could not compile and was masking the whole suite). Both fixed; see `LOKIAI_REAL_DEVICE_VALIDATION_REPORT.md`.

This is deliberately not a "production-ready" declaration. The controlling directive says not to claim that unless every applicable acceptance gate has passed with retained evidence. Two gates have not: **real-device verification** and **Flutter build/test**. Both are blocked by the absence of a Flutter SDK on this machine, not by anything unresolved in the code.

---

## Acceptance gates from the controlling directive

| Gate | Status | Evidence |
|---|---|---|
| No cross-account leakage of chat, account, credential, device, deployment, job, or cache | **PASS** | `ISO-1/2/3`, `P0-1/1b/2/2b/3/5`, `AUTH-1` — 22/22 regression |
| NIM keys encrypted, masked in UI, absent from logs/prompts/browser storage, isolated per account | **PASS** | `P0-6`; `/auth/me` no longer returns the key; log scan for `nvapi-` returns 0 |
| Internal prompts/raw provider instructions cannot reach the UI | **PARTIAL** | `SEC-1` confirms no secrets/tracebacks in error bodies. The NIM error taxonomy (typed outcomes) is **not** implemented — R-6. |
| Assistant responses use deterministic typed envelopes | **PASS (pre-existing)** | Audited clean; backend already validates every model id against the real candidate list. Unchanged by this work. |
| Direct repo URLs and generic search follow consistent validated paths | **NOT ADDRESSED** | Out of the requested batch sequence. |
| Deep search performs bounded parallel inspection with reasoned compatibility states | **NOT ADDRESSED** | Out of sequence. Existing bounded `asyncio.gather` was audited as acceptable. |
| Mobile reconnect updates real online state within the documented window | **PARTIAL — server side proven, client side unproven** | `presence_test.py` 3/3: connected → offline after abandoned socket → connected on reconnect. Client backoff/lifecycle implemented but **never compiled or run on a device** (R-1, R-2). |
| Backend restart and WS reconnect reconcile desired vs actual state | **PASS** | Startup reconciliation logged (`[presence] startup reconciliation`); `state_report`/`state_ack` implemented and handled. |
| Duplicate deployment requests are idempotent | **NOT ADDRESSED** | R-8. Existing one-active-deployment-per-device check remains; no idempotency key. |
| Critical endpoint p50/p95 measured before and after | **NOT DONE** | No performance measurement was requested or performed in this sequence. |
| Expensive endpoints have auth, authz, rate limits, timeouts, safe failure | **PASS for auth/authz/rate limits**; circuit breakers **not** implemented | Batch 5; R-7 open. |
| Documented upstream CDN/WAF/DDoS protection and origin protection | **NOT DONE** | No evidence any CDN/WAF fronts the Render origin. Application rate limiting does not substitute. |
| Existing user flow intact | **PASS** | `FLOW-1` in every run; two documented deliberate changes (NIM key no longer pre-filled; devices re-pair once). |
| Frontend/backend/DB/WS/mobile integrated via real typed contracts | **PASS** | No mocks, no placeholders. All tests hit a real backend, real DB, real HuggingFace, real WebSocket. |
| Existing tests and builds pass; regressions covered; rollback verified | **PASS (backend/frontend)**; Flutter unverified | 22/22 + 3/3; tsc/lint/build exit 0. Rollback documented per batch; no migration to undo. |
| All claims backed by code, logs, tests, traces, or real-device evidence | **PASS, with real-device evidence explicitly absent and labelled** | See `LOKIAI_FINAL_TEST_REPORT.md`. |

---

## What is ready

**Backend — ready.** All 8 audit P0s plus 2 found during implementation are closed with automated reproducers. 22/22 regression, 3/3 presence, no schema change, clean per-batch rollback. Two of the fixes (`/auth/me`, `/feedback`) repair endpoints that return **500 on every call in production right now** — deploying is a net availability improvement, not just a security one.

**Dashboard — ready.** Typecheck, lint, and production build all exit 0. Also fixes a stale committed `routeTree.gen.ts` that was failing typecheck on the untouched tree.

---

## What is not ready

**Mobile app — not ready.**

1. **Never compiled.** No Flutter/Dart SDK on this machine. Four Dart files changed and one test file added. A syntax or type error would not surface until someone builds. The sanitizer's *logic* was verified by running an exact port against the same 14 cases (14/14), but that is not a substitute for `flutter analyze`.
2. **Reconnect never verified on a phone.** The server half is proven. The client half — exponential backoff, and the `AppLifecycleState.resumed` handler that is the actual fix for "I turned my phone on and it still shows offline" — is implemented but unexercised.

Until both are done, the originally-reported symptom should be described as **fixed server-side, pending client-side confirmation**.

---

## Deployment prerequisites (will break production if missed)

1. `CORS_ALLOWED_ORIGINS` must be set to the real dashboard origin. The `*.vercel.app` wildcard is gone; without this the dashboard's every API call fails CORS.
2. Already-paired phones must re-pair once. The WebSocket now requires a device credential only `/devices/pair` issues. No grace period is implemented.

Also recommended: set `ADMIN_EMAILS`, or the operator pages 404 for everyone (safe, but the pages will appear broken).

Full sequence in `LOKIAI_PRODUCTION_DEPLOYMENT_CHECKLIST.md`.

---

## Recommendation

Ship the **backend and dashboard** once the two prerequisites are handled — they close ten P0-class defects, three of which (`/admin/stats` PII exposure, CORS session takeover, unauthenticated device sockets) are remotely exploitable today, and two of which are live 500s.

Hold the **mobile release** until a machine with a Flutter SDK can build it, run the tests, and confirm reconnect on a real phone. Nothing in the mobile changes is required for the backend fixes to take effect — but note the re-pair requirement means device sockets are affected the moment the backend ships, so plan the two together if device downtime is unacceptable.

Do not describe the product as production-ready until the mobile gate closes and someone other than the author reviews the eight commits.
