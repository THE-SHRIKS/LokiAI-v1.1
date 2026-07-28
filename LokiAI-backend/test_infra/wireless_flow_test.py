"""End-to-end proof of the v3 wireless chain: QR -> HTTP(S) pair -> WSS -> CDN.

Asserts that a model reaches a phone with no cable, no ADB, and no server-side
file push — the backend only ever hands the device a URL, and the device
fetches it itself from the CDN.

Run against the disposable test backend:
    python test_infra/wireless_flow_test.py
"""
import asyncio
import json
import os
import sys
import uuid

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from regression import _psql, _req, BASE_URL, PREFIX  # noqa: E402

import websockets  # noqa: E402

WS_BASE = BASE_URL.replace("http://", "ws://").replace("https://", "wss://")
results = []


def check(name, ok, evidence):
    results.append((name, ok, evidence))
    print(f"[{'PASS' if ok else 'FAIL'}] {name}")
    print(f"        {evidence}")


async def main():
    from passlib.context import CryptContext
    email = f"{PREFIX}-wireless@example.com"
    pw = "WirelessPass123"
    pw_hash = CryptContext(schemes=["bcrypt"]).hash(pw).replace("'", "''")
    _psql("INSERT INTO users (email, password_hash, name, email_verified) "
          f"VALUES ('{email}', '{pw_hash}', 'Wireless Flow', TRUE) "
          "ON CONFLICT (email) DO UPDATE SET email_verified = TRUE")
    _, body = _req("POST", "/auth/login", {"email": email, "password": pw})
    token = body["access_token"]

    # 1. Discovery: the backend advertises a network-reachable base URL, which
    #    is what makes a cable unnecessary in the first place.
    status, info = _req("GET", "/system/info")
    ok = status == 200 and isinstance(info, dict) and info.get("backend_url", "").startswith("http")
    check("1. backend advertises a network-reachable URL (no cable needed)",
          ok, f"HTTP {status}, backend_url={info.get('backend_url') if isinstance(info, dict) else info!r}")

    # 2. QR payload: everything the phone needs, delivered optically.
    status, pair = _req("POST", "/pairing/generate", token=token)
    qr = json.loads(pair["qr_data"]) if status == 200 else {}
    ok = status == 200 and {"backend_url", "token", "user_id"} <= set(qr)
    check("2. QR payload carries backend_url + one-time token + user_id",
          ok, f"HTTP {status}, qr keys={sorted(qr)}")

    # 3. Self-registration over HTTP. The phone posts its own specs; nothing is
    #    read off the device by the server.
    status, dev = _req("POST", "/devices/pair", {
        "token": qr["token"], "phone_model": f"{PREFIX}-wireless-phone",
        "cpu_arch": "arm64-v8a", "ram_mb": 6144,
        "storage_free_gb": 32.0, "android_version": "13",
    })
    device_id = dev.get("device_id")
    device_token = dev.get("device_token")
    ws_url = dev.get("websocket_url", "")
    ok = status == 200 and device_id and device_token
    check("3. phone self-registers over HTTP and receives a device credential",
          ok, f"HTTP {status}, device_id={'set' if device_id else 'MISSING'}, "
              f"device_token={'issued' if device_token else 'MISSING'}")

    # 4. The socket URL is a network URL, not a local/cable transport.
    ok = ws_url.startswith(("ws://", "wss://")) and "token=" in ws_url
    check("4. websocket_url is a network socket carrying the credential",
          ok, f"scheme={ws_url.split('://')[0] if '://' in ws_url else '?'}://…, "
              f"token param {'present' if 'token=' in ws_url else 'MISSING'}")

    # 5. Authenticated socket over the network.
    url = f"{WS_BASE}/ws/device/{device_id}?token={device_token}"
    async with websockets.connect(url, open_timeout=15) as ws:
        first = json.loads(await asyncio.wait_for(ws.recv(), timeout=15))
        ok = first.get("type") == "connected"
        check("5. device connects over authenticated WebSocket",
              ok, f"first frame type={first.get('type')!r}")

        # 6. Deploy: the backend must hand over a CDN URL, not bytes.
        status, dep = _req("POST", "/deployments", {
            "device_id": device_id,
            "hf_model_id": "litert-community/MobileNet-v2",
            "filename": "mobilenet_v2.tflite",
            "inference_mode": "camera",
        }, token=token)

        instruction = None
        if status == 200:
            for _ in range(4):
                msg = json.loads(await asyncio.wait_for(ws.recv(), timeout=30))
                if msg.get("action") == "deploy":
                    instruction = msg
                    break
        ok = instruction is not None
        check("6. deploy instruction is pushed over the socket",
              ok, f"HTTP {status}, action={instruction.get('action') if instruction else 'NOT RECEIVED'}")

        if instruction:
            model_url = instruction.get("model_url", "")
            ok = model_url.startswith("https://") and "huggingface.co" in model_url
            check("7. instruction carries a public CDN URL the phone fetches itself",
                  ok, f"model_url scheme={model_url.split('://')[0] if '://' in model_url else '?'}, "
                      f"host={'huggingface.co' if 'huggingface.co' in model_url else 'OTHER'}")

            # The server hands over a URL and a hash — never file bytes.
            ok = "model_sha256" in instruction and not any(
                k in instruction for k in ("file_bytes", "payload", "content", "adb", "local_path"))
            check("8. no file bytes and no local/ADB path in the instruction",
                  ok, f"keys={sorted(instruction)}")

    # 9. The device row exposed to clients never leaks the legacy serial column.
    status, devices = _req("GET", "/devices", token=token)
    leaked = any("adb_serial" in d for d in devices) if isinstance(devices, list) else True
    check("9. adb_serial is never exposed in the devices API",
          not leaked, f"HTTP {status}, {len(devices) if isinstance(devices, list) else '?'} device(s), "
                      f"adb_serial present={leaked}")

    _psql(
        f"DELETE FROM deployments WHERE user_id IN (SELECT id FROM users WHERE email='{email}'); "
        f"DELETE FROM models WHERE user_id IN (SELECT id FROM users WHERE email='{email}'); "
        f"DELETE FROM devices WHERE user_id IN (SELECT id FROM users WHERE email='{email}'); "
        f"DELETE FROM pairing_tokens WHERE user_id IN (SELECT id FROM users WHERE email='{email}'); "
        f"DELETE FROM users WHERE email='{email}'"
    )

    failed = sum(1 for _, ok, _ in results if not ok)
    print("\n" + "=" * 64)
    print(f"WIRELESS CHAIN: {len(results)} checks, {len(results)-failed} passed, {failed} failed")
    print("=" * 64)
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
