# LokiAI

**On-device AI, no cloud, forever.** Point your phone at a QR code, describe what you want in plain English, and LokiAI finds a real model that fits your hardware, ships it straight from Hugging Face to your device over WiFi, and runs it 100% offline from then on — even in airplane mode.

No USB. No ADB. No developer options. No model files ever touch our servers.

```
Dashboard (browser)  ──QR pairing──>  Phone (self-registers its own specs)
        │                                        │
        ├──"I want object detection"──> Backend ─┤
        │        (NVIDIA NIM + HF search)        │
        │                                        │
        └──Deploy──> Backend ──WS──> Phone ──> downloads model from HF CDN
                                                  │
                                          runs 100% offline
```

## How it works

1. Open the **dashboard** in a browser and click **Add Device** — a QR code appears.
2. Scan it with your phone's camera. The browser opens a install page; the **LokiAI Android app** downloads and installs.
3. Open the app, scan a second **pairing QR** shown in the dashboard. The phone reads its own hardware specs (RAM, CPU arch, storage, Android version) and registers itself — no ADB, no manual entry.
4. In the dashboard's AI chat, describe what you want ("I want real-time object detection"). The backend searches Hugging Face for models that actually fit *that* phone, then an NVIDIA NIM (Llama 3.1) model turns the results into a plain-English recommendation.
5. Pick a model, click **Deploy**. The backend pushes a WebSocket instruction to the phone; the phone downloads the model **directly from the Hugging Face CDN** (the backend never stores or proxies model files) and reports progress back in real time.
6. The app loads the model into the right on-device runtime and runs completely offline from then on.

## Repository structure

```
LokiAI/
├── LokiAI-backend/                       FastAPI + PostgreSQL API, WebSocket server, NVIDIA NIM + HF integration
├── LokiAI-Desktop/
│   └── stellar-dashboard-builder-main/   Web dashboard — TanStack Start + React + shadcn/ui
├── LokiAImobile UI/                      Android app — Flutter, camera/chat/voice inference
└── Docs/files/                           Architecture, PRD, spec, planner, rules (source of truth)
```

Each component has its own README with setup instructions:
[`LokiAI-backend/README.md`](LokiAI-backend/README.md) · [`LokiAI-Desktop/stellar-dashboard-builder-main/README.md`](LokiAI-Desktop/stellar-dashboard-builder-main/README.md) · [`LokiAImobile UI/README.md`](LokiAImobile%20UI/README.md)

## Tech stack

| Layer | Technology |
|---|---|
| Dashboard | TanStack Start, React 19, Tailwind, shadcn/ui, Vite |
| Backend | FastAPI (Python 3.12), asyncpg, WebSockets, slowapi rate limiting |
| Database | PostgreSQL (Railway) |
| Auth | Custom JWT (access + rotating refresh tokens), bcrypt |
| Mobile | Flutter (Dart) |
| Vision inference | TFLite (`tflite_flutter`), hardware-accelerated on-device |
| Chat inference | GGUF via `fllama` (llama.cpp FFI), CPU inference |
| Voice inference | TFLite audio classification |
| Model discovery | Hugging Face Hub API |
| AI assistant | NVIDIA NIM (Llama 3.1) |
| Model delivery | Hugging Face CDN, direct to device — zero server-side storage |

## Quick start

Requires: Python 3.12+, Node.js 20+ (or Bun), Flutter SDK, and a PostgreSQL database (e.g. Railway).

```bash
# 1. Backend
cd LokiAI-backend
python -m venv venv
./venv/Scripts/activate            # venv/bin/activate on macOS/Linux
pip install -r requirements.txt
cp .env.example .env               # fill in your own values
uvicorn main:app --host 0.0.0.0 --port 8000

# 2. Dashboard
cd LokiAI-Desktop/stellar-dashboard-builder-main
npm install                        # or: bun install
npm run dev                        # http://localhost:8080

# 3. Mobile app
cd "LokiAImobile UI"
flutter pub get
flutter run                        # real device recommended over emulator
```

See each subproject's README for full details and required environment variables.

## Project status

All core phases (backend, mobile app, on-device inference, dashboard) are built and have been verified end-to-end on real hardware. A security-hardening pass has since been layered on top: short-lived JWTs with rotating refresh tokens, per-endpoint rate limiting, a locked-down CORS policy, forgot/reset-password flow, and standard security headers across both backend and dashboard.

Full task-by-task history and verification detail live in [`Docs/files/`](Docs/files/).

## Constraints (by design)

- No USB, no ADB, no developer options — ever.
- No model files stored on the backend — only Hugging Face URLs.
- No cloud inference — everything runs on-device after deployment.
- NVIDIA NIM only for the AI assistant — no other LLM vendor in the backend.
