# LokiAI — Deep Audit, Security Hardening, Reliability, Performance, and Production Integration Directive

## Role

Act as a senior production systems engineer, security engineer, and codebase auditor working directly inside the existing LokiAI repository.

You are not building a new product, prototype, demo, static mock, replacement frontend, or parallel backend. You are repairing and hardening the current LokiAI implementation in place.

The current product is an Android-first, Wi-Fi-only AI deployment system with a web workspace, FastAPI backend, PostgreSQL state, WebSocket-connected Android clients, Hugging Face model resolution, NVIDIA NIM-assisted chat, and local device inference paths.

## Primary objective

Perform a deep evidence-based audit of the complete codebase, architecture, database, API boundaries, authentication, frontend state, mobile reconnect behavior, model-search pipeline, NIM integration, background processing, deployment lifecycle, security posture, observability, and production failure handling.

Then create and execute a safe implementation plan that fixes confirmed defects without breaking the existing product or silently changing the current user workflow.

## Non-negotiable rules

1. **Audit before implementation.** Do not start changing code until you have mapped the current architecture, request paths, state ownership, failure paths, data model, and deployment workflow.
2. **Do not regenerate the application.** Do not rewrite the frontend, backend, mobile app, database, design system, routing system, or project structure from scratch.
3. **Do not replace working subsystems merely because a different stack is preferred.** Patch, isolate, refactor incrementally, and preserve compatibility.
4. **Do not create mock APIs, fake devices, fake metrics, fake search results, hard-coded success responses, placeholder deployment states, or simulated production behavior.**
5. **Do not introduce static UI in place of real backend integration.** Every state shown in the UI must come from an authenticated, real, persisted, or explicitly transient system source.
6. **Do not break current routes, API contracts, authentication flows, pairings, deployments, or saved user data.** If a contract must change, add a versioned migration or compatibility adapter.
7. **Do not silently change the existing user flow.** Preserve the visible workflow unless a security or correctness defect requires a change. Any required UX change must be minimal, documented, and tested.
8. **Do not expose secrets.** Never print, log, return, cache in browser storage, embed in prompts, or serialize NVIDIA NIM keys, refresh tokens, access tokens, password hashes, pairing secrets, private model credentials, or encryption keys.
9. **Do not trust LLM output as executable state.** LLMs may classify or summarize. Deterministic services must own account identity, model eligibility, device ownership, deployment actions, JSON envelopes, database mutations, and security decisions.
10. **Do not claim a fix without evidence.** Every completed fix must have a reproducer, test, observed result, and rollback path.
11. **Do not commit broad unrelated formatting changes, generated lockfile churn, renamed folders, or design rewrites.** Keep diffs narrow and reviewable.
12. **Before destructive operations, database migrations, auth changes, secret-store changes, or protocol changes, create a rollback plan and verify a recoverable backup or migration path.**

---

# Product-flow preservation requirement

The intended user flow must remain recognizable:

1. User signs in.
2. User configures their own NVIDIA NIM key if required.
3. User pairs an Android device through the existing QR/Wi-Fi flow.
4. Device reports its real hardware and connection state.
5. User asks LokiAI to find or evaluate a model.
6. LokiAI searches permitted registries, validates compatibility, and returns real results.
7. User explicitly approves deployment.
8. Device downloads and activates the package.
9. Workspace shows real deployment and device state.
10. Device performs local inference through a supported runtime.

The implementation may improve loading, error messaging, progress reporting, retries, reconnect behavior, account boundaries, and result quality. It must not replace this workflow with a different product concept.

If any UX change is necessary for security or correctness, document:

- current behavior,
- defect,
- proposed change,
- why the change is unavoidable,
- affected screens and API contracts,
- migration/backward-compatibility behavior,
- regression tests.

---

# Confirmed symptoms to investigate

Treat the following as observed defects, not assumptions about their exact root cause:

## Chat and NIM

- User-provided NVIDIA NIM key exists, but chat sometimes does not work.
- Search can work while deeper search, reasoning, or final synthesis fails.
- Internal instructions or prompt text have appeared directly in assistant responses.
- Direct Hugging Face repository URLs and generic search requests behave inconsistently.
- The assistant is overly biased toward model search and mishandles unrelated or ambiguous user messages.
- Malformed JSON, empty responses, timeouts, rate limits, and provider failures may not be safely separated.

## Account and state isolation

- Chat may switch or merge between accounts.
- Account information and API-key-related state may mix with chat state.
- Cross-account browser state, cached state, in-memory state, query cache, WebSocket identity, or database ownership may be leaking.
- Logout/login and account switching may not fully clear request, cache, session, and connection state.

## Device presence and reconnect

- A phone can remain shown as offline after the mobile app/device is turned back on.
- WebSocket reconnect, heartbeat, registration refresh, presence expiry, desired/actual state reconciliation, or frontend polling may be stale or incomplete.
- Device state may be written directly from high-frequency telemetry without correct liveness semantics.

## Performance

- Some pages or actions load for too long.
- Chat/model search may perform multiple serial provider and Hugging Face requests.
- Repository deep inspection may use N+1 requests or sequential network calls.
- Polling may use `no-store` broadly and repeatedly fetch slow-changing metadata.
- The monolithic FastAPI file may contain tightly coupled auth, assistant, model resolution, WebSocket, database, and monitoring logic.
- High-frequency WebSocket events may create excessive PostgreSQL writes.

## Unknown defects

Do not limit the audit to the reported symptoms. Identify additional correctness, security, reliability, data-integrity, concurrency, and production-readiness failures through static inspection and real tests.

---

# Required execution sequence

## Phase 0 — Repository safety and baseline

Before modifying code:

1. Record repository root, current branch, commit hash, dirty state, runtime versions, package-manager versions, environment assumptions, and deployment targets.
2. Create a dedicated fix branch.
3. Do not delete or overwrite uncommitted user work.
4. Inventory services, apps, packages, entry points, environment files, database migrations, CI/CD workflows, deployment definitions, tests, scripts, and documentation.
5. Run existing tests and build commands unchanged.
6. Capture baseline failures, timings, bundle/build information, API response timings, database query timings, WebSocket behavior, browser console errors, backend errors, and mobile logs.
7. Produce a dependency and secret-exposure inventory without printing secret values.
8. Establish a test account matrix with at least two users and two isolated browser sessions.
9. Establish a device reconnect test using a real device or the repository's real supported test harness. Do not fake online state.

Output before implementation:

- architecture map,
- service/data-flow map,
- trust-boundary diagram in Markdown/Mermaid,
- database ownership map,
- API inventory,
- WebSocket protocol map,
- frontend state/cache map,
- mobile lifecycle/reconnect map,
- ranked defect register,
- implementation plan,
- rollback plan.

## Phase 1 — Deep architecture and code audit

Inspect actual code, not only documentation.

### Backend

Audit:

- FastAPI application startup and shutdown,
- connection-pool lifecycle,
- dynamic schema creation versus migrations,
- auth and refresh-token logic,
- JWT validation and revocation behavior,
- request-scoped versus module-global state,
- account/tenant ownership enforcement,
- NIM credential loading,
- assistant prompt construction,
- response fallback paths,
- Pydantic validation,
- Hugging Face adapters,
- repository tree inspection,
- model compatibility logic,
- deployment creation,
- WebSocket registries,
- device ownership,
- presence state,
- telemetry writes,
- retry/idempotency behavior,
- logging and redaction,
- rate limiting,
- CORS/CSP/security headers,
- body-size controls,
- upload handling,
- SSRF and URL validation,
- SQL injection and unsafe query construction,
- concurrency races,
- exception leakage,
- monitor endpoints,
- admin/debug endpoints,
- denial-of-service exposure.

### Frontend

Audit:

- access-token lifecycle,
- refresh-token behavior,
- localStorage/sessionStorage usage,
- account-scoped keys,
- behavior when user identity is undefined or changes,
- React/TanStack query cache isolation,
- route loader caching,
- stale requests during logout/account switching,
- WebSocket reconnection and identity binding,
- device polling and cache policy,
- chat-session ownership,
- error rendering,
- internal-prompt/debug leakage,
- unsafe HTML/Markdown rendering,
- deploy-action authorization,
- duplicate request prevention,
- loading waterfalls,
- large component render paths,
- bundle-level performance,
- accessibility regressions caused by fixes.

### Mobile

Audit:

- pairing-token handling,
- credential storage,
- app foreground/background lifecycle,
- network loss and recovery,
- WebSocket reconnect with exponential backoff and jitter,
- heartbeat/pong behavior,
- re-registration after process death,
- stale token recovery,
- device identity persistence,
- duplicate socket prevention,
- direct-download integrity,
- resumable download behavior,
- activation state,
- offline reconciliation,
- reporting of desired versus actual deployment state,
- local inference runtime lifecycle,
- crash recovery,
- Android power/battery/network restrictions.

### Database

Audit all tables and queries for:

- immutable user ownership,
- foreign keys,
- uniqueness constraints,
- indexes,
- tenant-scoped lookups,
- chat-session isolation,
- device ownership,
- deployment ownership,
- API credential separation,
- audit trails,
- idempotency keys,
- stale presence cleanup,
- migration safety,
- deleted-user behavior,
- orphan records,
- race conditions.

Every read or mutation of a user-owned resource must be authorized using the authenticated server-side identity. Never trust a client-supplied `user_id`.

## Phase 2 — Reproduce and prove root causes

Create minimal, real reproducers for each confirmed issue.

At minimum test:

1. Two accounts using the same browser profile.
2. Two accounts using separate browser contexts.
3. Logout while chat/search requests are in flight.
4. Login to account B immediately after account A.
5. NIM key missing, invalid, revoked, rate-limited, timed out, empty, malformed, and valid.
6. Direct Hugging Face URL with supported files.
7. Direct URL with unsupported files.
8. Repository that is gated/private.
9. Generic model search with zero valid candidates.
10. Generic model search with multiple candidates.
11. Phone app backgrounded, killed, network-disabled, rebooted, and reopened.
12. Backend restart while device is connected.
13. WebSocket disconnect and reconnect.
14. Duplicate device connection.
15. Stale frontend cache after device reconnect.
16. Interrupted model download.
17. Duplicate deployment click/request.
18. Slow Hugging Face and slow NIM responses.
19. Malformed provider content that resembles internal instructions.
20. Concurrent requests from multiple users.

For each reproducer record:

- exact preconditions,
- command or UI steps,
- sanitized request/response,
- trace ID,
- relevant logs,
- observed result,
- expected result,
- root cause,
- affected components.

Do not implement speculative fixes before confirming the root cause where reproduction is possible.

---

# Required implementation areas

## A. Strict account, workspace, chat, device, and credential isolation

Implement server-enforced ownership for every user resource.

Minimum requirements:

- Canonical chat history is server-side and tenant-scoped.
- Browser storage is only an optional cache and is always scoped by stable authenticated subject plus workspace/session identity.
- No cache key may contain `undefined`, `null`, empty user identity, email alone, or display name.
- Account change must cancel in-flight requests, clear memory stores, close WebSockets, clear account-scoped query caches, clear active chat/workspace/device selection, and reconnect under the new identity.
- WebSocket connections must authenticate independently and bind to exactly one user and one registered device.
- Every session/device/deployment lookup includes authenticated ownership.
- Add database constraints and indexes needed to enforce this.
- Consider PostgreSQL row-level security if compatible with the current deployment and connection model; do not add it blindly without testing pool/session behavior.
- API/provider credentials must live in a separate encrypted secret record, not inside general account or chat objects.
- API-key read endpoints return only configured status, provider, timestamps, and masked metadata. They never return the original key.
- API keys are never stored in localStorage, sessionStorage, chat messages, logs, analytics, error reports, WebSocket frames, or model prompts.

Add automated cross-tenant negative tests proving account A cannot read or mutate account B's chats, devices, credentials, deployments, or jobs.

## B. NIM provider integration and prompt-leak prevention

Build or repair a provider adapter with explicit typed outcomes.

Required error taxonomy:

- `NIM_KEY_MISSING`
- `NIM_KEY_INVALID`
- `NIM_ACCESS_DENIED`
- `NIM_RATE_LIMITED`
- `NIM_TIMEOUT`
- `NIM_UNAVAILABLE`
- `NIM_EMPTY_RESPONSE`
- `NIM_SCHEMA_INVALID`
- `NIM_MODEL_UNAVAILABLE`

Requirements:

- Validate the user key when it is saved and show real status.
- Resolve the current user's credential only inside the provider adapter.
- Set strict connect/read/overall timeouts.
- Use bounded retries only for safe transient failures, with exponential backoff and jitter.
- Do not retry invalid credentials or deterministic 4xx errors.
- Validate all model output using strict typed schemas.
- Never return the outbound prompt, system prompt, chain instructions, raw provider payload, stack trace, or internal error object to the user.
- Never let the LLM construct authoritative repository IDs, deployment IDs, button markup, eligibility state, or transport JSON.
- Deterministic backend code creates the response envelope.
- LLM-generated prose is optional and disposable. If synthesis fails, return a deterministic explanation from validated facts.
- Add adversarial tests where provider output includes instruction text, invalid JSON, extra keys, prompt fragments, HTML/script content, and conflicting model IDs.

## C. Assistant intent routing

Implement explicit routing before calling NIM.

Deterministic routes should cover:

- greetings,
- help,
- account/provider status,
- device status,
- deployment status,
- explicit Hugging Face URLs/slugs,
- direct deployment confirmations,
- known workspace commands.

Use NIM only when deterministic parsing cannot classify a natural-language model/deployment request.

Do not present LokiAI as a generic coding or model-training agent unless that capability exists in the current codebase and has real execution evidence. Preserve the current deployment product boundary.

## D. Real deep model search and compatibility

Separate:

1. query parsing,
2. registry search,
3. metadata normalization,
4. repository inspection,
5. compatibility evaluation,
6. ranking,
7. explanation,
8. deployment proposal.

Inspect and persist where available:

- repository and exact revision,
- task/pipeline metadata,
- model architecture,
- framework,
- licence and gating,
- file tree,
- artifact sizes,
- `.tflite`, `.gguf`, ONNX, or other configured supported paths,
- tokenizer/config/preprocessing assets,
- input/output shape,
- quantization,
- runtime/operator requirements,
- conversion possibility,
- device RAM/storage/ABI/OS/runtime fit,
- prior compatibility evidence.

Do not equate file-extension presence with deployability.

The compatibility engine must return one of:

- `DEPLOYABLE`
- `CONVERSION_OR_OPTIMIZATION_REQUIRED`
- `DIFFERENT_HARDWARE_REQUIRED`
- `INFEASIBLE`
- `REVIEW_REQUIRED`

Return reason codes and evidence, not only prose.

Use bounded parallelism for repository inspection. Avoid unbounded fan-out and sequential N+1 requests.

## E. Device online/offline presence and reconnect

Implement explicit liveness semantics.

Recommended state model:

- `never_connected`
- `connecting`
- `online`
- `degraded`
- `offline`
- `revoked`

Use:

- authenticated WebSocket connection,
- server heartbeat/ping and client pong,
- `last_seen_at`,
- connection generation/session ID,
- presence TTL,
- reconnect with exponential backoff plus jitter,
- immediate re-registration after mobile foreground/resume,
- token refresh or re-pair flow when credentials are stale,
- duplicate-connection arbitration,
- server-side stale-connection cleanup,
- desired versus actual state reconciliation after reconnect.

Do not mark a device online only because an old database flag says `connected=true`.

Do not keep a device offline after a new authenticated socket and heartbeat have been accepted.

Frontend device state must use a real freshness model:

```text
online = active_authenticated_socket AND heartbeat_fresh
```

Expose a precise reason when offline:

- app closed,
- network unavailable,
- authentication expired,
- pairing revoked,
- heartbeat expired,
- backend reconnecting,
- unknown.

On mobile app foreground/resume:

1. verify network,
2. verify stored device credential,
3. connect or reconnect,
4. re-send normalized device profile if changed,
5. reconcile pending deployments,
6. publish actual runtime/deployment state,
7. wait for server acknowledgement.

Test Android lifecycle behavior on a real supported device.

## F. Performance and loading optimization

Measure before changing.

Instrument stage timings for:

- authentication,
- database acquisition/query,
- NIM classification,
- Hugging Face search,
- repository inspection,
- compatibility scoring,
- synthesis,
- frontend fetch/render,
- WebSocket reconnect,
- device list refresh.

Optimization requirements:

- Remove unnecessary NIM calls.
- For direct repository URLs, bypass generic intent generation.
- Use asynchronous background jobs for deep model resolution instead of holding one HTTP request open indefinitely.
- Stream progress through SSE or the existing authenticated WebSocket protocol.
- Use bounded concurrency for external metadata requests.
- Add revision-aware caching for search results, repository metadata, file trees, licences, and compatibility evidence.
- Use negative caching for missing/unsupported artifacts.
- Do not apply `cache: no-store` to slow-changing model metadata without reason.
- Keep live device/deployment state fresh through event invalidation plus bounded polling fallback.
- Prevent duplicate requests from repeated clicks or React rerenders.
- Coalesce high-frequency device telemetry before PostgreSQL persistence.
- Persist important state transitions, not every progress percentage as a separate full update.
- Add indexes verified through query plans.
- Move schema management to real migrations if the current app performs schema creation or broad verification at runtime.
- Split the monolith only along proven boundaries and preserve imports/routes through compatibility modules. Do not perform a broad rewrite.

Define and test service-level targets based on baseline evidence. At minimum report p50, p95, and failure rate for critical paths.

## G. Production-grade UI/backend integration

All UI states must be backed by typed API responses.

Implement or verify:

- loading,
- empty,
- partial-progress,
- retryable failure,
- non-retryable failure,
- authentication failure,
- provider-key failure,
- device offline,
- incompatible model,
- deployment pending,
- deployment active,
- rollback available.

Do not parse magic strings such as `[DEPLOY_BUTTON: repo]` as the authoritative action contract.

Use a typed action payload:

```json
{
  "action": {
    "type": "PROPOSE_DEPLOYMENT",
    "model_version_id": "...",
    "device_id": "...",
    "requires_confirmation": true
  }
}
```

The backend must re-authorize and revalidate at execution time. The frontend must never be able to deploy solely by submitting a repository slug it rendered.

Preserve current visual language. Do not redesign unrelated screens.

## H. Cybersecurity and abuse resistance

Threat-model the real public deployment, assuming a hostile internet user and an authenticated malicious user.

Protect against friends, bots, or attackers trying to take the website down or abuse paid/external resources.

### Required controls

#### Edge and transport

- Put the public application behind a production CDN/WAF/reverse proxy that supports DDoS absorption, TLS, request-size limits, bot filtering, and rate limiting.
- Enforce HTTPS and secure cookies.
- Configure sane proxy and origin timeouts.
- Ensure the origin cannot be bypassed directly where practical.
- Restrict allowed hosts and trusted proxy headers.

#### Rate limiting and quotas

Apply layered limits by:

- IP,
- authenticated user,
- route,
- provider operation,
- device,
- concurrent job count.

Use stricter limits for:

- login,
- OTP,
- password reset,
- refresh,
- pairing generation,
- WebSocket connect,
- assistant chat,
- deep model search,
- repository inspection,
- uploads,
- deployment creation,
- feedback endpoints.

Return `429` with retry metadata. Do not perform expensive NIM/Hugging Face work before rate-limit and authorization checks.

Add per-user concurrency caps and global circuit breakers for NIM and Hugging Face calls.

#### Authentication and sessions

- Prevent account enumeration.
- Rate-limit OTP/password endpoints.
- Use short-lived access tokens and safely rotated refresh tokens.
- Detect refresh-token reuse where supported.
- Revoke sessions on password reset and explicit logout-all.
- Secure cookies with `HttpOnly`, `Secure`, correct `SameSite`, path, and domain.
- Protect state-changing cookie-authenticated routes against CSRF.
- Verify JWT issuer, audience, expiry, algorithm, and key rotation behavior.

#### WebSockets and pairing

- Authenticate WebSocket upgrades.
- Enforce origin checks where appropriate.
- Bind socket to user/device identity.
- Limit message size and rate.
- Validate every message schema.
- Expire pairing tokens quickly.
- Make pairing tokens single-use and replay-resistant.
- Add pairing revocation and device credential rotation.
- Prevent one account from claiming another account's device.

#### External URL and registry safety

- Prevent SSRF.
- Do not fetch arbitrary user-provided URLs.
- Allowlist supported registry domains and protocols.
- Resolve and validate hosts safely.
- Block private, loopback, link-local, metadata-service, and internal network targets.
- Limit redirects, response size, decompression, and download duration.
- Validate repository slugs separately from URLs.

#### Uploads and artifacts

- Stream uploads.
- Enforce size, type, extension, and content validation.
- Use isolated temporary storage.
- Prevent path traversal and archive bombs.
- Hash artifacts.
- Scan or quarantine untrusted archives where applicable.
- Never execute uploaded files in the backend process.
- Do not trust model metadata or model cards as safe HTML.

#### Browser security

- Maintain a restrictive CSP compatible with the actual app.
- Prevent XSS through Markdown/model-card/chat rendering.
- Do not use unsanitized `dangerouslySetInnerHTML`.
- Set frame-ancestors/clickjacking protections.
- Set content-type, referrer, permissions, and HSTS headers.
- Avoid exposing source maps publicly unless intentionally protected.

#### Database and application

- Use parameterized queries.
- Enforce connection-pool limits.
- Add transaction timeouts and statement timeouts where appropriate.
- Do not let expensive unbounded queries run from public inputs.
- Add idempotency for deployment and other expensive mutations.
- Add circuit breakers and bulkheads for external dependencies.
- Bound queues and reject excess work rather than exhausting memory.
- Enforce request body and WebSocket message limits.

#### Secrets and logs

- Centralize secret redaction.
- Prevent secrets in traces, error trackers, analytics, chat history, database dumps, frontend state, and CI logs.
- Add structured logs with trace IDs but no sensitive bodies by default.
- Audit dependency and container/image vulnerabilities using existing ecosystem tooling.
- Pin and update vulnerable dependencies through narrow reviewed changes.

#### Abuse detection and operations

- Add alerts for authentication spikes, OTP abuse, chat/search spikes, provider error spikes, WebSocket floods, deployment floods, 5xx increases, latency increases, and database pool exhaustion.
- Provide a safe operational kill switch for deep search and deployment creation without taking down login, account access, and read-only status pages.
- Add health, readiness, and dependency status checks that do not expose secrets or internals publicly.
- Document incident response, key rotation, credential revocation, rate-limit override, origin lockdown, and rollback procedures.

Do not claim that application-level rate limiting alone prevents volumetric DDoS. The public deployment requires upstream CDN/WAF/network protection.

## I. Reliability and data integrity

Implement or verify:

- idempotent deployment creation,
- monotonic deployment state transitions,
- optimistic concurrency or version checks,
- retry-safe background jobs,
- dead-letter handling,
- interrupted-download recovery,
- package integrity verification,
- activation acknowledgement,
- last-known-good rollback,
- backend restart recovery,
- offline reconciliation,
- device clock skew tolerance,
- audit events for security-sensitive actions.

Avoid ambiguous booleans such as only `connected` or `success`. Use typed states and reason codes.

---

# Testing requirements

## Automated tests

Add or repair:

- unit tests,
- API integration tests,
- database tests,
- cross-tenant authorization tests,
- provider-adapter contract tests,
- malformed-output tests,
- WebSocket authentication and reconnect tests,
- frontend state-isolation tests,
- mobile lifecycle/reconnect tests where supported,
- end-to-end deployment tests,
- migration tests,
- performance regression tests,
- security abuse tests.

## Security test cases

At minimum test:

- brute-force login/OTP throttling,
- account enumeration resistance,
- CSRF on state-changing routes,
- XSS in chat/model metadata,
- malicious Markdown/HTML,
- SSRF attempts,
- oversized body and WebSocket frames,
- request floods,
- deep-search concurrency exhaustion,
- unauthorized device/deployment access,
- replayed pairing token,
- replayed deployment request,
- leaked or malformed JWT,
- stale refresh token,
- direct-origin access where edge protection is expected,
- secret redaction.

Use authorized local/staging tests only. Do not attack third-party systems or production infrastructure outside the controlled environment.

## Required real end-to-end scenarios

1. Account A configures a valid NIM key, pairs device A, searches, and receives compatible real results.
2. Account B cannot see or mutate any account A state.
3. Switching A → B → A never merges chat, account, device, deployment, API-key status, or cached queries.
4. Invalid NIM key shows a precise safe error and never leaks prompts.
5. NIM timeout still returns deterministic validated search state where available.
6. Direct compatible Hugging Face URL produces a validated result.
7. Direct incompatible URL produces a clean structured rejection.
8. Mobile app is killed, reopened, reconnects, and becomes online within the documented liveness window.
9. Backend restart causes device and frontend to reconcile correctly.
10. Interrupted deployment resumes or fails safely and remains auditable.
11. Duplicate deploy submission produces one deployment.
12. Rate limits protect expensive endpoints without breaking normal use.

---

# Change-control gates

Before each implementation batch:

1. List files to change.
2. State the confirmed root cause.
3. State expected behavior.
4. State compatibility risk.
5. State rollback method.
6. Add or identify the test that will fail before and pass after.

After each batch:

1. Run relevant unit/integration tests.
2. Run type checks, lint, builds, migrations, and security checks.
3. Re-run the original reproducer.
4. Inspect logs for secret leakage.
5. Verify no unrelated user flow changed.
6. Record raw evidence.
7. Commit the narrow change with a clear message.

Stop and report instead of forcing a change when:

- repository state is inconsistent,
- required production configuration is unavailable,
- a migration cannot be made safely,
- a fix would require undocumented breaking behavior,
- real device verification is unavailable for a mobile-runtime claim,
- external provider behavior cannot be confirmed.

---

# Required audit artifacts

Create and maintain these files inside the repository under an appropriate existing documentation/audit directory. Do not scatter duplicates if equivalent files already exist; update the canonical location.

1. `LOKIAI_DEEP_AUDIT.md`
   - current architecture,
   - trust boundaries,
   - defect register,
   - severity,
   - evidence,
   - root causes,
   - recommendations.

2. `LOKIAI_IMPLEMENTATION_PLAN.md`
   - ordered work packages,
   - dependencies,
   - files/components,
   - risks,
   - rollback,
   - acceptance criteria.

3. `LOKIAI_SECURITY_THREAT_MODEL.md`
   - assets,
   - actors,
   - trust boundaries,
   - attack paths,
   - mitigations,
   - residual risks,
   - production controls.

4. `LOKIAI_TEST_AND_CHANGE_AUDIT.md`
   - append-only work log,
   - timestamp,
   - commit,
   - input/reproducer,
   - commands,
   - sanitized raw output,
   - test result,
   - files changed,
   - migration performed,
   - rollback notes.

5. `LOKIAI_PRODUCTION_RUNBOOK.md`
   - deploy,
   - rollback,
   - provider outage,
   - NIM key incidents,
   - WebSocket/device outage,
   - database saturation,
   - rate-limit event,
   - suspected attack,
   - secret rotation,
   - incident evidence collection.

---

# Severity order

Implement in this priority unless evidence proves a different dependency order:

## P0

- cross-account or cross-tenant data leakage,
- API-key/secret exposure,
- internal prompt leakage,
- broken authorization,
- unsafe deployment action authorization,
- public denial-of-service paths that can exhaust backend/provider/database resources,
- pairing or WebSocket identity takeover.

## P1

- device presence/reconnect failure,
- NIM failure handling,
- deep-search correctness,
- duplicate deployments,
- data corruption or stale lifecycle state,
- unbounded external request fan-out,
- critical latency bottlenecks.

## P2

- loading/render performance,
- observability gaps,
- incomplete errors,
- cache improvements,
- maintainability refactors with proven value.

Do not prioritize visual polish over correctness, security, isolation, reconnect reliability, or real deployment behavior.

---

# Final acceptance criteria

The work is not complete until all of the following are true and evidenced:

- No cross-account chat, account, credential, device, deployment, job, or cache leakage in automated and manual tests.
- User NIM keys are encrypted or securely stored, masked in UI, absent from logs/prompts/chat/browser storage, and isolated per account.
- Internal prompts and raw provider instructions cannot reach the UI through any tested failure path.
- Assistant responses use deterministic typed envelopes.
- Direct repository URLs and generic search requests follow consistent validated paths.
- Deep search performs bounded parallel metadata inspection and returns reasoned compatibility states.
- Mobile reconnect after offline/background/process death updates real online state within the documented heartbeat/reconnect window.
- Backend restart and WebSocket reconnect reconcile desired and actual device/deployment state.
- Duplicate deployment requests are idempotent.
- Critical endpoint p50/p95 timings and error rates are measured before and after.
- Expensive endpoints have authentication, authorization, rate limits, concurrency limits, timeouts, circuit breakers, and safe failure behavior.
- Public deployment has a documented upstream CDN/WAF/DDoS protection configuration and origin-protection strategy.
- Existing primary user flow remains intact, except for explicitly documented minimal security/correctness changes.
- Frontend, backend, database, WebSocket, and mobile behavior are integrated through real typed contracts, not static placeholders.
- Existing tests and builds pass, new regressions are covered, and rollback instructions are verified.
- All claims in the final report are backed by code, logs, tests, traces, migrations, or real-device evidence.

---

# Final response format

When finished, report:

1. Executive verdict.
2. Confirmed root causes.
3. Security findings by severity.
4. Reliability and reconnect findings.
5. Performance baseline versus final measurements.
6. Exact user-flow changes, preferably `none`; otherwise list and justify each.
7. Database/API/protocol changes.
8. Files changed.
9. Migrations and rollback path.
10. Test matrix with pass/fail evidence.
11. Known unresolved risks.
12. Production deployment checklist.
13. Commit hashes for each implementation batch.

Do not report “production-ready” unless every applicable acceptance gate has passed with retained evidence.
