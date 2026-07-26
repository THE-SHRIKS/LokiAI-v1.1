# EdgeMind / LokiAI — User Journey v3

> The complete user experience from first visit to daily offline AI use.  
> Zero cables. Zero developer options. Zero technical knowledge required.

---

## Journey Overview

```
FIRST TIME:
  Open dashboard → Scan QR → Install app → Scan pairing QR → Done (5 minutes)

EVERY DEPLOYMENT:
  Open dashboard → Tell AI what you want → Pick model → Phone downloads it (3 minutes)

EVERY DAY:
  Open app → Use AI offline → Forever
```

---

## Step 1: User Visits Dashboard

User opens the LokiAI dashboard in their browser. Any browser, any laptop, any OS. Nothing to install on the laptop.

Signs up with email and password. Logs in.

Dashboard shows an empty fleet view: "No devices connected yet."

Big green button: **"Add Device"**

**What user feels:** Clean, simple. One obvious next step.

---

## Step 2: First QR Code — Get the App

User clicks "Add Device."

Dashboard shows a QR code on screen with text: "Scan this with your phone to get the LokiAI app."

User picks up their Android phone. Opens the default camera app. Points it at the QR code on the laptop screen.

Phone shows a notification: "Open link?" User taps it.

Phone browser opens a simple page with the LokiAI logo and one button: **"Download LokiAI"**

User taps the button. APK downloads (takes 10-30 seconds depending on connection).

Download notification appears. User taps the downloaded file.

Android asks: "Install this app? You'll need to allow installation from this source." User taps "Settings" → enables "Allow from this source" → taps "Install."

App installs in 5 seconds. User taps "Open."

**What user feels:** This felt like downloading any app. Nothing weird or technical.

**Total time for this step:** About 2 minutes.

**This step happens once. Never again.**

---

## Step 3: Second QR Code — Pair the Device

LokiAI app opens on the phone for the first time.

App shows a clean screen: "Scan QR code to connect to your dashboard."

A camera viewfinder is active inside the app, ready to scan.

Back on the laptop, the dashboard has automatically moved to the next screen. It shows a second QR code with text: "Now open the LokiAI app on your phone and scan this code."

User points their phone (with LokiAI app open) at the laptop screen. App scans the QR code.

Behind the scenes (user sees none of this):
- QR code contains the backend URL + a one-time pairing token + user ID
- App decodes it
- App reads its own hardware specs:
  - Phone model: "Redmi Note 8 Pro"
  - CPU: arm64-v8a
  - RAM: 5636 MB
  - Storage: 78 GB free
  - Android version: 11
- App sends all this to the backend: POST /devices/pair
- Backend creates the device record and links it to the user's account
- Backend responds with device_id
- App connects a WebSocket to the backend for future deployment instructions

What the user sees: App shows "Connected! Your device is paired." with a green checkmark.

What the dashboard shows: The phone appears in the fleet view with all its real specs:
```
Redmi Note 8 Pro
ARM64 · 5.5 GB RAM · 78 GB storage · Android 11
Status: Connected
```

**What user feels:** That was easy. My phone just appeared on my laptop screen.

**Total time for this step:** About 30 seconds.

**This step happens once per device. Never again for this phone.**

---

## Step 4: Tell the AI What You Want

The AI assistant panel is open on the right side of the dashboard.

AI says: "I see your Redmi Note 8 Pro — 5.5GB RAM, ARM64. What do you want it to do?"

User types in plain English. Anything they want:
- "I want to detect objects with my camera"
- "I want a chatbot that works offline"
- "I want to identify sounds around me"
- "I want to classify images"
- "I want to transcribe speech to text"

AI reads the message. Understands the task. Checks the device specs.

Backend calls HuggingFace API:
- Searches for models matching the task type
- Filters to formats the phone supports (tflite, gguf, onnx)
- Filters out models too large for the phone's RAM (max size = RAM × 0.4)
- Sorts by popularity and quality

Backend calls NVIDIA NIM API with device specs + search results. AI generates a natural response:

"For real-time object detection on your Redmi Note 8 Pro, here are 3 models that fit your 5.5GB RAM:

1. **MobileNetV4** — 45MB, estimated 15-20fps, detects 1000 object types
2. **YOLOv8n-TFLite** — 27MB, faster but less accurate
3. **EfficientDet-Lite0** — 55MB, most accurate of the three

MobileNetV4 is the best balance of speed and accuracy for your hardware. Which one?"

**What user feels:** The AI understood what I want and gave me real options that fit my phone. I didn't have to know anything about model formats or RAM requirements.

---

## Step 5: Pick a Model and Deploy

User says "go with MobileNetV4" or clicks the model card.

Dashboard shows: "Deploying MobileNetV4 to your Redmi Note 8 Pro..."

Behind the scenes:
1. Backend creates a deployment record (status: "queued")
2. Backend resolves the HuggingFace CDN URL for the model file
3. Backend sends a WebSocket message to the phone app:
   ```json
   {
     "action": "deploy",
     "model_url": "https://huggingface.co/.../mobilenetv4.tflite",
     "model_name": "mobilenetv4.tflite",
     "config": {
       "inference_mode": "camera",
       "confidence_threshold": 0.75
     }
   }
   ```
4. Phone app receives the instruction
5. Phone app starts downloading the model directly from HuggingFace CDN
6. Progress updates sent back via WebSocket: 10%... 40%... 80%... 100%
7. Phone saves model to internal storage
8. Phone saves config.json to internal storage
9. Phone sends confirmation: { status: "complete" }
10. Backend updates deployment record
11. Dashboard shows: "Done. MobileNetV4 is running on your phone."

Dashboard shows deployment progress in real time:
```
Downloading model...    ████████████████████ 100%
Saving to device...     Done
Loading model...        Done

✓ MobileNetV4 is ready on your Redmi Note 8 Pro.
  Open the LokiAI app to start using it.
```

**What user feels:** It downloaded right to my phone. I didn't do anything.

**Total time:** 1-3 minutes depending on model size and internet speed.

**Important:** The model file went from HuggingFace's servers directly to the phone. Our backend never touched it. Zero storage cost on our side.

---

## Step 6: Use the App — Fully Offline

User opens LokiAI app on their phone.

App reads config.json from internal storage. Knows what model is deployed and what mode to show.

### If Camera Mode (object detection / image classification):

App opens the camera. User sees their camera feed with real-time labels overlaid on the screen.

Point at a cup → "Cup (87%)"
Point at a person → "Person (94%)"
Point at a car → "Car (91%)"

Labels update in real time as the camera moves. No internet. No cloud call. No latency beyond the model's inference time (~50ms per frame).

### If Chat Mode (text generation):

App shows a chat interface. User types a message:
"What is machine learning?"

Model generates a response locally, token by token, streaming to screen:
"Machine learning is a subset of artificial intelligence that enables computers to learn from data without being explicitly programmed..."

Every response is different. Every response is generated by the model running on the phone's CPU. No internet. No API call.

### If Voice Mode (audio classification):

App shows a microphone button. User taps and speaks.

Model processes the audio and shows the result:
"Detected: Speech (92%)" or a transcription of what was said.

No internet. No cloud processing.

**What user feels:** This is running on my phone. No cloud. It works even in airplane mode.

---

## Step 7: Deploy a Different Model

User wants to switch from camera detection to a chatbot.

They open the dashboard on their laptop. Their phone still shows as connected (WebSocket is alive when app is open and phone has internet).

User tells the AI: "I want an offline chatbot now."

AI recommends chat models. User picks one.

Same deployment flow: backend sends URL to phone via WebSocket, phone downloads the GGUF model from HuggingFace CDN, saves it, updates config.

User opens the app — chat mode is now active.

Old model is replaced. New model is running.

**What user feels:** Swapping models is as easy as asking for a different one.

---

## Step 8: What Happens When Phone Has No Internet

After deployment, the phone is fully independent.

- WiFi off → app works
- Mobile data off → app works
- Airplane mode → app works
- Phone restarted → app works (auto-loads model on launch)
- Backend server goes down → app works (model is local)
- HuggingFace goes down → app works (model is already downloaded)
- User's laptop is off → app works
- User is in a field with no signal → app works

The only time internet is needed: deploying a NEW model. Everything else is local.

---

## Edge Cases and Error Handling

### QR code won't scan
App shows: "Can't read the QR code? Enter this code manually: XXXX-XXXX"
Dashboard shows a text code the user can type into the app.

### Model download fails mid-way
App retries automatically 3 times. If all retries fail: "Download failed. Check your internet connection and try again." User taps retry in the app, or triggers re-deploy from dashboard.

### Model too large for phone
AI warns the user before deployment: "This model needs 3GB RAM but your phone has 5.5GB. It will use about 55% of your RAM. Proceed?" User confirms or picks a smaller model.

### Phone disconnects during deployment
Deployment status stays "downloading" in the database. When phone reconnects (app opens with internet), it resumes the download from where it left off (if supported by CDN) or restarts.

### App crashes on model load
App catches the error, shows: "This model couldn't load on your device. It may be incompatible. Try a different model from the dashboard."

### Multiple devices
User can pair multiple phones. Each shows in the dashboard fleet view. Each can have a different model deployed. Each operates independently.

---

## Emotional Journey Map

| Moment | Emotion | Design response |
|--------|---------|-----------------|
| First visit to dashboard | Curious but skeptical | Clean UI, one obvious button |
| Scanning first QR | Slightly anxious ("is this legit?") | Familiar pattern (like WhatsApp Web) |
| APK install warning | Nervous ("unknown source") | Clear text explaining why |
| Phone appears in dashboard | Surprised delight | Instant, no waiting |
| AI recommends models | Relief ("I don't have to choose blindly") | Plain English, real specs |
| Model deploys wirelessly | Impressed | Progress bar, real-time updates |
| First camera detection works | Excitement | Immediate visual feedback |
| Works in airplane mode | Trust established | No loading spinner, instant response |
