# LokiAI — Production Bug-Fix Directive

**Repository:** `L:\The Shriks\LokiAI`  
**Target:** current production code on `main`  
**Purpose:** fix the confirmed production UX, security, model-resolution, mobile-branding, and chat-persistence issues found during real use.

Do not redesign or rewrite LokiAI. Preserve the current architecture and user flow. Fix the bugs in the existing backend, dashboard, database usage, WebSocket protocol, and Flutter application.

---

## Confirmed production bugs

### Bug 1 — Direct Hugging Face repository resolution contradicts normal search

The same repository gives two different answers.

Natural-language search finds:

```text
Qwen/Qwen2.5-0.5B-Instruct-GGUF
qwen2.5-0.5b-instruct-q4_0.gguf
408.87 MB
Deployable
```

Direct URL:

```text
https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct-GGUF
```

incorrectly returns that no GGUF files exist.

#### Required fix

1. Reproduce both paths against local and production backends.
2. Make generic search and direct URL resolution use one canonical repository-inspection function.
3. Repository existence, filenames, sizes, formats, compatibility, and deployment eligibility must come from real Hugging Face evidence, never free-form NIM output.
4. Correctly handle redirects, complete repository siblings/file trees, nested paths, pagination where applicable, case handling, stale negative cache, `resolve/main`, `blob/main`, `tree/main`, and query parameters.
5. Distinguish:
   - `MODEL_NOT_FOUND`
   - `MODEL_INCOMPATIBLE`
   - `HF_UNAVAILABLE`
   - `HF_RESPONSE_INVALID`
6. Invalidate stale negative results after the fix.
7. Add regression tests:
   - `Qwen/Qwen2.5-0.5B-Instruct-GGUF` must return at least one real `.gguf`.
   - `google-bert/bert-base-uncased` must return `MODEL_INCOMPATIBLE` with no Deploy action.
8. Add a consistency test proving natural-language search and direct URL resolution return the same repository evidence.

---

### Bug 2 — Pairing secret and backend infrastructure are exposed in the mobile UI

The Android app visibly displays decoded QR details:

```text
QR decoded.
backend_url: https://lokiai.onrender.com
token: <pairing token>
```

This is unprofessional and exposes a live pairing credential.

#### Required fix

1. Remove all raw pairing payload details from the UI.
2. Never display or log pairing tokens, device tokens, JWTs, refresh tokens, backend URLs, WebSocket URLs, user IDs, deployment IDs, or raw API responses.
3. The scanning UI should only display safe states:

```text
Scanning QR…
QR detected
Verifying connection…
Connected to LokiAI
Pairing failed — scan a fresh QR
```

4. Pairing tokens must be one-time, short-lived, consumed atomically, and redacted in logs.
5. Clear decoded QR values from memory when pairing completes or fails.
6. Add tests asserting token strings and backend URLs never appear in rendered UI text.
7. Treat the token visible in the supplied screenshot as compromised and ensure it is expired or cannot be reused.

---

### Bug 3 — Chat/session disappears while deployment continues

Observed behavior:

1. A model or Deploy action opens a chat.
2. A deployment message is sent automatically.
3. Deployment continues in Background Tasks.
4. The chat window disappears or crashes.
5. The chat is missing from sidebar history.
6. Opening another chat still shows the deployment, proving the job survived while conversation state was lost.

#### Required fix

1. Reproduce the exact flow.
2. Identify whether the cause is route transition, missing session creation, failed persistence, sidebar index not updating, local-storage overwrite, panel unmount, deployment event replacing chat state, exception-boundary reset, or a race between stores.
3. Create and persist the conversation before sending an automatic deployment message.
4. Persist user message, assistant message, model evidence, and deployment reference before starting deployment.
5. Keep deployment state and chat state independently stored but linked by stable IDs.
6. A deployment must never delete, replace, or hide its originating chat.
7. The chat must survive refresh, session switching, navigation, deployment completion, and deployment failure.
8. If a deployment event arrives for a missing session, reconstruct a safe session entry.
9. Add tests for persistence, refresh, navigation, background-task synchronization, failure handling, and duplicate-session prevention.

---

### Bug 4 — Monitor endpoints flood the production console with 404s

Production shows:

```text
/monitor/log?limit=100 → 404
/monitor/status → 404
```

The backend may intentionally return 404 to conceal restricted operator routes, but normal users should not continuously poll them.

#### Required fix

1. Determine admin/operator capability before monitor polling begins.
2. Do not call operator-only endpoints for normal users.
3. Treat 401/403/404 as a controlled restricted state.
4. Stop retries after access is denied.
5. Preserve 404 concealment if that is the intended backend contract.
6. Add tests proving normal users do not poll monitor routes, operators can load them, and no console-error loop occurs.

---

### Bug 5 — Remove the NIM API-key eye/reveal button

The Account page shows a reveal button beside the NIM key.

#### Required fix

1. Remove the eye/reveal control.
2. Never prefill the saved key.
3. Show only:

```text
NVIDIA NIM API key configured
Replace key
Remove key
```

4. A new key field may remain masked while typing, but a saved value must never be retrievable.
5. Clear the field after a successful save.
6. Confirm the key never appears in API responses, browser storage, React state after save, logs, analytics, assistant prompts, or reports.
7. Add frontend and API tests.

---

### Bug 6 — Mobile app branding is unprofessional

The installed application uses the Flutter logo and displays:

```text
lokiai_app
```

The required product name is:

```text
LokiAI
```

An approved LokiAI logo already exists in the codebase.

#### Required fix

1. Find and use the existing approved LokiAI logo asset.
2. Do not invent a new logo.
3. Replace the Flutter launcher icon for all Android densities and adaptive icon layers.
4. Set the visible application name exactly to `LokiAI`.
5. Update Android label, launcher label, task-switcher label, install metadata, and any visible `lokiai_app` text.
6. Preserve package identity unless a package migration is explicitly required.
7. Record the exact logo source path.
8. Build and inspect a release APK.
9. Use only the wireless `/install` → `/apk/download` path for phone validation. No ADB or USB.

---

### Bug 7 — Hide custom-model upload for now

The Models page exposes:

```text
Drag & drop a .tflite or .gguf file, or click to browse
```

This feature is not ready.

#### Required fix

1. Remove or feature-flag the custom upload UI for production.
2. Hide the model-type selector, drop zone, browse button, upload progress, and direct navigation.
3. Prefer a production feature flag defaulting to disabled.
4. Do not remove stable backend functionality unless necessary.
5. Existing curated model deployment must continue working.
6. Add tests proving normal production users cannot access or trigger custom upload.

---

### Bug 8 — Model cards and Deploy actions must remain grounded

The real YuNet model successfully ran, which is good. Preserve that behavior.

Every deployable card must use backend-verified:

- repository/source,
- exact filename,
- exact size,
- SHA-256 where available,
- model format,
- task type,
- device compatibility evidence,
- selected runtime,
- real download URL.

NIM may explain results but must not invent or alter these fields. Deploy must use the exact artifact shown.

---

## UI and product rules

1. Preserve the current black-and-green LokiAI visual language.
2. Do not redesign unrelated panels.
3. Do not add emojis.
4. Do not expose backend hosts, routes, tokens, IDs, or provider internals in user-facing UI.
5. Replace technical errors with short, useful messages.
6. Keep Background Tasks functionality.
7. Keep the current wireless architecture.
8. Do not show repeated restricted-route errors in the browser console.
9. Do not expose debug labels, source-tracking metadata, or framework branding in production UI.

---

## Architecture constraints

The supported flow is:

```text
phone browser
→ /install
→ /apk/download
→ user installs LokiAI
→ dashboard creates QR
→ phone scans QR
→ HTTPS pairing
→ authenticated WSS
→ phone downloads model directly from Hugging Face CDN
→ local on-device inference
```

Never introduce or use:

- USB,
- ADB,
- platform-tools,
- developer options,
- cable installation,
- desktop-to-phone file pushing,
- `adb_serial`,
- subprocess calls to Android tools.

---

## Security requirements

1. Preserve strict CORS.
2. Preserve tenant isolation.
3. Preserve operator-route protection.
4. Preserve device-token authentication.
5. Preserve secure Android credential storage.
6. Preserve upload and route rate limits.
7. Preserve typed NIM/Hugging Face errors.
8. Never return raw provider exceptions.
9. Never fabricate model metadata.
10. Never log secrets.
11. Do not include real screenshot tokens in tests or reports.

---

## Required implementation process

### Baseline

Record current branch, local HEAD, remote HEAD, production main HEAD, working-tree status, deployed commits where verifiable, and current APK version/SHA-256.

Create a dedicated fix branch from latest production `main`.

### Reproduce first

Create a failing reproducer for every confirmed bug before changing code.

### Narrow commits

Use separate commits for:

1. canonical Hugging Face resolution,
2. chat/session persistence,
3. monitor polling/access handling,
4. pairing-secret redaction,
5. NIM-key UI cleanup,
6. mobile branding,
7. custom-upload feature flag,
8. grounded model-card verification.

### Required gates

Run:

```text
backend compile
backend regression
presence/reconnect tests
wireless-flow tests
NIM/search validation
direct URL consistency tests
frontend typecheck
frontend lint
frontend production build
frontend chat-persistence tests
Flutter analyze
Flutter tests
Flutter release APK build
secret/token output scan
APK route/hash verification
```

---

## Production verification

After deployment verify:

1. Qwen generic search and direct URL return consistent real repository evidence.
2. BERT remains incompatible with no Deploy action.
3. A deployment chat remains in the sidebar during and after deployment.
4. Refresh and navigation preserve the chat.
5. Background Tasks and chat show the same deployment.
6. Normal users generate no monitor polling errors.
7. The Account page has no saved-key reveal button.
8. The installed app shows the approved LokiAI icon and the name `LokiAI`.
9. QR scanning never displays token or backend URL.
10. The pairing token cannot be reused.
11. Custom upload is hidden.
12. Curated deployment and local inference still work.
13. Production APK hash matches the approved artifact.

---

## Reports

Create:

- `LOKIAI_PRODUCTION_BUG_FIX_REPORT.md`
- `LOKIAI_CHAT_PERSISTENCE_VALIDATION_REPORT.md`
- `LOKIAI_DIRECT_REPOSITORY_CONSISTENCY_REPORT.md`
- `LOKIAI_MOBILE_BRANDING_AND_PAIRING_SECURITY_REPORT.md`
- `LOKIAI_POST_FIX_PRODUCTION_TEST_REPORT.md`

Update:

- `LOKIAI_TEST_AND_CHANGE_AUDIT.md`
- `LOKIAI_RELEASE_READINESS_REPORT.md`
- `LOKIAI_REMAINING_RISK_REGISTER.md`
- `LOKIAI_SECURITY_THREAT_MODEL.md`
- `LOKIAI_API_AND_PROTOCOL_CHANGELOG.md`
- `LOKIAI_PRODUCTION_RUNBOOK.md`

Use only:

```text
PASS
FAIL
BLOCKED
NOT TESTED
NOT APPLICABLE
```

---

## Final response

Return:

1. source branch,
2. fix commits,
3. final production commit,
4. Render result,
5. Vercel result,
6. APK result,
7. Qwen direct-URL consistency result,
8. BERT incompatibility result,
9. chat-persistence result,
10. deployment/background-task synchronization result,
11. monitor-console result,
12. NIM-key UI result,
13. pairing-token redaction result,
14. mobile app name/icon result,
15. custom-upload visibility result,
16. backend/frontend/Flutter test totals,
17. production smoke-test totals,
18. remaining P0/P1/P2 risks,
19. rollback point and instructions,
20. report paths,
21. final verdict.

The final verdict must be exactly one:

```text
READY FOR CONTROLLED PRODUCTION DEPLOYMENT
READY WITH DECLARED BLOCKERS
NOT READY FOR PRODUCTION DEPLOYMENT
```

Do not stop after producing a plan. Reproduce, fix, test, deploy, verify, and document.
