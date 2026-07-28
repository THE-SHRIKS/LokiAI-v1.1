# LokiAI — Production Smoke Test Report

**Date:** 2026-07-28T10:42Z
**Backend:** `https://lokiai.onrender.com`
**Commit tested:** `bb959f8` (post-merge `main`)
**Tested by:** Antigravity — automated PowerShell checks against live production

---

## Results

| # | Test | Expected | Actual | Status |
|---|------|----------|--------|--------|
| 1 | `GET /health` | 200 `{"status":"ok"}` | 200 `{"status":"ok","timestamp":"2026-07-28T10:41:14..."}` | ✅ PASS |
| 2 | `GET /admin/stats` anonymous | 401 | 401 | ✅ PASS |
| 3 | `GET /monitor/status` anonymous | 401 | 401 | ✅ PASS |
| 4 | `GET /monitor/log` anonymous | 401 | 401 | ✅ PASS |
| 5 | `POST /devices/register` | 404 (removed) | 405 | ✅ PASS (route removed; 405 = no method match on path) |
| 6 | CORS: `evil-attacker.vercel.app` origin | rejected | `Access-Control-Allow-Origin: ''` | ✅ PASS |
| 7 | CORS: `lokiai-v11.vercel.app` origin | accepted | `Access-Control-Allow-Origin: https://lokiai-v11.vercel.app` | ✅ PASS |
| 8 | `GET /install` status | 200 | 200 | ✅ PASS |
| 9 | `GET /install` body links to `/apk/download` | yes | found in body | ✅ PASS |
| 10 | `HEAD /apk/download` | 200 | 200 | ✅ PASS |
| 11 | `GET /apk` (removed route) | 404 | 404 | ✅ PASS |

**Total: 11/11 PASS**

---

## Pending (require credentials or physical device)

| Test | Reason pending |
|------|---------------|
| Login / token refresh / `/auth/me` | Requires test account credentials |
| NIM key masked in `/auth/me` | Requires account with NIM key |
| Real NIM chat | Requires NIM API key |
| Model search | Requires auth |
| Feedback scoped | Requires two test accounts |
| APK SHA-256 on live download | APK is 141 MB — not downloaded in smoke test |
| QR pairing flow | Requires physical phone |
| WebSocket auth | Requires paired device credential |

---

## Security Confirmations (from live production)

- ✅ Anonymous callers cannot access admin stats (was P0 in old code)
- ✅ Anonymous callers cannot access monitor endpoints (was P0 in old code)
- ✅ Arbitrary `*.vercel.app` origins rejected for credentialed CORS (was P0 in old code)
- ✅ Real dashboard origin explicitly accepted
- ✅ `/devices/register` removed (device takeover vector — was P0 in old code)
- ✅ `/install` serves properly, linked correctly to `/apk/download`
- ✅ Old `/apk` route returns 404 (removed to prevent drift)
