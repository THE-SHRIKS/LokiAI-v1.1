"""Batch 7 presence-liveness test (disposable DB only).

Proves the two halves of the reconnect defect:
  1. a device that stops heartbeating flips to 'offline' on its own, without
     any clean socket close — previously it stayed 'connected' forever;
  2. a device that reconnects flips back to 'connected'.

Run with a short TTL so the test doesn't take minutes:
    PRESENCE_TTL_SECONDS=5 bash test_infra/run_test_backend.sh
    python test_infra/presence_test.py
"""
import asyncio
import json
import os
import subprocess
import sys
import urllib.request
import uuid

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from regression import _psql, _req, Ctx, PREFIX  # noqa: E402

import websockets  # noqa: E402

BASE_URL = os.getenv("LOKIAI_TEST_BASE_URL", "http://127.0.0.1:8000")
WS_BASE = BASE_URL.replace("http://", "ws://").replace("https://", "wss://")


def db_status(device_id):
    r = _psql(f"SELECT status FROM devices WHERE id = '{device_id}'")
    for line in r.stdout.splitlines():
        line = line.strip()
        if line in ("connected", "offline", "paired"):
            return line
    return f"<unparsed: {r.stdout.strip()[:120]}>"


async def main():
    from passlib.context import CryptContext
    email = f"{PREFIX}-presence@example.com"
    pw = "PresencePass123"
    pw_hash = CryptContext(schemes=["bcrypt"]).hash(pw).replace("'", "''")
    _psql(
        "INSERT INTO users (email, password_hash, name, email_verified) "
        f"VALUES ('{email}', '{pw_hash}', 'Presence Test', TRUE) "
        "ON CONFLICT (email) DO UPDATE SET password_hash=EXCLUDED.password_hash, email_verified=TRUE"
    )
    status, body = _req("POST", "/auth/login", {"email": email, "password": pw})
    token = body["access_token"]

    _, pair = _req("POST", "/pairing/generate", token=token)
    _, dev = _req("POST", "/devices/pair", {
        "token": pair["token"], "phone_model": f"{PREFIX}-presence-phone",
        "cpu_arch": "arm64-v8a", "ram_mb": 4096,
        "storage_free_gb": 16.0, "android_version": "13",
    })
    device_id = dev["device_id"]
    device_token = dev["device_token"]
    print(f"paired device {device_id}")
    print(f"  status after pairing: {db_status(device_id)}")

    ttl = int(os.getenv("PRESENCE_TTL_SECONDS", "70"))
    results = []

    # 1. Connect and heartbeat -> connected.
    url = f"{WS_BASE}/ws/device/{device_id}?token={device_token}"
    ws = await websockets.connect(url, open_timeout=10)
    await ws.recv()  # 'connected' frame
    await ws.send(json.dumps({"type": "heartbeat", "device_id": device_id}))
    await asyncio.wait_for(ws.recv(), timeout=10)  # heartbeat_ack (or state_ack)
    await asyncio.sleep(1)
    s = db_status(device_id)
    print(f"  status while connected+heartbeating: {s}")
    results.append(("device shows connected while heartbeating", s == "connected", s))

    # 2. Vanish WITHOUT a clean close (simulates process kill / dead network),
    #    then wait past the TTL + one sweep interval.
    # Abort the transport outright — no close frame is sent, which is exactly
    # what a killed app or a black-holed network looks like to the server.
    # (1006 cannot be sent deliberately; it only ever *describes* this case.)
    ws_transport = getattr(ws, "transport", None)
    if ws_transport is not None:
        ws_transport.abort()
    else:
        await ws.close()
    wait_s = ttl + 35
    print(f"  socket abandoned; waiting {wait_s}s for the presence sweep...")
    await asyncio.sleep(wait_s)
    s = db_status(device_id)
    print(f"  status after heartbeat went stale: {s}")
    results.append(("stale heartbeat expires device to offline", s == "offline", s))

    # 3. Reconnect -> back to connected (the reported bug: phone turned back
    #    on but the dashboard kept showing it offline).
    ws2 = await websockets.connect(url, open_timeout=10)
    await ws2.recv()
    await ws2.send(json.dumps({"type": "heartbeat", "device_id": device_id}))
    await asyncio.wait_for(ws2.recv(), timeout=10)
    await asyncio.sleep(1)
    s = db_status(device_id)
    print(f"  status after reconnect: {s}")
    results.append(("reconnect restores connected", s == "connected", s))
    await ws2.close()

    # cleanup
    _psql(
        f"DELETE FROM deployments WHERE device_id = '{device_id}'; "
        f"DELETE FROM devices WHERE id = '{device_id}'; "
        f"DELETE FROM pairing_tokens WHERE user_id IN (SELECT id FROM users WHERE email='{email}'); "
        f"DELETE FROM users WHERE email = '{email}';"
    )

    print("\n" + "=" * 60)
    failed = 0
    for name, ok, evidence in results:
        print(f"[{'PASS' if ok else 'FAIL'}] {name} (observed: {evidence})")
        if not ok:
            failed += 1
    print(f"TOTAL: {len(results)} checks, {len(results)-failed} passed, {failed} failed")
    print("=" * 60)
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
