"""Latency measurement for the endpoints named in the performance brief.

Measures real requests against a running backend and a real HuggingFace. No
synthetic timings, no estimates — every number here is an observed round trip.

    python test_infra/perf_probe.py --runs 7

Reports p50/p95 per endpoint. Run it before and after a change and compare;
an optimization without both numbers is not a measured optimization.
"""
import argparse
import json
import os
import statistics
import subprocess
import sys
import time
import urllib.error
import urllib.request
import uuid

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from regression import _psql, _req, BASE_URL  # noqa: E402


def pct(values, p):
    if not values:
        return float("nan")
    ordered = sorted(values)
    if len(ordered) == 1:
        return ordered[0]
    k = (len(ordered) - 1) * (p / 100)
    lo, hi = int(k), min(int(k) + 1, len(ordered) - 1)
    return ordered[lo] + (ordered[hi] - ordered[lo]) * (k - lo)


def timed(method, path, body=None, token=None):
    t0 = time.perf_counter()
    status, payload = _req(method, path, body, token=token)
    return (time.perf_counter() - t0) * 1000.0, status, payload


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--runs", type=int, default=7)
    ap.add_argument("--label", default="run")
    args = ap.parse_args()

    from passlib.context import CryptContext
    email = f"perfprobe-{uuid.uuid4().hex[:8]}@example.com"
    pw = "PerfPass123"
    pw_hash = CryptContext(schemes=["bcrypt"]).hash(pw).replace("'", "''")
    _psql("INSERT INTO users (email, password_hash, name, email_verified) "
          f"VALUES ('{email}', '{pw_hash}', 'Perf Probe', TRUE)")

    _, body = _req("POST", "/auth/login", {"email": email, "password": pw})
    token = body["access_token"]
    _, pair = _req("POST", "/pairing/generate", token=token)
    _, dev = _req("POST", "/devices/pair", {
        "token": pair["token"], "phone_model": "perf-probe-phone",
        "cpu_arch": "arm64-v8a", "ram_mb": 6144,
        "storage_free_gb": 32.0, "android_version": "13",
    })
    device_id = dev["device_id"]

    scenarios = [
        ("GET /health", lambda: timed("GET", "/health")),
        ("GET /auth/me", lambda: timed("GET", "/auth/me", token=token)),
        ("GET /devices", lambda: timed("GET", "/devices", token=token)),
        ("GET /deployments", lambda: timed("GET", "/deployments", token=token)),
        ("GET /models", lambda: timed("GET", "/models", token=token)),
        ("POST /models/search (real HF)", lambda: timed(
            "POST", "/models/search",
            {"device_id": device_id, "user_message": "offline chatbot"}, token)),
        # Direct-repo resolution. No NIM key configured, so this stops at the
        # key gate — it measures our own request handling, not the provider.
        ("POST /assistant/chat direct-URL (no key)", lambda: timed(
            "POST", "/assistant/chat",
            {"device_id": device_id,
             "message": "https://huggingface.co/litert-community/MobileNet-v2"},
            token)),
        ("POST /assistant/chat greeting (no key)", lambda: timed(
            "POST", "/assistant/chat",
            {"device_id": device_id, "message": "hello"}, token)),
    ]

    print(f"perf probe [{args.label}] — {args.runs} runs each — target {BASE_URL}\n")
    print(f"{'endpoint':<44} {'n':>3} {'p50 ms':>9} {'p95 ms':>9} {'min':>8} {'max':>8}  statuses")
    print("-" * 104)

    results = {}
    for name, fn in scenarios:
        samples, statuses = [], set()
        for _ in range(args.runs):
            ms, status, _ = fn()
            samples.append(ms)
            statuses.add(status)
        results[name] = {
            "n": len(samples),
            "p50": round(pct(samples, 50), 1),
            "p95": round(pct(samples, 95), 1),
            "min": round(min(samples), 1),
            "max": round(max(samples), 1),
            "statuses": sorted(statuses),
        }
        r = results[name]
        print(f"{name:<44} {r['n']:>3} {r['p50']:>9.1f} {r['p95']:>9.1f} "
              f"{r['min']:>8.1f} {r['max']:>8.1f}  {r['statuses']}")

    # Second pass on the cacheable direct-repo path, to show cache effect.
    print("\ndirect-repo resolution, repeated (cache behaviour):")
    for i in range(3):
        ms, status, _ = timed("POST", "/assistant/chat",
                              {"device_id": device_id,
                               "message": "https://huggingface.co/litert-community/MobileNet-v2"},
                              token)
        print(f"  call {i+1}: {ms:8.1f} ms  (HTTP {status})")

    _psql(
        f"DELETE FROM deployments WHERE user_id IN (SELECT id FROM users WHERE email='{email}'); "
        f"DELETE FROM models WHERE user_id IN (SELECT id FROM users WHERE email='{email}'); "
        f"DELETE FROM devices WHERE user_id IN (SELECT id FROM users WHERE email='{email}'); "
        f"DELETE FROM pairing_tokens WHERE user_id IN (SELECT id FROM users WHERE email='{email}'); "
        f"DELETE FROM users WHERE email='{email}'"
    )
    print(f"\n[cleanup] removed perf probe account")

    out = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                       f"perf_{args.label}.json")
    with open(out, "w") as f:
        json.dump(results, f, indent=2)
    print(f"[saved] {out}")


if __name__ == "__main__":
    main()
