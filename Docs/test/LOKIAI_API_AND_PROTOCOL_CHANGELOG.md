# LokiAI — API and Protocol Changelog

Covers `168f79b` → `f7efca6` (branch `chore/batch0-test-baseline`). Every change below is a defect fix; none is a redesign.

Legend: **BREAKING** = an existing client stops working without action. **RESTRICTIVE** = fewer callers are now allowed, by design.

---

## HTTP routes

### Removed

| Route | Change | Why |
|---|---|---|
| `POST /devices/register` | **BREAKING (no known callers)** — now 404 | Allowed any authenticated user to claim another user's device by `adb_serial` (P0-5). ADB-era v2 surface; verified before removal that neither the dashboard nor the Flutter app referenced it. The wireless flow uses `POST /devices/pair`, which is unchanged. |

### Added

| Route | Auth | Purpose |
|---|---|---|
| `GET /admin/feedback` | operator (`ADMIN_EMAILS`) | Preserves the cross-tenant feedback view that `GET /feedback` used to provide to any authenticated caller. |

### Access level changed (RESTRICTIVE)

| Route | Before | After |
|---|---|---|
| `GET /admin/stats` | **anonymous** | operator only; 404 for everyone else |
| `GET /monitor/status` | **anonymous** | operator only; 404 for everyone else |
| `GET /monitor/log` | **anonymous** | operator only; 404 for everyone else |
| `GET /feedback` | any valid token, returned **all users' data** | any valid token, returns **caller's own** submissions only |
| `GET /deployments/{id}` | ownership enforced on the DB path only; in-memory fast path returned first, unchecked | ownership enforced on **all** paths |

Non-operators receive **404, not 403**, so the existence of operator routes isn't confirmed to anyone probing.

### Response shape changed

| Route | Field | Change |
|---|---|---|
| `GET /auth/me` | `nim_key` | **REMOVED.** Was added in `168f79b` and crashed the endpoint (the helper it called never existed). Returning a decrypted provider credential to a browser is a P0 exposure regardless of the crash. `has_nim_key: boolean` is unchanged and remains the way to tell whether a key is configured. |
| `POST /devices/pair` | `device_token` | **ADDED.** Device-scoped credential required by the WebSocket. |
| `POST /devices/pair` | `websocket_url` | Now carries `?token=<device_token>`. Existing clients that use this URL verbatim keep working. |

### Rate limits added

| Route | Limit | Key |
|---|---|---|
| `POST /models/upload` | 5/hour | user (IP fallback) |
| `POST /models/search` | 20/minute | user (IP fallback) |
| `POST /deployments` | 10/minute | user (IP fallback) |
| `POST /pairing/generate` | 20/minute | user (IP fallback) |
| `POST /auth/verify-otp` | 10/minute | IP |
| `POST /auth/resend-otp` | 5/minute | IP |

Pre-existing limits (`/auth/login` 5/min, `/auth/register` 3/min, `/auth/forgot-password` 3/min, `/assistant/chat` 20/min, `/auth/nim-key` 10/min) are unchanged. All 429s carry `Retry-After: 60`.

### Request limits changed

| Route | Before | After |
|---|---|---|
| `POST /models/upload` | **exempt from all body-size limits** | `MAX_UPLOAD_MB` (default 600), enforced on both declared `Content-Length` and bytes actually received |
| all others | 10MB | 10MB (unchanged); a malformed `Content-Length` is now a 400 instead of a 500 |

### CORS (RESTRICTIVE)

| Before | After |
|---|---|
| `allow_origins` list **plus** regex `https://.*\.vercel\.app\|http://localhost:.*\|http://127\.0\.0\.1:.*` | `allow_origins` list **plus** regex `http://(localhost\|127\.0\.0\.1)(:\d+)?` |

Any `*.vercel.app` origin was accepted with credentials, which with the `SameSite=None` refresh cookie permitted session takeover from an attacker-controlled free Vercel deployment (P0-7).

**ACTION REQUIRED:** production dashboard origins must now be listed explicitly in `CORS_ALLOWED_ORIGINS` (e.g. `https://lokiai-v11.vercel.app`). Preview deployments need their specific origin added.

---

## WebSocket protocol — `/ws/device/{device_id}`

### Connection (BREAKING for devices)

| Before | After |
|---|---|
| Any `device_id` accepted. No credential of any kind. | Requires `?token=<device_token>` from `POST /devices/pair`. The token must be `type="device"`, match the `device_id` in the path, and the device must still exist and still be owned by the user the token was minted for. |

Close codes on rejection:

| Code | Meaning |
|---|---|
| `4401` | missing/invalid/mismatched device token, or the device is no longer paired |
| `4413` | inbound frame exceeded 64 KB |
| `4000` | connection superseded by a newer one for the same device, or heartbeat expired |

**Migration:** already-paired phones must re-pair once to obtain a token. Old APKs continue to work against an un-upgraded backend; a new APK works against either.

### Inbound messages (phone → server)

| Type | Change |
|---|---|
| `heartbeat` | Unchanged. Still refreshes `last_seen` and returns `heartbeat_ack`. |
| any message carrying `deployment_id` | **RESTRICTIVE** — the deployment must belong to the reporting device. Previously any connected socket could rewrite the status/progress/error of any deployment in the system by naming its id. |
| `state_report` | **NEW.** Sent on every connect: `{type, device_id, deployment_id, model_name, inference_mode, status, timestamp}`. Lets the server resolve a deployment it still believes is in flight when the phone actually finished it while disconnected. Advisory only — it can resolve an existing in-flight deployment for that device, never create one or touch another device's. |
| all | Must be a JSON object; frames over 64 KB close the socket. |

### Outbound messages (server → phone)

| Type | Change |
|---|---|
| `connected` | Unchanged. |
| `heartbeat_ack` | Unchanged. |
| `deploy` | Unchanged shape. |
| `state_ack` | **NEW.** Response to `state_report`: `{type, pending_deployments: [{deployment_id, status}], timestamp}`. |

---

## Presence semantics (behavioural, no contract change)

`devices.status` previously only ever became `offline` via an orderly `WebSocketDisconnect`. A device killed, network-black-holed, or orphaned by a backend restart stayed `connected` indefinitely.

- Heartbeat TTL sweep every 30s marks a device `offline` once `last_seen` is older than `PRESENCE_TTL_SECONDS` (default 70 ≈ 3 missed heartbeats).
- On startup, any row still `connected` is reset to `offline` (the restart invalidated the in-memory registry).
- A reconnect supersedes and explicitly closes the prior socket; a superseded socket's teardown can no longer mark offline a device that has already reconnected.

`GET /devices` and `GET /devices/{id}` response shapes are unchanged — the `status` value is simply now truthful.

---

## New environment variables

| Variable | Default | Effect if unset |
|---|---|---|
| `ADMIN_EMAILS` | *(empty)* | Nobody is an operator; `/admin/*` and `/monitor/*` are closed to everyone. Safe default. |
| `MAX_UPLOAD_MB` | `600` | 600MB upload cap. |
| `PRESENCE_TTL_SECONDS` | `70` | Devices expire to offline after ~70s without a heartbeat. |

`CORS_ALLOWED_ORIGINS` already existed but is now **required in production** — the `*.vercel.app` wildcard that previously made it optional is gone.

---

## Database

**No schema change.** No migration is required to deploy this branch, and no migration needs reverting to roll it back.
