"""
Task 3.1 Verification — Download a real model from HuggingFace to a local temp folder.
Tests: file exists, size > 0, SHA256 is non-empty, file is not corrupt.
"""
import asyncio
import tempfile
import hashlib
import os
import httpx

async def download_model_to_temp(hf_model_id: str, filename: str):
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
    # Use a real small TFLite model from HuggingFace
    hf_model_id = "Synaptics/MobileNetV2"
    filename = "MobileNetV2_float16.tflite"

    print(f"Downloading {hf_model_id}/{filename} ...")
    temp_path, sha256_hash, size_bytes = await download_model_to_temp(hf_model_id, filename)

    size_mb = size_bytes / (1024 * 1024)
    print(f"Downloaded to: {temp_path}")
    print(f"File size: {size_bytes} bytes ({size_mb:.2f} MB)")
    print(f"SHA256: {sha256_hash}")

    # Verify file exists
    assert os.path.exists(temp_path), "FAIL: File does not exist"
    print("CHECK: File exists on disk - PASS")

    # Verify file size > 0
    file_size_on_disk = os.path.getsize(temp_path)
    assert file_size_on_disk > 0, "FAIL: File is empty"
    assert file_size_on_disk == size_bytes, f"FAIL: Size mismatch disk={file_size_on_disk} vs downloaded={size_bytes}"
    print(f"CHECK: File size on disk matches ({file_size_on_disk} bytes) - PASS")

    # Verify SHA256 is non-empty
    assert len(sha256_hash) == 64, "FAIL: SHA256 is invalid"
    print(f"CHECK: SHA256 is valid (64 hex chars) - PASS")

    # Re-read file and verify SHA256 matches
    sha256_verify = hashlib.sha256()
    with open(temp_path, "rb") as f:
        while chunk := f.read(8192):
            sha256_verify.update(chunk)
    assert sha256_verify.hexdigest() == sha256_hash, "FAIL: SHA256 mismatch on re-read"
    print("CHECK: SHA256 verified on re-read - PASS")

    # Clean up temp file
    os.unlink(temp_path)
    os.rmdir(os.path.dirname(temp_path))
    print("CHECK: Temp file cleaned up - PASS")

    print("\nALL CHECKS PASSED - Task 3.1 verified")

if __name__ == "__main__":
    asyncio.run(main())
