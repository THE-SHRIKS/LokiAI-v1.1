# LokiAI Production Bug-Fix Report

## Target Environment
- **Branch:** `fix/production-bugs-batch1` (merged to `main`)
- **Date:** 2026-07-28
- **Platform Scope:** Backend (FastAPI), Frontend (TanStack Start), Mobile (Flutter Android)

## Overview
This report acts as the central index for the batch of bug fixes executed on 2026-07-28 targeting major flaws in repository resolution, UI credential leaking, session persistence, and branding.

## Bug Fix Summary
1. **Bug 1: Hugging Face Consistency**
   - Direct-URL searches failed for paginated repositories (like `Qwen2.5`) due to missing `siblings` arrays. Backend was rewritten to dynamically pull from the `tree/main` API when `siblings` is empty, ensuring direct URLs and keyword searches behave identically. Cache poisoning bugs caused by transient 500s or bad RAM parses were also squashed.
2. **Bug 2: Mobile Pairing Secret Leak**
   - The Flutter UI printed live WebSocket access credentials and backend URLs to the console, and exposed them during QR scanning. The UI and logger have been sanitized.
3. **Bug 3: Chat Session Wipe during Deployment**
   - A race condition was resolved in the TanStack Start frontend where `localStorage` arrays overwrote memory state, hiding deployment chats. Chats now reliably persist through navigation, refresh, and deployment cycles.
4. **Bug 4: Monitor Polling 404s**
   - The monitor route incorrectly polled restricted endpoints continuously for standard users. Standard users now trigger exactly one request; 401/403/404 responses permanently flip an `accessDenied` flag and clear the polling interval.
5. **Bug 5: NIM API Key Eye Button**
   - The Account page previously rendered a masked password field with a reveal toggle for a key the backend never transmits. The toggle was eliminated, and configured keys only display a "Replace" or "Remove" state.
6. **Bug 6: Mobile Branding**
   - Upgraded Android default `lokiai_app` labeling to `LokiAI`. Built proper `ic_launcher` assets for all densities from the official LokiAI logo.
7. **Bug 7: Custom Upload Exposure**
   - The Custom Upload drop-zone was temporarily disabled in production via the `VITE_ENABLE_CUSTOM_UPLOAD` feature flag, as requested.
8. **Bug 8: Grounded Deployments**
   - Grounded metadata integrity is natively enforced by the Bug 1 `_resolve_explicit_repo` implementation.

## Detailed Reports
For granular data, see:
- `LOKIAI_DIRECT_REPOSITORY_CONSISTENCY_REPORT.md`
- `LOKIAI_CHAT_PERSISTENCE_VALIDATION_REPORT.md`
- `LOKIAI_MOBILE_BRANDING_AND_PAIRING_SECURITY_REPORT.md`
- `LOKIAI_POST_FIX_PRODUCTION_TEST_REPORT.md`
