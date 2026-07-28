# LokiAI Test and Change Audit

## 2026-07-28 Fix Batch
- **Bug 1:** Rewrote HF resolution in `main.py` -> PASS.
- **Bug 2:** Redacted pairing secrets in `pairing_screen.dart` -> PASS.
- **Bug 3:** Fixed race condition in session array in `index.tsx` -> PASS.
- **Bug 4:** Handled 404 access-denied state in `monitor.tsx` -> PASS.
- **Bug 5:** Replaced NIM key reveal component in `account.tsx` -> PASS.
- **Bug 6:** Altered Flutter label and icons to `LokiAI` -> PASS.
- **Bug 7:** Hid upload zone via `VITE_ENABLE_CUSTOM_UPLOAD` -> PASS.
- **Bug 8:** Models are natively verified by Bug 1 -> PASS.

All changes map exactly to the `fix/production-bugs-batch1` branch off main.
