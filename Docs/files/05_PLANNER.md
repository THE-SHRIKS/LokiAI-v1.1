# EdgeMind / LokiAI — Task Planner v3

> Every task in order. What to build. How to verify. What blocks what.  
> No USB. No ADB. Wireless-only architecture.

---

## Rules for This Planner

1. Tasks are sequential. Task N+1 does not start until Task N is VERIFIED with real output.
2. Every task has a verification test. If test fails, task is not complete.
3. No mock data. No hardcoded responses. No simulated network. Everything real.
4. When a task completes, write the result to REPORT.md immediately with raw output.
5. When all tasks in a phase complete, the full phase is tested end-to-end before next phase.
6. The mobile app codebase is `S:\LokiAI\LokiAImobile UI` and nowhere else.
7. NVIDIA NIM API only for AI assistant. No Claude API in the backend.
8. Test on real Redmi Note 8 Pro. No emulator.

---

## Phase 1 — Backend Foundation

### Task 1.1 — Project Setup
**What:** FastAPI project with health endpoint. Connect to Railway PostgreSQL.
**Verification:** GET /health returns real timestamp. Database connection succeeds.
**Status:** ALREADY COMPLETE from previous build.

### Task 1.2 — Database Tables
**What:** Create all tables: users, pairing_tokens, devices, models, deployments.
**Note:** pairing_tokens is NEW (did not exist in v2). devices table no longer has adb_serial column.
**Verification:** Query information_schema.tables. All 5 tables exist.

### Task 1.3 — Auth Endpoints
**What:** POST /auth/register and POST /auth/login with bcrypt + JWT.
**Verification:** Register a user, login, get real JWT. Decode at jwt.io — shows real user_id.
**Status:** ALREADY COMPLETE. No changes needed.

### Task 1.4 — QR Pairing Token Generation
**What:** POST /pairing/generate — creates one-time token, returns QR data string. Token expires after 10 minutes. Requires JWT auth.
**Verification:** Call endpoint with valid JWT. Returns token + qr_data string. Call again — returns different token. Wait 11 minutes — old token rejected by /devices/pair.

### Task 1.5 — Device Self-Registration
**What:** POST /devices/pair — validates pairing token, accepts device specs from the phone app itself (not from ADB), creates device record, links to user, returns device_id + websocket_url. Marks token as used.
**Verification:**
1. Generate a pairing token via Task 1.4
2. Call POST /devices/pair with that token + real phone specs
3. Device appears in database with correct specs
4. Call POST /devices/pair with same token again → rejected (already used)
5. Call GET /devices with JWT → new device in list

### Task 1.6 — APK Serving
**What:** GET /install returns an HTML page with download button. GET /apk serves the actual APK file with correct MIME type.
**Verification:**
- curl -I /apk → 200, content-type: application/vnd.android.package-archive
- curl /install → 200, HTML with download link
- APK file size in response matches actual file on disk

### Task 1.7 — HuggingFace Model Search
**What:** POST /models/search — takes user message + device_id, searches HuggingFace API, filters by task + size + format, returns real results.
**Verification:** Call with "I want object detection" + device with 5636MB RAM. Returns real HuggingFace model IDs. Models actually exist on HuggingFace.
**Status:** ALREADY COMPLETE. May need minor updates for new device table structure.

### Task 1.8 — AI Assistant (NVIDIA NIM)
**What:** POST /assistant/chat — calls HuggingFace search, then NVIDIA NIM API (meta/llama-3.1-70b-instruct) with device context + search results. Returns natural language recommendation.
**Verification:** Call with "I want a chatbot" — returns real NIM-generated response mentioning real models and real device specs. Response is different for different questions.
**Status:** ALREADY COMPLETE.

### Task 1.9 — WebSocket Server
**What:** WS /ws/device/{device_id} — phone app connects after pairing. Backend can push deployment instructions. Phone can send progress updates and heartbeats.
**Verification:**
1. Start backend
2. Connect a WebSocket client to /ws/device/test-id
3. Send a message from server → client receives it
4. Send a message from client → server receives it
5. Disconnect → server detects disconnection
6. Reconnect → works again

### Task 1.10 — Wireless Deployment Endpoint
**What:** POST /deployments — creates deployment record, resolves HuggingFace CDN URL, sends deployment instruction to phone via WebSocket (model URL + config). Listens for phone's progress updates via WebSocket. Updates deployment status in database.
**Verification:**
1. Create a deployment with real device_id and real HuggingFace model
2. WebSocket message is sent to the device connection
3. Simulate phone sending back { status: "downloading", progress: 50 }
4. Simulate phone sending { status: "complete", progress: 100 }
5. GET /deployments/{id} shows status "complete"
6. Database record updated correctly

### Phase 1 End-to-End Test
1. Register a user
2. Login, get JWT
3. Generate pairing token
4. Pair a device (simulated phone specs)
5. Search models for that device
6. Get AI recommendation from NIM
7. Create a deployment
8. Verify WebSocket instruction was sent
9. Simulate phone completion
10. Verify deployment status is "complete"

All 10 steps must pass.

---

## Phase 2 — Android App Core

### Task 2.1 — Flutter Project Verification
**What:** Verify the existing LokiAI Mobile UI at `S:\LokiAI\LokiAImobile UI` builds and runs on the real Redmi Note 8 Pro.
**How:** flutter clean → flutter pub get → flutter run
**Verification:** App installs and opens on real phone without crashing. Existing UI renders correctly.

### Task 2.2 — QR Scanner Screen
**What:** Add a QR scanner screen as the first screen shown when app has no saved pairing data. Uses camera to scan QR code. Decodes JSON payload (backend_url, token, user_id).
**Verification:** Generate a QR code with test data. Open app. Scanner activates. Scan QR. App decodes and prints the extracted backend_url and token in logs.

### Task 2.3 — Self-Registration
**What:** After QR scan, app reads its own hardware specs using Flutter APIs and calls POST /devices/pair with the token + specs. Saves device_id and backend_url to SharedPreferences.
**Verification:**
1. Backend running
2. Generate a real pairing token
3. Create QR with that token
4. App scans QR → reads own specs → calls /devices/pair
5. Check database — device exists with real phone specs (Redmi Note 8 Pro, ARM64, 5636MB)
6. App shows "Connected" screen
7. Kill and reopen app — skips QR scanner (already paired)

### Task 2.4 — WebSocket Connection
**What:** After pairing, app connects WebSocket to backend. Stays connected while app is in foreground. Reconnects automatically if disconnected.
**Verification:**
1. App paired and running
2. Check backend logs — WebSocket connection from device_id exists
3. Kill app → backend detects disconnection
4. Reopen app → backend sees reconnection

### Task 2.5 — Model Downloader
**What:** When deployment instruction arrives via WebSocket, app downloads the model file directly from the HuggingFace CDN URL to internal app storage. Reports progress back via WebSocket.
**Verification:**
1. Backend sends a real deployment instruction with a real HuggingFace model URL
2. App starts downloading
3. Backend receives progress updates (10%... 50%... 100%)
4. Model file exists in app internal storage
5. File size matches expected size
6. SHA256 hash matches

### Task 2.6 — Config Receiver
**What:** App receives config.json as part of deployment instruction, saves to internal storage. On next app launch, reads config and routes to correct inference mode.
**Verification:**
1. Deploy a camera model → app receives config with inference_mode: "camera"
2. Force stop app and reopen → app reads config → shows camera mode
3. Deploy a chat model → app receives config with inference_mode: "chat"
4. Force stop and reopen → shows chat mode

### Phase 2 End-to-End Test
1. Fresh app launch (no previous pairing)
2. App shows QR scanner
3. Scan pairing QR generated from backend
4. App reads own specs, sends to backend
5. Device appears in dashboard
6. Send deployment instruction via WebSocket with real model URL
7. App downloads model from HuggingFace CDN
8. App saves model + config
9. App loads correct mode based on config
10. Kill app, reopen — skips pairing, loads model, shows correct mode

All 10 steps must pass on real Redmi Note 8 Pro.

---

## Phase 3 — Real Inference

### Task 3.1 — Camera Mode (TFLite)
**What:** When config says inference_mode: "camera", app opens camera and runs TFLite model on live frames. Labels shown on screen overlay. Labels change when pointing at different objects.
**Verification:**
1. Deploy a real TFLite classification model (e.g., MobileNetV2)
2. Open app → camera activates
3. Point at different objects → labels change
4. Works with zero internet (airplane mode)
5. logcat shows real inference output (class IDs, confidence scores)

### Task 3.2 — Chat Mode (GGUF)
**What:** When config says inference_mode: "chat", app loads GGUF model via fllama FFI. User types message, model generates unique response. Tokens stream to screen.
**Verification:**
1. Deploy a real small GGUF model (e.g., smollm2-135m-q4.gguf or tinyllama)
2. Open app → chat UI shows
3. Type "Hello, what can you do?" → get a real generated response
4. Type "What is the weather?" → get a DIFFERENT real response
5. Type "Tell me a joke" → get a THIRD different response
6. Turn off WiFi → type another message → still works
7. logcat shows fllama token generation output

### Task 3.3 — Voice Mode (TFLite Audio)
**What:** When config says inference_mode: "voice", app shows mic button. User speaks, audio processed by TFLite model, result shown.
**Verification:**
1. Deploy a real audio TFLite model (e.g., YAMNet for audio classification)
2. Open app → mic button visible
3. Tap mic → speak → result appears on screen
4. Different sounds → different classifications
5. Works offline

### Phase 3 End-to-End Test
1. Deploy camera model wirelessly → camera mode works with real labels
2. Deploy chat model wirelessly → chat generates unique responses
3. Deploy voice model wirelessly → voice classification works
4. All three work in airplane mode

---

## Phase 4 — Dashboard

### Task 4.1 — Next.js Project Setup
**What:** Create Next.js dashboard connected to real backend. Login page with real auth.
**Verification:** npm run dev → login with real credentials → JWT stored → redirect to fleet page.

### Task 4.2 — Fleet Page
**What:** Shows all paired devices with real specs from database. Real-time status updates.
**Verification:** Pair a real device → device appears in fleet with correct specs. No hardcoded data.

### Task 4.3 — QR Code Display
**What:** "Add Device" button calls POST /pairing/generate, displays QR code on screen. QR encodes the pairing data.
**Verification:** Click Add Device → QR appears → scan with phone → device pairs and appears in fleet.

### Task 4.4 — AI Chat Panel
**What:** Right-side AI assistant panel. Sends messages to POST /assistant/chat. Shows real NIM responses with model recommendations.
**Verification:** Type "I want object detection" → get real response with real models. Response mentions real device specs.

### Task 4.5 — Deploy from Dashboard
**What:** User picks a model → clicks Deploy → POST /deployments → shows real-time progress from phone's WebSocket updates.
**Verification:**
1. Click deploy on a model
2. Dashboard shows progress: downloading... 50%... 100%... complete
3. Phone has the model loaded
4. Phone shows correct inference mode

### Phase 4 End-to-End Test
1. Login to dashboard
2. Click Add Device → QR appears
3. Phone scans QR → pairs → appears in dashboard
4. Type in AI chat → get model recommendations
5. Click Deploy → phone downloads model → status updates in real time
6. Open app on phone → inference works
7. All real. No hardcoded data anywhere in dashboard.

---

## Phase 5 — Final System Test

The complete 12-step test on real hardware:

```
1. Fresh user signs up on dashboard
2. Clicks "Add Device" → QR code appears
3. Phone scans QR with default camera → browser opens → downloads APK
4. User installs APK on phone
5. Opens LokiAI app → shows QR scanner
6. Dashboard shows pairing QR → user scans from app
7. Phone reads own specs → sends to backend → device appears in dashboard
8. User types "I want real time object detection" in AI chat
9. AI responds with 3 real model recommendations
10. User picks one → clicks Deploy → phone downloads model wirelessly
11. User opens app → camera mode → points at objects → sees real labels
12. User turns on airplane mode → camera still works, labels still appear

All 12 steps must pass.
Step 12 is the proof that the product works.
```

---

## What Is NOT In This Planner

- USB / ADB anything — removed entirely
- Discovery agent (Go binary) — removed entirely
- Federated learning — future
- Custom model uploads — future (needs storage solution)
- Play Store listing — future (needs $25)
- iOS — future
- OTA app updates — future
- Analytics — future
