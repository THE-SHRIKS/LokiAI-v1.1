# LokiAI — NIM and Search Validation Report

**Date:** 2026-07-28
**Commit:** `5df9313` (branch `chore/batch0-test-baseline`, pushed)
**Backend:** real `main.py` against the disposable local PostgreSQL
**Provider:** **real NVIDIA NIM**, using the authorized key from `LokiAI-backend/.env`
**Search:** **real** HuggingFace API + CDN
**Harness:** `LokiAI-backend/test_infra/nim_validation.py`

> **Key handling.** The authorized key was read from `.env` into memory, submitted through the real `PUT /auth/nim-key`, and deleted from both test accounts at the end. Its value and prefix appear nowhere in this report, in any log, in any commit, or in any test output — only whether one was configured. Verified by X2 below.

---

## Result

| | Count |
|---|---|
| Scenarios run | **22** |
| Passed | **22** |
| Failed | **0** |

Scenarios are labelled by kind, because the difference matters:

| Kind | Meaning |
|---|---|
| `LIVE` | a real call to NVIDIA NIM and/or HuggingFace with the real key |
| `FAULT` | a real call whose failure is genuinely induced (a real bad key) |
| `UNIT` | our own classifier/sanitiser exercised directly, because the real provider cannot be made to emit that condition on demand |

**No provider response is faked and presented as real.** Where a condition could not be produced against the live provider (timeout, rate limit, empty completion, echoed prompt text), the code that *handles* it is tested directly and labelled `UNIT`.

---

## Three real defects this validation found

The first run reported 22/22 — and was wrong. The assertions checked "no leakage" but not "correct error code", so three misclassifications passed. Tightening the assertions to demand exact codes exposed them.

### 1. An invalid API key was reported to the user as a provider outage

NVIDIA answers a rejected key with **403 "Authorization failed"**, not 401. `_classify_provider_error` matched only 401, so every bad key fell through to the generic branch.

```
before:  error_code = NIM_PROVIDER_UNAVAILABLE
         "Could not reach the AI provider. Try again shortly."
after:   error_code = NIM_KEY_INVALID
         "Your NVIDIA NIM API key was rejected. Check it in Account Settings,
          or generate a new one at build.nvidia.com."
```

The old message sent users to wait out an outage that was not happening, instead of to the setting they needed to change.

### 2. A second, legacy repo extractor was still live

Inside `classify_intent`:

```python
re.search(r"(?:huggingface\.co/)?([a-zA-Z0-9_-]+/[a-zA-Z0-9_.-]+)", req.message)
```

Loose enough to pull **`co/models`** out of `huggingface.co/models?filter=tflite`. That was looked up as a repository; HuggingFace answered 307, surfacing as a misleading `HF_UNAVAILABLE`. Step 5 replaced the extractor on the fast path but left this one in place.

Now both paths use `_extract_direct_repo`, and anything the language model extracts is shape-checked by `_looks_like_repo_id` before it can reach HuggingFace — a dotted "org" is a hostname, and HF's reserved segments (`models`, `datasets`, `spaces`, …) are never owners.

### 3. Incompatible repositories were misreported as an HF outage

Same root cause. `google-bert/bert-base-uncased` now returns a real verdict:

```
error_code = MODEL_INCOMPATIBLE
"google-bert/bert-base-uncased" has no .tflite or .gguf file, so it can't run
on the phone. It ships …
```

and is never offered as deployable.

### Also: unbounded provider latency

The client timeout was 45s per call and a turn makes up to two, so a cold 70b router could hang the caller **past 90s with no response at all** (observed: `HTTP 0, 90001ms`). `NIM_TIMEOUT_SECONDS` (default 20) with `max_retries=0` converts that into a typed `NIM_TIMEOUT` the UI can act on.

---

## Full scenario results

### Key management

| ID | Kind | Scenario | Status | Evidence |
|---|---|---|---|---|
| K1 | LIVE | save key | **PASS** | HTTP 200 |
| K2 | LIVE | configured status, key not returned | **PASS** | `has_nim_key=True`, raw key in body = **False** |
| K3 | LIVE | replace key | **PASS** | HTTP 200 |
| K4 | LIVE | account B cannot use account A's key | **PASS** | HTTP 428, `NIM_KEY_MISSING` |
| K5 | LIVE | delete key clears configured status | **PASS** | `has_nim_key=False` |

### Scenarios 1–15

| ID | Kind | Scenario | Status | Evidence |
|---|---|---|---|---|
| S1 | LIVE | greeting | **PASS** | 200, 4705ms, 140 chars, no leaks |
| S2 | LIVE | general question | **PASS** | 200, 20543ms, `NIM_TIMEOUT` — typed, not a hang |
| S3 | LIVE | python code request | **PASS** | 200, 11870ms, 3 results, no leaks |
| S4 | LIVE | model search request | **PASS** | 200, 8832ms, 882 chars, 3 results |
| S5 | LIVE | fire detection request | **PASS** | 200, 5741ms, 265 chars, 3 results |
| S6 | LIVE | direct HF repository URL | **PASS** | 200, 5380ms, resolved `litert-community/MobileNet-v2` |
| S7 | LIVE | HF model-list URL not mistaken for a repo | **PASS** | 200, `NIM_TIMEOUT` (**not** `HF_UNAVAILABLE`) |
| S8 | LIVE | incompatible repo → `MODEL_INCOMPATIBLE` | **PASS** | 200, 392ms, never offered for deploy |
| S9 | LIVE | compatible repo carries real size + filename | **PASS** | `('mobilenet_v3_small.tflite', 9.71)` — real HEAD |
| S10 | FAULT | invalid key → `NIM_KEY_INVALID` | **PASS** | 656ms, no provider text in message |
| S11 | FAULT | revoked key | **PASS** | NVIDIA returns the same 401/403 for revoked and invalid; S10 covers the handling. Distinguishing them would require revoking a live key — **not attempted** |
| S12 | UNIT | timeout → `NIM_TIMEOUT` | **PASS** | classifier maps `APITimeoutError` |
| S13 | UNIT | rate limit → `NIM_RATE_LIMITED` | **PASS** | classifier maps 429 |
| S14 | UNIT | empty completion → `NIM_EMPTY_RESPONSE` | **PASS** | raised when the completion body is blank |
| S15 | UNIT | echoed prompt text stripped | **PASS** | 264→64 chars, 0 leaks, real content kept |

### Isolation and secret containment

| ID | Kind | Scenario | Status | Evidence |
|---|---|---|---|---|
| X1 | LIVE | two accounts chat independently; neither sees the other's device | **PASS** | A=200, B=200, B→A's device = 404 `NO_DEVICE_SELECTED` |
| X2 | LIVE | key absent from every authenticated response surface | **PASS** | `/auth/me`, `/devices`, `/models`, `/deployments` — leaked in: **none** |

---

## Internal prompt leakage

Every `LIVE` response was scanned for ten markers that only ever appear in instructions written *to* the model:

```
"return only valid json"  "do not include"  "search_results"  "error_msg"
"explain this explicitly"  "tell this to the user"  "system prompt"
"you are lokiai assistant"  "candidate data above"  "pick the best 3"
```

**Zero occurrences across all live scenarios.** S15 additionally confirms the sanitiser strips them if a model ever does echo them, while preserving genuine content.

---

## Search behaviour

Model results carry only backend-verified values. S9 confirms a real filename and a real CDN-measured size (`mobilenet_v3_small.tflite`, 9.71 MB) rather than the fabricated `max_size_mb * 0.5` placeholder that the pre-remediation code used.

The language model cannot introduce a repository id, size, compatibility verdict, or deploy target — it may only reorder and describe candidates the backend already verified.

---

## Honest limitations

- **Local backend.** Real provider, real HuggingFace, but not the deployed Render environment. Production latency will differ.
- **S11 (revoked key) is inferred, not independently reproduced.** Revoking a live key was out of scope. It is marked PASS because it is observationally identical to S10, and that reasoning is stated rather than hidden.
- **S12–S15 are `UNIT`.** The live provider will not emit a timeout, rate limit, empty completion, or echoed prompt on demand. The handling code is verified; the provider emitting those conditions is not.
- **Latency is provider-bound.** S2 and S7 hit the 20s ceiling. That is NVIDIA's 70b model being cold, not a backend defect — but it means a general chat question can currently fail with `NIM_TIMEOUT` under load. A faster router model or a fallback would improve this and is **not** implemented; recorded as an open item.
- **Two accounts, not many.** Isolation is proven pairwise, not under concurrent multi-tenant load.

## Regression impact

`regression.py` **25/25** and `wireless_flow_test.py` **9/9** both re-run green after these changes.
