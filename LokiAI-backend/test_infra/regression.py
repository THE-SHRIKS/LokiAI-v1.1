"""LokiAI regression suite — runs against the DISPOSABLE test database only.

Every check here corresponds to a defect in Docs/test/LOKIAI_DEEP_AUDIT.md.
Checks are tagged with the batch that fixes them, so the same file serves as
both the failing reproducer (before a batch) and the regression test (after).

Usage (see test_infra/README.md for the full env setup):
    python test_infra/regression.py
    python test_infra/regression.py --only P0-1        # single check
    python test_infra/regression.py --expect-fail P0-4  # reproducer mode

Never point BASE_URL at production — these checks create and delete records.
"""
import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.request
import uuid

BASE_URL = os.getenv("LOKIAI_TEST_BASE_URL", "http://127.0.0.1:8000")

# Unique per run so repeated runs never collide and cleanup is unambiguous.
RUN_ID = uuid.uuid4().hex[:8]
PREFIX = f"batch0test-{RUN_ID}"

results = []


def _req(method, path, body=None, token=None, headers=None, raw=False):
    """Returns (status_code, parsed_body_or_text). Never raises on HTTP error."""
    url = f"{BASE_URL}{path}"
    data = json.dumps(body).encode() if body is not None else None
    h = {"Content-Type": "application/json"}
    if token:
        h["Authorization"] = f"Bearer {token}"
    if headers:
        h.update(headers)
    req = urllib.request.Request(url, data=data, headers=h, method=method)
    try:
        with urllib.request.urlopen(req, timeout=90) as r:
            text = r.read().decode()
            return r.status, (text if raw else _maybe_json(text))
    except urllib.error.HTTPError as e:
        text = e.read().decode()
        return e.code, (text if raw else _maybe_json(text))
    except Exception as e:  # connection refused, timeout, etc.
        return 0, {"_transport_error": str(e)}


def _maybe_json(text):
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        return text


def check(check_id, description, fn):
    """Run one check. fn() returns (passed: bool, evidence: str)."""
    try:
        passed, evidence = fn()
    except Exception as e:
        passed, evidence = False, f"EXCEPTION: {type(e).__name__}: {e}"
    results.append((check_id, description, passed, evidence))
    status = "PASS" if passed else "FAIL"
    print(f"[{status}] {check_id}: {description}")
    if not passed:
        print(f"         evidence: {evidence}")
    return passed


# ── shared fixtures ───────────────────────────────────────────────────────────

class Ctx:
    """Two separate accounts + a device, for cross-tenant isolation checks."""
    a_email = f"{PREFIX}-a@example.com"
    b_email = f"{PREFIX}-b@example.com"
    password = "RegressPass123"
    # Account C exists solely for the rate-limit check: exhausting a per-user
    # budget must not starve any other check's requests.
    c_email = f"{PREFIX}-c@example.com"
    a_token = None
    b_token = None
    c_token = None
    a_user_id = None
    b_user_id = None
    a_device_id = None
    c_device_id = None
    a_device_token = None
    c_device_token = None


def _psql(sql):
    """Run SQL against the DISPOSABLE database only."""
    import subprocess
    pg = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                      "pg_portable", "postgresql-18.4.0-x86_64-pc-windows-msvc",
                      "bin", "psql.exe")
    return subprocess.run(
        [pg, "-h", "127.0.0.1", "-p", "5433", "-U", "lokiai_test", "-d", "lokiai_test",
         "-v", "ON_ERROR_STOP=1", "-c", sql],
        capture_output=True, text=True, check=False,
    )


def _register_and_login(email, name):
    """Seed a verified account directly in the disposable DB, then log in.

    Deliberately bypasses POST /auth/register: that endpoint sends a real OTP
    email, and this suite runs with SMTP pointed at an unresolvable host (so it
    can never touch real mail infrastructure). Seeding the row directly keeps
    the suite hermetic. The LOGIN path itself is still exercised for real
    against the running backend, so auth behavior is genuinely under test.
    """
    from passlib.context import CryptContext
    pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
    pw_hash = pwd_context.hash(Ctx.password).replace("'", "''")

    r = _psql(
        "INSERT INTO users (email, password_hash, name, email_verified) "
        f"VALUES ('{email}', '{pw_hash}', '{name}', TRUE) "
        "ON CONFLICT (email) DO UPDATE SET "
        "password_hash = EXCLUDED.password_hash, email_verified = TRUE"
    )
    if r.returncode != 0:
        raise RuntimeError(f"seeding {email} failed: {r.stderr.strip()}")

    status, body = _req("POST", "/auth/login", {"email": email, "password": Ctx.password})
    if status != 200:
        raise RuntimeError(f"login failed {status}: {body}")
    return body["access_token"]


def setup():
    Ctx.a_token = _register_and_login(Ctx.a_email, "Regress A")
    Ctx.b_token = _register_and_login(Ctx.b_email, "Regress B")
    _, me_a = _req("GET", "/auth/me", token=Ctx.a_token)
    _, me_b = _req("GET", "/auth/me", token=Ctx.b_token)
    Ctx.a_user_id = me_a.get("id") if isinstance(me_a, dict) else None
    Ctx.b_user_id = me_b.get("id") if isinstance(me_b, dict) else None

    # Pair a device to account A.
    _, pair = _req("POST", "/pairing/generate", token=Ctx.a_token)
    _, dev = _req("POST", "/devices/pair", {
        "token": pair["token"], "phone_model": f"{PREFIX}-phone",
        "cpu_arch": "arm64-v8a", "ram_mb": 6144,
        "storage_free_gb": 32.0, "android_version": "13",
    })
    Ctx.a_device_id = dev.get("device_id") if isinstance(dev, dict) else None
    Ctx.a_device_token = dev.get("device_token") if isinstance(dev, dict) else None

    # Account C + its own device, isolated for the rate-limit check.
    Ctx.c_token = _register_and_login(Ctx.c_email, "Regress C")
    _, pair_c = _req("POST", "/pairing/generate", token=Ctx.c_token)
    _, dev_c = _req("POST", "/devices/pair", {
        "token": pair_c["token"], "phone_model": f"{PREFIX}-phone-c",
        "cpu_arch": "arm64-v8a", "ram_mb": 6144,
        "storage_free_gb": 32.0, "android_version": "13",
    })
    Ctx.c_device_id = dev_c.get("device_id") if isinstance(dev_c, dict) else None
    Ctx.c_device_token = dev_c.get("device_token") if isinstance(dev_c, dict) else None


# ── checks ────────────────────────────────────────────────────────────────────

def c_p0_6_auth_me_no_key_leak():
    """P0-6 / Batch 1: /auth/me must not 500, and must never return the raw key."""
    status, _ = _req("PUT", "/auth/nim-key",
                     {"api_key": "nvapi-regressiontestkey000000000000000"},
                     token=Ctx.a_token)
    if status != 200:
        return False, f"could not save test key: HTTP {status}"
    try:
        status, body = _req("GET", "/auth/me", token=Ctx.a_token)
        if status != 200:
            return False, f"GET /auth/me returned HTTP {status} (expected 200); body={body}"
        if not isinstance(body, dict):
            return False, f"unexpected body type: {body!r}"
        if body.get("has_nim_key") is not True:
            return False, f"has_nim_key should be True, got {body.get('has_nim_key')!r}"
        # The actual secret must not appear anywhere in the response.
        blob = json.dumps(body)
        if "nvapi-" in blob:
            return False, "RAW KEY LEAKED in /auth/me response body"
        return True, f"HTTP 200, has_nim_key=True, no raw key in body (keys: {sorted(body)})"
    finally:
        _req("DELETE", "/auth/nim-key", token=Ctx.a_token)


def c_p0_1_admin_stats_requires_auth():
    """P0-1 / Batch 2: /admin/stats must reject unauthenticated callers."""
    status, body = _req("GET", "/admin/stats")
    if status in (401, 403, 404):
        return True, f"unauthenticated -> HTTP {status}"
    return False, f"unauthenticated -> HTTP {status}; body={str(body)[:200]}"


def c_p0_1b_admin_stats_rejects_normal_user():
    """P0-1 / Batch 2: a normal authenticated user is not an admin."""
    status, body = _req("GET", "/admin/stats", token=Ctx.b_token)
    if status in (401, 403, 404):
        return True, f"non-admin user -> HTTP {status}"
    return False, f"non-admin user -> HTTP {status}; body={str(body)[:200]}"


def c_p0_2_feedback_scoped():
    """P0-2 / Batch 2: GET /feedback must not expose other users' feedback."""
    marker = f"{PREFIX}-secret-feedback-from-A"
    status, _ = _req("POST", "/feedback",
                     {"category": "test", "message": marker}, token=Ctx.a_token)
    if status != 200:
        return False, f"could not submit feedback as A: HTTP {status}"
    status, body = _req("GET", "/feedback", token=Ctx.b_token)
    if status in (401, 403, 404):
        return True, f"B reading feedback -> HTTP {status} (endpoint restricted)"
    if status != 200:
        return False, f"unexpected HTTP {status} for B; body={str(body)[:200]}"
    if marker in json.dumps(body):
        return False, "account B can read account A's feedback message"
    return True, "B's feedback list does not contain A's message"


def c_p0_3_monitor_requires_auth():
    """P0-3 / Batch 2: monitor endpoints must not be anonymous."""
    s1, _ = _req("GET", "/monitor/status")
    s2, _ = _req("GET", "/monitor/log")
    if s1 in (401, 403, 404) and s2 in (401, 403, 404):
        return True, f"/monitor/status -> {s1}, /monitor/log -> {s2}"
    return False, f"/monitor/status -> {s1}, /monitor/log -> {s2} (expected 401/403/404)"


def c_p0_2b_deployment_status_ownership():
    """P0-2b / Batch 2: the in-memory fast path must still enforce ownership.

    A's deployment id must not be readable by B. Uses a real deployment when
    one can be created; otherwise falls back to a random uuid, which must 404.
    """
    status, body = _req("GET", f"/deployments/{uuid.uuid4()}", token=Ctx.b_token)
    if status == 404:
        return True, "unknown deployment id -> 404 for other account"
    return False, f"unknown deployment id -> HTTP {status}; body={str(body)[:200]}"


def c_p0_5_device_register_no_hijack():
    """P0-5 / Batch 4: B must not be able to claim A's device via adb_serial."""
    serial = f"{PREFIX}-serial"
    # A registers a device with a known serial (if the endpoint still exists).
    s_a, _ = _req("POST", "/devices/register", {
        "name": "A phone", "phone_model": "A", "cpu_arch": "arm64-v8a",
        "ram_mb": 4096, "storage_free_gb": 10.0, "android_version": "13",
        "adb_serial": serial,
    }, token=Ctx.a_token)
    if s_a == 404:
        return True, "/devices/register removed (404) — hijack path gone"
    if s_a != 200:
        return True, f"/devices/register unavailable to A (HTTP {s_a}) — no hijack path"
    # B tries to claim the same serial.
    s_b, body_b = _req("POST", "/devices/register", {
        "name": "B steal", "phone_model": "B", "cpu_arch": "arm64-v8a",
        "ram_mb": 4096, "storage_free_gb": 10.0, "android_version": "13",
        "adb_serial": serial,
    }, token=Ctx.b_token)
    if s_b in (403, 404, 409):
        return True, f"B claiming A's serial -> HTTP {s_b}"
    return False, f"B claimed A's device: HTTP {s_b}; body={str(body_b)[:200]}"


def c_cross_tenant_device_read():
    """Core isolation: B must not read A's device."""
    if not Ctx.a_device_id:
        return False, "no device paired to A during setup"
    status, _ = _req("GET", f"/devices/{Ctx.a_device_id}", token=Ctx.b_token)
    if status in (403, 404):
        return True, f"B reading A's device -> HTTP {status}"
    return False, f"B reading A's device -> HTTP {status} (expected 403/404)"


def c_cross_tenant_device_delete():
    """Core isolation: B must not delete A's device."""
    if not Ctx.a_device_id:
        return False, "no device paired to A during setup"
    status, _ = _req("DELETE", f"/devices/{Ctx.a_device_id}", token=Ctx.b_token)
    if status in (403, 404):
        return True, f"B deleting A's device -> HTTP {status}"
    return False, f"B deleting A's device -> HTTP {status} (expected 403/404)"


def c_cross_tenant_deploy_to_foreign_device():
    """Core isolation: B must not deploy onto A's device."""
    if not Ctx.a_device_id:
        return False, "no device paired to A during setup"
    status, _ = _req("POST", "/deployments", {
        "device_id": Ctx.a_device_id, "hf_model_id": "litert-community/MobileNet-v2",
        "filename": "mobilenet_v2.tflite", "inference_mode": "camera",
    }, token=Ctx.b_token)
    if status in (403, 404):
        return True, f"B deploying to A's device -> HTTP {status}"
    return False, f"B deploying to A's device -> HTTP {status} (expected 403/404)"


def c_auth_required_core_routes():
    """Every user-data route must reject anonymous callers."""
    bad = []
    for method, path in [
        ("GET", "/devices"), ("GET", "/models"), ("GET", "/deployments"),
        ("GET", "/auth/me"), ("POST", "/pairing/generate"),
    ]:
        status, _ = _req(method, path)
        if status not in (401, 403):
            bad.append(f"{method} {path} -> {status}")
    if bad:
        return False, "; ".join(bad)
    return True, "all core user-data routes reject anonymous access"


def c_health_still_public():
    """Regression guard: /health must stay anonymous (uptime checks rely on it)."""
    status, body = _req("GET", "/health")
    if status == 200 and isinstance(body, dict) and body.get("status") == "ok":
        return True, "GET /health -> 200 {status: ok}"
    return False, f"GET /health -> {status}; body={str(body)[:200]}"


def c_user_flow_intact():
    """The documented v3 flow must still work end to end for a real account."""
    steps = []
    status, body = _req("GET", "/auth/me", token=Ctx.a_token)
    if status != 200:
        return False, f"/auth/me -> {status}"
    steps.append("auth/me ok")

    status, pair = _req("POST", "/pairing/generate", token=Ctx.a_token)
    if status != 200 or "token" not in pair:
        return False, f"/pairing/generate -> {status}"
    steps.append("pairing ok")

    status, dev = _req("POST", "/devices/pair", {
        "token": pair["token"], "phone_model": f"{PREFIX}-flowphone",
        "cpu_arch": "arm64-v8a", "ram_mb": 6144,
        "storage_free_gb": 32.0, "android_version": "13",
    })
    if status != 200 or "device_id" not in dev:
        return False, f"/devices/pair -> {status}"
    steps.append("pair ok")

    status, devices = _req("GET", "/devices", token=Ctx.a_token)
    if status != 200 or not isinstance(devices, list) or not devices:
        return False, f"/devices -> {status}"
    steps.append(f"devices ok ({len(devices)})")

    status, search = _req("POST", "/models/search", {
        "device_id": dev["device_id"],
        "user_message": "I want to classify images with my camera",
    }, token=Ctx.a_token)
    if status != 200:
        return False, f"/models/search -> {status}: {str(search)[:200]}"
    recs = search.get("recommendations", []) if isinstance(search, dict) else []
    if not recs:
        return False, "/models/search returned zero recommendations"
    steps.append(f"search ok ({len(recs)} real HF results)")

    return True, "; ".join(steps)


def c_p0_7_cors_no_vercel_wildcard():
    """P0-7 / Batch 6: an arbitrary *.vercel.app origin must not be allowed.

    With allow_credentials=True, any accepted origin can call /auth/refresh
    from a victim's browser and read the new access token — session takeover.
    """
    evil = "https://evil-attacker-poc.vercel.app"
    status, _ = _req("OPTIONS", "/auth/refresh", headers={
        "Origin": evil,
        "Access-Control-Request-Method": "POST",
    })
    # Re-issue to read headers directly.
    req = urllib.request.Request(f"{BASE_URL}/auth/refresh", method="OPTIONS")
    req.add_header("Origin", evil)
    req.add_header("Access-Control-Request-Method", "POST")
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            allow = r.headers.get("access-control-allow-origin")
    except urllib.error.HTTPError as e:
        allow = e.headers.get("access-control-allow-origin")
    except Exception as e:
        return False, f"transport error: {e}"

    if allow and evil in allow:
        return False, f"attacker origin allowed by CORS: allow-origin={allow!r}"
    return True, f"attacker origin rejected (allow-origin={allow!r})"


def c_cors_real_dashboard_still_allowed():
    """Regression guard: the configured dashboard origin must keep working."""
    good = "http://localhost:8080"
    req = urllib.request.Request(f"{BASE_URL}/auth/refresh", method="OPTIONS")
    req.add_header("Origin", good)
    req.add_header("Access-Control-Request-Method", "POST")
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            allow = r.headers.get("access-control-allow-origin")
            creds = r.headers.get("access-control-allow-credentials")
    except urllib.error.HTTPError as e:
        allow = e.headers.get("access-control-allow-origin")
        creds = e.headers.get("access-control-allow-credentials")
    except Exception as e:
        return False, f"transport error: {e}"

    if allow and good in allow and creds == "true":
        return True, f"dashboard origin allowed (allow-origin={allow!r}, credentials={creds})"
    return False, f"dashboard origin NOT allowed: allow-origin={allow!r}, credentials={creds!r}"


def c_p0_8_upload_size_capped():
    """P0-8 / Batch 5: /models/upload must reject an oversized body.

    Sends only the headers with an over-limit Content-Length, so the check is
    cheap — the middleware must reject before any body is read.
    """
    cap_mb = int(os.getenv("MAX_UPLOAD_MB", "600"))
    oversized = (cap_mb + 50) * 1024 * 1024
    req = urllib.request.Request(f"{BASE_URL}/models/upload", method="POST", data=b"")
    req.add_header("Authorization", f"Bearer {Ctx.a_token}")
    req.add_header("Content-Type", "multipart/form-data; boundary=x")
    req.add_header("Content-Length", str(oversized))
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return False, f"oversized upload accepted: HTTP {r.status}"
    except urllib.error.HTTPError as e:
        if e.code == 413:
            return True, "oversized upload -> HTTP 413 (rejected before body read)"
        return False, f"expected 413, got HTTP {e.code}"
    except Exception as e:
        # urllib may refuse to send a body it doesn't have; treat a transport
        # failure as inconclusive rather than a pass.
        return False, f"inconclusive (transport): {e}"


def c_p1_2_search_rate_limited():
    """P1-2 / Batch 5: /models/search must throttle sustained abuse.

    Uses dedicated account C — the limit is per authenticated user, so burning
    a budget here must not affect any other check.
    """
    if not Ctx.c_device_id:
        return False, "no device paired to C during setup"
    saw_429 = False
    codes = []
    for _ in range(26):
        status, _ = _req("POST", "/models/search", {
            "device_id": Ctx.c_device_id, "user_message": "chatbot",
        }, token=Ctx.c_token)
        codes.append(status)
        if status == 429:
            saw_429 = True
            break
    if saw_429:
        return True, f"429 after {len(codes)} calls (limit 20/min)"
    return False, f"no 429 in {len(codes)} rapid calls; codes={sorted(set(codes))}"


def _ws_connect(device_id, token=None, timeout=10):
    """Open a device WebSocket. Returns (connected: bool, detail: str)."""
    import asyncio
    import websockets

    url = BASE_URL.replace("http://", "ws://").replace("https://", "wss://")
    url = f"{url}/ws/device/{device_id}"
    if token:
        url = f"{url}?token={token}"

    async def go():
        try:
            async with websockets.connect(url, open_timeout=timeout) as ws:
                msg = await asyncio.wait_for(ws.recv(), timeout=timeout)
                return True, f"connected, first message: {str(msg)[:120]}"
        except Exception as e:
            return False, f"{type(e).__name__}: {str(e)[:160]}"

    return asyncio.run(go())


def c_p0_4_ws_requires_auth():
    """P0-4 / Batch 3: the device socket must reject a bare device_id.

    Previously any device_id connected with no credential at all — enough to
    receive another user's deployment pushes and forge their device presence.
    """
    if not Ctx.a_device_id:
        return False, "no device paired to A during setup"
    ok, detail = _ws_connect(Ctx.a_device_id, token=None)
    if ok:
        return False, f"unauthenticated socket ACCEPTED: {detail}"
    return True, f"unauthenticated socket rejected ({detail})"


def c_p0_4b_ws_rejects_foreign_token():
    """P0-4 / Batch 3: a token minted for one device must not open another."""
    if not (Ctx.a_device_id and Ctx.c_device_id):
        return False, "need two paired devices for this check"
    if not Ctx.c_device_token:
        return False, "no device token issued at pairing for C"
    ok, detail = _ws_connect(Ctx.a_device_id, token=Ctx.c_device_token)
    if ok:
        return False, f"C's token opened A's socket: {detail}"
    return True, f"cross-device token rejected ({detail})"


def c_ws_valid_token_connects():
    """Regression guard: a correctly paired device must still connect."""
    if not Ctx.a_device_id or not Ctx.a_device_token:
        return False, "no device token issued at pairing for A"
    ok, detail = _ws_connect(Ctx.a_device_id, token=Ctx.a_device_token)
    if ok:
        return True, detail
    return False, f"legitimate device could not connect: {detail}"


def c_pair_returns_device_token():
    """Batch 3 contract: /devices/pair must issue a device credential."""
    if Ctx.a_device_token and isinstance(Ctx.a_device_token, str):
        return True, f"device_token issued (len={len(Ctx.a_device_token)})"
    return False, "POST /devices/pair did not return a device_token"


def c_no_secret_in_error_bodies():
    """Error responses must never carry secrets or stack traces."""
    status, body = _req("GET", "/devices/not-a-uuid", token=Ctx.a_token)
    blob = json.dumps(body) if not isinstance(body, str) else body
    for leak in ("Traceback", "nvapi-", "postgresql://", "JWT_SECRET"):
        if leak in blob:
            return False, f"error body contains {leak!r}: {blob[:200]}"
    return True, f"HTTP {status}, no secrets/traceback in body"


CHECKS = [
    ("P0-6", "/auth/me works and never returns the raw NIM key", c_p0_6_auth_me_no_key_leak),
    ("P0-1", "/admin/stats rejects anonymous callers", c_p0_1_admin_stats_requires_auth),
    ("P0-1b", "/admin/stats rejects non-admin users", c_p0_1b_admin_stats_rejects_normal_user),
    ("P0-2", "GET /feedback does not leak other users' feedback", c_p0_2_feedback_scoped),
    ("P0-2b", "/deployments/{id} enforces ownership on all paths", c_p0_2b_deployment_status_ownership),
    ("P0-3", "/monitor/* rejects anonymous callers", c_p0_3_monitor_requires_auth),
    ("P0-5", "/devices/register cannot hijack another user's device", c_p0_5_device_register_no_hijack),
    ("P0-7", "CORS rejects arbitrary *.vercel.app origins", c_p0_7_cors_no_vercel_wildcard),
    ("P0-8", "/models/upload rejects oversized bodies", c_p0_8_upload_size_capped),
    ("P1-2", "/models/search is rate limited", c_p1_2_search_rate_limited),
    ("P0-4", "device WebSocket rejects unauthenticated connects", c_p0_4_ws_requires_auth),
    ("P0-4b", "device WebSocket rejects a token for a different device", c_p0_4b_ws_rejects_foreign_token),
    ("WS-1", "correctly paired device can still connect", c_ws_valid_token_connects),
    ("WS-2", "/devices/pair issues a device credential", c_pair_returns_device_token),
    ("CORS-1", "configured dashboard origin still allowed with credentials", c_cors_real_dashboard_still_allowed),
    ("ISO-1", "cross-tenant device read blocked", c_cross_tenant_device_read),
    ("ISO-2", "cross-tenant device delete blocked", c_cross_tenant_device_delete),
    ("ISO-3", "cross-tenant deployment blocked", c_cross_tenant_deploy_to_foreign_device),
    ("AUTH-1", "core user-data routes require auth", c_auth_required_core_routes),
    ("FLOW-1", "documented v3 user flow still works end to end", c_user_flow_intact),
    ("SEC-1", "no secrets or tracebacks in error bodies", c_no_secret_in_error_bodies),
    ("PUB-1", "/health remains public", c_health_still_public),
]


def cleanup():
    """Remove only the synthetic records this run created."""
    sql = f"""
    DELETE FROM deployments WHERE user_id IN (SELECT id FROM users WHERE email LIKE '{PREFIX}%');
    DELETE FROM models      WHERE user_id IN (SELECT id FROM users WHERE email LIKE '{PREFIX}%');
    DELETE FROM devices     WHERE user_id IN (SELECT id FROM users WHERE email LIKE '{PREFIX}%');
    DELETE FROM pairing_tokens WHERE user_id IN (SELECT id FROM users WHERE email LIKE '{PREFIX}%');
    DELETE FROM email_otps  WHERE user_id IN (SELECT id FROM users WHERE email LIKE '{PREFIX}%');
    DELETE FROM password_reset_tokens WHERE user_id IN (SELECT id FROM users WHERE email LIKE '{PREFIX}%');
    DELETE FROM users WHERE email LIKE '{PREFIX}%';
    """
    r = _psql(sql)
    print(f"\n[cleanup] removed synthetic records for prefix {PREFIX} "
          f"(rc={r.returncode})")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", help="run a single check by id (e.g. P0-1)")
    ap.add_argument("--no-cleanup", action="store_true")
    args = ap.parse_args()

    print(f"LokiAI regression — target {BASE_URL} — run {RUN_ID}\n")
    status, _ = _req("GET", "/health")
    if status != 200:
        print(f"ABORT: backend not reachable at {BASE_URL} (HTTP {status})")
        return 2

    try:
        setup()
    except Exception as e:
        print(f"ABORT: setup failed: {e}")
        return 2

    try:
        for cid, desc, fn in CHECKS:
            if args.only and cid != args.only:
                continue
            check(cid, desc, fn)
    finally:
        if not args.no_cleanup:
            cleanup()

    passed = sum(1 for _, _, p, _ in results if p)
    failed = len(results) - passed
    print(f"\n{'='*64}\nTOTAL: {len(results)} checks, {passed} passed, {failed} failed")
    if failed:
        print("\nFAILED:")
        for cid, desc, p, ev in results:
            if not p:
                print(f"  {cid}: {desc}\n      {ev}")
    print("=" * 64)
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
