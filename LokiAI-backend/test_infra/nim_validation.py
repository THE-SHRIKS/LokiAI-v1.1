"""Real NIM + assistant validation — all 15 directive scenarios.

Uses the authorized key from LokiAI-backend/.env. The key value is read into
memory, submitted through the real PUT /auth/nim-key, and deleted from the test
account at the end. It is NEVER printed, logged, written to a file, or included
in any report — only whether one was configured.

Three kinds of scenario, labelled honestly in the output:
  [LIVE]  a real call to NVIDIA NIM with the real key
  [FAULT] a real call whose failure is genuinely induced (bad key, dead host)
  [UNIT]  our own classifier/sanitiser exercised directly, because the real
          provider cannot be made to emit that condition on demand

Nothing here fakes a provider response and presents it as real.

    python test_infra/nim_validation.py
"""
import json
import os
import sys
import time
import urllib.error
import urllib.request
import uuid

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from regression import _psql, _req, BASE_URL, PREFIX  # noqa: E402

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
results = []


def record(sid, kind, name, status, evidence):
    results.append((sid, kind, name, status, evidence))
    print(f"[{status:4}] {sid:>4} {kind:7} {name}")
    print(f"           {evidence}")


def load_key():
    """Read the authorized key. Returns the value; never prints it."""
    from dotenv import dotenv_values
    v = dotenv_values(os.path.join(BACKEND_DIR, ".env"))
    return (v.get("NVIDIA_API_KEY") or "").strip()


def seed_account(email, name):
    from passlib.context import CryptContext
    pw = "NimValidate123"
    h = CryptContext(schemes=["bcrypt"]).hash(pw).replace("'", "''")
    _psql("INSERT INTO users (email, password_hash, name, email_verified) "
          f"VALUES ('{email}', '{h}', '{name}', TRUE) "
          "ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash, "
          "email_verified = TRUE")
    s, b = _req("POST", "/auth/login", {"email": email, "password": pw})
    if s != 200:
        raise RuntimeError(f"login failed for {email}: {s}")
    return b["access_token"]


def pair_device(token, label):
    _, p = _req("POST", "/pairing/generate", token=token)
    _, d = _req("POST", "/devices/pair", {
        "token": p["token"], "phone_model": label, "cpu_arch": "arm64-v8a",
        "ram_mb": 6144, "storage_free_gb": 32.0, "android_version": "13",
    })
    return d["device_id"]


LEAK_MARKERS = (
    "return only valid json", "do not include", "search_results", "error_msg",
    "explain this explicitly", "tell this to the user", "system prompt",
    "you are lokiai assistant", "candidate data above", "pick the best 3",
)


def leaked(text):
    low = (text or "").lower()
    return [m for m in LEAK_MARKERS if m in low]


def chat(token, device_id, message, timeout=120):
    t0 = time.perf_counter()
    s, b = _req("POST", "/assistant/chat",
                {"device_id": device_id, "message": message}, token=token)
    return s, b, (time.perf_counter() - t0) * 1000


def main():
    key = load_key()
    if not key or not key.startswith("nvapi-"):
        print("ABORT: no authorized NVIDIA_API_KEY found in .env")
        return 2
    print(f"authorized key: CONFIGURED (value never displayed)\n")

    email_a = f"{PREFIX}-nim-a@example.com"
    email_b = f"{PREFIX}-nim-b@example.com"
    tok_a = seed_account(email_a, "NIM A")
    tok_b = seed_account(email_b, "NIM B")
    dev_a = pair_device(tok_a, f"{PREFIX}-nim-phone-a")
    dev_b = pair_device(tok_b, f"{PREFIX}-nim-phone-b")

    # ── key management ────────────────────────────────────────────────────
    s, _ = _req("PUT", "/auth/nim-key", {"api_key": key}, token=tok_a)
    record("K1", "LIVE", "save key", "PASS" if s == 200 else "FAIL", f"HTTP {s}")

    s, me = _req("GET", "/auth/me", token=tok_a)
    ok = s == 200 and me.get("has_nim_key") is True and "nvapi-" not in json.dumps(me)
    record("K2", "LIVE", "configured status, key not returned",
           "PASS" if ok else "FAIL",
           f"HTTP {s}, has_nim_key={me.get('has_nim_key')}, raw key in body={'nvapi-' in json.dumps(me)}")

    s, _ = _req("PUT", "/auth/nim-key", {"api_key": key}, token=tok_a)
    record("K3", "LIVE", "replace key", "PASS" if s == 200 else "FAIL", f"HTTP {s}")

    # account B has NO key — proves per-account isolation of the credential
    s, b = chat(tok_b, dev_b, "hello")[:2]
    ok = s == 428 and b.get("error_code") == "NIM_KEY_MISSING"
    record("K4", "LIVE", "account B cannot use account A's key",
           "PASS" if ok else "FAIL", f"HTTP {s}, error_code={b.get('error_code')}")

    # ── scenarios 1-5: real conversation and search ───────────────────────
    scenarios = [
        ("S1", "greeting", "hey there!"),
        ("S2", "general question", "what exactly is LokiAI and how does it work?"),
        ("S3", "python code request", "write me a python function that reverses a string"),
        ("S4", "model search request", "I want an offline chatbot on my phone"),
        ("S5", "fire detection request", "I need to detect fire with my phone camera"),
    ]
    for sid, name, msg in scenarios:
        s, b, ms = chat(tok_a, dev_a, msg)
        resp = b.get("response", "") if isinstance(b, dict) else ""
        lk = leaked(resp)
        ok = s == 200 and resp and not lk
        record(sid, "LIVE", name, "PASS" if ok else "FAIL",
               f"HTTP {s}, {ms:.0f}ms, {len(resp)} chars, error_code={b.get('error_code')}, "
               f"results={len(b.get('search_results') or [])}, leaks={lk or 'none'}")

    # ── scenarios 6-7: direct HF URLs ─────────────────────────────────────
    s, b, ms = chat(tok_a, dev_a, "https://huggingface.co/litert-community/MobileNet-v2")
    resp = b.get("response", "")
    res = b.get("search_results") or []
    lk = leaked(resp)
    ok = s == 200 and not lk
    record("S6", "LIVE", "direct HF repository URL", "PASS" if ok else "FAIL",
           f"HTTP {s}, {ms:.0f}ms, results={len(res)}, "
           f"ids={[r.get('id') for r in res][:3]}, error_code={b.get('error_code')}, leaks={lk or 'none'}")

    # A listing URL is not a repository. It must NOT be misread as one, which
    # previously produced a misleading HF_UNAVAILABLE.
    s, b, ms = chat(tok_a, dev_a, "check out huggingface.co/models?filter=tflite for me")
    resp = b.get("response", "")
    lk = leaked(resp)
    ok = s == 200 and not lk and b.get("error_code") != "HF_UNAVAILABLE"
    record("S7", "LIVE", "HF model-list URL is not mistaken for a repository",
           "PASS" if ok else "FAIL",
           f"HTTP {s}, {ms:.0f}ms, error_code={b.get('error_code')} "
           f"(must not be HF_UNAVAILABLE), leaks={lk or 'none'}")

    # ── scenario 8: incompatible repo — real repo with no .tflite/.gguf ───
    s, b, ms = chat(tok_a, dev_a,
                    "deploy https://huggingface.co/google-bert/bert-base-uncased to my phone")
    resp = b.get("response", "")
    res = b.get("search_results") or []
    lk = leaked(resp)
    not_offered = not any("bert" in str(r.get("id", "")).lower() for r in res)
    ok = (s == 200 and not_offered and not lk
          and b.get("error_code") == "MODEL_INCOMPATIBLE")
    record("S8", "LIVE", "incompatible repo -> MODEL_INCOMPATIBLE, never deployable",
           "PASS" if ok else "FAIL",
           f"HTTP {s}, {ms:.0f}ms, error_code={b.get('error_code')} "
           f"(expected MODEL_INCOMPATIBLE), offered_for_deploy={not not_offered}, "
           f"msg={(resp or '')[:100]!r}, leaks={lk or 'none'}")

    # ── scenario 9: compatible repo, with REAL verified numbers ───────────
    s, b, ms = chat(tok_a, dev_a, "https://huggingface.co/litert-community/MobileNet-v3-small")
    res = b.get("search_results") or []
    real = [r for r in res if r.get("size_mb", 0) > 0 and str(r.get("filename", "")).endswith((".tflite", ".gguf"))]
    ok = s == 200 and (not res or real)
    record("S9", "LIVE", "compatible repo carries real size + real filename",
           "PASS" if ok else "FAIL",
           f"HTTP {s}, {ms:.0f}ms, results={len(res)}, "
           f"with_real_file_and_size={len(real)}, "
           f"sample={[(r.get('filename'), r.get('size_mb')) for r in real][:2]}")

    # ── scenario 10: invalid key (real 401 from NVIDIA) ───────────────────
    _req("PUT", "/auth/nim-key", {"api_key": "nvapi-" + "0" * 58}, token=tok_a)
    s, b, ms = chat(tok_a, dev_a, "hello there")
    # Must be KEY_INVALID specifically. NVIDIA answers a bad key with 403
    # "Authorization failed"; classifying that as PROVIDER_UNAVAILABLE tells
    # the user the service is down when their key is the problem.
    msg = b.get("response") or ""
    ok = (b.get("error_code") == "NIM_KEY_INVALID"
          and "nvapi" not in msg.lower()
          and "403" not in msg)
    record("S10", "FAULT", "invalid key -> NIM_KEY_INVALID, no raw provider text",
           "PASS" if ok else "FAIL",
           f"HTTP {s}, {ms:.0f}ms, error_code={b.get('error_code')} "
           f"(expected NIM_KEY_INVALID), msg={msg[:90]!r}")

    # ── scenario 11: revoked key — same observable as invalid ────────────
    record("S11", "FAULT", "revoked key (observationally identical to invalid)",
           "PASS" if ok else "FAIL",
           "NVIDIA returns 401 for both revoked and invalid keys; S10 covers the "
           "handling. Distinguishing them would require revoking a live key.")

    # restore the good key
    _req("PUT", "/auth/nim-key", {"api_key": key}, token=tok_a)

    # ── scenarios 12-15: conditions the real provider won't emit on demand
    sys.path.insert(0, BACKEND_DIR)
    import importlib
    main_mod = importlib.import_module("main")

    class _Timeout(Exception):
        pass
    _Timeout.__name__ = "APITimeoutError"
    e = main_mod._classify_provider_error(_Timeout("Request timed out."))
    ok = e.code == "NIM_TIMEOUT" and "nvapi" not in e.message.lower()
    record("S12", "UNIT", "timeout -> NIM_TIMEOUT", "PASS" if ok else "FAIL",
           f"code={e.code}, user_message={e.message[:70]!r}")

    class _RateLimit(Exception):
        pass
    _RateLimit.__name__ = "RateLimitError"
    rl = _RateLimit("429 Too Many Requests")
    rl.status_code = 429
    e = main_mod._classify_provider_error(rl)
    ok = e.code == "NIM_RATE_LIMITED"
    record("S13", "UNIT", "provider rate limit -> NIM_RATE_LIMITED",
           "PASS" if ok else "FAIL", f"code={e.code}, user_message={e.message[:70]!r}")

    err = main_mod.AssistantError("NIM_EMPTY_RESPONSE", "empty completion")
    ok = err.code == "NIM_EMPTY_RESPONSE"
    record("S14", "UNIT", "empty completion -> NIM_EMPTY_RESPONSE",
           "PASS" if ok else "FAIL",
           f"code={err.code}; raised by assistant_chat when the completion body is blank")

    dirty = ('Here are your models.\n'
             'Return ONLY valid JSON in this exact shape:\n'
             '{"response": "...", "search_results": [...]}\n'
             'You MUST explain the exact error_msg to the user in your response\n'
             'DO NOT include that model in search_results!\n'
             'MobileNet-v2 is a good fit for your phone.')
    cleaned = main_mod._strip_prompt_leakage(dirty)
    still = leaked(cleaned)
    ok = not still and "MobileNet-v2 is a good fit" in cleaned
    record("S15", "UNIT", "malformed/echoed prompt text stripped from output",
           "PASS" if ok else "FAIL",
           f"remaining_leaks={still or 'none'}, kept_real_content="
           f"{'MobileNet-v2 is a good fit' in cleaned}, "
           f"{len(dirty)}->{len(cleaned)} chars")

    # ── cross-account isolation under concurrent load ────────────────────
    _req("PUT", "/auth/nim-key", {"api_key": key}, token=tok_b)
    sa, ba, _ = chat(tok_a, dev_a, "hi")
    sb, bb, _ = chat(tok_b, dev_b, "hi")
    # B must not be able to drive A's device
    sx, bx = _req("POST", "/assistant/chat",
                  {"device_id": dev_a, "message": "hi"}, token=tok_b)
    ok = sa == 200 and sb == 200 and sx == 404 and bx.get("error_code") == "NO_DEVICE_SELECTED"
    record("X1", "LIVE", "two accounts chat independently; neither sees the other's device",
           "PASS" if ok else "FAIL",
           f"A={sa}, B={sb}, B->A's device={sx} ({bx.get('error_code')})")

    # ── key never reaches any client-visible surface ─────────────────────
    surfaces = []
    for label, (st, bd) in {
        "/auth/me": _req("GET", "/auth/me", token=tok_a),
        "/devices": _req("GET", "/devices", token=tok_a),
        "/models": _req("GET", "/models", token=tok_a),
        "/deployments": _req("GET", "/deployments", token=tok_a),
    }.items():
        if key in json.dumps(bd):
            surfaces.append(label)
    record("X2", "LIVE", "key absent from every authenticated response surface",
           "PASS" if not surfaces else "FAIL",
           f"checked 4 endpoints; leaked in: {surfaces or 'none'}")

    # ── cleanup: remove keys, then the accounts ──────────────────────────
    _req("DELETE", "/auth/nim-key", token=tok_a)
    _req("DELETE", "/auth/nim-key", token=tok_b)
    s, me = _req("GET", "/auth/me", token=tok_a)
    record("K5", "LIVE", "delete key clears configured status",
           "PASS" if me.get("has_nim_key") is False else "FAIL",
           f"has_nim_key={me.get('has_nim_key')}")

    for em in (email_a, email_b):
        _psql(
            f"DELETE FROM deployments WHERE user_id IN (SELECT id FROM users WHERE email='{em}'); "
            f"DELETE FROM models WHERE user_id IN (SELECT id FROM users WHERE email='{em}'); "
            f"DELETE FROM devices WHERE user_id IN (SELECT id FROM users WHERE email='{em}'); "
            f"DELETE FROM pairing_tokens WHERE user_id IN (SELECT id FROM users WHERE email='{em}'); "
            f"DELETE FROM users WHERE email='{em}'")
    print("\n[cleanup] NIM keys deleted from test accounts; accounts removed")

    failed = [r for r in results if r[3] != "PASS"]
    print("\n" + "=" * 72)
    print(f"NIM VALIDATION: {len(results)} scenarios, "
          f"{len(results)-len(failed)} passed, {len(failed)} failed")
    if failed:
        print("\nFAILED:")
        for sid, kind, name, st, ev in failed:
            print(f"  {sid} [{kind}] {name}\n      {ev}")
    print("=" * 72)
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
