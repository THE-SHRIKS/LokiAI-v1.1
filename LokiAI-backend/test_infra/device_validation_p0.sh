#!/usr/bin/env bash
#
# P0 incident — physical-device validation.
#
# Nothing in this file has been executed: no Android device was attached when
# the source fixes were written. Every step below must be run against a real
# handset before the release can be called production ready. Record the actual
# output; do not infer a pass from a step that was skipped.
#
# Usage:
#   ADB=./platform-tools/adb.exe \
#   BACKEND=https://lokiai.onrender.com \
#   APK=build/app/outputs/flutter-apk/app-release.apk \
#   bash LokiAI-backend/test_infra/device_validation_p0.sh
#
set -uo pipefail

ADB="${ADB:-adb}"
BACKEND="${BACKEND:-https://lokiai.onrender.com}"
DASHBOARD="${DASHBOARD:-https://lokiai.theshriks.space}"
APK="${APK:-build/app/outputs/flutter-apk/app-release.apk}"
PKG="${PKG:-io.lokiai.lokiai_app}"
OUT="${OUT:-device-validation-$(date +%Y%m%d-%H%M%S)}"

mkdir -p "$OUT"
step() { printf '\n=== %s ===\n' "$1" | tee -a "$OUT/log.txt"; }
run()  { printf '$ %s\n' "$*" | tee -a "$OUT/log.txt"; "$@" 2>&1 | tee -a "$OUT/log.txt"; }

# ---------------------------------------------------------------------------
step "0. PRECONDITION — a device must actually be attached"
# ---------------------------------------------------------------------------
if ! "$ADB" devices | grep -qE '\sdevice$'; then
  echo "NO DEVICE ATTACHED — validation cannot proceed." | tee -a "$OUT/log.txt"
  echo "NOT READY FOR PRODUCTION DEPLOYMENT" | tee -a "$OUT/log.txt"
  exit 2
fi
run "$ADB" devices -l
run "$ADB" shell getprop ro.build.version.release
run "$ADB" shell getprop ro.product.model

# ---------------------------------------------------------------------------
step "9. RELEASE-VERSION CONSISTENCY (run FIRST — everything else is void
      if the components under test are not the intended build)"
# ---------------------------------------------------------------------------
run curl -fsS "$BACKEND/health"
run curl -fsS "$BACKEND/apk/info"
run curl -fsS "$BACKEND/diagnostics/versions"
# Dashboard build stamp, now emitted into the served HTML.
run bash -c "curl -fsS '$DASHBOARD/workspace/' | grep -o 'lokiai-build-[a-z]*\" content=\"[^\"]*\"'"
# Served APK hash must equal the local artifact hash byte for byte.
run bash -c "curl -fsS '$BACKEND/apk/download' -o '$OUT/served.apk' && sha256sum '$OUT/served.apk'"
run sha256sum "$APK"
echo "EXPECT: served.apk sha256 == local APK sha256 == /apk/info .sha256" | tee -a "$OUT/log.txt"
# Installed build, as reported by the phone itself.
run "$ADB" shell dumpsys package "$PKG" \| grep -E "versionName|versionCode"
echo "EXPECT: /diagnostics/versions .devices[*] matches the installed versionName/versionCode," | tee -a "$OUT/log.txt"
echo "        and .consistent == true with empty .mismatches and .unverifiable" | tee -a "$OUT/log.txt"

# ---------------------------------------------------------------------------
step "1. SERVICE EXIT CLASSIFICATION"
# ---------------------------------------------------------------------------
run "$ADB" logcat -c
echo "ACTION: open the app, start a chat model activation, then from another shell run:" | tee -a "$OUT/log.txt"
echo "  $ADB shell am force-stop --user 0 $PKG:inference   # or kill the :inference pid" | tee -a "$OUT/log.txt"
run bash -c "sleep 30; '$ADB' logcat -d -s FllamaPlugin:V flutter:V > '$OUT/service-exit-logcat.txt'; tail -40 '$OUT/service-exit-logcat.txt'"
run bash -c "'$ADB' shell dumpsys activity exit-info $PKG > '$OUT/exit-info.txt'; tail -40 '$OUT/exit-info.txt'"
cat <<'EXPECT' | tee -a "$OUT/log.txt"
EXPECT:
  - The Dart error code is one of INFERENCE_SERVICE_*, never
    CHAT_CONTEXT_CREATE_FAILED and never MODEL_QUARANTINED.
  - The PlatformException details field is a JSON object, NOT null, containing
    service_state, binding_completed, active_operation, rebind_attempts,
    session_generation and (on API >= 30) exit_evidence.
  - exit_evidence.reason_name matches `dumpsys activity exit-info`.
  - A kill Android attributes to LOW_MEMORY yields
    INFERENCE_SERVICE_LOW_MEMORY_KILL; anything it does not explain yields
    INFERENCE_SERVICE_UNKNOWN_EXIT and is NOT called a memory kill.
  - No user-facing text says "redeploy".
EXPECT

# ---------------------------------------------------------------------------
step "2. REPEATED CHAT ACTIVATION (the acceptance gate: succeeds repeatedly,
      or the feature stays disabled)"
# ---------------------------------------------------------------------------
echo "ACTION: activate the deployed chat model and send one message. Repeat 10x," | tee -a "$OUT/log.txt"
echo "        force-stopping the app between attempts 5 and 6." | tee -a "$OUT/log.txt"
run bash -c "'$ADB' logcat -d -s flutter:V FllamaPlugin:V > '$OUT/chat-activation.txt'; grep -cE 'ready|CHAT_' '$OUT/chat-activation.txt'"
echo "EXPECT: 10/10 activations reach ready. Any failure must carry a specific" | tee -a "$OUT/log.txt"
echo "        code; a service code must not quarantine the model." | tee -a "$OUT/log.txt"

# ---------------------------------------------------------------------------
step "3. REPEATED SERVICE BINDING / BOUNDED REBIND (no infinite loop)"
# ---------------------------------------------------------------------------
run "$ADB" logcat -c
echo "ACTION: kill :inference 6 times in rapid succession (more than" | tee -a "$OUT/log.txt"
echo "        MAX_REBIND_ATTEMPTS = 4)." | tee -a "$OUT/log.txt"
run bash -c "sleep 60; '$ADB' logcat -d -s FllamaPlugin:V > '$OUT/rebind.txt'; grep -c 'rebind attempt' '$OUT/rebind.txt'"
cat <<'EXPECT' | tee -a "$OUT/log.txt"
EXPECT:
  - "rebind attempt N" never exceeds 4 within one unstable window.
  - Backoff delays increase (~400/800/1600/3200 ms) with jitter, never a
    tight loop.
  - After exhaustion the state is FAILED and calls return
    INFERENCE_SERVICE_REBIND_EXHAUSTED rather than retrying forever.
  - A connection that survives 5s resets the budget: "connection stable".
  - No two overlapping "bindService status=" lines (binds are serialized).
EXPECT

# ---------------------------------------------------------------------------
step "4. LOW-MEMORY BEHAVIOUR"
# ---------------------------------------------------------------------------
run "$ADB" shell dumpsys meminfo "$PKG" \| head -30
echo "ACTION: with a chat model loaded, open several heavy apps to force" | tee -a "$OUT/log.txt"
echo "        Android to reclaim the :inference process." | tee -a "$OUT/log.txt"
run bash -c "'$ADB' shell dumpsys activity exit-info $PKG > '$OUT/exit-info-lowmem.txt'; grep -A3 -i 'reason' '$OUT/exit-info-lowmem.txt' | head -30"
echo "EXPECT: reason LOW_MEMORY -> INFERENCE_SERVICE_LOW_MEMORY_KILL, user text" | tee -a "$OUT/log.txt"
echo "        says the model is fine, and ModelGuard records NO strike." | tee -a "$OUT/log.txt"

# ---------------------------------------------------------------------------
step "5. EXACT SUPPORTED AUDIO DEPLOYMENT"
# ---------------------------------------------------------------------------
echo "PRECONDITION: AUDIO_ARTIFACT_CATALOG is EMPTY and audio deploy is OFF." | tee -a "$OUT/log.txt"
run curl -fsS "$BACKEND/health"
echo "EXPECT: .audio_deployment_enabled == false, .audio_catalog_size == 0." | tee -a "$OUT/log.txt"
cat <<'EXPECT' | tee -a "$OUT/log.txt"
TO QUALIFY AN ARTIFACT (the only way audio is re-enabled):
  1. Pick a candidate; pin its IMMUTABLE 40-hex commit revision (never "main").
  2. Download it at that exact revision; record sha256 and exact byte size.
  3. Sideload it and run VoiceInference.validateAndProbe() against it on THIS
     device. It must pass every gate: 1 input tensor, Float32 in/out, fixed
     shape, exactly 15600 samples, exactly 521 outputs, label count 521, and a
     real inference through _decodeAndRun on the synthetic tone.
  4. ONLY THEN add the entry to AUDIO_ARTIFACT_CATALOG with
     verification_status = IMPLEMENTED_AND_TESTED, and set
     AUDIO_MODEL_DEPLOYMENT_ENABLED=true.
  Do not add an entry that has not completed step 3 on real hardware.
EXPECT

# ---------------------------------------------------------------------------
step "6. MICROPHONE INFERENCE (only after step 5 qualifies an artifact)"
# ---------------------------------------------------------------------------
echo "ACTION: deploy the qualified artifact, open the mic feature, produce sound." | tee -a "$OUT/log.txt"
run bash -c "'$ADB' logcat -d -s flutter:V | grep -i 'VOICE:' | tail -40 | tee '$OUT/mic.txt'"
echo "EXPECT: 'VOICE: model loaded ... in=[15600] out=[521] labels=521' followed" | tee -a "$OUT/log.txt"
echo "        by real 'VOICE: result ->' lines with named AudioSet classes." | tee -a "$OUT/log.txt"

# ---------------------------------------------------------------------------
step "7. UNSUPPORTED AUDIO REJECTION (the incident artifact itself)"
# ---------------------------------------------------------------------------
echo "ACTION: attempt to deploy yamnetp_ahead_ds_lr0.000001.tflite." | tee -a "$OUT/log.txt"
cat <<'EXPECT' | tee -a "$OUT/log.txt"
EXPECT:
  - It is NOT recommended anywhere in the dashboard.
  - Any direct deploy attempt returns 422 with code
    AUDIO_DEPLOYMENT_TEMPORARILY_DISABLED (feature off) or
    AUDIO_ARTIFACT_NOT_CATALOGUED (feature on, artifact unverified).
  - The rejection happens BEFORE any download: the phone must never receive a
    deploy instruction for it, so no bytes are transferred.
  - No message anywhere suggests finding a "standard Float32" model.
EXPECT

# ---------------------------------------------------------------------------
step "8. CANCELLATION ATTRIBUTION"
# ---------------------------------------------------------------------------
echo "ACTION: start a large chat deployment, let it reach ~30-60%, then click" | tee -a "$OUT/log.txt"
echo "        Cancel in Background Tasks." | tee -a "$OUT/log.txt"
run bash -c "'$ADB' logcat -d -s flutter:V | grep -iE 'cancel|VERIFICATION: download' | tail -30 | tee '$OUT/cancel.txt'"
cat <<'EXPECT' | tee -a "$OUT/log.txt"
EXPECT (verify against GET /deployments and the DB row):
  - cancellation_source == 'user_dashboard'
  - cancelled_by_user_id == the signed-in user
  - cancelled_at is set
  - cancellation_request_id is the dash-<uuid> the dashboard generated, and the
    SAME id appears in the phone's acknowledgement
  - progress_at_cancellation preserves the real percentage (NOT 0)
  - Background Tasks renders "cancelled from dashboard" in muted styling with a
    Ban icon, NOT the red XCircle used for failures
  - Clicking Cancel twice returns 200 with idempotent_replay == true, not 409
  - A NEW deployment to the same device starts immediately afterwards (no 409)
  - Starting a second deployment while one is queued sets
    superseded_by_deployment_id on the first
EXPECT

step "RESULT"
echo "Record every EXPECT above as PASS or FAIL with the captured output in $OUT/." | tee -a "$OUT/log.txt"
echo "Any FAIL, or any step not run => NOT READY FOR PRODUCTION DEPLOYMENT." | tee -a "$OUT/log.txt"
