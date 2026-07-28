# LokiAI — Pre-Production Deployment Report

**Date:** 2026-07-28
**Branch:** `chore/batch0-test-baseline`
**Branch head at time of push:** `38a571c9419821943db62a4c72dbd8576f207d28`
**`origin/main`:** `168f79b8d3cc538ddd8655ee911e5820011b81ac` — unchanged, not merged

---

## Verdict

| Item | Status |
|---|---|
| Remediation branch pushed to origin | **PASS** |
| Backend deployed to pre-production | **BLOCKED** |
| Frontend deployed to pre-production | **BLOCKED** |
| Deployed frontend+backend exercised together | **NOT TESTED** (blocked by the above) |

Deployment could not be performed from this environment. The branch is pushed and ready; the deploy itself needs someone with console access. Per the user's decision, the chosen route was **push-only, user deploys**.

---

## Step 1 — Verified environment state

Recorded from the repository and live probes, not from documentation.

```
branch:            chore/batch0-test-baseline
HEAD:              f8968be… at session start, 38a571c… at push
remote:            https://github.com/The-Shriks/LokiAI.git
working tree:      clean except untracked patch.py (pre-existing, preserved)
ahead/behind main: 9 ahead, 0 behind (at session start)
```

All nine expected remediation commits verified present by `git cat-file -e`.

**Deployment configuration is not in the repository.** No `vercel.json`, no `render.yaml`, no `.github/workflows`. The only deploy artifact is `LokiAI-backend/Procfile` (`web: uvicorn main:app --host 0.0.0.0 --port $PORT`). Branch→environment mapping therefore lives exclusively in the Render and Vercel dashboards and **could not be verified from here** — it is recorded as unverified rather than assumed.

Live endpoints confirmed reachable:

| Environment | URL | Result |
|---|---|---|
| Backend (Render) | `https://lokiai.onrender.com` | `/health` → 200 (after a ~25s cold start; free tier suspends) |
| Dashboard (Vercel) | `https://lokiai-v11.vercel.app` | `/` → 200 |

Neon database: the pre-production `DATABASE_URL` is present in `LokiAI-backend/.env` (presence verified, value never read). Whether pre-production shares the production Neon instance **could not be determined** without console access.

---

## Step 1 (critical finding) — production is running pre-remediation code

Probed directly on 2026-07-28. Response bodies were deliberately discarded (`-o /dev/null`) so the exposure could be proven without collecting real user data.

```
GET  https://lokiai.onrender.com/health                 -> 200
GET  https://lokiai.onrender.com/admin/stats  (no auth) -> 200    ** P0-1 LIVE **
GET  https://lokiai.onrender.com/monitor/status (no auth)-> 200   ** P0-3 LIVE **
POST https://lokiai.onrender.com/devices/register       -> 401    ** P0-5 route still present **
OPTIONS https://lokiai.onrender.com/auth/refresh
        Origin: https://evil-poc-check.vercel.app
   -> access-control-allow-origin: https://evil-poc-check.vercel.app  ** P0-7 LIVE **
```

`origin/main` = `168f79b` confirms why: the remediation branch had never been pushed, so no deployment could ever have picked it up.

**Every P0 in the audit is still exploitable in production.** `/admin/stats` returns every registered user's id, name, email, signup date, device count and latest deployment to any anonymous caller. The CORS result means any attacker-controlled `*.vercel.app` page can pull a fresh access token from a logged-in victim's browser.

---

## Step 8 — Deployment attempt

### What was done

```
git push -u origin chore/batch0-test-baseline
 * [new branch]  chore/batch0-test-baseline -> chore/batch0-test-baseline
```

Post-push remote state:
```
38a571c9419821943db62a4c72dbd8576f207d28  refs/heads/chore/batch0-test-baseline
168f79b8d3cc538ddd8655ee911e5820011b81ac  refs/heads/main      <- untouched
```

This publishes the work and enables a Vercel preview deployment (if the GitHub integration is configured for non-default branches) **without** touching `main` and **without** triggering any production deploy.

### Why the deploy itself is BLOCKED

| Route | Blocker |
|---|---|
| Vercel CLI | Installed (58.0.0 via `npx`) but **not authenticated**. `vercel whoami` returns a device-OAuth URL requiring interactive browser login, which cannot be completed from a non-interactive session. No `VERCEL_TOKEN` in the environment. |
| Render CLI | Not installed. No `RENDER_API_KEY` in the environment. |
| Merge to `main` | Possible, but explicitly declined — it would deploy straight to real production rather than pre-production, and the user chose the push-only route. |

No credentials were requested in chat, and none were guessed or fabricated.

### What you need to do to complete the deploy

Follow `LOKIAI_PRODUCTION_DEPLOYMENT_CHECKLIST.md`. The two items that will break things if skipped:

1. **Set `CORS_ALLOWED_ORIGINS`** on the Render service to the exact pre-production dashboard origin (e.g. `https://lokiai-v11.vercel.app`). The `*.vercel.app` wildcard is gone; without an explicit origin, every dashboard API call fails CORS.
2. **Plan the device re-pair.** Once the backend ships, old APKs cannot connect at all — see the corrected matrix in `LOKIAI_API_AND_PROTOCOL_CHANGELOG.md`. Ship the new APK and expect one QR re-scan per device.

Also recommended: set `ADMIN_EMAILS`, or `/admin/*` and `/monitor/*` will 404 for everyone (safe, but the pages will look broken).

---

## Step 7 — Configuration required (values never printed)

| Variable | Status | Note |
|---|---|---|
| `DATABASE_URL` | present | unchanged |
| `JWT_SECRET_KEY` | present | unchanged. **Do not rotate casually** — it also derives the Fernet key for stored NIM keys; rotating invalidates every session *and* makes every stored NIM key undecryptable. |
| `CORS_ALLOWED_ORIGINS` | **ACTION REQUIRED** | must list the exact preprod origin |
| `DASHBOARD_URL` | present | used for password-reset links |
| `BACKEND_PUBLIC_URL` | present | embedded in pairing QR codes |
| SMTP / `EMAIL_RELAY_*` | present | unchanged |
| `ADMIN_EMAILS` | **NEW — unset** | empty ⇒ nobody is an operator (safe default) |
| `MAX_UPLOAD_MB` | **NEW — optional** | defaults to 600 |
| `PRESENCE_TTL_SECONDS` | **NEW — optional** | defaults to 70 |
| `HF_HEAD_CONCURRENCY` | **NEW — optional** | defaults to 8 |
| `HF_CACHE_TTL_SECONDS` | **NEW — optional** | defaults to 300 |
| `APK_DOWNLOAD_URL` / `APK_SIZE_MB` | present | Render's filesystem is ephemeral |

---

## Rollback

Nothing was deployed, so nothing needs rolling back. The only remote change is one new branch, removable with:

```bash
git push origin --delete chore/batch0-test-baseline
```

`main` and every deployed environment are byte-identical to their state before this session.

---

## Known limitations of this report

- Branch→environment mapping for Render and Vercel is **unverified** — it is not in the repo and I had no console access.
- Whether pre-production shares the production Neon database is **undetermined**.
- No deployment ID exists for either platform, because no deployment ran.
- The live probes above prove which *code* is deployed; they do not prove which *branch* the platform is configured to watch.
