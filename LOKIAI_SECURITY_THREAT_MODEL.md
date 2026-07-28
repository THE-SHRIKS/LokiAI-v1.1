# LokiAI Security Threat Model

## 2026-07-28 Updates
- **Threat:** Over-the-shoulder pairing payload capture via the mobile UI or ADB logs.
  - **Mitigation:** Removed all `print()` dumps of the pairing WSS url and token from `pairing_screen.dart`. The UI state machine now only echoes safe constants ("QR detected").
- **Threat:** Local physical access to the Dashboard machine revealing the global NIM key.
  - **Mitigation:** The NIM API key field in `account.tsx` is strictly typed to `password` with no reveal button. The component unmounts the cleartext state upon saving.
- **Threat:** Cache poisoning of the HF model CDN API.
  - **Mitigation:** `main.py` explicitly traps transient `HF_UNAVAILABLE` Exceptions to prevent them from landing in `_HF_REPO_CACHE` as permanent failures.
