# LokiAI Backend

FastAPI service that pairs devices, searches Hugging Face for models that fit a phone's hardware, gets AI-generated recommendations from NVIDIA NIM, and orchestrates wireless model delivery over WebSocket. Stores zero model files — only URLs.

## Setup

```bash
python -m venv venv
./venv/Scripts/activate        # venv/bin/activate on macOS/Linux
pip install -r requirements.txt
cp .env.example .env           # fill in real values, see below
uvicorn main:app --host 0.0.0.0 --port 8000
```

`GET /health` should return `{"status": "ok", "timestamp": ...}` once running. Tables (`users`, `devices`, `models`, `deployments`, `pairing_tokens`, `password_reset_tokens`, `token_blacklist`) are created automatically on startup if they don't exist.

> **Windows note:** run without `--reload` during development. `uvicorn --reload` spawns a worker via Python's `multiprocessing` whose PID doesn't reliably show up in `netstat` or `Get-Process` — a stale worker can end up serving old code after an edit. Restart the process manually instead.

## Environment variables

See [`.env.example`](.env.example) for the full list. In short:

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `JWT_SECRET_KEY` | Signs access/refresh JWTs |
| `NVIDIA_API_KEY` | NVIDIA NIM API access (AI assistant) |
| `SMTP_*` | Sends OTP + password-reset emails |
| `CORS_ALLOWED_ORIGINS` | Allowlisted origins (comma-separated) |
| `DASHBOARD_URL` | Used to build links in outgoing emails |

Hugging Face Hub search/CDN calls are unauthenticated and need no API key.

## API overview

| Area | Endpoints |
|---|---|
| Auth | `POST /auth/register`, `/auth/verify-otp`, `/auth/resend-otp`, `/auth/login`, `/auth/refresh`, `/auth/logout`, `/auth/me`, `/auth/forgot-password`, `/auth/reset-password` |
| Pairing | `POST /pairing/generate`, `POST /devices/pair` |
| Devices | `GET /devices`, `GET /devices/{id}`, `DELETE /devices/{id}` |
| Models | `POST /models/search`, `GET /models`, `POST /models/upload`, `GET /models/files/{filename}` |
| AI assistant | `POST /assistant/chat` — device-aware recommendations via Hugging Face search + NVIDIA NIM |
| Deployment | `POST /deployments`, `GET /deployments`, `GET /deployments/{id}`, `WS /ws/device/{device_id}` |
| APK delivery | `GET /install`, `GET /apk` |
| Ops | `GET /health`, `GET /monitor/status`, `GET /monitor/log` |

## Security

- Access tokens are short-lived (30 min); refresh tokens live in an httpOnly cookie and rotate on every use. Logout and rotation are backed by a real DB blacklist, not just client-side deletion.
- Rate limiting (`slowapi`) on auth and assistant endpoints.
- Explicit CORS allowlist (no wildcard origins), standard security headers on every response.
- Request bodies capped at 10MB (model uploads exempted).

## Model delivery

The backend never downloads or stores model files. It resolves a Hugging Face CDN URL and a `config.json`, pushes both to the paired phone over its WebSocket connection, and the phone downloads directly from Hugging Face. `.gguf` (chat) and `.tflite` (camera/voice) are the only formats served — matches the on-device runtimes the mobile app ships with.
