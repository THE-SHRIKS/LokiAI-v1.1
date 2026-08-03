# Model Switching Protocol

Current model switching is transactional at the app/plugin boundary:

1. UI model selection writes the active `config.json`.
2. `_runtimeQueue` serializes reloads.
3. Existing `ChatInference` is detached from the UI.
4. Active generation is cancelled.
5. Native token callbacks are ignored by epoch/request filters.
6. `releaseContext` waits for generation stop and native release.
7. `releaseContext` returns an acknowledgement with `generationStopped`, `contextDestroyed`, `modelDestroyed`, `callbacksDetached`, `epoch`, and `operationResult`.
8. Camera is closed before the new model runtime is considered.
9. New chat model is validated and loaded lazily on first send.

Installed/deployed models are separate from the loaded model. The registry allows up to 10 installed models, but `FLlama` allows only one native context at a time.
