# LokiAI Mobile

The Android app that pairs with the [LokiAI dashboard](../LokiAI-Desktop/stellar-dashboard-builder-main), self-registers its own hardware specs, downloads models straight from the Hugging Face CDN, and runs them fully offline. Built with Flutter.

No ADB. No developer options. Installed via QR-code-triggered APK download.

## Setup

```bash
flutter pub get
flutter run          # a real device is strongly recommended over an emulator
```

The app uses a vendored copy of `fllama` (`packages/fllama`) with a proguard fix for modern Android Gradle Plugin — see the `dependency_overrides` note in [`pubspec.yaml`](pubspec.yaml).

## How it works

1. **First launch** — no saved pairing data, so the app shows a QR scanner ([`pairing_screen.dart`](lib/pairing_screen.dart)).
2. **Pairing** — scans a QR code from the dashboard containing `{ backend_url, token }`, reads its own hardware specs (model, CPU arch, RAM, storage, Android version) via [`device_registration.dart`](lib/device_registration.dart), and calls `POST /devices/pair`.
3. **Live connection** — [`backend_connection.dart`](lib/backend_connection.dart) opens and maintains a WebSocket to the backend, reconnecting automatically.
4. **Deployment** — when a deployment instruction arrives over the socket, [`model_downloader.dart`](lib/model_downloader.dart) streams the model directly from the Hugging Face CDN into app-internal storage, reporting progress back over the same socket.
5. **Config + inference** — [`config_reader.dart`](lib/config_reader.dart) reads the deployed `config.json` and routes to the correct mode. Inference runtimes live under [`lib/ml`](lib/ml):
   - **Camera** — TFLite (`tflite_flutter`), live camera frames, on-screen labels.
   - **Chat** — GGUF via `fllama` (llama.cpp FFI), streamed token generation.
   - **Voice** — TFLite audio classification on mic input.

Everything after step 4 works with zero network connectivity, including airplane mode.

## Bundled asset

`assets/best.tflite` ships inside the APK as the default camera-detection model, available immediately without waiting on a deployment. Deployed models replace it in app-internal storage; the bundled asset is never overwritten.

## Structure

```
lib/
├── main.dart                  App entry, routing between pairing/chat/camera/voice UI
├── pairing_screen.dart        QR scanner + first-run pairing flow
├── device_registration.dart   Reads real hardware specs, calls POST /devices/pair
├── backend_connection.dart    WebSocket client — deployment instructions, heartbeats
├── model_downloader.dart      Streams model files from the Hugging Face CDN
├── config_reader.dart         Reads/persists config.json, resolves inference mode
└── ml/                        TFLite / fllama inference runtimes
```
