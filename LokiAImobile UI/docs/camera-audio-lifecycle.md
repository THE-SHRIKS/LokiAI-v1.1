# Camera And Audio Lifecycle

Camera ownership is centralized in `CameraFeatureController`.

Open path:

1. Collapse repeated opens with `_openInFlight`.
2. Enumerate cameras.
3. Request permission only after user action.
4. Create and initialize one `CameraController`.
5. Start optional `VisionEngine`.
6. Start one image stream if recognition is ready.

Close path:

1. Clear controller and engine references.
2. Stop image stream when active.
3. Dispose camera controller.
4. Dispose vision engine.

Audio ownership is centralized in `MicFeatureController`.

Start path:

1. Collapse repeated starts with `_startInFlight`.
2. Validate audio model path.
3. Request microphone permission.
4. Load one `VoiceInference`.
5. Start one recorder stream.

Stop path:

1. Cancel audio subscription.
2. Stop recorder when recording.
3. Dispose recorder.
4. Close TFLite interpreter.

Remaining gap: camera/audio transitions are not yet coordinated by one shared `RuntimeCoordinator`; they are centralized per feature and guarded against overlap.
