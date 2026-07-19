"""
Task 3.2 Verification - Push a real file to a real connected phone via ADB.
Tests: file arrives on phone, size matches original.
"""
import asyncio
import subprocess
import tempfile
import hashlib
import os
import httpx

ADB_PATH = r"S:\LokiAI\platform-tools\adb.exe"

def get_connected_serial():
    result = subprocess.run([ADB_PATH, "devices"], capture_output=True, text=True)
    lines = result.stdout.strip().split("\n")
    for line in lines[1:]:
        parts = line.strip().split("\t")
        if len(parts) == 2 and parts[1] == "device":
            return parts[0]
    return None

def push_to_device(adb_serial, local_path, remote_path):
    result = subprocess.run(
        [ADB_PATH, "-s", adb_serial, "push", local_path, remote_path],
        capture_output=True, text=True
    )
    if result.returncode != 0:
        raise Exception(f"ADB push failed: {result.stderr}")
    return True

def shell_cmd(adb_serial, cmd):
    result = subprocess.run(
        [ADB_PATH, "-s", adb_serial, "shell"] + cmd.split(),
        capture_output=True, text=True
    )
    return result.stdout.strip()

async def download_model_to_temp(hf_model_id, filename):
    url = f"https://huggingface.co/{hf_model_id}/resolve/main/{filename}"
    temp_dir = tempfile.mkdtemp(prefix="edgemind_")
    temp_path = os.path.join(temp_dir, filename)
    sha256 = hashlib.sha256()
    total_bytes = 0
    async with httpx.AsyncClient(timeout=120.0) as client:
        async with client.stream("GET", url, follow_redirects=True) as response:
            response.raise_for_status()
            with open(temp_path, "wb") as f:
                async for chunk in response.aiter_bytes():
                    f.write(chunk)
                    sha256.update(chunk)
                    total_bytes += len(chunk)
    return temp_path, sha256.hexdigest(), total_bytes

async def main():
    # Step 1: Check phone is connected
    serial = get_connected_serial()
    assert serial is not None, "FAIL: No device connected"
    print(f"Device connected: {serial}")

    # Step 2: Download a real model to temp folder
    hf_model_id = "Synaptics/MobileNetV2"
    filename = "MobileNetV2_float16.tflite"
    print(f"Downloading {hf_model_id}/{filename} ...")
    temp_path, sha256_hash, size_bytes = await download_model_to_temp(hf_model_id, filename)
    print(f"Downloaded to: {temp_path} ({size_bytes} bytes)")

    # Step 3: Create remote directory on phone
    remote_dir = "/sdcard/edgemind/models/"
    shell_cmd(serial, f"mkdir -p {remote_dir}")

    # Step 4: Push file to phone
    remote_path = f"{remote_dir}{filename}"
    print(f"Pushing to phone: {remote_path}")
    push_to_device(serial, temp_path, remote_path)
    print("ADB push completed")

    # Step 5: Verify file exists on phone
    ls_output = shell_cmd(serial, f"ls -la {remote_path}")
    print(f"Phone ls output: {ls_output}")
    assert filename in ls_output, f"FAIL: File not found on phone. ls output: {ls_output}"
    print("CHECK: File exists on phone - PASS")

    # Step 6: Verify file size on phone matches
    phone_size_output = shell_cmd(serial, f"wc -c < {remote_path}")
    phone_size = int(phone_size_output.strip())
    print(f"Phone file size: {phone_size} bytes, Local file size: {size_bytes} bytes")
    assert phone_size == size_bytes, f"FAIL: Size mismatch phone={phone_size} vs local={size_bytes}"
    print("CHECK: File size matches - PASS")

    # Step 7: Clean up temp file locally
    os.unlink(temp_path)
    os.rmdir(os.path.dirname(temp_path))
    print("CHECK: Local temp file cleaned up - PASS")

    print("\nALL CHECKS PASSED - Task 3.2 verified")

if __name__ == "__main__":
    asyncio.run(main())
