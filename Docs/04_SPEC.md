# EdgeMind / LokiAI — Production Spec v3

> Every endpoint, every schema, every component behavior. No ambiguity.

---

## Backend API Endpoints

### Auth
```
POST /auth/register
  body: { email: string, password: string }
  returns: { user_id: uuid }

POST /auth/login
  body: { email: string, password: string }
  returns: { access_token: string, token_type: "bearer" }
```

### QR and Pairing
```
POST /pairing/generate
  headers: Authorization: Bearer <jwt>
  body: {}
  returns: {
    token: string,          // one-time pairing token, valid 10 minutes
    qr_data: string,        // JSON string to encode in QR
    expires_at: datetime
  }

  qr_data format:
  {
    "backend_url": "https://your-railway-url.up.railway.app",
    "token": "abc123-one-time-token",
    "user_id": "uuid"
  }

POST /devices/pair
  body: {
    token: string,             // one-time pairing token from QR
    phone_model: string,       // "Redmi Note 8 Pro"
    cpu_arch: string,          // "arm64-v8a"
    ram_mb: integer,           // 5636
    storage_free_gb: float,    // 78.18
    android_version: string    // "11"
  }
  returns: {
    device_id: uuid,
    websocket_url: string      // "wss://your-url/ws/device/{device_id}"
  }
  errors:
    400: "Invalid or expired pairing token"
    409: "Device already paired" (based on phone_model + cpu_arch + ram_mb combo)
```

### APK Distribution
```
GET /install
  returns: HTML page with LokiAI branding and download button
  content-type: text/html

GET /apk
  returns: the APK file
  content-type: application/vnd.android.package-archive
  content-disposition: attachment; filename="lokiai.apk"
```

### Devices
```
GET /devices
  headers: Authorization: Bearer <jwt>
  returns: [ list of user's paired devices with specs and status ]

GET /devices/{id}
  headers: Authorization: Bearer <jwt>
  returns: {
    id, phone_model, cpu_arch, ram_mb, storage_free_gb,
    android_version, status, last_seen, current_deployment
  }
```

### Model Search
```
POST /models/search
  headers: Authorization: Bearer <jwt>
  body: {
    device_id: uuid,
    user_message: string      // "I want to detect objects with my camera"
  }
  returns: {
    recommendations: [
      {
        hf_model_id: string,    // "google/mobilenet_v2_1.0_224"
        name: string,           // "MobileNetV4"
        size_mb: float,         // 45.0
        format: string,         // "tflite"
        task: string,           // "object-detection"
        download_url: string,   // direct HuggingFace CDN URL
        estimated_fps: integer  // 15 (calculated from device specs)
      }
    ]
  }
```

### AI Assistant
```
POST /assistant/chat
  headers: Authorization: Bearer <jwt>
  body: {
    message: string,
    device_id: uuid,
    conversation_history: [ { role: "user"|"assistant", content: string } ]
  }
  returns: {
    response: string,           // AI's natural language response
    action: null | "search_models" | "deploy",
    search_results: [ ... ]     // model recommendations if action is search_models
  }

  AI backend: NVIDIA NIM API
  Model: meta/llama-3.1-70b-instruct
  Endpoint: https://integrate.api.nvidia.com/v1/chat/completions
```

### Deployments
```
POST /deployments
  headers: Authorization: Bearer <jwt>
  body: {
    device_id: uuid,
    hf_model_id: string,       // "google/mobilenet_v2_1.0_224"
    model_filename: string,    // "model.tflite"
    config: {
      inference_mode: "camera" | "chat" | "voice",
      confidence_threshold: float  // default 0.75
    }
  }
  returns: { deployment_id: uuid, status: "queued" }

  What happens after POST:
  1. Backend resolves HuggingFace CDN URL for the model file
  2. Backend sends WebSocket message to the phone app with download URL + config
  3. Phone downloads model directly from HuggingFace CDN
  4. Phone saves model + config to internal storage
  5. Phone reports completion via WebSocket
  6. Backend updates deployment status to "complete"

GET /deployments/{id}
  returns: { deployment_id, status, progress_percent, error_message }
  status values: queued | downloading | complete | failed

POST /deployments/{id}/rollback
  returns: { status: "rolling_back" }
```

### WebSocket
```
WS /ws/device/{device_id}

Connection: phone app connects after pairing, stays connected while app is open

Server → Phone messages:
{
  "action": "deploy",
  "deployment_id": "uuid",
  "model_url": "https://huggingface.co/.../resolve/main/model.tflite",
  "model_name": "model.tflite",
  "model_sha256": "hash-string",
  "config": {
    "inference_mode": "camera",
    "confidence_threshold": 0.75
  }
}

Phone → Server messages:
{
  "deployment_id": "uuid",
  "status": "downloading" | "complete" | "failed",
  "progress_percent": 0-100,
  "error_message": null | "string"
}

{
  "type": "heartbeat",
  "device_id": "uuid",
  "timestamp": "iso-datetime"
}
```

---

## Database Schema (PostgreSQL — Railway)

```sql
CREATE TABLE users (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email           TEXT UNIQUE NOT NULL,
  password_hash   TEXT NOT NULL,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE pairing_tokens (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID REFERENCES users(id) NOT NULL,
  token           TEXT UNIQUE NOT NULL,
  used            BOOLEAN DEFAULT FALSE,
  expires_at      TIMESTAMPTZ NOT NULL,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE devices (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID REFERENCES users(id) NOT NULL,
  phone_model     TEXT,
  cpu_arch        TEXT,
  ram_mb          INTEGER,
  storage_free_gb FLOAT,
  android_version TEXT,
  status          TEXT DEFAULT 'paired',    -- paired | connected | offline
  last_seen       TIMESTAMPTZ,
  paired_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE models (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID REFERENCES users(id) NOT NULL,
  name            TEXT NOT NULL,
  hf_model_id     TEXT,
  format          TEXT NOT NULL,            -- tflite | gguf | onnx
  size_mb         FLOAT,
  task_type       TEXT,
  download_url    TEXT,                     -- HuggingFace CDN URL
  sha256          TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE deployments (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID REFERENCES users(id) NOT NULL,
  device_id       UUID REFERENCES devices(id),
  model_id        UUID REFERENCES models(id),
  status          TEXT DEFAULT 'queued',    -- queued | downloading | complete | failed
  progress        INTEGER DEFAULT 0,
  config          JSONB,
  deployed_at     TIMESTAMPTZ DEFAULT NOW(),
  completed_at    TIMESTAMPTZ,
  error_message   TEXT
);
```

---

## Android App Spec (Flutter)

### Package
- Package name: `io.lokiai.lokiai_app`
- Min SDK: 24 (Android 7.0)
- Target SDK: 34
- Codebase: `S:\LokiAI\LokiAImobile UI`

### First Launch Flow
```
1. Check if device is already paired:
   - Read shared_preferences for "device_id" and "backend_url"
   - If both exist: skip to step 5
   - If not: show pairing screen

2. Pairing screen:
   - Camera viewfinder active
   - Text: "Scan QR code from your dashboard"
   - On scan: decode QR JSON → extract backend_url + token

3. Self-registration:
   - Read hardware specs via Flutter APIs
   - POST /devices/pair with token + specs
   - Save device_id and backend_url to shared_preferences

4. Connect WebSocket:
   - Connect to wss://{backend_url}/ws/device/{device_id}
   - Stay connected while app is in foreground

5. Check for deployed model:
   - Look for config.json in app internal storage
   - If exists: load model, show correct mode
   - If not: show "Waiting for deployment" screen
```

### Hardware Spec Reading (Flutter APIs)
```dart
// Phone model
String model = (await DeviceInfoPlugin().androidInfo).model;

// CPU architecture
String arch = (await DeviceInfoPlugin().androidInfo).supportedAbis.first;

// RAM
int totalRam = (await SysInfo().getTotalPhysicalMemory()) ~/ (1024 * 1024);

// Storage
final stat = await StatFs(getExternalStorageDirectory().path);
double freeGb = stat.availableBytes / (1024 * 1024 * 1024);

// Android version
String version = (await DeviceInfoPlugin().androidInfo).version.release;
```

### Model Download (in app)
```dart
Future<void> downloadModel(String url, String filename) async {
  final dir = await getApplicationDocumentsDirectory();
  final file = File('${dir.path}/models/$filename');

  final client = HttpClient();
  final request = await client.getUrl(Uri.parse(url));
  final response = await request.close();

  final totalBytes = response.contentLength;
  int receivedBytes = 0;

  final sink = file.openWrite();
  await for (final chunk in response) {
    sink.add(chunk);
    receivedBytes += chunk.length;
    // Report progress via WebSocket
    sendProgress((receivedBytes / totalBytes * 100).round());
  }
  await sink.close();

  // Verify SHA256
  final hash = sha256.convert(await file.readAsBytes()).toString();
  if (hash != expectedHash) {
    throw Exception("Hash mismatch");
  }
}
```

### Config JSON Format
```json
{
  "model_name": "mobilenetv4.tflite",
  "model_path": "/data/data/io.lokiai.lokiai_app/models/mobilenetv4.tflite",
  "inference_mode": "camera",
  "format": "tflite",
  "confidence_threshold": 0.75,
  "deployed_at": "2026-07-05T10:00:00Z",
  "deployment_id": "uuid-here"
}
```

### Inference Modes

**Camera Mode (TFLite):**
- Open camera via `camera` plugin
- Run model on each frame via `tflite_flutter`
- Render labels with confidence on camera overlay
- Labels must change when pointing at different objects
- No hardcoded labels

**Chat Mode (GGUF):**
- Show chat UI (existing LokiAI design)
- Load model via `fllama` (llama.cpp FFI)
- User types → model generates response token by token
- Stream tokens to screen via ValueListenableBuilder
- Every response must be uniquely generated, not hardcoded

**Voice Mode (TFLite Audio):**
- Show mic button
- Record audio via `record` plugin
- Process audio buffer through TFLite audio model
- Show classification or transcription result
- No hardcoded results

### WebSocket Handler (in app)
```dart
void connectWebSocket(String deviceId, String backendUrl) {
  final channel = WebSocketChannel.connect(
    Uri.parse('wss://$backendUrl/ws/device/$deviceId')
  );

  channel.stream.listen((message) {
    final data = jsonDecode(message);

    if (data['action'] == 'deploy') {
      downloadModel(data['model_url'], data['model_name']);
      saveConfig(data['config']);
    }
  });
}
```

---

## HuggingFace Search Logic

```python
async def search_models(user_message: str, device_ram_mb: int):
    # 1. Classify task from user message
    task_keywords = {
        "detect": "object-detection",
        "camera": "object-detection",
        "chat": "text-generation",
        "talk": "text-generation",
        "voice": "automatic-speech-recognition",
        "transcribe": "automatic-speech-recognition",
        "classify": "image-classification",
        "recognize": "image-classification",
        "audio": "audio-classification"
    }

    task = match_task(user_message, task_keywords)

    # 2. Calculate max model size
    max_size_mb = device_ram_mb * 0.4

    # 3. Search HuggingFace
    results = await hf_api.search(
        task=task,
        format=["tflite", "gguf", "onnx"],
        sort="downloads",
        limit=10
    )

    # 4. Filter by size
    fitting = [m for m in results if m.size_mb <= max_size_mb]

    # 5. Send to NVIDIA NIM for ranking and explanation
    response = await nim_api.chat(
        model="meta/llama-3.1-70b-instruct",
        system=f"Device: {device_specs}. Models: {fitting}. Pick top 3.",
        user=user_message
    )

    return response
```

---

## Error Handling

| Error | What happens |
|-------|-------------|
| QR code expired | App shows: "This code has expired. Generate a new one from the dashboard." |
| Pairing token already used | App shows: "This code was already used. Generate a new one." |
| Device already paired | Backend returns existing device_id, app continues normally |
| WebSocket disconnects | App reconnects automatically every 5 seconds, up to 30 attempts |
| Model download fails | App retries 3 times. If all fail: shows error, sends failure to backend |
| Model hash mismatch | App deletes corrupt file, reports failure, asks for re-deploy |
| Model too large for storage | App checks before downloading, shows: "Not enough storage. Free up X MB." |
| Model fails to load | App shows: "This model couldn't load. Try a different one from the dashboard." |
| No config.json on launch | App shows: "No model deployed yet. Open the dashboard to deploy one." |
