"""
Phase 3 End-to-End Test
Tests the full flow: device registration (verified) -> model search -> deployment -> verify on phone.
Per PLANNER.md Phase 3 E2E Test steps 1-5.
Step 6 (EdgeMind app) deferred to Phase 4 when Flutter APK is built.
"""
import time
import json
import subprocess
import httpx

BASE_URL = "http://127.0.0.1:8000"
ADB_PATH = r"S:\LokiAI\platform-tools\adb.exe"

def get_serial():
    result = subprocess.run([ADB_PATH, "devices"], capture_output=True, text=True)
    for line in result.stdout.strip().split("\n")[1:]:
        parts = line.strip().split("\t")
        if len(parts) == 2 and parts[1] == "device":
            return parts[0]
    return None

def adb_shell(serial, cmd):
    result = subprocess.run(
        [ADB_PATH, "-s", serial, "shell"] + cmd.split(),
        capture_output=True, text=True
    )
    return result.stdout.strip()

def main():
    client = httpx.Client(base_url=BASE_URL, timeout=30.0)
    serial = get_serial()
    assert serial is not None, "FAIL: No ADB device connected"
    print(f"ADB device connected: {serial}")

    print("=" * 60)
    print("PHASE 3 END-TO-END TEST")
    print("=" * 60)

    # Step 1: Register device (Phase 2 verified - device already registered)
    print("\n--- Step 1: Device Registration (Phase 2 verified) ---")
    login_resp = client.post("/auth/login", json={
        "email": "e2e_user3@example.com",
        "password": "password123"
    })
    assert login_resp.status_code == 200, f"Login failed: {login_resp.text}"
    token = login_resp.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    devices_resp = client.get("/devices", headers=headers)
    devices = devices_resp.json()
    device = None
    for d in devices:
        if d["adb_serial"] == serial:
            device = d
            break
    assert device is not None, f"Device with serial {serial} not found in database"
    print(f"   Device: {device['phone_model']} (ID: {device['id']})")
    print(f"   RAM: {device['ram_mb']} MB, Storage: {device['storage_free_gb']} GB")
    print("   STEP 1 PASS")

    # Step 2: Search models (Phase 1 verified)
    print("\n--- Step 2: Model Search (Phase 1 verified) ---")
    search_resp = client.post("/models/search", headers=headers, json={
        "device_id": device["id"],
        "user_message": "I want to classify images with my camera"
    })
    assert search_resp.status_code == 200, f"Search failed: {search_resp.text}"
    search_data = search_resp.json()
    assert len(search_data.get("recommendations", [])) > 0, "No models found"
    print(f"   Found {len(search_data['recommendations'])} models")
    for m in search_data["recommendations"][:3]:
        print(f"   - {m['name']} ({m['size_mb']} MB)")
    print("   STEP 2 PASS")

    # Step 3: Create deployment with real model
    print("\n--- Step 3: Create Deployment ---")
    # Clean phone first
    adb_shell(serial, "rm -rf /sdcard/edgemind/")
    time.sleep(1)

    deploy_resp = client.post("/deployments", headers=headers, json={
        "device_id": device["id"],
        "hf_model_id": "Synaptics/MobileNetV2",
        "filename": "MobileNetV2_float16.tflite",
        "inference_mode": "camera",
        "confidence_threshold": 0.75
    })
    assert deploy_resp.status_code == 200, f"Deploy failed: {deploy_resp.text}"
    deployment_id = deploy_resp.json()["deployment_id"]
    print(f"   Deployment ID: {deployment_id}")
    print(f"   Initial status: {deploy_resp.json()['status']}")
    print("   STEP 3 PASS")

    # Step 4: Watch status go to complete
    print("\n--- Step 4: Watch Status -> Complete ---")
    max_polls = 30
    statuses_seen = []
    final_status = None
    for i in range(max_polls):
        time.sleep(3)
        status_resp = client.get(f"/deployments/{deployment_id}", headers=headers)
        status_data = status_resp.json()
        current = status_data["status"]
        progress = status_data.get("progress_percent", 0)
        if current not in statuses_seen:
            statuses_seen.append(current)
        print(f"   Poll {i+1}: status={current}, progress={progress}%")

        if current == "complete":
            final_status = "complete"
            break
        elif current == "failed":
            print(f"   DEPLOYMENT FAILED: {status_data.get('error_message')}")
            final_status = "failed"
            break

    assert final_status == "complete", f"Deployment did not complete. Last status: {final_status}"
    print(f"   Status progression: {' -> '.join(statuses_seen)}")
    print("   STEP 4 PASS")

    # Step 5: Physically check phone
    print("\n--- Step 5: Physically Check Phone ---")

    # Check model file
    model_ls = adb_shell(serial, "ls -la /sdcard/edgemind/models/MobileNetV2_float16.tflite")
    assert "MobileNetV2_float16.tflite" in model_ls, f"Model file not on phone: {model_ls}"
    print(f"   Model file: {model_ls}")

    # Check model file size
    model_size = adb_shell(serial, "wc -c < /sdcard/edgemind/models/MobileNetV2_float16.tflite")
    print(f"   Model size on phone: {model_size} bytes")

    # Check config.json
    config_str = adb_shell(serial, "cat /sdcard/edgemind/config.json")
    config = json.loads(config_str)
    assert config["model_name"] == "MobileNetV2_float16.tflite"
    assert config["inference_mode"] == "camera"
    assert config["deployment_id"] == deployment_id
    print(f"   config.json: model={config['model_name']}, mode={config['inference_mode']}")

    print("   STEP 5 PASS")

    # Step 6: EdgeMind app - deferred to Phase 4
    print("\n--- Step 6: EdgeMind App (deferred to Phase 4) ---")
    print("   APK not yet built (Flutter app is Phase 4)")
    print("   STEP 6 DEFERRED")

    print("\n" + "=" * 60)
    print("PHASE 3 END-TO-END TEST: PASSED (Steps 1-5)")
    print("Step 6 deferred to Phase 4 (Flutter APK not yet built)")
    print("=" * 60)

if __name__ == "__main__":
    main()
