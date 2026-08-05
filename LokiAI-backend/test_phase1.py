"""Phase 1 end-to-end integration test: register -> login -> pair device ->
search -> chat, against a REAL running backend.

This must never run during plain `python -m unittest discover` or `pytest`
collection — it needs a live server and creates real users/devices, and the
old version of this file made that live HTTP call at import time, which
broke discovery for every other test in the suite. It now only runs when
explicitly opted into.

Run explicitly, with a backend already running at BACKEND_URL:
    RUN_INTEGRATION_TESTS=1 python -m unittest test_phase1 -v
"""
import os
import unittest
import uuid

import httpx

RUN_INTEGRATION = os.environ.get("RUN_INTEGRATION_TESTS") == "1"
BASE_URL = os.environ.get("BACKEND_URL", "http://localhost:8000")


@unittest.skipUnless(
    RUN_INTEGRATION,
    "set RUN_INTEGRATION_TESTS=1 and run a live backend at BACKEND_URL to run this",
)
class Phase1EndToEndTest(unittest.TestCase):
    def test_register_login_device_search_chat(self):
        import asyncio

        asyncio.run(self._run())

    async def _run(self):
        timeout_config = httpx.Timeout(120.0, connect=60.0)
        async with httpx.AsyncClient(timeout=timeout_config) as client:
            # A fixed email meant every rerun after the first hit a stale
            # account; a fresh one per run keeps this test repeatable.
            email = f"e2e_{uuid.uuid4().hex[:12]}@example.com"
            r_body = {"email": email, "password": "password123"}
            r = await client.post(f"{BASE_URL}/auth/register", json=r_body)
            self.assertIn(r.status_code, (200, 400), r.text)

            l = await client.post(f"{BASE_URL}/auth/login", json=r_body)
            self.assertEqual(l.status_code, 200, l.text)
            token = l.json()["access_token"]
            headers = {"Authorization": f"Bearer {token}"}

            d_body = {
                "name": "E2E Phone",
                "phone_model": "Pixel 6",
                "cpu_arch": "arm64-v8a",
                "ram_mb": 8192,
                "storage_free_gb": 40.5,
                "android_version": "12",
                "adb_serial": f"E2E_{uuid.uuid4().hex[:8]}",
            }
            d = await client.post(
                f"{BASE_URL}/devices/register", json=d_body, headers=headers
            )
            self.assertEqual(d.status_code, 200, d.text)
            device_id = d.json()["device_id"]

            s_body = {
                "device_id": device_id,
                "user_message": "I need a fast tflite object detection model",
            }
            s = await client.post(
                f"{BASE_URL}/models/search", json=s_body, headers=headers
            )
            self.assertEqual(s.status_code, 200, s.text)

            c_body = {
                "device_id": device_id,
                "message": "I need a fast tflite object detection model",
            }
            c = await client.post(
                f"{BASE_URL}/assistant/chat", json=c_body, headers=headers
            )
            self.assertEqual(c.status_code, 200, c.text)


if __name__ == "__main__":
    unittest.main()
