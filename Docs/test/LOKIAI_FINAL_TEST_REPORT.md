# LokiAI — Final Test Report

**Date:** 2026-07-27
**Branch:** `chore/batch0-test-baseline` @ `f7efca6807a2d715b9a3337fedf4c3b7d7f9b975`
**Environment:** disposable local PostgreSQL 18.4.0 (`127.0.0.1:5433`), real backend process (unmodified `main.py`), real HuggingFace API, real WebSocket client. SMTP and NIM deliberately pointed at inert values.

---

## Totals

| Suite | Checks | Passed | Failed | Not run |
|---|---|---|---|---|
| Backend regression (`test_infra/regression.py`) | 22 | **22** | 0 | 0 |
| Presence liveness (`test_infra/presence_test.py`) | 3 | **3** | 0 | 0 |
| Frontend typecheck (`tsc --noEmit`) | — | **exit 0** | — | — |
| Frontend lint (`eslint .`) | — | **exit 0** | — | — |
| Frontend build (`vite build` + Nitro) | — | **exit 0** | — | — |
| Flutter analyze / test / build | 14 (written) | — | — | **all — no SDK on this machine** |
| Sanitizer logic verification (port of Dart → Python) | 14 | **14** | 0 | 0 |

**Backend + presence: 25/25 passing. Frontend: 3/3 gates green. Flutter: written but unexecuted.**

---

## Baseline vs. final

The regression suite was written *before* any fix, so its first run is a genuine failing-reproducer baseline.

| Check | Baseline (pre-fix) | Final |
|---|---|---|
| P0-6 `/auth/me` no key leak | **FAIL** — HTTP 500 | PASS |
| P0-1 `/admin/stats` anonymous | **FAIL** — HTTP 200 + full user dump | PASS |
| P0-1b `/admin/stats` non-admin | **FAIL** — HTTP 200 | PASS |
| P0-2 `/feedback` scoped | **FAIL** — HTTP 500, then leak | PASS |
| P0-2b `/deployments/{id}` ownership | PASS | PASS |
| P0-3 `/monitor/*` anonymous | **FAIL** — both HTTP 200 | PASS |
| P0-5 device hijack | **FAIL** — B claimed A's device, HTTP 200 | PASS |
| P0-7 CORS wildcard | not yet written | PASS |
| P0-8 upload cap | not yet written | PASS |
| P1-2 search rate limit | not yet written | PASS |
| P0-4 WS unauthenticated | not yet written | PASS |
| P0-4b WS cross-device token | not yet written | PASS |
| ISO-1/2/3 cross-tenant device/deploy | PASS | PASS |
| AUTH-1 core routes require auth | PASS | PASS |
| FLOW-1 v3 user flow intact | PASS | PASS |
| SEC-1 no secrets in error bodies | PASS | PASS |
| PUB-1 `/health` public | PASS | PASS |

**Baseline: 8 passed / 6 failed of 14. Final: 22 passed / 0 failed of 22.**

---

## Raw output — final regression run (sanitized)

```
LokiAI regression - target http://127.0.0.1:8000 - run 6894aa5f

[PASS] P0-6: /auth/me works and never returns the raw NIM key
[PASS] P0-1: /admin/stats rejects anonymous callers
[PASS] P0-1b: /admin/stats rejects non-admin users
[PASS] P0-2: GET /feedback does not leak other users' feedback
[PASS] P0-2b: /deployments/{id} enforces ownership on all paths
[PASS] P0-3: /monitor/* rejects anonymous callers
[PASS] P0-5: /devices/register cannot hijack another user's device
[PASS] P0-7: CORS rejects arbitrary *.vercel.app origins
[PASS] P0-8: /models/upload rejects oversized bodies
[PASS] P1-2: /models/search is rate limited
[PASS] P0-4: device WebSocket rejects unauthenticated connects
[PASS] P0-4b: device WebSocket rejects a token for a different device
[PASS] WS-1: correctly paired device can still connect
[PASS] WS-2: /devices/pair issues a device credential
[PASS] CORS-1: configured dashboard origin still allowed with credentials
[PASS] ISO-1: cross-tenant device read blocked
[PASS] ISO-2: cross-tenant device delete blocked
[PASS] ISO-3: cross-tenant deployment blocked
[PASS] AUTH-1: core user-data routes require auth
[PASS] FLOW-1: documented v3 user flow still works end to end
[PASS] SEC-1: no secrets or tracebacks in error bodies
[PASS] PUB-1: /health remains public

[cleanup] removed synthetic records for prefix batch0test-6894aa5f (rc=0)

================================================================
TOTAL: 22 checks, 22 passed, 0 failed
================================================================
```

## Raw output — presence liveness (the reported reconnect bug)

Run with `PRESENCE_TTL_SECONDS=5` so the sweep is observable in seconds rather than minutes.

```
paired device 4376354a-85c9-44d5-b218-a9338b8bea3b
  status after pairing: paired
  status while connected+heartbeating: connected
  socket abandoned; waiting 40s for the presence sweep...
  status after heartbeat went stale: offline
  status after reconnect: connected

============================================================
[PASS] device shows connected while heartbeating (observed: connected)
[PASS] stale heartbeat expires device to offline (observed: offline)
[PASS] reconnect restores connected (observed: connected)
TOTAL: 3 checks, 3 passed, 0 failed
============================================================
```

The socket is aborted at the transport layer with no close frame — exactly what a killed app or black-holed network looks like to the server, which is the case the old code could never detect.

## Raw output — live P0-6 reproduction (pre-fix, from the server's own log)

```
File "L:\The Shriks\LokiAI\LokiAI-backend\main.py", line 891, in get_me
    "nim_key": _decrypt_key(row["nvidia_api_key_encrypted"]) if ... else None,
               ^^^^^^^^^^^^
NameError: name '_decrypt_key' is not defined. Did you mean: '_decrypt_secret'?
```

## Raw output — P0-9 discovery (not in the original audit)

```
File "L:\The Shriks\LokiAI\LokiAI-backend\main.py", line 318, in submit_feedback
    token_data = verify_token(credentials.credentials)
                 ^^^^^^^^^^^^
NameError: name 'verify_token' is not defined. Did you mean: 'verify_otp'?
[ERROR] POST /feedback: name 'verify_token' is not defined
INFO:  127.0.0.1:62943 - "POST /feedback HTTP/1.1" 500 Internal Server Error
```

## Frontend gates

```
=== TYPECHECK ===   TSC_EXIT:0
=== LINT ===        LINT_EXIT:0   (eslint ., no output)
=== BUILD ===       BUILD_EXIT:0  (Vite client + SSR + Nitro server, all bundles emitted)
```

Note: the committed `routeTree.gen.ts` was stale at baseline (missing the `/account` route) and `tsc --noEmit` failed with 2 errors on the untouched tree. Regenerated in Batch 1; the typecheck gate has been meaningful since.

## Secret-leak scan

```
grep -icE "nvapi-|postgresql://|JWT_SECRET|password_hash" test_infra/backend.log
0
```
No secret material in server logs across the whole run. `SEC-1` additionally asserts no secrets or tracebacks reach client-visible error bodies.

---

## Test hygiene

- Every synthetic record uses a per-run unique prefix (`batch0test-<8 hex>`); cleanup deletes exactly those rows and nothing else, verified by `rc=0` on every run.
- The rate-limit check runs as its own dedicated account so exhausting a per-user budget cannot starve any other check. (This was caught and fixed after it caused a false `FLOW-1` failure during Batch 5 — recorded honestly rather than silently reordered.)
- No test touched the production Neon database. Registration is bypassed by seeding a verified user directly in the disposable DB, because the real register path sends an OTP email and SMTP is deliberately unreachable in the test environment; the login path itself is still exercised for real.

---

## Known gaps in coverage

1. **Flutter suite unexecuted** — no SDK on this machine. 14 sanitizer cases are written and their logic verified by an exact Python port, but `flutter analyze`, `flutter test`, and `flutter build apk` have not run.
2. **No real-device test.** The reconnect/lifecycle fix is verified against a real WebSocket client and real database, not a physical Android phone. The `AppLifecycleState.resumed` path specifically cannot be exercised without a device or emulator.
3. **No load or soak testing.** Rate-limit thresholds are judgment calls sitting far above observed interactive use; they have not been validated under real concurrent load.
4. **NIM provider paths untested end-to-end.** `/assistant/chat` was verified only to its 428 "key required" gate; the full two-stage NIM flow needs a real key and is unchanged by these batches.
5. **No CI.** Every gate above was run manually; nothing prevents a regression from landing unnoticed.
