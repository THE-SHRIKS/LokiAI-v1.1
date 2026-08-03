# Inference Process Architecture

GGUF inference now runs in Android service `ink.xcl.fllama.FllamaService` with:

- `android:exported="false"`
- `android:process=":inference"`

Flutter talks to the service through the existing `fllama` MethodChannel API. Internally, `FllamaPlugin` bridges MethodChannel calls to the service using private Messenger IPC. The UI process never receives raw native pointers; it receives numeric context identifiers and token events.

Service death handling:

- Pending MethodChannel calls fail with `SERVICE_DIED` or `SERVICE_DISCONNECTED`.
- The plugin attempts one automatic rebind after binder death.
- Dart chat state receives a deterministic platform exception instead of a UI process crash when the inference process dies.

Native execution:

- `FLlama` owns all `LlamaContext` instances inside the service process.
- `FLlama` refuses a second context while one is loaded.
- Load, tokenize, generate, release, and utility work run on `FllamaNativeCommand`.
- `stopCompletion` may run outside that queue so it can abort a blocking generation and then wait for the generation job.
