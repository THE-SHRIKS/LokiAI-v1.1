# LokiAI — Project Rules for AI Agents

## What this project is
LokiAI is a **zero-USB, zero-ADB, WiFi-only AI deployment system** for Android phones.
- **Backend**: FastAPI monolith (`LokiAI-backend/main.py`, ~2400 lines) + PostgreSQL (Neon) + WebSockets
- **Dashboard**: React 19 + TanStack Start + TailwindCSS v4 + shadcn/ui (`LokiAI-Desktop/stellar-dashboard-builder-main/`)
- **Mobile**: Flutter Android app (`LokiAImobile UI/`) — on-device inference only (fllama + tflite_flutter)

## Hard constraints — never violate these

1. **No cloud inference on mobile.** All ML inference code must target local on-device execution (llama.cpp / TFLite). Do not add any API calls to remote inference services inside `LokiAImobile UI/lib/ml/`.
2. **Backend never stores model files.** `main.py` orchestrates HuggingFace CDN URLs only. Never write code that downloads or caches model weights on the server.
3. **`main.py` is the single source of truth.** It is intentionally monolithic. Do not split it into multiple files unless explicitly asked. When editing, always verify asyncpg queries and WebSocket logic are not broken.
4. **Dashboard uses TanStack file-based routing.** New pages go in `src/routes/`. Reuse existing `src/components/ui/` and `src/components/workspace/` components before creating new ones.
5. **Do not push to production without explicit user approval.** Make local changes only, show the user, then wait for "push to prod" before touching the deployed Render/Vercel/bore services.

## Coding standards

- **Python**: async/await throughout, asyncpg for DB, Pydantic v2 models, FastAPI dependency injection
- **TypeScript**: strict mode, no `any` unless unavoidable, prefer explicit return types on exported functions
- **CSS**: Use the existing design token system (`oklch` values from `styles.css`) — `--olive`, `--olive-bright`, `--background`, `--panel`, etc. Do NOT hardcode hex colors.
- **Logo**: Always use `/lokiai-logo.png` (served from `public/`) at height 22-26px. Never use a text/letter fallback.

## Local dev URLs
- **Frontend**: `http://localhost:8080` (network: `http://192.168.31.233:8080`)
- **Backend**: `http://localhost:8000` (network: `http://192.168.31.233:8000`)
- **Backend docs**: `http://localhost:8000/docs`

## Start servers
```powershell
# Backend
cd "L:\The Shriks\LokiAI\LokiAI-backend"
.\venv\Scripts\python.exe -m uvicorn main:app --host 0.0.0.0 --port 8000 --reload

# Frontend
cd "L:\The Shriks\LokiAI\LokiAI-Desktop\stellar-dashboard-builder-main"
npm run dev -- --host 0.0.0.0
```

## Key files
| File | Purpose |
|------|---------|
| `LokiAI-backend/main.py` | Entire FastAPI backend |
| `LokiAI-backend/.env` | SMTP, DB, JWT, NVIDIA API keys |
| `src/routes/*.tsx` | All dashboard pages (file-based routing) |
| `src/components/workspace/AddDeviceDialog.tsx` | QR pairing dialog |
| `src/components/workspace/Sidebar.tsx` | Main nav sidebar |
| `src/lib/lokiai-api.ts` | All backend API calls |
| `src/styles.css` | Design tokens (oklch palette) |
| `public/lokiai-logo.png` | The real LokiAI wordmark logo |

## Production deployments
- Backend: Render (`lokiai.onrender.com`)
- Frontend: Vercel
- Tunnel: bore / similar
- Only push after explicit user confirmation.
