"""
Task 3.4 Verification - Full Deployment Endpoint test.
Creates a deployment via POST /deployments with a real device_id and real HuggingFace model.
Polls GET /deployments/{id} until status reaches 'complete'.
Verifies: model file on phone, config.json on phone, database record shows 'complete'.
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

    # Step 1: Login to get JWT
    print("1. Logging in...")
    login_resp = client.post("/auth/login", json={
        "email": "e2e_user3@example.com",
        "password": "password123"
    })
    assert login_resp.status_code == 200, f"Login failed: {login_resp.text}"
    token = login_resp.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}
    print(f"   Token obtained")

    # Step 2: Get device_id
    print("2. Getting device list...")
    devices_resp = client.get("/devices", headers=headers)
    assert devices_resp.status_code == 200, f"Get devices failed: {devices_resp.text}"
    devices = devices_resp.json()
    assert len(devices) > 0, "No devices registered"

    serial = get_serial()
    assert serial is not None, "No ADB device connected"
    print(f"   ADB serial: {serial}")

    # Find the device matching the connected ADB serial
    device_id = None
    for d in devices:
        if d["adb_serial"] == serial:
            device_id = d["id"]
            break
    assert device_id is not None, f"No registered device matches ADB serial {serial}. Devices: {[(d['id'], d['adb_serial']) for d in devices]}"
    print(f"   Device ID: {device_id}")

    # Step 3: Clean up any previous deployment files on phone
    print("3. Cleaning up previous files on phone...")
    adb_shell(serial, "rm -rf /sdcard/edgemind/")
    time.sleep(1)

    # Step 4: Create deployment
    print("4. Creating deployment...")
    deploy_resp = client.post("/deployments", headers=headers, json={
        "device_id": device_id,
        "hf_model_id": "Synaptics/MobileNetV2",
        "filename": "MobileNetV2_float16.tflite",
        "inference_mode": "camera",
        "confidence_threshold": 0.75
    })
    assert deploy_resp.status_code == 200, f"Deploy failed: {deploy_resp.text}"
    deployment_id = deploy_resp.json()["deployment_id"]
    print(f"   Deployment ID: {deployment_id}")
    print(f"   Initial status: {deploy_resp.json()['status']}")

    # Step 5: Poll status every 3 seconds
    print("5. Polling deployment status...")
    max_polls = 30  # 90 seconds max
    final_status = None
    for i in range(max_polls):
        time.sleep(3)
        status_resp = client.get(f"/deployments/{deployment_id}", headers=headers)
        status_data = status_resp.json()
        current_status = status_data["status"]
        progress = status_data.get("progress_percent", 0)
        print(f"   Poll {i+1}: status={current_status}, progress={progress}%")

        if current_status == "complete":
            final_status = "complete"
            break
        elif current_status == "failed":
            print(f"   DEPLOYMENT FAILED: {status_data.get('error_message')}")
            final_status = "failed"
            break

    assert final_status == "complete", f"Deployment did not complete. Last status: {final_status}"
    print("   CHECK: Deployment status reached 'complete' - PASS")

    # Step 6: Verify model file is on phone
    print("6. Verifying model file on phone...")
    ls_output = adb_shell(serial, "ls -la /sdcard/edgemind/models/MobileNetV2_float16.tflite")
    assert "MobileNetV2_float16.tflite" in ls_output, f"Model file not found on phone: {ls_output}"
    print(f"   {ls_output}")
    print("   CHECK: Model file exists on phone - PASS")

    # Step 7: Verify config.json is on phone
    print("7. Verifying config.json on phone...")
    config_output = adb_shell(serial, "cat /sdcard/edgemind/config.json")
    config = json.loads(config_output)
    assert config["model_name"] == "MobileNetV2_float16.tflite", f"Config model_name mismatch: {config}"
    assert config["inference_mode"] == "camera", f"Config inference_mode mismatch: {config}"
    assert config["deployment_id"] == deployment_id, f"Config deployment_id mismatch: {config}"
    print(f"   model_name: {config['model_name']}")
    print(f"   inference_mode: {config['inference_mode']}")
    print(f"   deployment_id: {config['deployment_id']}")
    print("   CHECK: config.json verified on phone - PASS")

    # Step 8: Verify database record
    print("8. Verifying database record...")
    final_resp = client.get(f"/deployments/{deployment_id}", headers=headers)
    final_data = final_resp.json()
    assert final_data["status"] == "complete", f"DB status not complete: {final_data}"
    print(f"   DB status: {final_data['status']}")
    print("   CHECK: Database record shows 'complete' - PASS")

    print("\nALL CHECKS PASSED - Task 3.4 verified")

if __name__ == "__main__":
    main()
