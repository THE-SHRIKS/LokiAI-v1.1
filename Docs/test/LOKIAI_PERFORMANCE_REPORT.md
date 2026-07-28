# LokiAI — Performance Report

**Date:** 2026-07-28
**Commit measured (before):** `6036b12`
**Commit measured (after):** `38a571c`
**Environment:** local backend (`uvicorn`, Python 3.14.6) against a disposable local PostgreSQL 18.4.0 and the **real** public HuggingFace API/CDN.
**Tool:** `LokiAI-backend/test_infra/perf_probe.py`, 7 runs per endpoint.
**Method:** every number is an observed HTTP round trip. Nothing is estimated, extrapolated, or synthetic.

Reproduce:
```bash
bash test_infra/run_test_backend.sh          # disposable DB, inert SMTP/NIM
python test_infra/perf_probe.py --runs 7 --label before
# apply change, restart
python test_infra/perf_probe.py --runs 7 --label after
```

---

## Measurement first

The brief asked for measurement before optimization. That ordering mattered: it showed the slow-loading complaint was **not** spread across the app. Everything except model search was already fast.

### Before

| Endpoint | n | p50 ms | p95 ms | min | max |
|---|---:|---:|---:|---:|---:|
| `GET /health` | 7 | 2.5 | 29.2 | 1.6 | 32.2 |
| `GET /auth/me` | 7 | 3.6 | 15.8 | 2.1 | 16.4 |
| `GET /devices` | 7 | 15.7 | 22.6 | 2.0 | 23.7 |
| `GET /deployments` | 7 | 2.5 | 31.9 | 2.2 | 34.3 |
| `GET /models` | 7 | 2.7 | 26.1 | 1.9 | 28.3 |
| **`POST /models/search`** (real HF) | 7 | **4810.5** | **13326.3** | 2628.0 | 16610.2 |
| `POST /assistant/chat` direct-URL | 7 | 15.9 | 26.8 | 3.6 | 26.9 |
| `POST /assistant/chat` greeting | 7 | 19.9 | 38.9 | 2.3 | 43.2 |

Model search was three orders of magnitude slower than everything else. Nothing else warranted a change, so nothing else was changed.

### Diagnosis

`search_deployable_models()` issued **one redirect-following CDN HEAD per candidate, up to 40, all fired simultaneously with no bound**. The public HuggingFace CDN throttles bursts like that; `_hf_head()` then honours `Retry-After` by sleeping. That sleep is the long tail — a p95 of 13.3s is mostly waiting out self-inflicted 429s.

A second measurement corroborated it: hammering `/models/search` 26 times took **96.3 seconds** (~3.7s/call), which is also why the old rate-limit regression check could never observe a 429 — 26 calls outlast the 60-second window. That check was rewritten to probe the same per-user limit via a cheap endpoint.

### Change applied

Two bounded fixes. No behaviour change, no architectural change.

1. **Cache file size per `(repo, file)`** — a file's size on `main` is stable, and popular repos recur across queries.
2. **Bound concurrent HEADs** — `HF_HEAD_CONCURRENCY`, default 8.

Also, from the previous commit: a pasted repo URL now skips the intent model entirely, and repo metadata is cached for 300s.

### After

| Endpoint | n | p50 ms | p95 ms | min | max |
|---|---:|---:|---:|---:|---:|
| `GET /health` | 7 | 1.6 | 16.3 | 1.2 | 16.4 |
| `GET /auth/me` | 7 | 14.6 | 20.1 | 3.5 | 20.5 |
| `GET /devices` | 7 | 16.1 | 18.1 | 8.7 | 18.8 |
| `GET /deployments` | 7 | 5.6 | 23.6 | 2.3 | 24.0 |
| `GET /models` | 7 | 1.9 | 13.9 | 1.8 | 16.9 |
| **`POST /models/search`** (real HF) | 7 | **937.2** | **3464.0** | 430.5 | 4430.4 |
| `POST /assistant/chat` direct-URL | 7 | 4.5 | 20.6 | 2.9 | 20.9 |
| `POST /assistant/chat` greeting | 7 | 14.2 | 16.0 | 2.5 | 16.1 |

### Result

| `POST /models/search` | Before | After | Change |
|---|---:|---:|---|
| p50 | 4810.5 ms | 937.2 ms | **5.1× faster** |
| p95 | 13326.3 ms | 3464.0 ms | **3.8× faster** |
| min | 2628.0 ms | 430.5 ms | **6.1× faster** |
| max | 16610.2 ms | 4430.4 ms | **3.7× faster** |

Both mechanisms contribute. Caching explains the repeat-query gain; the concurrency bound explains the **min** improving 6× — that is a cache-cold path, so the gain there is purely from not triggering CDN throttling.

Direct-repo resolution, repeated three times, held at **2.2–2.6 ms** — the metadata cache serving without re-hitting HuggingFace.

Other endpoints moved by a few ms in both directions; that is run-to-run noise at this scale, not signal.

---

## Honest limits of these numbers

These are **not** production figures, and should not be quoted as such.

- **Local backend.** Render adds network latency, free-tier cold starts (a ~25s cold start was observed on the live backend during this session), and shared CPU. Production p95 will be higher.
- **The full NIM assistant path is NOT measured.** With no NIM key configured, `/assistant/chat` stops at the key gate (HTTP 428). The assistant rows above measure our own request handling only — they do **not** include a real NIM round trip. Measuring that needs a real key.
- **HuggingFace is a live third party.** Its latency varies by time of day and by how recently our IP made requests. Before/after runs were minutes apart, which controls for this only roughly.
- **7 runs is a small sample.** p95 from 7 samples is an indication, not a stable statistic. The 5× p50 shift is far larger than the noise, but treat the exact figures as approximate.

## Not measured (requested but not covered)

| Metric | Status | Why |
|---|---|---|
| Assistant p50/p95 with a real NIM key | **NOT TESTED** | no key available this session |
| NIM request count per assistant turn | **NOT TESTED** | same |
| Frontend workspace load | **NOT TESTED** | needs a browser session against a deployed frontend |
| Device-list refresh latency (client-side) | **NOT TESTED** | server side is covered by `GET /devices` above |
| WebSocket reconnect time | **PASS (functional)** | proven by `presence_test.py`, not timed as a distribution |
| Online/offline convergence time | **PASS (functional)** | bounded by `PRESENCE_TTL_SECONDS` (default 70s) + a 30s sweep; verified end-to-end at TTL=5s |
| Database query timings | **NOT TESTED** | no query hit the DB hard enough to matter; all DB-backed endpoints are <20ms p50 |

## Deliberately not done

- **No database indexes were added.** The audit flagged six unindexed tenant-scoped FK columns (risk R-5), but every DB-backed endpoint measured under 20ms p50 on this dataset. Adding indexes without query evidence would be an unmeasured change; it stays open in the risk register with the honest note that the evidence will appear at larger row counts, not now.
- **No circuit breakers.** Still open as R-7. Rate limits bound the abuse case; they do not bound the provider-outage case.
- **No architectural rewrite of the assistant.** A bounded fix was sufficient, so the two-stage design was left alone.
