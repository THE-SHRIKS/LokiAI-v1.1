"""
FAILURE 1 FIX — Trigger EdgeMind deployment pipeline for all 3 models.
This script does NOT manually push models. It calls POST /deployments 3 times
and lets the backend pipeline download from HuggingFace and push via ADB.

Verified filenames from HuggingFace API:
  - Synaptics/MobileNetV2  -> MobileNetV2_float16.tflite (camera)
  - TheBloke/phi-2-GGUF    -> phi-2.Q4_K_S.gguf (chat, smallest Q4)
  - chayuto/yamnet-mel-int8-tflm -> yamnet.tflite (voice)
"""
import requests
import time
import sys

BASE_URL = "http://localhost:8000"
EMAIL = "testuser2@example.com"
PASSWORD = "testpassword"

def login():
    r = requests.post(f"{BASE_URL}/auth/login", json={"email": EMAIL, "password": PASSWORD})
    if r.status_code != 200:
        print(f"Login failed: {r.status_code} {r.text}")
        sys.exit(1)
    token = r.json()["access_token"]
    print(f"[AUTH] Logged in. Token: {token[:40]}...")
    return token

def get_device(token):
    r = requests.get(f"{BASE_URL}/devices", headers={"Authorization": f"Bearer {token}"})
    if r.status_code != 200:
        print(f"GET /devices failed: {r.status_code} {r.text}")
        sys.exit(1)
    devices = r.json()
    if not devices:
        print("No devices registered. Run agent.exe first.")
        sys.exit(1)
    device = devices[0]
    print(f"[DEVICE] Found: {device['phone_model']} (ADB: {device['adb_serial']}) ID: {device['id']}")
    return device["id"]

def poll_deployment(token, deployment_id, label):
    print(f"\n[POLL] {label} ({deployment_id})...")
    for attempt in range(120):  # 10 minutes max
        r = requests.get(
            f"{BASE_URL}/deployments/{deployment_id}",
            headers={"Authorization": f"Bearer {token}"}
        )
        if r.status_code != 200:
            print(f"  Poll error: {r.status_code} {r.text}")
            time.sleep(5)
            continue
        data = r.json()
        status = data.get("status")
        progress = data.get("progress_percent", 0)
        print(f"  [{attempt+1}] status={status}, progress={progress}%")
        if status == "complete":
            print(f"  [DONE] {label} deployment complete.")
            return True
        if status == "failed":
            print(f"  [FAILED] {label}: {data.get('error_message')}")
            return False
        time.sleep(5)
    print(f"  [TIMEOUT] {label} deployment timed out.")
    return False

def deploy(token, device_id, label, hf_model_id, filename, inference_mode):
    print(f"\n[DEPLOY] {label}")
    print(f"  HF model: {hf_model_id}  file: {filename}  mode: {inference_mode}")
    payload = {
        "device_id": device_id,
        "hf_model_id": hf_model_id,
        "filename": filename,
        "inference_mode": inference_mode,
        "confidence_threshold": 0.5,
    }
    r = requests.post(
        f"{BASE_URL}/deployments",
        json=payload,
        headers={"Authorization": f"Bearer {token}"}
    )
    print(f"  POST /deployments -> {r.status_code}: {r.text}")
    if r.status_code != 200:
        return None
    deployment_id = r.json()["deployment_id"]
    print(f"  Deployment ID: {deployment_id}")
    return deployment_id

def main():
    print("=" * 60)
    print("FAILURE 1 FIX — EdgeMind Deployment Pipeline")
    print("3 real models -> Redmi Note 8 Pro via backend ADB pipeline")
    print("=" * 60)

    token = login()
    device_id = get_device(token)

    results = {}

    # MODEL 1: Camera/Vision — MobileNetV2 TFLite (verified file on HF)
    d1 = deploy(
        token, device_id,
        label="Camera/Vision: MobileNetV2 TFLite",
        hf_model_id="Synaptics/MobileNetV2",
        filename="MobileNetV2_float16.tflite",
        inference_mode="camera"
    )
    results["MobileNetV2 (camera)"] = poll_deployment(token, d1, "MobileNetV2") if d1 else False

    # MODEL 2: Chat/Text — Phi-2 Q4_K_S GGUF (smallest variant)
    d2 = deploy(
        token, device_id,
        label="Chat/Text: Phi-2 Q4_K_S GGUF",
        hf_model_id="TheBloke/phi-2-GGUF",
        filename="phi-2.Q4_K_S.gguf",
        inference_mode="chat"
    )
    results["Phi-2 Q4_K_S (chat)"] = poll_deployment(token, d2, "Phi-2 GGUF") if d2 else False

    # MODEL 3: Voice/Audio — YAMNet TFLite
    d3 = deploy(
        token, device_id,
        label="Voice/Audio: YAMNet TFLite",
        hf_model_id="chayuto/yamnet-mel-int8-tflm",
        filename="yamnet.tflite",
        inference_mode="voice"
    )
    results["YAMNet (voice)"] = poll_deployment(token, d3, "YAMNet") if d3 else False

    print("\n" + "=" * 60)
    print("DEPLOYMENT SUMMARY")
    all_ok = True
    for name, ok in results.items():
        status = "DONE" if ok else "FAILED"
        print(f"  {name}: {status}")
        if not ok:
            all_ok = False
    print("=" * 60)

    if not all_ok:
        sys.exit(1)

if __name__ == "__main__":
    main()
