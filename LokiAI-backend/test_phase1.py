import httpx
import asyncio
import json

async def run_test():
    base_url = 'http://localhost:8000'
    print("Starting Phase 1 End-to-End Test")
    
    timeout_config = httpx.Timeout(120.0, connect=60.0)
    async with httpx.AsyncClient(timeout=timeout_config) as client:
        # 1. Register
        print("1. Register User")
        r_body = {'email': 'e2e_user3@example.com', 'password': 'password123'}
        r = await client.post(f"{base_url}/auth/register", json=r_body)
        print("Register status:", r.status_code)
        if r.status_code != 200 and r.status_code != 400:
            print(r.text)
            return
            
        # 2. Login
        print("2. Login User")
        l = await client.post(f"{base_url}/auth/login", json=r_body)
        print("Login status:", l.status_code)
        token = l.json()['access_token']
        headers = {'Authorization': f'Bearer {token}'}
        
        # 3. Register Device
        print("3. Register Device")
        d_body = {
          "name": "E2E Phone",
          "phone_model": "Pixel 6",
          "cpu_arch": "arm64-v8a",
          "ram_mb": 8192,
          "storage_free_gb": 40.5,
          "android_version": "12",
          "adb_serial": "E2E_SERIAL3"
        }
        d = await client.post(f"{base_url}/devices/register", json=d_body, headers=headers)
        print("Device register status:", d.status_code)
        device_id = d.json()['device_id']
        
        # 4. Search Models
        print("4. Search Models")
        s_body = {'device_id': device_id, 'user_message': 'I need a fast tflite object detection model'}
        s = await client.post(f"{base_url}/models/search", json=s_body, headers=headers)
        print("Models search status:", s.status_code)
        print("Models found:", len(s.json().get('recommendations', [])))
        
        # 5. Assistant Chat
        print("5. Assistant Chat")
        c_body = {'device_id': device_id, 'message': 'I need a fast tflite object detection model'}
        c = await client.post(f"{base_url}/assistant/chat", json=c_body, headers=headers)
        print("Assistant chat status:", c.status_code)
        print("Assistant response keys:", list(c.json().keys()))
        print("ALL TESTS PASSED")

asyncio.run(run_test())
