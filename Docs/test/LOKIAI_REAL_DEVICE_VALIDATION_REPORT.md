# LokiAI — Real Device Validation Report

**Date:** 2026-07-28
**Commit:** `38a571c` (branch `chore/batch0-test-baseline`)
**Flutter:** 3.44.2 stable, Dart 3.12.2 — SDK found in-repo at `./flutter`
**APK:** `LokiAImobile UI/build/app/outputs/flutter-apk/app-debug.apk`, 271 MB, built 2026-07-28

---

## Verdict

| Gate | Status |
|---|---|
| Flutter toolchain available | **PASS** |
| `flutter pub get` | **PASS** |
| `flutter analyze` (app code) | **PASS** — 0 errors |
| `flutter test` | **PASS** — 11/11 |
| `flutter build apk` | **PASS** |
| APK installed on a real phone | **BLOCKED** — no device connected |
| Reconnect verified on real hardware | **BLOCKED** |
| On-device inference | **NOT TESTED** |

**The previous session's claim that no Flutter SDK existed was wrong.** One is present at `L:\The Shriks\LokiAI\flutter` (3.44.2). Risk R-1 is now closed for compile/analyze/test/build. R-2 (real-hardware reconnect) remains open.

---

## Correcting the prior record

The last session reported the mobile changes as `NOT RUN` and flagged R-1 honestly — but on the wrong premise. It checked `PATH`, `%LOCALAPPDATA%\flutter`, `C:\flutter` and `C:\src\flutter`, and did not check the repository itself. The SDK was in the repo the whole time.

That flag turned out to be well-placed anyway: **the first real compile found two genuine defects** that static reasoning had missed.

### Defect 1 — the state-report path could never have compiled

`backend_connection.dart` `_sendStateReport()` treated `ConfigReader.load()` as returning an `AppConfig` and read `.deploymentId` / `.modelName` / `.inferenceMode` straight off it. It actually returns a `ConfigResult` wrapper (`{config, error}`).

```
error - The getter 'deploymentId' isn't defined for the type 'ConfigResult'
      - lib\backend_connection.dart:212:31 - undefined_getter
error - The getter 'modelName' isn't defined for the type 'ConfigResult'
error - The getter 'inferenceMode' isn't defined for the type 'ConfigResult'
```

Batch 8's desired-vs-actual reconciliation would not have shipped at all. Fixed in `76c3fff`, which also forwards `result.error` as `config_error` so the backend can distinguish "nothing deployed" from "deployment present but config unreadable".

### Defect 2 — the test suite could not compile

`test/widget_test.dart` was still the stock Flutter counter scaffold referencing a `MyApp` class that has never existed here (the root widget is `LokiApp`). It failed to compile, which broke `flutter test` for the **whole package** — masking the 14 sanitizer cases added in Batch 8. Replaced with a real build-smoke test of `LokiApp`.

---

## Raw evidence

```
$ ./flutter/bin/flutter --version
Flutter 3.44.2 • channel stable
Framework • revision c9a6c48423 (7 weeks ago) • 2026-06-10
Engine • hash 04efd7c093d4e9281d5526ebcad6ecc60ba8badf
Tools • Dart 3.12.2 • DevTools 2.57.0

$ flutter pub get
Got dependencies!            PUBGET_EXIT:0

$ flutter analyze lib test          # app code only
error count: 0
```

`flutter analyze` across the *whole* project reports 2047 issues, but they are in `packages/fllama/example/` — a vendored third-party sample app with missing imports — and in `test_shape.dart`, a pre-existing root scratch file. Neither is app code, neither was touched, and neither is shipped. The app's own `lib/` and `test/` have **zero errors**. Remaining `lib/` output is pre-existing style lint (`avoid_print`, `withOpacity` deprecation, unnecessary `!`) in files this work did not modify. **No analyzer error was suppressed to make the build green.**

```
$ flutter test
00:00 +1: ...device_credential_store_test.dart: write stores the token and leaves no plaintext copy
00:00 +2: ...device_credential_store_test.dart: read returns null when nothing is stored
00:00 +3: ...device_credential_store_test.dart: migrates a legacy plaintext token and deletes the original
00:00 +4: ...device_credential_store_test.dart: secure value wins over a stale plaintext value
00:00 +5: ...device_credential_store_test.dart: clear removes the credential from both locations
00:00 +6: ...model_downloader_test.dart: keeps ordinary model filenames unchanged
00:00 +7: ...model_downloader_test.dart: strips parent-directory traversal
00:00 +8: ...model_downloader_test.dart: strips absolute paths and both separator styles
00:00 +9: ...model_downloader_test.dart: neutralises characters that are not filename-safe
00:00 +10: ...model_downloader_test.dart: never returns a dot-file or an empty name
00:00 +11: ...widget_test.dart: LokiApp builds its first frame without throwing
00:00 +11: All tests passed!            TEST_EXIT:0

$ flutter build apk --debug
Running Gradle task 'assembleDebug'...        227.7s
√ Built build\app\outputs\flutter-apk\app-debug.apk        BUILD_EXIT:0
```

---

## Secure credential storage (risk R-3)

Implemented in `3c54d20`. `lib/device_credential_store.dart` moves the device WebSocket token from plaintext `shared_preferences` into Keystore-backed `EncryptedSharedPreferences`.

| Requirement | Status | Evidence |
|---|---|---|
| Token persists across restart | **PASS (unit)** | secure-storage round trip covered; on-device persistence not observed |
| Token unavailable to ordinary app storage | **PASS (unit)** | test asserts plaintext prefs key is `null` after write and after migration |
| Logout/unpair removes it | **PASS (unit)** | `clear()` verified to remove from both locations |
| Invalid/expired token triggers controlled re-pair | **PASS (code)** | `4401` → `_onCredentialRejected()` → stop retrying, clear credential, show pairing screen with explanation |
| Credentials never logged | **PASS (review)** | only presence is logged; no code path prints the value |
| Backup cannot carry identity to another device | **PASS (config)** | `allowBackup=false`, `fullBackupContent=false`, `data_extraction_rules.xml` excludes cloud-backup **and** device-transfer for all domains |

**Limitation, stated plainly:** these tests fake the Keystore platform channel, because no unit-test binding provides one. They prove the store's own logic — migration, precedence, deletion — and **do not** prove the real Android Keystore is used on a device. That is an on-device check, below.

---

## Step 4 — WebSocket migration matrix

Rows 1–5 and 8–13 are verified server-side against a real WebSocket client (`test_infra/regression.py`, `presence_test.py`). Rows needing a physical handset are marked.

| # | Scenario | Status | Evidence |
|---|---|---|---|
| 1 | Old APK, already-paired device, **old** backend | **NOT TESTED** | old backend no longer running |
| 2 | Old APK after backend WS-auth deploy | **PASS (by construction)** | no `device_token` ⇒ close `4401`. Verified: unauthenticated connect rejected (`P0-4`) |
| 3 | Old APK after re-pairing | **FAIL — by design** | old APK cannot store or send `device_token`; re-pair does not help. **APK update mandatory.** |
| 4 | New APK, old pairing data (no token) | **PASS (code)** | detects `4401`, clears credential, prompts re-pair |
| 5 | New APK after re-pairing | **PASS** | `WS-1` — correctly paired device connects |
| 6 | New APK after app restart | **BLOCKED** | needs device |
| 7 | New APK after phone restart | **BLOCKED** | needs device |
| 8 | Duplicate device connections | **PASS** | second connect supersedes and explicitly closes the first (`4000`) |
| 9 | Invalid token | **PASS** | `P0-4` — rejected |
| 10 | Token for another device | **PASS** | `P0-4b` — cross-device token rejected |
| 11 | Deleted/unpaired device | **PASS** | handler re-checks ownership every connect |
| 12 | Backend restart | **PASS** | startup reconciliation resets stale `connected` rows |
| 13 | Network loss and recovery | **PASS (server)** | `presence_test.py`: connected → offline after abandoned socket → connected on reconnect |

**Migration decision:** explicit one-time re-pair, no unauthenticated fallback, no grace period. A compatibility window would leave the impersonation path open for as long as it existed. The app now explains the requirement rather than silently failing.

---

## Remaining — what still needs the real phone

**This is a wireless-only flow. No USB, no ADB, no manual file push** — per `Docs/06_RULES.md` Rule 12 and the standing directive that the LokiAI system performs every device action itself. The APK reaches the phone the way it does for any user: the phone's browser downloads it from the backend's own `/install` page, and pairing happens by QR.

*(An earlier draft of this report proposed `adb install`. That was wrong — it contradicts the architecture this same audit flagged the leftover ADB code for violating. Corrected.)*

Delivery path, all over Wi-Fi:

1. Backend runs on this machine and serves the freshly-built APK at `GET /apk/download`, linked from `GET /install`.
2. Phone opens `http://<lan-ip>:8000/install` in its browser, taps Download, installs.
3. Dashboard → Add Device → QR. Phone scans it and self-registers via `POST /devices/pair`, receiving its `device_token`.

Requirement: phone and backend on the same Wi-Fi. Progress is observed from the **backend's own logs and the dashboard**, which is where the real signal is — `[WS] device … connected (authenticated)`, `[presence] device … -> offline (heartbeat stale)`, and the device's status in `GET /devices`.

Sequence to observe:

| # | Action | Expected |
|---|---|---|
| 1 | Pair via QR from the dashboard | device appears, status `connected`; backend logs `[WS] device … connected (authenticated)` |
| 2 | Confirm the credential is not plaintext | covered by unit tests; on-device confirmation would need developer tooling and is deliberately **not** part of this wireless flow |
| 3 | Power the phone **off** | dashboard shows `offline` within ~70s (`PRESENCE_TTL_SECONDS`); backend logs `[presence] device … -> offline (heartbeat stale)` |
| 4 | Power the phone **on**, open the app | returns to `connected` **without** relaunching manually — *this is the original reported bug* |
| 5 | Background the app 5+ min, resume | reconnects on resume (`lifecycle -> resumed` in logcat) |
| 6 | Disable Wi-Fi 3+ min, re-enable | reconnects; backoff visible in logcat, never gives up |
| 7 | Restart the backend | device reconnects and re-reports state |
| 8 | Unpair from the dashboard, wait | app receives `4401`, shows the re-pair screen |
| 9 | Deploy a small real model | real progress; file lands under the app's `models/` dir |
| 10 | Run inference | **NOT TESTED** — mark FAILED or BLOCKED with raw output; do not assume |

Until steps 3–4 are observed, the reconnect fix is **proven server-side and unproven client-side**, and should be described that way.
