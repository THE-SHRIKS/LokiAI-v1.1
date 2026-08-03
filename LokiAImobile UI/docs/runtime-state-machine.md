# Runtime State Machine

Global runtime state remains represented in Dart by feature-specific typed enums:

- Chat: `ChatRuntimeState`
- Camera: `CameraFeatureState`
- Audio: `MicFeatureState`

Current deterministic policy: active work completes or is cancelled before the next transition runs. Chat/model reloads are serialized by `_runtimeQueue` and `ChatInference._serial`. Native fllama commands run through the `FllamaNativeCommand` single-thread executor, with `stopCompletion` allowed to interrupt an active generation.

Legal chat transitions:

- `uninitialized -> loading -> ready`
- `ready -> generating -> ready`
- `generating -> cancelling -> ready`
- `ready/generating -> switching -> unloading -> disposed`
- `loading/generating/unloading -> failed`

Legal camera transitions:

- `idle -> initializing/requestingPermission -> ready`
- `ready -> capturing -> processing -> ready`
- `ready/failed -> idle`
- `any -> disposed`

Legal audio transitions:

- `idle -> requestingPermission -> initializing -> listening`
- `listening -> processing -> idle`
- `initializing/listening -> failed`
- `any -> disposed`

Stale chat token callbacks are filtered by context id, request id, and Dart epoch.
