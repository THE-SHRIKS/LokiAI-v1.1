# Failure And Quarantine Policy

Current behavior:

- GGUF files are preflight-checked before native loading.
- Known-invalid files are rejected with user-readable messages.
- A persisted load marker records when native loading starts.
- If the app later starts and the marker remains, the model path is quarantined.
- Quarantine is path based and stored in shared preferences.
- Quarantined models remain in the selector but are refused by chat loading.
- Duplicate microphone failure messages are not appended repeatedly.

Improved in this task:

- Native fllama crashes are isolated to the `:inference` service process.
- Binder death causes pending operations to fail deterministically.
- The plugin attempts one service rebind after death.

Remaining gap: quarantine records are not yet structured by model hash, ABI, app version, Android version, native signal, and failure stage.
