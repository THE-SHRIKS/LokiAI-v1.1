# LokiAI — Detailed System Architecture

This document provides a highly precise, file-by-file breakdown of the LokiAI ecosystem. LokiAI is a zero-USB, zero-ADB, Wi-Fi-only AI deployment system designed to push Large Language Models (LLMs) and Vision models directly to Android phones for 100% on-device local inference.

---

## 1. Backend (`LokiAI-backend/`)

The backend is built as a single, highly optimized monolithic FastAPI application. It orchestrates user authentication, mobile-to-desktop pairing, HuggingFace model resolution, and real-time WebSocket telemetry. It strictly acts as an orchestration layer—it **never** downloads or caches model weights on the server.

### `LokiAI-backend/main.py`
This is the heart of the system (~2,650 lines). It is organized into distinct phases:

*   **Database & Connection Pooling:** Uses `asyncpg` to connect to a PostgreSQL database (Neon). It defines the entire schema dynamically (users, email_otps, password_reset_tokens, pairing_tokens, devices, models, deployments).
*   **Security & Middleware:**
    *   `CORSMiddleware`: Handles cross-origin requests securely, utilizing a regex (`allow_origin_regex`) to allow `*.vercel.app` and localhost, while rejecting unauthorized origins.
    *   `SecurityHeadersMiddleware`: Enforces `X-Content-Type-Options`, `Content-Security-Policy`, and other OWASP best practices.
    *   `BodySizeLimitMiddleware`: Caps incoming requests at 10MB to prevent abuse, while specifically exempting the `/models/upload` route to allow large model telemetry.
    *   `MonitorMiddleware`: Tracks request latency, API hit counts, and error rates, exposing them at `/monitor/status`.
*   **Phase 1: Authentication (`/auth/*`)**
    *   Implements password hashing (bcrypt) and JWT generation.
    *   Uses a two-step email OTP verification flow (`/auth/register` -> `/auth/verify-otp`).
    *   Sends emails via a fire-and-forget `asyncio.create_task` wrapping the `send_email` SMTP coroutine.
*   **Phase 2: Pairing & WebSockets (`/ws/device/*`)**
    *   `/pairing/generate`: Generates a short-lived, cryptographically secure token and returns a base64 QR code image for the mobile app to scan.
    *   `device_websocket`: A dedicated WebSocket endpoint where the Android phone maintains a persistent connection. It tracks live metrics (download progress, active connection status) and writes them instantly to the PostgreSQL `devices` and `deployments` tables.
*   **Phase 3: AI Assistant (`/assistant/chat`)**
    *   Powered by NVIDIA NIM.
    *   Extracts intents from user queries (e.g., "Deploy fire detection").
    *   It contains advanced Regex parsing to detect explicit HuggingFace repository URLs in the chat, allowing users to bypass standard keyword filters.
    *   It aggressively filters models against the target device's hardware specs (RAM/Storage). It structurally rejects models lacking `.gguf` or `.tflite` formats, ensuring Android compatibility.

---

## 2. Frontend Dashboard (`LokiAI-Desktop/stellar-dashboard-builder-main/`)

The frontend is a production-grade enterprise dashboard built with React 19, TanStack Start (file-based routing), TailwindCSS v4, and shadcn/ui. 

### `src/styles.css`
The single source of truth for the LokiAI brand identity. It defines the design token system using native `oklch` CSS variables.
*   Core Tokens: `--olive`, `--olive-bright`, `--olive-glow`.
*   Defines custom CSS animations (`@keyframes slide`) to drive high-performance DOM-native interactive visuals without relying on external libraries like Framer Motion.

### `src/lib/lokiai-api.ts`
The core API client bridging the frontend to the FastAPI backend.
*   Manages the lifecycle of the JWT Access Token (stored strictly in memory to prevent XSS exfiltration).
*   Implements an interceptor-like `doFetch` wrapper that automatically handles 401 Unauthorized responses by exchanging an HTTPOnly cookie for a fresh access token via `/auth/refresh`.
*   Enforces `cache: "no-store"` on polling endpoints (like `getDevices()`) to prevent the browser from aggressively caching stale network states.

### `src/routes/` (TanStack File-Based Routing)
*   **`index.tsx`:** The primary workspace. It handles polling for connected devices and contains the core Chat UI state. Chat history is securely isolated in `localStorage` using a scoped key (`lokiai_chat_sessions_v1_{user_id}`) to prevent cross-account data leakage on shared machines.
*   **`account.tsx`:** The account management portal where users input their NVIDIA NIM API keys and manage paired hardware.
*   **`feedback.tsx`:** Submits user telemetry and bug reports back to the backend.

### `src/components/`
*   **`landing/LandingPage.tsx`:** A highly sophisticated SaaS landing page. It avoids static images entirely, instead utilizing native CSS gradients, Lucide SVG icons, and complex Tailwind animations to render glowing neural networks, mobile phone nodes, and data streams natively in the DOM. Includes a Bento Box capabilities grid and expandable FAQ.
*   **`workspace/Sidebar.tsx`:** The global navigation shell.
*   **`workspace/ChatPanel.tsx`:** Renders the AI conversation. It parses backend metadata to conditionally render actionable "Deploy Model" UI cards directly within the chat stream.

---

## 3. Mobile Client (`LokiAImobile UI/`)

The mobile tier is built with Flutter and is strictly designed for **offline inference execution**. 

*   **Connectivity Engine:** Scans the QR code generated by the dashboard and initiates a WebSocket connection to the backend. It reports its hardware specs (RAM, OS version, Free Storage).
*   **Download Manager:** Once a deployment is triggered from the dashboard, the backend orchestrates a direct CDN link. The mobile app pulls gigabyte-scale model weights over the local Wi-Fi layer without requiring ADB or USB cables.
*   **ML Runtime (`lib/ml/`):** 
    *   Integrates `llama.cpp` (via `fllama` or similar bindings) to execute quantized `.gguf` language models entirely locally.
    *   Integrates `tflite_flutter` to execute `.tflite` vision and audio models natively on the device's CPU/NPU.
    *   *Hard Constraint:* It never reaches out to cloud APIs for inference processing.

---

## 4. AI Agent Architecture & Model Resolution Pipeline

The intelligence layer of LokiAI (`/assistant/chat`) is not a simple passthrough to an LLM. It operates as a multi-stage, autonomous agent pipeline that verifies hardware constraints and repository integrity in real-time.

### Stage 1: Intent Extraction & Regex Fast-Paths
When a user submits a query (e.g., "Deploy fire detection" or pasting a direct HuggingFace URL), the backend executes a primary analysis step using the user's provided NVIDIA NIM API key. 
*   **Regex Interception:** If the query contains a HuggingFace slug (e.g., `prithivMLmods/Fire-Detection-Siglip2`), a regex (`r"([a-zA-Z0-9_-]+/[a-zA-Z0-9_.-]+)"`) extracts it immediately, bypassing generic keyword generation and forcing an `explicit_model` resolution path.
*   **Keyword Generation:** For natural language requests, the LLM is prompted to extract optimized `search_keywords` and categorize the `task_type` (e.g., `object-detection`, `text-generation`).

### Stage 2: HuggingFace API Proxy & Deep Search
The backend orchestrates asynchronous network requests to the HuggingFace API based on the extracted intent:
*   **Direct Lookup:** If `explicit_model` is present, it directly fetches the repository metadata via `https://huggingface.co/api/models/{slug}?full=True`.
*   **Fuzzy Search:** If keywords are generated, it queries the Hub with sorting heuristics (`sort=downloads`, `direction=-1`) to retrieve the top candidate models.

### Stage 3: Deep File Inspection & Hardware Validation
This is the most critical constraint layer. An edge device cannot run a raw PyTorch `.bin` or `.safetensors` file. LokiAI performs a "deep file inspection" on the HuggingFace tree structure:
1.  **Format Verification:** It scans the repository files specifically for `.tflite` (for Vision/Audio) and `.gguf` (for LLMs).
2.  **RAM Profiling:** It calculates the total file size of the target weights. It then queries the PostgreSQL `devices` table to retrieve the exact `ram_mb` of the target phone. 
3.  **Constraint Enforcement:** If the model size exceeds the available RAM (with a safety buffer), or if the required edge formats are completely missing, the model is flagged. *Crucially, these models are not silently dropped.* They are passed to the next stage tagged with specific `error_msg` data.

### Stage 4: Synthesis & UI Generation
The backend executes a final prompt to the NVIDIA NIM LLM, providing it with the validated model data and hardware errors. 
*   The AI synthesizes a highly contextual response (e.g., "I found `prithivMLmods/Fire-Detection-Siglip2`, but it cannot be deployed because it lacks a TFLite file format.").
*   If a model is perfectly compatible, the AI outputs a specialized markup string: `[DEPLOY_BUTTON: repository/slug]`.
*   **Frontend Interception:** In `ChatPanel.tsx`, the frontend intercepts this exact markup using regex and replaces it in the DOM with a fully interactive, native React Component allowing 1-click wireless deployment.

---

## 5. Architecture Data Flow Example (Deployment)

1. **User Intent:** The user types "I need a fire detection model" in `index.tsx`.
2. **AI Resolution:** The frontend sends this to `/assistant/chat`. The backend queries NVIDIA NIM, fetches the HuggingFace Hub API, cross-references `.tflite` files against the phone's 6GB RAM spec, and returns a verified model.
3. **UI Generation:** `ChatPanel.tsx` renders a "Deploy" button.
4. **Trigger:** User clicks Deploy. The backend inserts a `deployment` record and sends a WebSocket trigger to the phone.
5. **Execution:** The Flutter app receives the WSS message, begins downloading the model from the CDN, and sends real-time `progress_percent` back up the WSS socket.
6. **Completion:** The phone finishes the download, loads it into `tflite_flutter`, and begins running offline inferences at 30+ FPS.
