# LokiAI Runtime Stability Audit

## 1. Current Architecture

The Flutter application is rooted in `lib/main.dart`. `PairingGate` restores the device pairing and then shows `LokiHomeScreen`. The home screen preserves the existing single chat surface, top camera/microphone controls, bottom model selector, and chat composer.

Model deployment state is file based, not database based:

- Active model: app-documents `config.json`, with legacy fallback `/sdcard/edgemind/config.json`.
- Installed models: app-documents `model-registry.json`.
- Downloaded files: app-documents `models/`.
- Legacy model files: `/sdcard/edgemind/models/`.

Chat GGUF inference currently flows through `ChatInference` -> vendored `fllama` Flutter plugin -> Android `FllamaService` -> `FLlama` -> `LlamaContext` JNI -> llama.cpp. Before this task, the service was a local bound service in the UI process, so native aborts still killed Flutter.

Vision uses `CameraFeatureController` for camera ownership and `VisionEngine` for TFLite inference in a Dart isolate. Audio uses `MicFeatureController` and `VoiceInference` with the `record` plugin and TFLite.

## 2. Exact Crash-Prone Flows

- `fllama` native GGUF load or completion can abort the process because it runs in the Flutter app process.
- `FllamaService` exposes a local binder, so it cannot be moved to another process without replacing the bridge.
- `FLlama` launches every command on `Dispatchers.IO`, allowing native load, completion, stop, release, tokenize, and utility work to overlap.
- `FLlama.contexts` allows multiple native contexts in memory.
- Model switching disposes the old `ChatInference`, but the native plugin only acknowledges `releaseContext` completion with `null`; there is no structured teardown result.
- `model-registry.json` has no installed-model limit enforcement.
- `ModelGuard` validates only a small GGUF header subset and uses a coarse permanent path quarantine.
- Camera lifecycle is mostly centralized, but the controller does not have a formal mode epoch shared with chat.
- Audio lifecycle is centralized, but it is not coordinated through a global mode transition controller.

## 3. Resource Ownership Map

- `LokiHomeScreen`: owns UI state, messages, active `ChatInference`, one `CameraFeatureController`, one `MicFeatureController`.
- `ChatInference`: owns one Dart-side chat runtime, current context id, token subscription, generation stream, epoch, and serialized Dart queue.
- `ModelGuard`: owns preflight checks and shared-preferences crash/quarantine markers.
- `CameraFeatureController`: owns camera permission, `CameraController`, image stream, capture flow, and `VisionEngine`.
- `VisionEngine`: owns one Dart isolate and one TFLite `Interpreter`.
- `MicFeatureController`: owns microphone state and `VoiceInference`.
- `VoiceInference`: owns one `AudioRecorder`, audio stream subscription, and TFLite `Interpreter`.
- `FllamaService`/`FLlama`: owns llama.cpp native contexts and generation callbacks.

## 4. Concurrency And Race-Condition Map

- Dart chat requests are serialized inside `ChatInference`.
- Runtime reloads are serialized in `LokiHomeScreen._runtimeQueue`.
- Camera open/capture has in-flight guards.
- Microphone start has an in-flight guard.
- Native fllama calls were not serialized before this patch because each method launched an independent `Dispatchers.IO` coroutine.
- Native callbacks include context id but not a service epoch or mode epoch.
- Model selection while a chat generation runs depends on `dispose()` calling cancel and release in order.

Chosen deterministic policy for this stabilization pass: current transitions finish before later work runs. Dart queues serialize chat/model reloads; native fllama commands run on one service executor.

## 5. Current UI Workflow Map

1. Pairing gate verifies device credentials.
2. The paired home screen displays the existing chat view.
3. The top bar exposes camera and microphone icons.
4. The bottom input bar shows the model selector pill and message composer.
5. The user selects a downloaded model from the existing modal bottom sheet.
6. The user sends chat text, opens camera, or toggles microphone.
7. Failures are rendered as existing chat messages or inline camera/mic notices.

This task must preserve that UI and route structure.

## 6. Current Persisted-Data Model

`AppConfig` fields: model name/path, inference mode, format, threshold, deployment id, size, sha256, optional `llm_model`, optional `llm_path`.

`model-registry.json` is an array of the same config maps. There is no schema version field. Existing records are backward compatible because unknown fields are ignored by `AppConfig.fromJson`.

## 7. Migration Risks

- There is no database migration framework. Migrations must be tolerant JSON rewrites.
- Existing users may already have more than 10 registry entries; files must not be deleted automatically.
- Legacy `/sdcard/edgemind` users must continue to load.
- Adding fields to registry maps is safe, but rewriting must preserve unknown keys.

## 8. Native Integration Risks

- llama.cpp can terminate the process with SIGABRT/SIGSEGV.
- A local service binder does not isolate native crashes.
- Cross-process service binding requires IPC; a direct service object cast is invalid across processes.
- MethodChannel results must always complete, including service death.
- EventChannel token events must not mutate stale Dart state after service restart.

## 9. Camera Lifecycle Risks

- Starting a second image stream can throw.
- `takePicture()` while streaming fails on some devices, so the stream must stop before capture and restart afterward.
- Camera initialization can fail when another app owns the camera.
- Stream callbacks can outlive the active engine and must check ownership.
- Leaving vision mode must stop the stream and dispose the controller before chat/model transitions that need resources.

## 10. Audio Lifecycle Risks

- Recorder permission must be requested only on user action.
- Starting two recorder streams can overlap callbacks.
- Audio buffers can continue after UI disposal unless the subscription is cancelled.
- Interpreter close must happen after recorder stop.

## 11. Implementation Plan

1. Preserve UI and Dart public APIs.
2. Move `FllamaService` to `android:process=":inference"`.
3. Replace local binder calls with private Messenger IPC.
4. Add Binder death handling, one automatic rebind, and deterministic pending-call failures.
5. Serialize all `FLlama` native operations on one executor.
6. Enforce one active native context in `FLlama`.
7. Return structured unload acknowledgement from `releaseContext`.
8. Enforce the 10 installed-model limit during deployment registration without deleting existing files.
9. Add documentation for the state machine, process architecture, switching protocol, camera/audio lifecycle, and failure policy.
10. Run Flutter tests and Android/Gradle build checks available in this workspace.

## 12. Files Expected To Change

- `packages/fllama/android/src/main/AndroidManifest.xml`
- `packages/fllama/android/src/main/kotlin/ink/xcl/fllama/FllamaPlugin.kt`
- `packages/fllama/android/src/main/kotlin/ink/xcl/fllama/FllamaService.kt`
- `packages/fllama/android/src/main/kotlin/ink/xcl/fllama/FLlama.kt`
- `packages/fllama/lib/fllama_method_channel.dart`
- `lib/model_downloader.dart`
- `docs/*.md`
- Focused tests where possible.

## 13. UI-Preservation Guarantees

No route, screen, visual hierarchy, icon, bottom navigation, chat composer, model selector, camera surface, or microphone control is intentionally changed. New technical failures must use existing inline or chat-message failure patterns.

## 14. Backward-Compatibility Strategy

Existing config and registry records remain readable. Unknown JSON fields remain ignored. Existing downloaded model files are retained. Existing users above the future 10-model cap are not cleaned up automatically; new deployment registration is refused until they remove entries.

## 15. Rollback Strategy

Rollback is limited to the vendored fllama plugin and downloader registry changes. Because persisted JSON is not destructively migrated, reverting code restores previous behavior without deleting downloaded models or chat messages.
