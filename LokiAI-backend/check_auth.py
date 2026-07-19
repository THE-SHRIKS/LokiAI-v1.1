import requests
BASE_URL = "http://localhost:8000"

# Try various credentials that might have been registered
for email, password in [
    ("testuser2@example.com", "testpassword"),
    ("testuser@example.com", "testpassword"),
    ("test@example.com", "testpassword"),
    ("admin@edgemind.io", "testpassword"),
]:
    r = requests.post(f"{BASE_URL}/auth/login", json={"email": email, "password": password})
    print(f"  {email}: {r.status_code}")
    if r.status_code == 200:
        token = r.json()["access_token"]
        print(f"  SUCCESS. Token: {token[:50]}")
        # Get device list
        devices = requests.get(f"{BASE_URL}/devices", headers={"Authorization": f"Bearer {token}"}).json()
        print(f"  Devices: {devices}")
        break
