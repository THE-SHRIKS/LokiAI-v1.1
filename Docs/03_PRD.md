# EdgeMind / LokiAI — Product Requirements Document v3

> What the product must do. What success looks like. What is out of scope.

---

## Product Goals

### G1 — Zero-cable device setup
A user must be able to go from zero to having an AI model running on their phone without ever plugging in a cable. QR code scan is the only physical action. Target: under 5 minutes from first QR scan to model running.

### G2 — Zero cloud inference
After deployment, the model runs 100% on the phone. No internet needed. No API calls. No cloud dependency. If our backend goes down, the user's phone keeps working.

### G3 — Zero model storage cost
Our backend never stores or proxies model files. The phone downloads directly from HuggingFace CDN. Our cost scales with API calls and database rows, not with model file sizes.

### G4 — Any model, any task
The user describes what they want in plain English. The AI finds matching models from HuggingFace. The user does not need to know about model formats, quantization, or architectures. Use cases are infinite — we do not pre-select or curate.

### G5 — Non-technical users first
A person who has never heard the word "TFLite" must be able to complete the entire flow without help. If any step requires technical knowledge, the product has failed at that step.

---

## User Stories

### Device Setup

**US-001:** As a user, I want to add my phone to LokiAI by scanning a QR code, so that I don't need to plug in any cables or change any phone settings.

**US-002:** As a user, I want the app to read my phone's specs automatically, so that I don't have to look up my RAM or CPU type.

**US-003:** As a user, I want to see my phone appear in the dashboard within 30 seconds of scanning the QR code, with all its specs shown correctly.

### Model Selection

**US-004:** As a user, I want to describe what I need in plain English (like "detect objects with camera") and have the AI recommend models that actually fit my phone.

**US-005:** As a user, I want to see the model size and estimated performance before deploying, so I can make an informed choice.

**US-006:** As a user, I want to pick from multiple options ranked by fit, not be forced into one choice.

### Deployment

**US-007:** As a user, I want the model to download directly to my phone after I click deploy, without me doing anything on the phone.

**US-008:** As a user, I want to see real-time download progress on the dashboard.

**US-009:** As a user, I want the deployment to handle errors gracefully — retry if download fails, tell me clearly if something goes wrong.

### Daily Use

**US-010:** As a user, I want to open the app and have it immediately ready — camera, chat, or voice — based on what model is deployed.

**US-011:** As a user, I want the app to work with zero internet. Airplane mode, no WiFi, no data — it must still work.

**US-012:** As a user, I want the app to automatically reload the model after a phone restart, without me doing anything.

### Model Switching

**US-013:** As a user, I want to deploy a different model to my phone at any time from the dashboard, replacing the current one.

**US-014:** As a user, I want to switch between camera, chat, and voice models by just deploying a different model — the app adapts automatically.

---

## Functional Requirements

### QR Pairing System

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-QR01 | Dashboard generates unique QR code containing backend URL + one-time pairing token | Must have |
| FR-QR02 | QR code expires after 10 minutes or single use (whichever comes first) | Must have |
| FR-QR03 | App decodes QR code and extracts backend URL + token | Must have |
| FR-QR04 | App reads own hardware specs via Flutter platform APIs | Must have |
| FR-QR05 | App sends specs + token to POST /devices/pair | Must have |
| FR-QR06 | Backend validates token, creates device, links to user account | Must have |
| FR-QR07 | Device appears in dashboard within 5 seconds of pairing | Must have |
| FR-QR08 | Manual code entry as fallback if QR scan fails | Should have |

### APK Distribution

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-APK01 | Backend serves APK at GET /apk with correct MIME type | Must have |
| FR-APK02 | Backend serves mobile-friendly install page at GET /install | Must have |
| FR-APK03 | Install page works on all Android browsers (Chrome, Samsung, Firefox) | Must have |
| FR-APK04 | APK size under 50MB (ideally under 30MB) | Should have |

### Model Search and AI Assistant

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-AI01 | POST /assistant/chat accepts plain English and returns model recommendations | Must have |
| FR-AI02 | Search filters by task type, format, and max model size based on device RAM | Must have |
| FR-AI03 | Returns top 3 recommendations with name, size, format, estimated performance | Must have |
| FR-AI04 | Uses NVIDIA NIM API (meta/llama-3.1-70b-instruct) for response generation | Must have |
| FR-AI05 | Response includes real HuggingFace model IDs that actually exist | Must have |

### Wireless Deployment

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-DEP01 | POST /deployments sends deployment instruction to phone via WebSocket | Must have |
| FR-DEP02 | Instruction contains HuggingFace CDN direct download URL | Must have |
| FR-DEP03 | Phone app downloads model directly from HuggingFace CDN (not through backend) | Must have |
| FR-DEP04 | Phone app reports download progress back to backend via WebSocket | Must have |
| FR-DEP05 | Phone app saves model + config.json to internal storage after download | Must have |
| FR-DEP06 | Deployment status tracks: queued → downloading → complete | Must have |
| FR-DEP07 | If download fails, phone retries 3 times before reporting failure | Must have |
| FR-DEP08 | Dashboard shows real-time deployment progress | Must have |

### Offline Inference

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-INF01 | App reads config.json on launch and shows correct mode (camera/chat/voice) | Must have |
| FR-INF02 | Camera mode: TFLite model runs on live camera frames, labels shown on screen | Must have |
| FR-INF03 | Chat mode: GGUF model generates real text responses via fllama FFI | Must have |
| FR-INF04 | Voice mode: TFLite audio model processes mic input, result shown | Must have |
| FR-INF05 | All inference modes work with zero internet (airplane mode) | Must have |
| FR-INF06 | Model auto-loads on app start (including after phone restart) | Must have |
| FR-INF07 | No hardcoded responses anywhere in the app — all output from real inference | Must have |

---

## Non-Functional Requirements

### Performance

| Requirement | Target |
|-------------|--------|
| Time from first QR scan to app installed | < 2 minutes |
| Time from pairing QR scan to device in dashboard | < 30 seconds |
| Model deployment time (45MB model over WiFi) | < 3 minutes |
| Camera inference latency | < 100ms per frame |
| Chat first-token latency | < 3 seconds |
| App launch to inference ready | < 5 seconds |

### Reliability

| Requirement | Target |
|-------------|--------|
| QR pairing success rate | > 95% |
| Model download completion rate | > 90% (with retries) |
| App crash rate during inference | < 1% |
| Offline availability after deployment | 100% |

### Security

| Requirement | Spec |
|-------------|------|
| Pairing tokens | One-time use, expire after 10 minutes |
| Auth | JWT with expiry, password hashed with bcrypt |
| WebSocket | Authenticated with device token |
| Model integrity | SHA-256 hash verified after download |

---

## Non-Goals (v3)

| Not building | Why |
|-------------|-----|
| Play Store listing | No money for $25 fee right now |
| iOS support | Android first, iOS later |
| Model training | Users bring models from HuggingFace |
| Federated learning | Future feature, not Phase 1 |
| Multiple simultaneous models on one phone | One model per phone for now |
| Real-time video streaming to dashboard | Footage stays on device — privacy |
| User-uploaded custom models | Future feature (needs R2 storage) |
| OTA app updates | Manual re-deploy APK for now |
| Analytics dashboard | Future feature |

---

## Success Metrics

| Metric | Target |
|--------|--------|
| Time from first visit to model running on phone | < 5 minutes |
| Users who complete full flow without help | > 70% |
| Model deployment success rate | > 90% |
| App works in airplane mode after deployment | 100% |
| Backend monthly cost | < $5 (Railway free tier) |
| Model storage cost | $0 (HuggingFace CDN) |
