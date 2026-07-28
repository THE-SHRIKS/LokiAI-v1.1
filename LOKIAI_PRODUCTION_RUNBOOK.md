# LokiAI Production Runbook

## Deployment Pipeline (Updated 2026-07-28)
### Backend
1. Target: `main.py`
2. Environment: FastAPI, Python 3.10+, asyncpg
3. Execution: `uvicorn main:app --host 0.0.0.0 --port 8000`
4. Post-Deployment Checks: Ensure HF resolution queries do not cache transient exceptions.

### Dashboard
1. Target: `src/` (TanStack Start)
2. Build Command: `npm run build`
3. Feature Flags: Ensure `VITE_ENABLE_CUSTOM_UPLOAD` is omitted or set to `false` for standard production builds to conceal the Custom Upload interface.

### Mobile Application
1. Target: `LokiAImobile UI/` (Flutter)
2. Build Command: `flutter build apk --release`
3. Distribution: APK deployed dynamically via the `/apk/download` backend handler. No ADB installations are supported for end-users.
