# LokiAI Direct Repository Consistency Report

## Executive Summary
This document outlines the findings and resolution for the Hugging Face repository resolution mismatch (Bug 1) implemented on 2026-07-28.

## Identified Bug
**Bug 1: Direct URL resolution contradicts generic search**
Pasting a direct URL (e.g., `Qwen/Qwen2.5-0.5B-Instruct-GGUF`) would erroneously return `MODEL_INCOMPATIBLE` because the `siblings` array in the standard `GET /api/models/{repo_id}?full=True` response was empty for highly paginated repositories. Natural-language search found the model perfectly. Furthermore, transient CDN errors (`HF_UNAVAILABLE`) were being aggressively cached as permanent incompatibilities.

## Remediation Details
1. **Unified Canonical Path:** The backend now relies strictly on `_fetch_repo_siblings()` for both generic search and direct URL resolution.
2. **Paginated Fallback:** If the primary HF metadata `siblings` array is empty, the code falls back to the `/api/models/{repo_id}/tree/main` endpoint and loops until pagination completes.
3. **Defensive Caching:** 
   - `HF_UNAVAILABLE` transient errors bypass the cache.
   - Any model size validation resulting in `0 MB` (bad RAM read) skips cache-write to prevent poisoning.
   - Pre-existing stale negatives in the dictionary were selectively invalidated.

## Verification Gates
| Test Case | Status |
| :--- | :--- |
| Qwen2.5 direct URL yields .gguf | PASS |
| BERT base yields MODEL_INCOMPATIBLE | PASS |
| Transient timeouts bypass cache | PASS |
| Size validation cache skip | PASS |

**Verdict:** Both search methodologies now rely on identical, grounded evidence from the Hugging Face API, achieving complete deterministic consistency.
