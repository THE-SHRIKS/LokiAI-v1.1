# EdgeMind / LokiAI — Production Architecture v3

> Zero USB. Zero ADB. Zero developer options.  
> QR code pairing + WiFi model delivery + offline inference.  
> This document replaces all previous architecture versions.

---

## What We Are Building

A platform where:
1. User opens dashboard on their laptop
2. Scans a QR code with their phone
3. Phone downloads and installs the LokiAI app
4. Phone registers itself — reads its own hardware specs, sends to backend
5. User tells the AI what they want in plain English
6. AI finds real models from HuggingFace that fit the device
7. Phone downloads the model directly from HuggingFace CDN
8. User opens the app. Interacts with AI offline. Forever.

No USB cable at any point. No developer options. No ADB. No model storage on our servers.

---

## System Components

### 1. Web Dashboard (Next.js)
**Where:** Runs in browser on user's laptop  
**What it does:**
- Login / registration
- Shows connected devices with real specs
- AI assistant panel for natural language model selection
- QR code generator for device pairing
- Deployment trigger and status tracking
- Fleet overview (multiple devices)

**Connects to:** Backend API via HTTPS + WebSocket

### 2. Backend (FastAPI + Python)
**Where:** Hosted on Railway free tier  
**What it does:**
- User authentication (custom JWT, python-jose)
- Device registration (receives specs from phone app, not from ADB)
- HuggingFace API search (finds models by task + hardware constraints)
- NVIDIA NIM API calls (AI assistant, model recommendations)
- Deployment management (tells phone app which model URL to download)
- WebSocket server (pushes deployment instructions to connected phone apps)
- QR token generation (one-time pairing tokens)
- APK serving (serves the LokiAI APK file for download)

**Does NOT do:**
- Does not store model files (phone downloads directly from HuggingFace CDN)
- Does not touch ADB or USB
- Does not scan devices (phone scans itself)

### 3. Database (PostgreSQL via Railway)
**Where:** Railway managed PostgreSQL  
**What it stores:**
- users table (email, password hash)
- devices table (phone specs, linked to user)
- models table (metadata + HuggingFace URL, not the actual model file)
- deployments table (which model was deployed to which device, status)
- pairing_tokens table (one-time QR pairing tokens)

**Does NOT store:** Model files. Ever. Only URLs.

### 4. Android App — LokiAI Mobile (Flutter)
**Where:** Runs on user's Android phone  
**Codebase:** `S:\LokiAI\LokiAImobile UI`  
**How it gets installed:** User scans QR code → browser downloads APK → user installs  
**What it does on first launch:**
- Shows "Scan QR to pair" screen
- User scans pairing QR from dashboard
- App reads its own hardware specs using Flutter APIs:
  - `Build.MODEL` → phone model name
  - `Build.SUPPORTED_ABIS` → CPU architecture (arm64-v8a, etc.)
  - `ActivityManager.memoryInfo` → total RAM in MB
  - `StatFs` → available storage in GB
  - `Build.VERSION.RELEASE` → Android version
- App sends specs to backend via POST /devices/pair
- App connects WebSocket to backend for deployment instructions

**What it does on deployment:**
- Receives deployment instruction via WebSocket (contains HuggingFace CDN URL)
- Downloads model file directly from HuggingFace CDN to internal app storage
- Receives config.json from backend
- Saves config locally
- Loads model into correct inference runtime

**What it does on daily use (fully offline):**
- Reads config.json on launch
- Loads model from local storage
- Shows correct UI:
  - Camera mode → TFLite inference on live camera feed, labels on screen
  - Chat mode → GGUF model via llama.cpp FFI, real token generation
  - Voice mode → TFLite audio model on mic input, result on screen
- Zero internet required. Zero backend calls. Zero cloud dependency.

### 5. Components That No Longer Exist
| Removed | Why |
|---------|-----|
| Discovery Agent (Go binary) | Phone reads its own specs now. No external scanner needed. |
| ADB / platform-tools | No USB connection in the flow at all. |
| USB cable requirement | QR code + WiFi replaces it entirely. |
| Developer options requirement | Not needed — APK installs via browser download. |
| Cloudflare R2 | Models download directly from HuggingFace CDN to phone. |
| Temp folder on server | Backend never touches model files. Only passes URLs. |

---

## Data Flow — Complete

```
PHASE 1: APK INSTALLATION (one time)

Dashboard "Add Device" button clicked
    → Backend generates one-time pairing token
    → Dashboard displays QR code encoding: https://<backend-url>/install?token=xxx

User scans QR with phone's default camera
    → Phone browser opens https://<backend-url>/install?token=xxx
    → Page shows "Download LokiAI" button
    → User taps button → APK downloads
    → User taps downloaded APK → installs (allow unknown sources once)
    → LokiAI app is now on the phone


PHASE 2: DEVICE PAIRING (one time per device)

User opens LokiAI app on phone
    → App shows "Scan QR code to connect" screen

Dashboard shows a second QR code (pairing QR)
    → Encodes: { backend_url, pairing_token, user_id }

User scans pairing QR from within the LokiAI app
    → App decodes backend URL + token
    → App reads its own hardware specs via Flutter APIs
    → App calls POST /devices/pair with:
        { token, phone_model, cpu_arch, ram_mb, storage_gb, android_version }
    → Backend validates token, creates device record, links to user
    → Backend returns { device_id, websocket_url }
    → App connects to WebSocket /ws/device/{device_id}
    → Device appears in dashboard automatically


PHASE 3: MODEL SELECTION

Dashboard shows the paired device with real specs
User types in AI assistant: "I want real time object detection"

    → POST /assistant/chat
    → Backend calls HuggingFace API:
        - Filter by task type (object-detection)
        - Filter by format (tflite, onnx, gguf)
        - Filter by max size (device RAM × 0.4)
        - Sort by downloads
    → Backend calls NVIDIA NIM API (meta/llama-3.1-70b-instruct):
        - System prompt includes device specs + HF search results
        - Returns top 3 recommendations in plain English
    → Dashboard shows AI response with 3 model cards


PHASE 4: MODEL DEPLOYMENT (zero server storage)

User picks a model → clicks Deploy
    → POST /deployments
    → Backend creates deployment record (status: "queued")
    → Backend resolves the HuggingFace CDN direct download URL
    → Backend generates config.json with model name, mode, threshold
    → Backend sends deployment instruction via WebSocket to phone app:
        {
          action: "deploy",
          model_url: "https://huggingface.co/.../resolve/main/model.tflite",
          model_name: "mobilenetv4.tflite",
          config: { inference_mode: "camera", confidence_threshold: 0.75 }
        }
    → Phone app receives instruction
    → Phone app downloads model directly from HuggingFace CDN
        (streaming download with progress tracking)
    → Phone app saves model to internal storage
    → Phone app saves config.json to internal storage
    → Phone app sends confirmation back via WebSocket: { status: "complete" }
    → Backend updates deployment record to "complete"
    → Dashboard shows "Deployment complete"


PHASE 5: DAILY USE (fully offline)

User opens LokiAI app
    → App reads config.json from internal storage
    → App loads model from internal storage into correct runtime:
        .tflite → TFLite (tflite_flutter)
        .gguf → llama.cpp (fllama FFI)
    → App shows correct UI mode
    → User interacts: camera / chat / voice
    → Zero internet required
    → Runs forever until user deploys a different model
```

---

## Tech Stack — Final

| Component | Technology | Reason |
|-----------|-----------|--------|
| Dashboard | Next.js 14 | React-based, fast |
| Backend | FastAPI Python 3.12 | Async, HF/NIM ecosystem |
| Database | PostgreSQL (Railway) | Real managed DB, free tier |
| Auth | Custom JWT (python-jose) | No vendor lock-in |
| Hosting | Railway free tier | Backend + DB in one place |
| Android App | Flutter (Dart) | Single codebase, camera/mic/chat built in |
| Model search | HuggingFace API | Free, largest model hub |
| AI Assistant | NVIDIA NIM API (meta/llama-3.1-70b-instruct) | Primary and only AI backend |
| Vision inference | tflite_flutter (LiteRT) | Best for Android, hardware accelerated |
| Chat inference | fllama (llama.cpp FFI) | GGUF models, CPU inference |
| Voice inference | TFLite Audio | Audio classification/transcription |
| Real-time comms | WebSocket (FastAPI) | Push deployment instructions to phone |
| QR generation | qrcode (Python library) | Pairing + APK download |
| Model storage | None (HuggingFace CDN) | Phone downloads directly, zero cost |

---

## What Runs Where

```
USER'S LAPTOP (browser only):
  - Next.js dashboard in Chrome/Firefox/Safari
  - Nothing installed on the laptop
  - No Go binary, no ADB, no platform-tools

RAILWAY SERVER:
  - FastAPI backend
  - PostgreSQL database
  - WebSocket server
  - NVIDIA NIM API calls
  - HuggingFace API calls
  - APK file serving (one static file)
  - Zero model file storage

HUGGINGFACE CDN:
  - Model files (served directly to phone)
  - Zero cost to us
  - Globally distributed, fast downloads

ANDROID PHONE:
  - LokiAI Flutter APK
  - Model file in internal storage
  - config.json in internal storage
  - Inference runtime (inside APK)
  - 100% offline after deployment
```

---

## Network Requirements

| Action | Network needed? | What network? |
|--------|----------------|---------------|
| Scan QR for APK download | Yes | Any internet (WiFi or mobile data) |
| Install APK | No | Offline (file already downloaded) |
| Pair device (scan QR from app) | Yes | Any internet to reach backend |
| Model deployment | Yes | Any internet (downloads from HuggingFace CDN) |
| Daily use / inference | No | Completely offline |
| Deploy a new model later | Yes | Any internet |

Phone and laptop do NOT need to be on the same WiFi. Backend is on Railway (public internet). Phone talks to backend over any internet connection.

This is different from the earlier QR concept where we assumed same-WiFi. Since the backend is on Railway (public URL), the phone just needs any internet to reach it. Much simpler.

---

## Constraints

- No Play Store — APK served by our backend
- No USB at any point
- No ADB at any point
- No developer options required
- No model storage on our servers — ever
- No cloud inference — 100% on device after deployment
- User describes task in plain English — AI picks models
- NVIDIA NIM API only for AI assistant (no Claude in backend)
- Phone runs independently after deployment — no ongoing backend dependency
