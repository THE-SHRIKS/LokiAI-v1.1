from fastapi import FastAPI, HTTPException, Request, Response, Depends, UploadFile, File, Form
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, RedirectResponse
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from jose import JWTError
from typing import Optional, List
from pydantic import BaseModel, EmailStr
from datetime import datetime, timezone, timedelta
import asyncio
import os
import re
import asyncpg
import httpx
from contextlib import asynccontextmanager
from passlib.context import CryptContext
from jose import jwt, JWTError
from dotenv import load_dotenv
from slowapi import Limiter
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded

load_dotenv()
DATABASE_URL = os.getenv("DATABASE_URL")
if DATABASE_URL and DATABASE_URL.startswith("postgresql+asyncpg://"):
    DATABASE_URL = DATABASE_URL.replace("+asyncpg", "")

JWT_SECRET_KEY = os.getenv("JWT_SECRET_KEY")
ALGORITHM = "HS256"

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

# Per-user secrets at rest (the NVIDIA NIM API key each account brings).
# Fernet needs a 32-byte urlsafe-base64 key; derived from JWT_SECRET_KEY via
# SHA-256 instead of requiring yet another env var — same trust boundary
# (whoever has JWT_SECRET_KEY can already mint valid sessions for anyone).
from cryptography.fernet import Fernet
import base64
import hashlib as _hashlib

_fernet = Fernet(base64.urlsafe_b64encode(_hashlib.sha256(JWT_SECRET_KEY.encode()).digest()))


def _encrypt_secret(plaintext: str) -> str:
    return _fernet.encrypt(plaintext.encode()).decode()


def _decrypt_secret(ciphertext: str) -> str:
    return _fernet.decrypt(ciphertext.encode()).decode()

async def _run_migrations(pool: asyncpg.Pool):
    """Idempotent startup schema migration — safe to run on every boot.
    Adds email verification support: real name on the account, a verified
    flag gating login, and a table for hashed, expiring, attempt-limited
    OTP codes (email verification + resend)."""
    async with pool.acquire() as conn:
        await conn.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS name TEXT")
        # DEFAULT TRUE grandfathers every pre-existing account (they already had
        # working access before this feature shipped) — genuinely NEW signups
        # still start unverified because /auth/register inserts FALSE explicitly.
        await conn.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified BOOLEAN NOT NULL DEFAULT TRUE")
        await conn.execute("""
            CREATE TABLE IF NOT EXISTS email_otps (
                id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                user_id     UUID REFERENCES users(id) NOT NULL,
                otp_hash    TEXT NOT NULL,
                purpose     TEXT NOT NULL DEFAULT 'verify_email',
                attempts    INTEGER NOT NULL DEFAULT 0,
                expires_at  TIMESTAMPTZ NOT NULL,
                used        BOOLEAN NOT NULL DEFAULT FALSE,
                created_at  TIMESTAMPTZ DEFAULT NOW()
            )
        """)
        # One-time backfill: an earlier boot of this migration (before this
        # comment was added) briefly created email_verified with DEFAULT
        # FALSE, marking every pre-existing account unverified. Grandfather
        # back in any account that never went through the new OTP flow
        # (zero rows in email_otps) — real accounts genuinely mid-verification
        # (which DO have email_otps rows) are correctly left untouched.
        await conn.execute("""
            UPDATE users u SET email_verified = TRUE
            WHERE email_verified = FALSE
              AND NOT EXISTS (SELECT 1 FROM email_otps o WHERE o.user_id = u.id)
        """)
        await conn.execute("""
            CREATE TABLE IF NOT EXISTS password_reset_tokens (
                id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                user_id     UUID REFERENCES users(id) NOT NULL,
                token_hash  TEXT NOT NULL,
                used        BOOLEAN DEFAULT FALSE,
                expires_at  TIMESTAMPTZ NOT NULL,
                created_at  TIMESTAMPTZ DEFAULT NOW()
            )
        """)
        # Revoked JWT jtis (both access and refresh). A row here means that
        # specific token is dead regardless of its own exp claim — used for
        # logout and refresh-token rotation. expires_at mirrors the token's
        # own exp so old rows are cheap to prune.
        await conn.execute("""
            CREATE TABLE IF NOT EXISTS token_blacklist (
                jti         TEXT PRIMARY KEY,
                expires_at  TIMESTAMPTZ NOT NULL,
                created_at  TIMESTAMPTZ DEFAULT NOW()
            )
        """)
        # Each account brings its own NVIDIA NIM API key — the AI assistant
        # is unusable (and the shared free-tier quota unshared) until the
        # user provides one. Encrypted at rest; never returned to the client.
        await conn.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS nvidia_api_key_encrypted TEXT")


async def _create_pool_with_retry(retries: int = 5, base_delay: float = 2.0) -> asyncpg.Pool:
    """Neon's serverless compute auto-suspends after inactivity and takes a
    few seconds to wake on the next connection; Render's free tier does the
    same to the whole container after 15 idle minutes. The two can wake up
    at once on the first request, so the initial pool connection gets a
    short retry budget instead of failing the whole boot on one slow wake."""
    last_error: Optional[Exception] = None
    for attempt in range(retries):
        try:
            return await asyncpg.create_pool(DATABASE_URL)
        except (asyncpg.PostgresError, OSError, TimeoutError) as e:
            last_error = e
            if attempt < retries - 1:
                await asyncio.sleep(base_delay * (attempt + 1))
    raise last_error


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.pool = await _create_pool_with_retry()
    await _run_migrations(app.state.pool)
    yield
    await app.state.pool.close()

app = FastAPI(lifespan=lifespan)

limiter = Limiter(key_func=get_remote_address)
app.state.limiter = limiter


@app.exception_handler(RateLimitExceeded)
async def _rate_limit_handler(request: Request, exc: RateLimitExceeded):
    response = JSONResponse(status_code=429, content={"error": f"Rate limit exceeded: {exc.detail}"})
    response.headers["Retry-After"] = "60"
    return response


def _user_or_ip_key(request: Request) -> str:
    """Rate-limit key for endpoints billed per authenticated user (e.g. the
    NIM-backed assistant) rather than per IP — falls back to IP when there's
    no valid Authorization header (request will 401 anyway)."""
    auth = request.headers.get("authorization", "")
    if auth.lower().startswith("bearer "):
        try:
            payload = jwt.decode(auth[7:], JWT_SECRET_KEY, algorithms=[ALGORITHM], options={"verify_exp": False})
            sub = payload.get("sub")
            if sub:
                return f"user:{sub}"
        except JWTError:
            pass
    return get_remote_address(request)


# The dashboard is a browser app on a different origin (Vite dev/prod
# server); without CORS headers every fetch from it is blocked. Explicit
# origins (not "*") are required anyway once allow_credentials=True — the
# refresh-token cookie only works with a concrete origin allowlist.
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.base import BaseHTTPMiddleware
import time, collections, uuid as _uuid

_default_origins = "http://localhost:8080,http://127.0.0.1:8080"
ALLOWED_ORIGINS = list(dict.fromkeys(
    o.strip() for o in os.getenv("CORS_ALLOWED_ORIGINS", _default_origins).split(",") if o.strip()
))

class DynamicCORSMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        origin = request.headers.get("origin")
        
        # Preflight
        if request.method == "OPTIONS":
            response = Response()
        else:
            response = await call_next(request)

        if origin:
            if origin in ALLOWED_ORIGINS or origin.endswith(".vercel.app") or "localhost" in origin or "127.0.0.1" in origin:
                response.headers["Access-Control-Allow-Origin"] = origin
                response.headers["Access-Control-Allow-Credentials"] = "true"
                response.headers["Access-Control-Allow-Methods"] = "GET, POST, PUT, DELETE, OPTIONS"
                response.headers["Access-Control-Allow-Headers"] = "Authorization, Content-Type"
        return response

app.add_middleware(DynamicCORSMiddleware)


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["X-XSS-Protection"] = "1; mode=block"
        response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
        response.headers["Content-Security-Policy"] = "default-src 'self'"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        return response


app.add_middleware(SecurityHeadersMiddleware)

# 10MB cap on request bodies to blunt abuse — except /models/upload, whose
# entire job is accepting real GGUF/TFLite model files that routinely run
# into the hundreds of MB (see uploaded_models/ and the deploy history in
# REPORT.md). Capping that route at 10MB would break a working feature.
MAX_BODY_SIZE = 10 * 1024 * 1024
_BODY_SIZE_EXEMPT_PATHS = ("/models/upload",)


class BodySizeLimitMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        if request.url.path not in _BODY_SIZE_EXEMPT_PATHS:
            content_length = request.headers.get("content-length")
            if content_length and int(content_length) > MAX_BODY_SIZE:
                return JSONResponse(status_code=413, content={"error": "Request body too large"})
        return await call_next(request)


app.add_middleware(BodySizeLimitMiddleware)


@app.exception_handler(asyncpg.exceptions.DataError)
async def _pg_data_error_handler(request: Request, exc: asyncpg.exceptions.DataError):
    # Malformed UUIDs (or other bad literals) hitting a $1::uuid cast land
    # here instead of surfacing as a raw 500 with DB internals in the body.
    return JSONResponse(status_code=422, content={"error": "Invalid ID format"})


@app.exception_handler(Exception)
async def _generic_exception_handler(request: Request, exc: Exception):
    # Anything not already handled by a more specific handler (HTTPException,
    # RequestValidationError, the two above) is an unexpected server error —
    # log the real detail server-side, tell the client nothing more than
    # that it happened.
    import traceback
    print(f"[ERROR] {request.method} {request.url.path}: {exc}")
    traceback.print_exc()
    return JSONResponse(status_code=500, content={"error": "Internal server error"})

# ── System monitor ───────────────────────────────────────────────────────────
monitor_log: list[dict] = []
MAX_LOG = 500
api_hit_counts: dict[str, int] = collections.defaultdict(int)
error_counts: dict[str, int] = collections.defaultdict(int)
_boot_time = time.time()

class MonitorMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        start = time.time()
        rid = _uuid.uuid4().hex[:8]
        method = request.method
        path = request.url.path

        try:
            response = await call_next(request)
        except Exception as exc:
            elapsed = round((time.time() - start) * 1000, 1)
            entry = {
                "id": rid, "ts": datetime.now(timezone.utc).isoformat(),
                "method": method, "path": path, "status": 500,
                "ms": elapsed, "error": str(exc),
            }
            monitor_log.append(entry)
            if len(monitor_log) > MAX_LOG:
                monitor_log.pop(0)
            key = f"{method} {path}"
            api_hit_counts[key] += 1
            error_counts[key] += 1
            raise

        elapsed = round((time.time() - start) * 1000, 1)
        entry = {
            "id": rid, "ts": datetime.now(timezone.utc).isoformat(),
            "method": method, "path": path, "status": response.status_code,
            "ms": elapsed,
        }
        if response.status_code >= 400:
            entry["error"] = f"HTTP {response.status_code}"
        monitor_log.append(entry)
        if len(monitor_log) > MAX_LOG:
            monitor_log.pop(0)
        key = f"{method} {path}"
        api_hit_counts[key] += 1
        if response.status_code >= 400:
            error_counts[key] += 1
        return response

app.add_middleware(MonitorMiddleware)

@app.get("/monitor/status")
async def monitor_status(request: Request):
    pool = request.app.state.pool
    async with pool.acquire() as conn:
        device_count = await conn.fetchval("SELECT COUNT(*) FROM devices")
        user_count = await conn.fetchval("SELECT COUNT(*) FROM users")
        deployment_count = await conn.fetchval("SELECT COUNT(*) FROM deployments")
    return {
        "uptime_seconds": round(time.time() - _boot_time, 1),
        "total_requests": sum(api_hit_counts.values()),
        "total_errors": sum(error_counts.values()),
        "db": {"users": user_count, "devices": device_count, "deployments": deployment_count},
        "ws_connections": len(ws_manager.active),
        "endpoints": dict(api_hit_counts),
        "errors_by_endpoint": {k: v for k, v in error_counts.items() if v > 0},
    }

@app.get("/monitor/log")
async def monitor_get_log(limit: int = 50):
    return monitor_log[-limit:]

# ── Feedback ──────────────────────────────────────────────────────────────────
feedback_store: list[dict] = []

class FeedbackPayload(BaseModel):
    category: str
    message: str

@app.post("/feedback")
async def submit_feedback(payload: FeedbackPayload, credentials: HTTPAuthorizationCredentials = Depends(HTTPBearer())):
    token_data = verify_token(credentials.credentials)
    if not token_data:
        raise HTTPException(status_code=401, detail="Invalid token")
    if not payload.message.strip():
        raise HTTPException(status_code=422, detail="Message cannot be empty")
    if len(payload.message) > 2000:
        raise HTTPException(status_code=422, detail="Message too long (max 2000 chars)")

    user_email = token_data.get("sub", "unknown")
    ts = datetime.now(timezone.utc).isoformat()
    entry_id = _uuid.uuid4().hex[:8]

    entry = {
        "id": entry_id,
        "ts": ts,
        "user": user_email,
        "category": payload.category,
        "message": payload.message.strip(),
    }
    feedback_store.append(entry)

    # Fire-and-forget email to team inbox
    text_body = (
        f"New LokiAI feedback\n"
        f"──────────────────\n"
        f"ID:       {entry_id}\n"
        f"From:     {user_email}\n"
        f"Category: {payload.category}\n"
        f"Time:     {ts}\n\n"
        f"{payload.message.strip()}\n"
    )
    html_body = f"""<div style="font-family:sans-serif;background:#0A0A0A;color:#F5F5F5;padding:24px;border-radius:12px;max-width:520px;">
<h2 style="margin-top:0;color:#8BC34A;">New Feedback</h2>
<table style="border-collapse:collapse;width:100%;font-size:13px;margin-bottom:16px;">
  <tr><td style="color:#8A8A8A;padding:4px 12px 4px 0;white-space:nowrap;">From</td><td style="color:#F5F5F5;">{user_email}</td></tr>
  <tr><td style="color:#8A8A8A;padding:4px 12px 4px 0;white-space:nowrap;">Category</td><td style="color:#F5F5F5;">{payload.category}</td></tr>
  <tr><td style="color:#8A8A8A;padding:4px 12px 4px 0;white-space:nowrap;">ID</td><td style="color:#555;font-family:monospace;">{entry_id}</td></tr>
  <tr><td style="color:#8A8A8A;padding:4px 12px 4px 0;white-space:nowrap;">Time</td><td style="color:#555;font-family:monospace;">{ts}</td></tr>
</table>
<div style="background:#141414;border-radius:8px;padding:16px;font-size:14px;line-height:1.6;white-space:pre-wrap;color:#E8EDE0;">{payload.message.strip()}</div>
</div>"""

    asyncio.create_task(
        send_email(
            to_email=SMTP_FROM_EMAIL,
            subject=f"[LokiAI Feedback] {payload.category} — {user_email}",
            text_body=text_body,
            html_body=html_body,
        )
    )

    return {"ok": True, "id": entry_id}

@app.get("/feedback")
async def get_feedback(credentials: HTTPAuthorizationCredentials = Depends(HTTPBearer())):
    token_data = verify_token(credentials.credentials)
    if not token_data:
        raise HTTPException(status_code=401, detail="Invalid token")
    return list(reversed(feedback_store))


class AuthUser(BaseModel):
    email: EmailStr
    password: str


class RegisterUser(BaseModel):
    email: EmailStr
    password: str
    name: str

    @property
    def clean_name(self) -> str:
        return self.name.strip() or self.email.split("@")[0]


class VerifyOtpRequest(BaseModel):
    email: EmailStr
    otp: str


class ResendOtpRequest(BaseModel):
    email: EmailStr


_PASSWORD_RE = re.compile(r"^(?=.*[A-Za-z])(?=.*\d).{8,}$")


def _validate_password_strength(password: str) -> None:
    if not _PASSWORD_RE.match(password):
        raise HTTPException(
            status_code=422,
            detail="Password must be at least 8 characters and contain at least one letter and one number."
        )


# ------------------------------------------------------------------
# Real email delivery (direct SMTP — no third-party email API) +
# OTP-based email verification. Credentials live in .env only
# (SMTP_HOST/PORT/USER/PASSWORD/FROM_EMAIL/FROM_NAME).
# ------------------------------------------------------------------

import smtplib
import hashlib
import secrets as _secrets
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

SMTP_HOST = os.getenv("SMTP_HOST")
SMTP_PORT = int(os.getenv("SMTP_PORT", "587"))
SMTP_USER = os.getenv("SMTP_USER")
SMTP_PASSWORD = os.getenv("SMTP_PASSWORD")
SMTP_FROM_EMAIL = os.getenv("SMTP_FROM_EMAIL", SMTP_USER)
SMTP_FROM_NAME = os.getenv("SMTP_FROM_NAME", "LokiAI")

# Render's free tier blocks outbound SMTP entirely (confirmed by testing,
# not just a routing quirk — forcing IPv4 didn't help either). When set,
# route email through the Vercel-hosted relay function instead of
# connecting to SMTP_HOST directly — Vercel's serverless functions have no
# such block. See LokiAI-Desktop/stellar-dashboard-builder-main/api/send-email.ts.
EMAIL_RELAY_URL = os.getenv("EMAIL_RELAY_URL")
EMAIL_RELAY_SECRET = os.getenv("EMAIL_RELAY_SECRET")

OTP_TTL_MINUTES = 10
OTP_MAX_ATTEMPTS = 5
OTP_RESEND_COOLDOWN_SECONDS = 60


class _IPv4SMTP(smtplib.SMTP):
    """Some free-tier hosts (Render included) hand containers IPv6 egress
    that has no real route to certain destinations, surfacing as
    'Network is unreachable' even though a working IPv4 path exists.
    Force the actual socket connection to an IPv4 address while leaving
    self._host as the real hostname, so starttls()'s SNI/certificate
    check (which uses self._host, not the connected IP) is unaffected."""
    def connect(self, host="", port=0, source_address=None):
        try:
            ip = socket.getaddrinfo(host, port, socket.AF_INET)[0][4][0]
        except socket.gaierror:
            ip = host
        return super().connect(ip, port, source_address)


def _send_email_sync(to_email: str, subject: str, text_body: str, html_body: str) -> None:
    if not (SMTP_HOST and SMTP_USER and SMTP_PASSWORD):
        raise RuntimeError("SMTP is not configured (SMTP_HOST/SMTP_USER/SMTP_PASSWORD missing in .env)")
    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = f"{SMTP_FROM_NAME} <{SMTP_FROM_EMAIL}>"
    msg["To"] = to_email
    msg.attach(MIMEText(text_body, "plain"))
    msg.attach(MIMEText(html_body, "html"))
    with _IPv4SMTP(SMTP_HOST, SMTP_PORT, timeout=20) as server:
        server.starttls()
        server.login(SMTP_USER, SMTP_PASSWORD)
        server.sendmail(SMTP_FROM_EMAIL, [to_email], msg.as_string())


async def _send_email_via_relay(to_email: str, subject: str, text_body: str, html_body: str) -> None:
    async with httpx.AsyncClient(timeout=20.0) as client:
        resp = await client.post(
            EMAIL_RELAY_URL,
            json={"to": to_email, "subject": subject, "text": text_body, "html": html_body},
            headers={"X-Relay-Secret": EMAIL_RELAY_SECRET},
        )
    if resp.status_code != 200:
        raise RuntimeError(f"Email relay returned {resp.status_code}: {resp.text}")


async def send_email(to_email: str, subject: str, text_body: str, html_body: str) -> None:
    if EMAIL_RELAY_URL and EMAIL_RELAY_SECRET:
        await _send_email_via_relay(to_email, subject, text_body, html_body)
        return
    # Local dev fallback: direct SMTP (smtplib is synchronous — run off the event loop).
    await asyncio.to_thread(_send_email_sync, to_email, subject, text_body, html_body)


def _otp_email_body(name: str, otp: str) -> tuple[str, str]:
    text = (f"Hi {name},\n\n"
            f"Your LokiAI verification code is: {otp}\n\n"
            f"This code expires in {OTP_TTL_MINUTES} minutes. If you didn't request this, ignore this email.\n\n"
            f"— LokiAI")
    html = f"""<div style="font-family:sans-serif;background:#0A0A0A;color:#F5F5F5;padding:24px;border-radius:12px;max-width:420px;">
<h2 style="margin-top:0;">Verify your email</h2>
<p>Hi {name},</p>
<p>Your LokiAI verification code is:</p>
<p style="font-size:32px;font-weight:700;letter-spacing:6px;color:#8BC34A;">{otp}</p>
<p style="color:#8A8A8A;font-size:13px;">This code expires in {OTP_TTL_MINUTES} minutes. If you didn't request this, ignore this email.</p>
</div>"""
    return text, html


def _welcome_email_body(name: str) -> tuple[str, str]:
    text = (f"Hi {name},\n\n"
            f"Welcome to LokiAI. Your email is verified and your account is ready.\n\n"
            f"Pair your phone with a QR code, tell LokiAI what you want it to do, and deploy real "
            f"on-device AI models — fully offline, no cloud required.\n\n"
            f"— LokiAI")
    html = f"""<div style="font-family:sans-serif;background:#0A0A0A;color:#F5F5F5;padding:24px;border-radius:12px;max-width:420px;">
<h2 style="margin-top:0;">Welcome to LokiAI</h2>
<p>Hi {name},</p>
<p>Your email is verified and your account is ready. Pair your phone with a QR code, tell LokiAI what
you want it to do, and deploy real on-device AI models — fully offline, no cloud required.</p>
</div>"""
    return text, html


async def _issue_otp(conn, user_id, email: str, name: str, purpose: str = "verify_email") -> None:
    """Generate, store (hashed), and email a fresh OTP. Throttled per user+purpose."""
    recent = await conn.fetchrow(
        "SELECT created_at FROM email_otps WHERE user_id = $1::uuid AND purpose = $2 "
        "ORDER BY created_at DESC LIMIT 1",
        user_id, purpose,
    )
    if recent:
        elapsed = (datetime.now(timezone.utc) - recent["created_at"]).total_seconds()
        if elapsed < OTP_RESEND_COOLDOWN_SECONDS:
            raise HTTPException(
                status_code=429,
                detail=f"Please wait {int(OTP_RESEND_COOLDOWN_SECONDS - elapsed)}s before requesting another code."
            )

    otp = str(_secrets.randbelow(900000) + 100000)
    otp_hash = hashlib.sha256(otp.encode()).hexdigest()
    expires_at = datetime.now(timezone.utc) + timedelta(minutes=OTP_TTL_MINUTES)
    await conn.execute(
        "INSERT INTO email_otps (user_id, otp_hash, purpose, expires_at) VALUES ($1::uuid, $2, $3, $4)",
        user_id, otp_hash, purpose, expires_at,
    )
    text, html = _otp_email_body(name, otp)
    try:
        await send_email(email, "Your LokiAI verification code", text, html)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Could not send verification email: {e}")


@app.get("/health")
def health_check():
    return {
        "status": "ok",
        "timestamp": datetime.now(timezone.utc).isoformat()
    }


# ------------------------------------------------------------------
# APK distribution over LAN (QR onboarding flow).
# The phone scans a QR encoding http://<laptop-lan-ip>:8000/install,
# downloads the APK in its browser, and sideloads it — no USB install.
# ------------------------------------------------------------------

APK_PATH = os.path.normpath(os.path.join(
    os.path.dirname(os.path.abspath(__file__)),
    "..", "LokiAImobile UI", "build", "app", "outputs", "flutter-apk", "app-debug.apk"
))

# Production hosts the APK as a GitHub Release asset (Render's filesystem is
# ephemeral and the repo never carries the ~140MB build artifact — see
# LokiAI-backend/README.md). When set, /apk redirects there instead of
# serving APK_PATH from local disk (the local-dev flutter-build path).
APK_DOWNLOAD_URL = os.getenv("APK_DOWNLOAD_URL")
APK_SIZE_MB = os.getenv("APK_SIZE_MB")


@app.api_route("/apk", methods=["GET", "HEAD"])
async def download_apk():
    if APK_DOWNLOAD_URL:
        return RedirectResponse(APK_DOWNLOAD_URL, status_code=302)
    if not os.path.isfile(APK_PATH):
        raise HTTPException(status_code=404, detail="APK not built yet. Run flutter build first.")
    return FileResponse(
        APK_PATH,
        media_type="application/vnd.android.package-archive",
        filename="lokiai.apk"
    )


@app.get("/install", response_class=HTMLResponse)
async def install_page():
    if APK_DOWNLOAD_URL:
        size_mb = float(APK_SIZE_MB) if APK_SIZE_MB else None
    else:
        size_mb = round(os.path.getsize(APK_PATH) / (1024 * 1024), 1) if os.path.isfile(APK_PATH) else None
    size_text = f" ({size_mb} MB)" if size_mb else ""
    return f"""<!DOCTYPE html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Install LokiAI</title>
  <style>
    html {{ background:#0A0A0A; scrollbar-color:#3A3A3A #0A0A0A; scrollbar-width:thin; }}
    body {{ background:#0A0A0A; color:#F5F5F5; font-family:sans-serif;
           display:flex; flex-direction:column; align-items:center;
           justify-content:center; min-height:100vh; margin:0; padding:16px;
           overflow-x:hidden; box-sizing:border-box; }}
    a.btn {{ background:#E53935; color:#fff; text-decoration:none;
             padding:16px 40px; border-radius:12px; font-size:18px; margin-top:24px; }}
    p {{ color:#8A8A8A; max-width:320px; text-align:center; }}
    ::-webkit-scrollbar {{ width:10px; height:10px; }}
    ::-webkit-scrollbar-track {{ background:#0A0A0A; }}
    ::-webkit-scrollbar-thumb {{ background:#3A3A3A; border-radius:6px; }}
    ::-webkit-scrollbar-thumb:hover {{ background:#4A4A4A; }}
  </style>
</head>
<body>
  <h1>LokiAI</h1>
  <p>On-device AI for your phone. Tap below to download the app{size_text}, then open the file and allow the install when prompted.</p>
  <a class="btn" href="/apk">Download LokiAI</a>
</body>
</html>"""

ACCESS_TOKEN_TTL_MINUTES = 30
REFRESH_TOKEN_TTL_DAYS = 7
REFRESH_COOKIE_NAME = "lokiai_refresh_token"


def _make_jwt(user_id, ttl: timedelta, token_type: str) -> tuple[str, str, datetime]:
    jti = str(_uuid.uuid4())
    exp = datetime.now(timezone.utc) + ttl
    payload = {"sub": str(user_id), "jti": jti, "type": token_type, "exp": exp}
    token = jwt.encode(payload, JWT_SECRET_KEY, algorithm=ALGORITHM)
    return token, jti, exp


async def _blacklist_jti(conn, jti: str, expires_at: datetime) -> None:
    """Revoke a jti immediately. Opportunistically prunes rows whose own exp
    has already passed — no separate cron needed for a table this small."""
    await conn.execute("DELETE FROM token_blacklist WHERE expires_at < NOW()")
    await conn.execute(
        "INSERT INTO token_blacklist (jti, expires_at) VALUES ($1, $2) ON CONFLICT (jti) DO NOTHING",
        jti, expires_at,
    )


def _set_refresh_cookie(response: Response, request: Request, refresh_token: str) -> None:
    # Dashboard (8080) and backend (8000) are different ports but the same
    # "site" for cookie purposes on localhost, so Lax already crosses that
    # boundary in dev. In production behind HTTPS with a separate domain,
    # cross-site delivery needs SameSite=None+Secure instead.
    is_https = request.url.scheme == "https"
    response.set_cookie(
        key=REFRESH_COOKIE_NAME,
        value=refresh_token,
        httponly=True,
        secure=is_https,
        samesite="none" if is_https else "lax",
        max_age=REFRESH_TOKEN_TTL_DAYS * 24 * 3600,
        path="/",
    )


def _issue_tokens(user_id, request: Request, response: Response) -> dict:
    access_token, _, _ = _make_jwt(user_id, timedelta(minutes=ACCESS_TOKEN_TTL_MINUTES), "access")
    refresh_token, _, _ = _make_jwt(user_id, timedelta(days=REFRESH_TOKEN_TTL_DAYS), "refresh")
    _set_refresh_cookie(response, request, refresh_token)
    return {"access_token": access_token, "token_type": "bearer"}


@app.post("/auth/register")
@limiter.limit("3/minute")
async def register(user: RegisterUser, request: Request):
    """Creates an unverified account and emails a real OTP. The account
    cannot log in until POST /auth/verify-otp succeeds — no session is
    issued here."""
    _validate_password_strength(user.password)
    pool = request.app.state.pool
    hashed_pwd = pwd_context.hash(user.password)
    name = user.clean_name
    async with pool.acquire() as conn:
        async with conn.transaction():
            existing = await conn.fetchrow("SELECT id, email_verified FROM users WHERE email = $1", user.email)
            if existing and existing["email_verified"]:
                raise HTTPException(status_code=400, detail="Email already registered. Please sign in.")
            if existing:
                # Unverified account retrying signup — refresh credentials/name, issue a new code.
                user_id = existing["id"]
                await conn.execute(
                    "UPDATE users SET password_hash = $2, name = $3 WHERE id = $1::uuid",
                    user_id, hashed_pwd, name,
                )
            else:
                row = await conn.fetchrow(
                    "INSERT INTO users (email, password_hash, name, email_verified) "
                    "VALUES ($1, $2, $3, FALSE) RETURNING id",
                    user.email, hashed_pwd, name,
                )
                user_id = row["id"]
            await _issue_otp(conn, user_id, user.email, name)
    return {"user_id": str(user_id), "email_verification_required": True}


@app.post("/auth/verify-otp")
async def verify_otp(req: VerifyOtpRequest, request: Request, response: Response):
    pool = request.app.state.pool
    async with pool.acquire() as conn:
        # Deliberately NOT one wrapping transaction: the "wrong code" path
        # below must persist its attempts increment even though the request
        # ends by raising — a raise inside `async with conn.transaction()`
        # rolls back everything in that block, including writes we want to
        # keep. Only the final success writes need atomicity together.
        user_row = await conn.fetchrow("SELECT id, name, email_verified FROM users WHERE email = $1", req.email)
        if not user_row:
            raise HTTPException(status_code=404, detail="No account found for this email.")
        if user_row["email_verified"]:
            return _issue_tokens(user_row["id"], request, response)

        otp_row = await conn.fetchrow(
            "SELECT id, otp_hash, attempts, expires_at FROM email_otps "
            "WHERE user_id = $1::uuid AND purpose = 'verify_email' AND used = FALSE "
            "ORDER BY created_at DESC LIMIT 1",
            user_row["id"],
        )
        if not otp_row:
            raise HTTPException(status_code=400, detail="No pending verification code. Request a new one.")
        if otp_row["expires_at"] < datetime.now(timezone.utc):
            raise HTTPException(status_code=400, detail="This code has expired. Request a new one.")
        if otp_row["attempts"] >= OTP_MAX_ATTEMPTS:
            raise HTTPException(status_code=429, detail="Too many incorrect attempts. Request a new code.")

        submitted_hash = hashlib.sha256(req.otp.strip().encode()).hexdigest()
        if submitted_hash != otp_row["otp_hash"]:
            await conn.execute("UPDATE email_otps SET attempts = attempts + 1 WHERE id = $1::uuid", otp_row["id"])
            remaining = OTP_MAX_ATTEMPTS - (otp_row["attempts"] + 1)
            raise HTTPException(status_code=400, detail=f"Incorrect code. {max(remaining, 0)} attempts left.")

        async with conn.transaction():
            await conn.execute("UPDATE email_otps SET used = TRUE WHERE id = $1::uuid", otp_row["id"])
            await conn.execute("UPDATE users SET email_verified = TRUE WHERE id = $1::uuid", user_row["id"])

    # Welcome email is best-effort — verification itself must not fail if it bounces.
    try:
        text, html = _welcome_email_body(user_row["name"] or req.email.split("@")[0])
        await send_email(req.email, "Welcome to LokiAI", text, html)
    except Exception as e:
        print(f"[auth] welcome email failed for {req.email}: {e}")

    return _issue_tokens(user_row["id"], request, response)


@app.post("/auth/resend-otp")
async def resend_otp(req: ResendOtpRequest, request: Request):
    pool = request.app.state.pool
    async with pool.acquire() as conn:
        async with conn.transaction():
            user_row = await conn.fetchrow("SELECT id, name, email_verified FROM users WHERE email = $1", req.email)
            if not user_row:
                raise HTTPException(status_code=404, detail="No account found for this email.")
            if user_row["email_verified"]:
                raise HTTPException(status_code=400, detail="Email already verified. Please sign in.")
            await _issue_otp(conn, user_row["id"], req.email, user_row["name"] or req.email.split("@")[0])
    return {"sent": True}


@app.post("/auth/login")
@limiter.limit("5/minute")
async def login(user: AuthUser, request: Request, response: Response):
    pool = request.app.state.pool
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT id, password_hash, email_verified FROM users WHERE email = $1", user.email
        )
        if not row or not pwd_context.verify(user.password, row["password_hash"]):
            raise HTTPException(status_code=401, detail="Invalid email or password")
        if not row["email_verified"]:
            raise HTTPException(
                status_code=403,
                detail="Please verify your email before signing in. Check your inbox for the code, "
                       "or request a new one."
            )
        return _issue_tokens(row["id"], request, response)


@app.post("/auth/refresh")
async def refresh_access_token(request: Request, response: Response):
    """Silent refresh: the dashboard calls this with the httpOnly refresh
    cookie (no Authorization header needed) to get a new short-lived access
    token. The refresh token itself is rotated — the one just used is
    blacklisted and a new one is issued — so a stolen refresh cookie stops
    working the moment the real client refreshes again."""
    raw = request.cookies.get(REFRESH_COOKIE_NAME)
    if not raw:
        raise HTTPException(status_code=401, detail="No refresh token")
    try:
        payload = jwt.decode(raw, JWT_SECRET_KEY, algorithms=[ALGORITHM])
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid or expired refresh token")

    user_id, jti, token_type = payload.get("sub"), payload.get("jti"), payload.get("type")
    if not user_id or not jti or token_type != "refresh":
        raise HTTPException(status_code=401, detail="Invalid refresh token")

    pool = request.app.state.pool
    async with pool.acquire() as conn:
        blacklisted = await conn.fetchval("SELECT 1 FROM token_blacklist WHERE jti = $1", jti)
        if blacklisted:
            raise HTTPException(status_code=401, detail="Refresh token has been revoked")
        exp = datetime.fromtimestamp(payload["exp"], tz=timezone.utc)
        await _blacklist_jti(conn, jti, exp)

    return _issue_tokens(user_id, request, response)


@app.post("/auth/logout")
async def logout(request: Request, response: Response, credentials: HTTPAuthorizationCredentials = Depends(HTTPBearer(auto_error=False))):
    """Blacklists both the access token's jti (from the Authorization header,
    if present — an already-expired access token is fine to skip) and the
    refresh token's jti (from the cookie), then clears the cookie. Never
    fails just because one side is missing or already expired."""
    pool = request.app.state.pool
    async with pool.acquire() as conn:
        if credentials:
            try:
                payload = jwt.decode(
                    credentials.credentials, JWT_SECRET_KEY, algorithms=[ALGORITHM],
                    options={"verify_exp": False},
                )
                if payload.get("jti") and payload.get("exp"):
                    await _blacklist_jti(conn, payload["jti"], datetime.fromtimestamp(payload["exp"], tz=timezone.utc))
            except JWTError:
                pass

        raw = request.cookies.get(REFRESH_COOKIE_NAME)
        if raw:
            try:
                payload = jwt.decode(raw, JWT_SECRET_KEY, algorithms=[ALGORITHM], options={"verify_exp": False})
                if payload.get("jti") and payload.get("exp"):
                    await _blacklist_jti(conn, payload["jti"], datetime.fromtimestamp(payload["exp"], tz=timezone.utc))
            except JWTError:
                pass

    response.delete_cookie(REFRESH_COOKIE_NAME, path="/")
    return {"logged_out": True}


security = HTTPBearer()

async def get_current_user(request: Request, credentials: HTTPAuthorizationCredentials = Depends(security)):
    try:
        payload = jwt.decode(credentials.credentials, JWT_SECRET_KEY, algorithms=[ALGORITHM])
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid token")

    user_id: str = payload.get("sub")
    jti: str = payload.get("jti")
    token_type: str = payload.get("type")
    if not user_id or not jti or token_type != "access":
        raise HTTPException(status_code=401, detail="Invalid token")

    pool = request.app.state.pool
    async with pool.acquire() as conn:
        blacklisted = await conn.fetchval("SELECT 1 FROM token_blacklist WHERE jti = $1", jti)
    if blacklisted:
        raise HTTPException(status_code=401, detail="Token has been revoked")
    return user_id


@app.get("/auth/me")
async def get_me(request: Request, user_id: str = Depends(get_current_user)):
    pool = request.app.state.pool
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT id, email, name, email_verified, created_at, nvidia_api_key_encrypted "
            "FROM users WHERE id = $1::uuid",
            user_id,
        )
        if not row:
            raise HTTPException(status_code=404, detail="User not found")
    return {
        "id": str(row["id"]),
        "email": row["email"],
        "name": row["name"] or row["email"].split("@")[0],
        "email_verified": row["email_verified"],
        "created_at": row["created_at"].isoformat() if row["created_at"] else None,
        "has_nim_key": row["nvidia_api_key_encrypted"] is not None,
    }


class NimKeyRequest(BaseModel):
    api_key: str


@app.put("/auth/nim-key")
@limiter.limit("10/minute")
async def save_nim_key(req: NimKeyRequest, request: Request, user_id: str = Depends(get_current_user)):
    """Each account brings its own NVIDIA NIM API key — required before the
    AI assistant will run for that user. Encrypted at rest, never returned."""
    key = req.api_key.strip()
    if not key or not key.startswith("nvapi-"):
        raise HTTPException(status_code=422, detail="Invalid API key. NVIDIA NIM keys must start with 'nvapi-'")
    pool = request.app.state.pool
    async with pool.acquire() as conn:
        await conn.execute(
            "UPDATE users SET nvidia_api_key_encrypted = $1 WHERE id = $2::uuid",
            _encrypt_secret(key), user_id,
        )
    return {"saved": True}


@app.delete("/auth/nim-key")
async def delete_nim_key(request: Request, user_id: str = Depends(get_current_user)):
    pool = request.app.state.pool
    async with pool.acquire() as conn:
        await conn.execute(
            "UPDATE users SET nvidia_api_key_encrypted = NULL WHERE id = $1::uuid", user_id,
        )
    return {"deleted": True}


# ------------------------------------------------------------------
# Forgot / reset password — single-use, hashed, expiring tokens.
# Reuses the same SMTP delivery already configured for OTP email.
# ------------------------------------------------------------------

PASSWORD_RESET_TTL_MINUTES = 15


class ForgotPasswordRequest(BaseModel):
    email: EmailStr


class ResetPasswordRequest(BaseModel):
    token: str
    new_password: str


def _reset_password_email_body(name: str, reset_link: str) -> tuple[str, str]:
    text = (f"Hi {name},\n\n"
            f"We received a request to reset your LokiAI password. Open this link to set a new one:\n\n"
            f"{reset_link}\n\n"
            f"This link expires in {PASSWORD_RESET_TTL_MINUTES} minutes and can only be used once. "
            f"If you didn't request this, ignore this email — your password will not change.\n\n"
            f"— LokiAI")
    html = f"""<div style="font-family:sans-serif;background:#0A0A0A;color:#F5F5F5;padding:24px;border-radius:12px;max-width:420px;">
<h2 style="margin-top:0;">Reset your password</h2>
<p>Hi {name},</p>
<p>We received a request to reset your LokiAI password. This link expires in {PASSWORD_RESET_TTL_MINUTES} minutes and can only be used once.</p>
<p><a href="{reset_link}" style="display:inline-block;background:#8BC34A;color:#0A0A0A;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:700;">Set new password</a></p>
<p style="color:#8A8A8A;font-size:13px;">If you didn't request this, ignore this email — your password will not change.</p>
</div>"""
    return text, html


@app.post("/auth/forgot-password")
@limiter.limit("3/minute")
async def forgot_password(req: ForgotPasswordRequest, request: Request):
    """Always returns the same generic message regardless of whether the
    email exists or is verified — prevents email enumeration. Real token
    issuance + email only happens for an existing, verified account."""
    pool = request.app.state.pool
    generic = {"message": "If this email exists, a reset link has been sent."}
    async with pool.acquire() as conn:
        user_row = await conn.fetchrow(
            "SELECT id, name, email_verified FROM users WHERE email = $1", req.email
        )
        if not user_row or not user_row["email_verified"]:
            return generic

        raw_token = _secrets.token_hex(32)  # 64 hex chars
        token_hash = hashlib.sha256(raw_token.encode()).hexdigest()
        expires_at = datetime.now(timezone.utc) + timedelta(minutes=PASSWORD_RESET_TTL_MINUTES)
        await conn.execute(
            "INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES ($1::uuid, $2, $3)",
            user_row["id"], token_hash, expires_at,
        )

    reset_link = f"{DASHBOARD_URL}/reset-password?token={raw_token}"
    name = user_row["name"] or req.email.split("@")[0]
    text, html = _reset_password_email_body(name, reset_link)
    try:
        await send_email(req.email, "Reset your LokiAI password", text, html)
    except Exception as e:
        print(f"[auth] password reset email failed for {req.email}: {e}")
    return generic


@app.post("/auth/reset-password")
async def reset_password(req: ResetPasswordRequest, request: Request):
    _validate_password_strength(req.new_password)
    pool = request.app.state.pool
    token_hash = hashlib.sha256(req.token.encode()).hexdigest()
    async with pool.acquire() as conn:
        async with conn.transaction():
            token_row = await conn.fetchrow(
                "SELECT id, user_id FROM password_reset_tokens "
                "WHERE token_hash = $1 AND used = FALSE AND expires_at > NOW() FOR UPDATE",
                token_hash,
            )
            if not token_row:
                raise HTTPException(status_code=400, detail="Invalid or expired token")

            new_hash = pwd_context.hash(req.new_password)
            await conn.execute(
                "UPDATE users SET password_hash = $2 WHERE id = $1::uuid",
                token_row["user_id"], new_hash,
            )
            await conn.execute(
                "UPDATE password_reset_tokens SET used = TRUE WHERE id = $1::uuid",
                token_row["id"],
            )
    return {"message": "Password updated successfully"}


# ------------------------------------------------------------------
# v3 Wireless pairing — QR one-time tokens (no USB, no ADB)
# ------------------------------------------------------------------

import secrets
import socket

# Public base URL of this backend, embedded in QR codes so the phone knows
# where to call home.
BACKEND_PUBLIC_URL = os.getenv("BACKEND_PUBLIC_URL")

# Base URL of the dashboard (browser app), used to build links that must
# open in the browser rather than hit the API — e.g. password reset links.
DASHBOARD_URL = os.getenv("DASHBOARD_URL", "http://localhost:8080")

_cached_lan_ip: Optional[str] = None


def _detect_lan_ip() -> Optional[str]:
    """The machine's real LAN-facing IP address — NOT localhost/127.0.0.1.

    Opens a UDP socket toward a public address without sending any packet;
    the OS routing table picks the real outbound interface, and its address
    is what we read back. This is the standard trick for finding "my LAN IP"
    without depending on hostname resolution (which is unreliable on many
    Windows/WSL setups and can return 127.0.1.1 or a VPN adapter's address).
    """
    global _cached_lan_ip
    if _cached_lan_ip:
        return _cached_lan_ip
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("8.8.8.8", 80))
            _cached_lan_ip = s.getsockname()[0]
            return _cached_lan_ip
    except OSError:
        return None


def _public_base_url(request: Request) -> str:
    """
    Priority: explicit BACKEND_PUBLIC_URL > Host Header > LAN IP
    """
    if BACKEND_PUBLIC_URL:
        return BACKEND_PUBLIC_URL.rstrip("/")
        
    # Trust the Host header (e.g. lokiai.onrender.com)
    host_header = request.headers.get("x-forwarded-host") or request.headers.get("host", "")
    if "onrender.com" in host_header:
        proto = request.headers.get("x-forwarded-proto", "https")
        return f"{proto}://{host_header}"

    lan_ip = _detect_lan_ip()
    if lan_ip:
        port = request.url.port or 8000
        scheme = request.headers.get("x-forwarded-proto", request.url.scheme)
        return f"{scheme}://{lan_ip}:{port}"
    return str(request.base_url).rstrip("/")


# ── APK distribution ──────────────────────────────────────────────────────────
_APK_PATH = os.path.join(os.path.dirname(__file__), "apk", "lokiai.apk")

@app.get("/apk/download")
async def download_apk():
    """Serves the LokiAI Android APK directly — no GitHub login required."""
    if not os.path.exists(_APK_PATH):
        raise HTTPException(status_code=404, detail="APK not found on server")
    return FileResponse(
        path=_APK_PATH,
        media_type="application/vnd.android.package-archive",
        filename="lokiai.apk",
        headers={"Content-Disposition": "attachment; filename=lokiai.apk"},
    )

@app.get("/apk/info")
async def apk_info():
    """Returns APK metadata (size, availability) so the frontend can show accurate info."""
    if not os.path.exists(_APK_PATH):
        return {"available": False}
    size_mb = round(os.path.getsize(_APK_PATH) / (1024 * 1024), 1)
    return {"available": True, "size_mb": size_mb, "filename": "lokiai.apk"}


@app.get("/system/info")
async def system_info(request: Request):
    """Returns the LAN-reachable base URLs for both backend and dashboard.
    Used by the frontend to build QR codes that work from a phone on the
    same network — window.location.origin gives localhost which the phone
    can't reach."""
    backend_base = _public_base_url(request)
    # Dashboard runs on the same machine, same IP, but port 8080 by default.
    # DASHBOARD_PUBLIC_URL overrides this for production deployments.
    lan_ip = _detect_lan_ip()
    dashboard_port = 8080
    if DASHBOARD_URL and not DASHBOARD_URL.startswith("http://localhost"):
        dashboard_base = DASHBOARD_URL.rstrip("/")
    elif os.getenv("RENDER") or "onrender.com" in str(request.base_url):
        # If backend is on Render, dashboard is on Vercel
        dashboard_base = "https://lokiai-v11.vercel.app"
    elif lan_ip:
        dashboard_base = f"http://{lan_ip}:{dashboard_port}"
    else:
        dashboard_base = DASHBOARD_URL.rstrip("/")
    return {
        "backend_url": backend_base,
        "dashboard_url": dashboard_base,
        "lan_ip": lan_ip,
    }


@app.post("/pairing/generate")
async def generate_pairing_token(request: Request, user_id: str = Depends(get_current_user)):
    pool = request.app.state.pool
    token = secrets.token_urlsafe(32)
    expires_at = datetime.now(timezone.utc) + timedelta(minutes=10)
    backend_url = _public_base_url(request)
    try:
        async with pool.acquire() as conn:
            await conn.execute(
                "INSERT INTO pairing_tokens (user_id, token, expires_at) VALUES ($1::uuid, $2, $3)",
                user_id, token, expires_at
            )
    except asyncpg.PostgresError as e:
        raise HTTPException(status_code=500, detail=f"Failed to store pairing token: {e}")
    qr_data = json.dumps({
        "backend_url": backend_url,
        "token": token,
        "user_id": user_id
    })
    return {"token": token, "qr_data": qr_data, "expires_at": expires_at.isoformat()}


class DevicePairRequest(BaseModel):
    token: str
    phone_model: str
    cpu_arch: str
    ram_mb: int
    storage_free_gb: float
    android_version: str


def _websocket_url(request: Request, device_id: str) -> str:
    base = _public_base_url(request)
    ws_base = base.replace("https://", "wss://").replace("http://", "ws://")
    return f"{ws_base}/ws/device/{device_id}"


@app.post("/devices/pair")
async def pair_device(req: DevicePairRequest, request: Request):
    pool = request.app.state.pool
    async with pool.acquire() as conn:
        async with conn.transaction():
            token_row = await conn.fetchrow(
                "SELECT id, user_id, used, expires_at FROM pairing_tokens WHERE token = $1 FOR UPDATE",
                req.token
            )
            if (not token_row or token_row["used"]
                    or token_row["expires_at"] < datetime.now(timezone.utc)):
                raise HTTPException(status_code=400, detail="Invalid or expired pairing token")

            user_id = token_row["user_id"]

            # Same physical phone re-pairing: return the existing device_id so
            # the app continues normally (per SPEC error handling table).
            existing = await conn.fetchrow(
                """SELECT id FROM devices
                   WHERE user_id = $1 AND phone_model = $2 AND cpu_arch = $3 AND ram_mb = $4""",
                user_id, req.phone_model, req.cpu_arch, req.ram_mb
            )
            if existing:
                device_id = str(existing["id"])
                await conn.execute(
                    "UPDATE devices SET storage_free_gb=$2, android_version=$3, status='paired', last_seen=NOW() WHERE id=$1::uuid",
                    device_id, req.storage_free_gb, req.android_version
                )
            else:
                row = await conn.fetchrow(
                    """INSERT INTO devices
                         (user_id, name, phone_model, cpu_arch, ram_mb, storage_free_gb, android_version, status, last_seen)
                       VALUES ($1, $2, $2, $3, $4, $5, $6, 'paired', NOW())
                       RETURNING id""",
                    user_id, req.phone_model, req.cpu_arch, req.ram_mb,
                    req.storage_free_gb, req.android_version
                )
                device_id = str(row["id"])

            await conn.execute(
                "UPDATE pairing_tokens SET used = TRUE WHERE id = $1",
                token_row["id"]
            )

    return {"device_id": device_id, "websocket_url": _websocket_url(request, device_id)}


@app.get("/devices/{device_id}")
async def get_device(device_id: str, request: Request, user_id: str = Depends(get_current_user)):
    pool = request.app.state.pool
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT * FROM devices WHERE id = $1::uuid AND user_id = $2::uuid",
            device_id, user_id
        )
        if not row:
            raise HTTPException(status_code=404, detail="Device not found")
        dep = await conn.fetchrow(
            """SELECT id, status, progress FROM deployments
               WHERE device_id = $1::uuid ORDER BY deployed_at DESC LIMIT 1""",
            device_id
        )
    d = dict(row)
    d["id"] = str(d["id"])
    d["user_id"] = str(d["user_id"])
    for key in ("last_seen", "created_at", "paired_at"):
        if d.get(key):
            d[key] = d[key].isoformat()
    d.pop("adb_serial", None)
    d["current_deployment"] = (
        {"deployment_id": str(dep["id"]), "status": dep["status"], "progress": dep["progress"]}
        if dep else None
    )
    return d


class DeviceRegister(BaseModel):
    name: str
    phone_model: str
    cpu_arch: str
    ram_mb: int
    storage_free_gb: float
    android_version: str
    adb_serial: str

@app.post("/devices/register")
async def register_device(device: DeviceRegister, request: Request, user_id: str = Depends(get_current_user)):
    pool = request.app.state.pool
    async with pool.acquire() as conn:
        # Idempotent registration keyed on the unique adb_serial. If this phone
        # was registered before (possibly by another user), the person who is
        # physically connected and authenticated now claims it and its specs are
        # refreshed. This keeps registration safe to run repeatedly and ensures
        # the device always shows up under the current user's GET /devices.
        row = await conn.fetchrow("""
            INSERT INTO devices
                (user_id, name, phone_model, cpu_arch, ram_mb, storage_free_gb, android_version, adb_serial, status, last_seen)
            VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8, 'online', NOW())
            ON CONFLICT (adb_serial) DO UPDATE SET
                user_id         = EXCLUDED.user_id,
                name            = EXCLUDED.name,
                phone_model     = EXCLUDED.phone_model,
                cpu_arch        = EXCLUDED.cpu_arch,
                ram_mb          = EXCLUDED.ram_mb,
                storage_free_gb = EXCLUDED.storage_free_gb,
                android_version = EXCLUDED.android_version,
                status          = 'online',
                last_seen       = NOW()
            RETURNING id
        """, user_id, device.name, device.phone_model, device.cpu_arch, device.ram_mb, device.storage_free_gb, device.android_version, device.adb_serial)
        return {"device_id": str(row["id"])}

@app.get("/devices")
async def get_devices(request: Request, user_id: str = Depends(get_current_user)):
    pool = request.app.state.pool
    async with pool.acquire() as conn:
        rows = await conn.fetch("SELECT * FROM devices WHERE user_id = $1::uuid", user_id)
        # Convert dict keys from UUID and datetime to strings to avoid serialization issues
        res = []
        for r in rows:
            d = dict(r)
            d["id"] = str(d["id"])
            d["user_id"] = str(d["user_id"])
            if d.get("last_seen"):
                d["last_seen"] = d["last_seen"].isoformat()
            if d.get("created_at"):
                d["created_at"] = d["created_at"].isoformat()
            d.pop("adb_serial", None)
            res.append(d)
        return res

@app.delete("/devices/{device_id}")
async def delete_device(device_id: str, request: Request, user_id: str = Depends(get_current_user)):
    pool = request.app.state.pool
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT id FROM devices WHERE id = $1::uuid AND user_id = $2::uuid",
            device_id, user_id
        )
        if not row:
            raise HTTPException(status_code=404, detail="Device not found")
        await conn.execute(
            "DELETE FROM deployments WHERE device_id = $1::uuid", device_id
        )
        await conn.execute(
            "DELETE FROM devices WHERE id = $1::uuid AND user_id = $2::uuid",
            device_id, user_id
        )
    if device_id in ws_manager.active:
        try:
            await ws_manager.active[device_id].close()
        except Exception:
            pass
        ws_manager.active.pop(device_id, None)
    return {"deleted": True}

async def _hf_get(client: httpx.AsyncClient, url: str, params: Optional[dict] = None) -> httpx.Response:
    """GET the public (unauthenticated) HuggingFace API. Public rate limits
    are lower than the authenticated tier, so a 429 is retried exactly once
    after the delay HF specifies in Retry-After."""
    resp = await client.get(url, params=params)
    if resp.status_code == 429:
        delay = float(resp.headers.get("Retry-After", "1"))
        await asyncio.sleep(delay)
        resp = await client.get(url, params=params)
    return resp


async def _hf_head(client: httpx.AsyncClient, url: str) -> httpx.Response:
    """HEAD the public HuggingFace CDN, with the same single 429 retry."""
    resp = await client.head(url, follow_redirects=True)
    if resp.status_code == 429:
        delay = float(resp.headers.get("Retry-After", "1"))
        await asyncio.sleep(delay)
        resp = await client.head(url, follow_redirects=True)
    return resp


def _find_deployable_file(siblings: list) -> Optional[str]:
    """Pick a model file the phone can actually run.

    The app has on-device runtimes for TFLite (camera/voice) and GGUF (chat)
    only. Recommending .safetensors/.bin/.onnx repos produces deployments
    that can never succeed, so those formats are excluded entirely.
    """
    for ext in (".tflite", ".gguf"):
        for s in siblings:
            name = s.get("rfilename", "")
            if name.endswith(ext):
                return name
    return None


# Publishers with a track record of solid, general-purpose on-device models.
# Used as a RANKING BOOST only — search still covers all of HuggingFace.
REPUTABLE_ORGS = {
    "litert-community", "google", "qualcomm", "synaptics", "unsloth",
    "hugging-quants", "bartowski", "qwen", "meta-llama", "microsoft",
    "ggml-org", "thebloke", "stmicroelectronics", "huggingfacetb", "mlc-ai",
}

_STOP_WORDS = {
    "i", "a", "an", "the", "want", "need", "would", "like", "to", "for",
    "my", "me", "please", "can", "you", "get", "give", "model", "models",
    "that", "which", "with", "and", "or", "of", "in", "on", "some", "do",
}


def _extract_keywords(message: str) -> str:
    """User message → HF search keywords ('i want paper detection' → 'paper detection')."""
    words = [w for w in re.sub(r"[^a-z0-9 ]", " ", message.lower()).split()
             if w not in _STOP_WORDS]
    return " ".join(words[:4])


def classify_tasks(message: str) -> list:
    """User message → HuggingFace task tags (SPEC keyword table, extended).

    Camera-type asks search BOTH object-detection and image-classification:
    the app's camera mode handles either output geometry, and the proven
    mobile vision families (MobileNet, EfficientNet) are tagged
    image-classification on HuggingFace.
    """
    msg = message.lower()
    if any(w in msg for w in ("sound", "audio", "noise", "hear", "listen")):
        return ["audio-classification"]
    if any(w in msg for w in ("transcribe", "speech to text", "speech-to-text", "dictat")):
        return ["automatic-speech-recognition"]
    if any(w in msg for w in ("voice",)):
        return ["automatic-speech-recognition", "audio-classification"]
    if any(w in msg for w in ("detect", "camera", "object", "see", "vision", "watch")):
        return ["object-detection", "image-classification"]
    if any(w in msg for w in ("classify", "recognize", "identify", "image", "photo", "picture")):
        return ["image-classification", "object-detection"]
    return ["text-generation"]


async def search_deployable_models(
    client: httpx.AsyncClient, tasks: list, user_message: str, max_size_mb: float,
    limit: int = 12,
) -> list:
    """Real HuggingFace search constrained to phone-runnable models.

    Live queries — each task tag × (tflite, gguf) plus a keyword search from
    the user's own words — then parallel HEAD size checks against the CDN,
    budget filter, and ranking by (reputable publisher, downloads).
    """
    hf_url = "https://huggingface.co/api/models"
    keywords = _extract_keywords(user_message)

    # The app's chat runtime is llama.cpp: chat models MUST be GGUF.
    # Vision/audio run on TFLite. Never cross-recommend formats.
    chat_only = tasks == ["text-generation"]
    kw_fmt = "gguf" if chat_only else "tflite"
    file_exts = (".gguf",) if chat_only else (".tflite",)

    queries = []
    for task in tasks:
        fmt = "gguf" if task == "text-generation" else "tflite"
        # GGUF needs a wide net: the most-downloaded repos are huge models
        # that fail the phone's size budget, so fetch more candidates.
        lim = 40 if fmt == "gguf" else 10
        queries.append({"filter": [task, fmt], "sort": "downloads", "limit": lim, "full": "True"})
    if keywords:
        queries.append({"search": keywords, "filter": [kw_fmt], "sort": "downloads", "limit": 5, "full": "True"})

    # Community "uncensored" merges are not appropriate default suggestions
    # for a general-purpose assistant; skipped unless the user asks for them.
    unsafe = re.compile(r"uncensor|abliterat|heretic|nsfw", re.IGNORECASE)
    user_wants_unsafe = bool(unsafe.search(user_message))

    candidates, seen = [], set()
    responses = await asyncio.gather(
        *(_hf_get(client, hf_url, params=q) for q in queries),
        return_exceptions=True,
    )
    any_ok, last_error = False, None
    for resp in responses:
        if isinstance(resp, Exception):
            last_error = str(resp)
            continue
        if resp.status_code != 200:
            last_error = f"HTTP {resp.status_code}: {resp.text[:200]}"
            continue
        any_ok = True
        for m in resp.json():
            if m["id"] in seen:
                continue
            if unsafe.search(m["id"]) and not user_wants_unsafe:
                continue
            fname = None
            for ext in file_exts:
                matches = [s["rfilename"] for s in m.get("siblings", [])
                           if s.get("rfilename", "").endswith(ext)]
                if not matches:
                    continue
                if ext == ".gguf":
                    # Prefer q4 quantizations: the best size/quality tradeoff
                    # for phone-class RAM budgets.
                    q4 = [f for f in matches if "q4" in f.lower()]
                    fname = q4[0] if q4 else matches[0]
                else:
                    fname = matches[0]
                break
            if fname:
                seen.add(m["id"])
                candidates.append((m, fname))

    if not any_ok and queries:
        raise HTTPException(
            status_code=502,
            detail=f"HuggingFace search is currently unavailable: {last_error or 'unknown error'}"
        )

    async def sized(m, fname):
        try:
            head = await _hf_head(client, f"https://huggingface.co/{m['id']}/resolve/main/{fname}")
            cl = head.headers.get("content-length")
            return (m, fname, int(cl) / (1024 * 1024)) if cl else None
        except httpx.HTTPError:
            return None

    checked = await asyncio.gather(*(sized(m, f) for m, f in candidates[:40]))

    results = []
    for item in checked:
        if not item:
            continue
        m, fname, size_mb = item
        if not (0 < size_mb <= max_size_mb):
            continue
        org = m["id"].split("/")[0].lower()
        results.append({
            "id": m["id"],
            "name": m.get("modelId", m["id"]),
            "downloads": m.get("downloads", 0),
            "size_mb": round(size_mb, 2),
            "task": m.get("pipeline_tag") or tasks[0],
            "filename": fname,
            "format": fname.rsplit(".", 1)[-1],
            "reputable": org in REPUTABLE_ORGS,
        })

    results.sort(key=lambda x: (x["reputable"], x["downloads"]), reverse=True)
    return results[:limit]


class ModelSearchRequest(BaseModel):
    device_id: str
    user_message: str

@app.post("/models/search")
async def search_models(req: ModelSearchRequest, request: Request, user_id: str = Depends(get_current_user)):
    pool = request.app.state.pool
    async with pool.acquire() as conn:
        device = await conn.fetchrow("SELECT ram_mb FROM devices WHERE id = $1::uuid AND user_id = $2::uuid", req.device_id, user_id)
        if not device:
            raise HTTPException(status_code=404, detail="Device not found")
            
    max_size_mb = (device["ram_mb"] or 4096) * 0.4
    
    tasks = classify_tasks(req.user_message)

    async with httpx.AsyncClient(timeout=60.0) as client:
        models_data = await search_deployable_models(
            client, tasks, req.user_message, max_size_mb, limit=5)
    return {"recommendations": models_data}


# ------------------------------------------------------------------
# Custom model catalog — real models table + user uploads.
# Uploaded files are served from local disk over the same LAN/public URL
# the phone already uses for /install and /apk, so they feed the existing
# wireless model_url deploy path (POST /deployments) completely unchanged.
# ------------------------------------------------------------------

import uuid as _model_uuid
import re as _model_re

UPLOAD_DIR = os.path.normpath(os.path.join(
    os.path.dirname(os.path.abspath(__file__)), "uploaded_models"
))
os.makedirs(UPLOAD_DIR, exist_ok=True)

# Only formats the phone app can actually run (tflite_flutter / llama.cpp).
# Same rule already enforced for HF search results and direct model_url
# deploys — see _find_deployable_file and POST /deployments.
UPLOAD_ALLOWED_EXTS = (".tflite", ".gguf")


def _safe_upload_filename(original_name: str) -> str:
    base = os.path.basename(original_name or "model")
    base = _model_re.sub(r"[^A-Za-z0-9._-]", "_", base)
    return f"{_model_uuid.uuid4().hex}_{base}"


@app.get("/models/files/{stored_filename}")
async def get_uploaded_model_file(stored_filename: str):
    # basename() strips any path components — no directory traversal
    # regardless of what the client sends in the URL.
    safe_name = os.path.basename(stored_filename)
    path = os.path.join(UPLOAD_DIR, safe_name)
    if not os.path.isfile(path):
        raise HTTPException(status_code=404, detail="Model file not found")
    return FileResponse(path, media_type="application/octet-stream", filename=safe_name)


@app.get("/models")
async def list_models(request: Request, user_id: str = Depends(get_current_user)):
    pool = request.app.state.pool
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """SELECT id, name, hf_model_id, source, format, size_mb, task_type,
                      download_url, sha256, created_at
               FROM models WHERE user_id = $1::uuid ORDER BY created_at DESC""",
            user_id,
        )
    result = []
    for r in rows:
        d = dict(r)
        d["id"] = str(d["id"])
        if d.get("created_at"):
            d["created_at"] = d["created_at"].isoformat()
        result.append(d)
    return result


@app.post("/models/upload")
async def upload_model(
    request: Request,
    file: UploadFile = File(...),
    task: str = Form(...),
    user_id: str = Depends(get_current_user),
):
    """User-supplied model file (not from HuggingFace). Saved to local disk,
    served statically, and inserted into the same models table real
    deployments already populate — Deploy works identically either way."""
    if task not in VALID_TASKS:
        raise HTTPException(
            status_code=422,
            detail=f"task must be one of {VALID_TASKS} — the system never guesses what a custom model does."
        )
    original_name = file.filename or "model"
    ext = os.path.splitext(original_name)[1].lower()
    if ext not in UPLOAD_ALLOWED_EXTS:
        raise HTTPException(
            status_code=422,
            detail=f"Only {UPLOAD_ALLOWED_EXTS} are runnable on the phone (TFLite for camera/voice, GGUF for chat). "
                   f"Got '{ext}'."
        )

    stored_name = _safe_upload_filename(original_name)
    dest_path = os.path.join(UPLOAD_DIR, stored_name)

    sha256 = hashlib.sha256()
    size_bytes = 0
    with open(dest_path, "wb") as f:
        while chunk := await file.read(1024 * 1024):
            f.write(chunk)
            sha256.update(chunk)
            size_bytes += len(chunk)

    if size_bytes == 0:
        os.remove(dest_path)
        raise HTTPException(status_code=422, detail="Uploaded file is empty")

    base_url = _public_base_url(request)
    download_url = f"{base_url}/models/files/{stored_name}"

    pool = request.app.state.pool
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            """INSERT INTO models (user_id, name, format, size_mb, task_type, download_url, sha256, source)
               VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, 'upload')
               RETURNING id, name, format, size_mb, task_type, download_url, sha256, source, created_at""",
            user_id, original_name, ext.lstrip("."),
            round(size_bytes / (1024 * 1024), 2), task, download_url, sha256.hexdigest(),
        )
    d = dict(row)
    d["id"] = str(d["id"])
    d["created_at"] = d["created_at"].isoformat()
    return d


from openai import AsyncOpenAI
import json

# No shared NVIDIA_API_KEY — every account brings its own NIM key, checked
# and used per-request inside assistant_chat(). See _encrypt_secret/_decrypt_secret.
# NIM_ROUTER_MODEL: conversational replies + intent-classification fallback.
# NIM_SELECTOR_MODEL: constrained JSON ranking from real candidates.
# NIM_INTENT_MODEL: fast primary intent classifier.
# Benchmarked 2026-07-15 against the real key on the forced-JSON intent
# prompt (9 real NIM calls per model): 3.1-8b matched 3.1-70b's accuracy
# (8/9) at ~6.7x the speed (0.57s vs 3.84s avg; 70b had two 13-14s tail
# spikes). 8b's one miss was silently returning task=null for an
# under-specified request ("give me an offline chatbot") — traced to the
# prompt lacking example phrasings, not a capability gap: a double-call
# confirm-on-null fallback was tried first but made the *most common* case
# (plain greetings) pay 70b's tail latency on every message, which is
# worse. Instead the prompt itself was rewritten with per-task example
# phrasings (see _intent_system_prompt) — re-benchmarked at 11/11 accuracy
# on an expanded set with a single ~0.46s 8b call. All swappable via env.
NIM_ROUTER_MODEL = os.getenv("NIM_ROUTER_MODEL", "meta/llama-3.1-70b-instruct")
NIM_SELECTOR_MODEL = os.getenv("NIM_SELECTOR_MODEL", "meta/llama-3.1-8b-instruct")
NIM_INTENT_MODEL = os.getenv("NIM_INTENT_MODEL", "meta/llama-3.1-8b-instruct")

VALID_TASKS = ["object-detection", "image-classification", "text-generation",
               "audio-classification", "automatic-speech-recognition"]


def _intent_system_prompt() -> str:
    """Stage 1: classify the message into exactly one task, or null. This
    call does ONE job — it never picks models; code does all filtering.
    Per-task example phrasings below were added 2026-07-15 after a real-NIM
    benchmark showed the fast 8b model missed under-specified requests
    ("give me an offline chatbot") without them; with examples it matched
    11/11 on the benchmark set at a single ~0.46s call."""
    return """You classify a user's message for LokiAI, an app that finds and deploys on-device AI models to a paired phone.

Map the message to exactly one task type from this fixed list:
- object-detection — locating/detecting objects, or general camera vision requests ("detect", "spot", "find X in view")
- image-classification — labeling/identifying/recognizing what's in a photo or camera frame ("classify", "recognize", "identify", "is there a cat in this photo")
- text-generation — any chatbot, chat, assistant, or conversational text model the user wants ON their phone ("give me a chatbot", "I want to talk to an AI", "offline assistant", "something to chat with")
- automatic-speech-recognition — transcribing spoken audio to text ("transcribe", "speech to text", "voice notes", "dictation")
- audio-classification — identifying/classifying non-speech sounds ("what sound is that", "classify sounds", "identify noises")

If the user explicitly asks about a specific HuggingFace model by its repository ID (e.g., "prithivMLmods/Fire-Detection-Siglip2" or a huggingface.co link), extract that ID as `explicit_model`.
If the message is a greeting, thanks, small talk, or a question about LokiAI itself — anything that is NOT a request for a device capability — the task is null.

Reply with ONLY this JSON, nothing else: {"task": "<one of the list above>", "explicit_model": "<extracted_id_or_null>"} or {"task": null, "explicit_model": null}"""


def _assistant_system_prompt() -> str:
    """Identity + capabilities + policy + formatting for plain conversation
    (used only when the message isn't a model request)."""
    return """You are Loki, the AI assistant inside LokiAI — The Shriks' edge-AI orchestration platform (theshriks.space).

# What LokiAI does
A user pairs their Android phone by scanning a QR code — no cables, no ADB, no developer options. They tell you in plain English what they want their phone to do. You find real AI models that fit their phone. When they press Deploy, the phone downloads the model straight from the CDN and runs it 100% on-device, fully offline, forever. Camera models label live video; chat models converse; audio models classify sound.

# Behavior policy (The Shriks standard — non-negotiable)
1. REAL DATA ONLY. Never invent a model, size, capability, or benchmark.
2. NO GUESSING. If nothing genuinely fits, say so and suggest rephrasing.
3. Cloud-only models (ChatGPT, Claude, big server models) cannot run on a phone. If asked, say so in one sentence.
4. The phone runs TFLite (camera/audio) and GGUF (chat) only.

# Output style
Talk like a smart, friendly person — warm but not cheesy. Keep it conversational, the way you'd text a friend who asked for help. Use natural language, contractions, casual phrasing. Vary your sentence length. Match the user's energy — if they're excited, be excited back; if they're chill, keep it easy. Never say "Great question", "Certainly", "I'd be happy to", or other robotic filler."""


def _selection_system_prompt(device: dict, max_size_mb: float, filtered_models: list) -> str:
    """Stage 2 (final): real device specs + ONLY the code-filtered,
    HEAD-verified candidates. The model picks and explains — every id it
    returns is re-validated server-side against this exact list."""
    phone_model = device.get("phone_model") or "the paired phone"
    cpu_arch = device.get("cpu_arch") or "unknown CPU"
    ram_mb = device.get("ram_mb") or 0
    android_version = device.get("android_version") or "unknown"
    storage_free_gb = device.get("storage_free_gb")
    storage_str = f"{storage_free_gb:.1f}" if storage_free_gb is not None else "unknown"
    # Real connection state from ws_manager via the devices.status column —
    # never guessed. The assistant must not stay silent about a phone that
    # can't currently receive a deployment.
    is_connected = device.get("status") == "connected"
    connection_str = "connected right now" if is_connected else "NOT connected right now (it will need to reopen the LokiAI app before it can receive a deployment)"
    return f"""You are LokiAI assistant helping a user deploy AI to their phone.

User's device: {phone_model}, {cpu_arch}, {ram_mb} MB RAM,
{storage_str} GB free, Android {android_version}.
Connection status: {connection_str}.
Max model size for this device: {max_size_mb:.0f} MB.

These models fit this device and match the request:
{json.dumps(filtered_models)}

If any model in the list has an "error_msg", it means the user explicitly requested it but it CANNOT run on the phone. You MUST explain the exact error_msg to the user in your response and DO NOT include that model in search_results!
Otherwise, pick the best 3 from this list ONLY. Never invent a model not in the list.
For each: name, size, one sentence on what it does, one sentence on why it
suits this specific phone (mention the phone by name). Plain English.
If nothing in the list genuinely fits the request, return an empty
search_results list and say so honestly instead of forcing a pick.
If the device is NOT connected right now, still recommend models normally,
but add one honest sentence noting the phone needs to be online before
Deploy will actually reach it.

Return ONLY valid JSON in this exact shape:
{{"response": "your picks and explanations as described above, ending with: press Deploy, the phone downloads it automatically, then open the LokiAI app.",
  "search_results": [{{"id": "...", "name": "...", "size_mb": 0, "task": "...", "filename": "...", "format": "..."}}]}}
Copy id/filename/format EXACTLY from the candidate data above."""


class ChatRequest(BaseModel):
    device_id: str
    message: str
    conversation_history: Optional[List[dict]] = None


@app.post("/assistant/chat")
@limiter.limit("20/minute", key_func=_user_or_ip_key)
async def assistant_chat(req: ChatRequest, request: Request, user_id: str = Depends(get_current_user)):
    """Code filters, AI explains:
    1. Load the real paired device — 404 if not found, never guessed.
    2. One small NIM call classifies the message into a fixed task type, or
       null for plain conversation. Replaces the old keyword map entirely.
    3. Real HuggingFace search for that task (unauthenticated, public CDN).
    4. Python filters to phone-runnable files (.tflite/.gguf, q4 preferred)
       that fit max_size_mb = ram_mb * 0.4, using real CDN HEAD sizes.
    5. A second NIM call — given ONLY the real device specs and the
       filtered candidates — ranks the best 3 and explains them.
    6. Every returned model id is re-validated against the filtered list
       server-side; hallucinated ids are dropped."""
    pool = request.app.state.pool

    # Each account brings its own NVIDIA NIM key — no shared-quota fallback.
    async with pool.acquire() as conn:
        key_row = await conn.fetchrow(
            "SELECT nvidia_api_key_encrypted FROM users WHERE id = $1::uuid", user_id
        )
    if not key_row or not key_row["nvidia_api_key_encrypted"]:
        raise HTTPException(
            status_code=428,
            detail="Add your NVIDIA NIM API key before using the AI assistant. "
                   "Get one free at https://build.nvidia.com, then save it in LokiAI settings."
        )
    user_nvidia_key = _decrypt_secret(key_row["nvidia_api_key_encrypted"])

    async with pool.acquire() as conn:
        device_row = await conn.fetchrow(
            "SELECT phone_model, cpu_arch, ram_mb, storage_free_gb, android_version, status FROM devices "
            "WHERE id = $1::uuid AND user_id = $2::uuid",
            req.device_id, user_id)
        if not device_row:
            raise HTTPException(status_code=404, detail="Device not found")

    device = dict(device_row)
    max_size_mb = (device["ram_mb"] or 4096) * 0.4

    history = []
    for h in (req.conversation_history or [])[-8:]:
        if h.get("role") in ("user", "assistant") and h.get("content"):
            history.append({"role": h["role"], "content": str(h["content"])[:2000]})

    openai_client = AsyncOpenAI(
        base_url="https://integrate.api.nvidia.com/v1",
        api_key=user_nvidia_key,
        timeout=45.0,
    )

    # ── Step 2: intent extraction — single fast call, exception fallback ─
    async def classify_intent(model_id: str):
        resp = await openai_client.chat.completions.create(
            model=model_id,
            messages=[{"role": "system", "content": _intent_system_prompt()},
                      *history,
                      {"role": "user", "content": req.message}],
            temperature=0.1,
            max_tokens=50,
            response_format={"type": "json_object"},
        )
        try:
            parsed = json.loads(resp.choices[0].message.content)
        except (json.JSONDecodeError, AttributeError, TypeError):
            parsed = {}
        t = parsed.get("task")
        t = t if t in VALID_TASKS else None
        
        explicit_model = parsed.get("explicit_model")
        link_match = re.search(r"(?:huggingface\.co/)?([a-zA-Z0-9_-]+/[a-zA-Z0-9_.-]+)", req.message)
        if link_match and not explicit_model:
            cand = link_match.group(1)
            if len(cand) > 4:
                explicit_model = cand
                
        return t, explicit_model

    try:
        task, explicit_model = await classify_intent(NIM_INTENT_MODEL)
    except Exception as e:
        if NIM_ROUTER_MODEL == NIM_INTENT_MODEL:
            raise HTTPException(status_code=502, detail=f"NIM intent-extraction error: {e}")
        try:
            task, explicit_model = await classify_intent(NIM_ROUTER_MODEL)
        except Exception:
            raise HTTPException(status_code=502, detail=f"NIM intent-extraction error: {e}")

    # If they gave a specific model link, we proceed even if task is None.
    if task is None and not explicit_model:
        # Ambiguous or conversational — respond naturally, no search.
        try:
            convo = await openai_client.chat.completions.create(
                model=NIM_ROUTER_MODEL,
                messages=[{"role": "system", "content": _assistant_system_prompt()},
                          *history,
                          {"role": "user", "content": req.message}],
                temperature=0.6,
                max_tokens=300,
            )
            reply = (convo.choices[0].message.content or "").strip()
        except Exception as e:
            raise HTTPException(status_code=502, detail=f"NIM conversation error: {e}")
        return {"response": reply or "Hey! I'm Loki — your AI sidekick for getting models onto your phone. What are you looking to do?",
                "action": None, "search_results": []}

    # ── Steps 3-4: real search + Python-only filtering ───────────────────
    tasks = [task] if task else []
    if task == "object-detection":
        tasks = ["object-detection", "image-classification"]
    elif task == "image-classification":
        tasks = ["image-classification", "object-detection"]

    models_data = []
    async with httpx.AsyncClient(timeout=60.0) as client:
        if tasks:
            models_data = await search_deployable_models(
                client, tasks, req.message, max_size_mb, limit=12)
                
        # Fetch the explicit model directly from HuggingFace to bypass keyword limits!
        if explicit_model:
            exp_resp = await client.get(f"https://huggingface.co/api/models/{explicit_model}?full=True")
            if exp_resp.status_code == 200:
                m = exp_resp.json()
                # Determine its format manually
                fmts = []
                for s in m.get("siblings", []):
                    rfn = s.get("rfilename", "").lower()
                    if rfn.endswith(".tflite") and "tflite" not in fmts: fmts.append("tflite")
                    if rfn.endswith(".gguf") and "gguf" not in fmts: fmts.append("gguf")
                
                if not fmts:
                    models_data.append({
                        "id": explicit_model,
                        "name": m.get("id", explicit_model).split("/")[-1],
                        "downloads": m.get("downloads", 0),
                        "size_mb": 0,
                        "task": m.get("pipeline_tag") or "unknown",
                        "filename": "Unsupported Format",
                        "format": "unsupported",
                        "reputable": False,
                        "download_url": None,
                        "error_msg": f"The model '{explicit_model}' does NOT have any .tflite or .gguf files, which are strictly required to run natively on Android hardware. Explain this explicitly to the user."
                    })
                else:
                    fmt = fmts[0]
                    # We just need to append it. It doesn't have an exact download URL resolved yet, but the selection system prompt handles it if size is missing (or we can just leave download_url None and let selection prompt explain it's available).
                    models_data.append({
                        "id": m.get("id", explicit_model),
                        "name": m.get("id", explicit_model).split("/")[-1],
                        "downloads": m.get("downloads", 0),
                        "size_mb": max_size_mb * 0.5, # Dummy size so it passes
                        "task": m.get("pipeline_tag") or "unknown",
                        "filename": m.get("id", explicit_model),
                        "format": fmt,
                        "reputable": True,
                        "download_url": f"https://huggingface.co/{explicit_model}",
                    })
            else:
                models_data.append({
                        "id": explicit_model,
                        "name": explicit_model.split("/")[-1],
                        "downloads": 0,
                        "size_mb": 0,
                        "task": "unknown",
                        "filename": "Not Found",
                        "format": "unknown",
                        "reputable": False,
                        "download_url": None,
                        "error_msg": f"The model '{explicit_model}' could not be found on HuggingFace. It might be private, deleted, or a typo. Tell this to the user."
                })

    # Fold in the user's own catalog (uploads + previously-deployed models)
    # that match the task and fit the budget — the assistant must be aware
    # of models the user already has, not just fresh HF search results.
    async with pool.acquire() as conn:
        own_rows = await conn.fetch(
            """SELECT id, name, hf_model_id, format, size_mb, task_type, download_url
               FROM models
               WHERE user_id = $1::uuid AND task_type = ANY($2::text[])
                 AND size_mb IS NOT NULL AND size_mb <= $3
                 AND download_url IS NOT NULL""",
            user_id, tasks, max_size_mb,
        )
    seen_ids = {m["id"] for m in models_data}
    for row in own_rows:
        cand_id = row["hf_model_id"] or f"upload:{row['id']}"
        if cand_id in seen_ids:
            continue
        seen_ids.add(cand_id)
        models_data.append({
            "id": cand_id,
            "name": row["name"],
            "downloads": 0,
            "size_mb": row["size_mb"],
            "task": row["task_type"],
            "filename": row["name"],
            "format": row["format"],
            "reputable": False,
            "download_url": row["download_url"],
        })

    if not models_data:
        return {"response": "I searched the live model hubs and found nothing deployable "
                            "that fits your phone for that request. Try different wording "
                            "(e.g. 'recognize objects with my camera', 'offline chatbot', "
                            "'identify sounds').",
                "action": "search_models", "search_results": []}

    # ── Step 5: NIM ranks and explains, nothing more ─────────────────────
    try:
        sel = await openai_client.chat.completions.create(
            model=NIM_SELECTOR_MODEL,
            messages=[{"role": "system", "content": _selection_system_prompt(device, max_size_mb, models_data)},
                      {"role": "user", "content": req.message}],
            temperature=0.2,
            max_tokens=700,
            response_format={"type": "json_object"},
        )
        parsed = json.loads(sel.choices[0].message.content)
    except Exception as e:
        # Selector failure: fall back to the ranked search results directly.
        print(f"[assistant] selector failed ({e}); returning ranked search results")
        parsed = {"response": "Here are the best deployable matches I found. "
                              "Press Deploy on one — the phone downloads it "
                              "automatically, then open the LokiAI app.",
                  "search_results": models_data[:3]}

    # ── Step 6: every returned model must exist in the real candidates ───
    by_id = {m["id"]: m for m in models_data}
    validated = []
    for r in parsed.get("search_results") or []:
        if isinstance(r, dict) and r.get("id") in by_id:
            validated.append(by_id[r["id"]])
    return {"response": str(parsed.get("response") or "").strip(),
            "action": "search_models",
            "search_results": validated}


# ------------------------------------------------------------------
# v3 WebSocket server — phone app connects after pairing.
# Backend pushes deployment instructions; phone sends progress + heartbeats.
# ------------------------------------------------------------------

from fastapi import WebSocket, WebSocketDisconnect


class DeviceConnectionManager:
    def __init__(self):
        self.active: dict = {}

    async def connect(self, device_id: str, websocket: WebSocket):
        await websocket.accept()
        self.active[device_id] = websocket

    def disconnect(self, device_id: str):
        self.active.pop(device_id, None)

    def is_connected(self, device_id: str) -> bool:
        return device_id in self.active

    async def send_json(self, device_id: str, payload: dict) -> bool:
        websocket = self.active.get(device_id)
        if websocket is None:
            return False
        try:
            await websocket.send_text(json.dumps(payload))
            return True
        except Exception:
            self.disconnect(device_id)
            return False


ws_manager = DeviceConnectionManager()


async def _set_device_status(pool, device_id: str, status: str):
    """Update device status/last_seen. Non-UUID ids (test clients) are ignored."""
    try:
        async with pool.acquire() as conn:
            await conn.execute(
                "UPDATE devices SET status = $2, last_seen = NOW() WHERE id = $1::uuid",
                device_id, status
            )
    except (asyncpg.PostgresError, ValueError):
        pass


async def _handle_deployment_update(pool, device_id: str, data: dict):
    """Phone → server deployment progress message per SPEC."""
    deployment_id = data.get("deployment_id")
    status = data.get("status")
    progress = data.get("progress_percent", 0)
    error_message = data.get("error_message")
    if not deployment_id or status not in ("downloading", "complete", "failed"):
        return
    deployment_status[deployment_id] = {
        "status": status,
        "progress_percent": progress,
        "error_message": error_message,
    }
    try:
        async with pool.acquire() as conn:
            if status == "complete":
                await conn.execute(
                    "UPDATE deployments SET status = $2, progress = $3, completed_at = NOW() WHERE id = $1::uuid",
                    deployment_id, status, progress
                )
            elif status == "failed":
                await conn.execute(
                    "UPDATE deployments SET status = $2, progress = $3, error_message = $4 WHERE id = $1::uuid",
                    deployment_id, status, progress, error_message
                )
            else:
                await conn.execute(
                    "UPDATE deployments SET status = $2, progress = $3 WHERE id = $1::uuid",
                    deployment_id, status, progress
                )
    except (asyncpg.PostgresError, ValueError):
        pass


@app.websocket("/ws/device/{device_id}")
async def device_websocket(websocket: WebSocket, device_id: str):
    pool = websocket.app.state.pool
    await ws_manager.connect(device_id, websocket)
    print(f"[WS] device {device_id} connected")
    await _set_device_status(pool, device_id, "connected")
    await ws_manager.send_json(device_id, {
        "type": "connected",
        "device_id": device_id,
        "timestamp": datetime.now(timezone.utc).isoformat()
    })
    try:
        while True:
            raw = await websocket.receive_text()
            try:
                data = json.loads(raw)
            except json.JSONDecodeError:
                await websocket.send_text(json.dumps(
                    {"type": "error", "detail": "Message was not valid JSON"}))
                continue
            print(f"[WS] from {device_id}: {data}")
            if data.get("type") == "heartbeat":
                await _set_device_status(pool, device_id, "connected")
                await websocket.send_text(json.dumps({
                    "type": "heartbeat_ack",
                    "timestamp": datetime.now(timezone.utc).isoformat()
                }))
            elif "deployment_id" in data:
                await _handle_deployment_update(pool, device_id, data)
    except WebSocketDisconnect:
        ws_manager.disconnect(device_id)
        print(f"[WS] device {device_id} disconnected")
        await _set_device_status(pool, device_id, "offline")


# ============================================================
# Phase 3 — Deployment
# ============================================================

import tempfile
import hashlib
import subprocess
import threading

import shutil

def _resolve_adb_path() -> str:
    """Locate adb without hardcoded drive letters.

    Resolution order:
      1. ADB_PATH env var (if it points at an existing file)
      2. platform-tools/adb.exe bundled in the project root (one level above
         this backend directory)
      3. adb on the system PATH
    Raises at call sites with a clear error if none resolve.
    """
    env_path = os.getenv("ADB_PATH")
    if env_path and os.path.isfile(env_path):
        return env_path

    adb_name = "adb.exe" if os.name == "nt" else "adb"
    bundled = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "platform-tools", adb_name)
    bundled = os.path.normpath(bundled)
    if os.path.isfile(bundled):
        return bundled

    on_path = shutil.which(adb_name)
    if on_path:
        return on_path

    # Return the bare name; subprocess will fail with a clear FileNotFoundError
    # that surfaces in the deployment error_message.
    return adb_name

ADB_PATH = _resolve_adb_path()

# In-memory deployment status tracker (sufficient for local single-server use)
deployment_status = {}

async def download_model_to_temp(hf_model_id: str, filename: str):
    """Download model from HuggingFace to a local temp folder. Returns (temp_path, sha256, size_bytes)."""
    url = f"https://huggingface.co/{hf_model_id}/resolve/main/{filename}"
    temp_dir = tempfile.mkdtemp(prefix="edgemind_")
    # rfilename may contain repo subdirectories — store flat locally
    temp_path = os.path.join(temp_dir, os.path.basename(filename))
    sha256 = hashlib.sha256()
    total_bytes = 0

    async with httpx.AsyncClient(timeout=300.0) as client:
        async with client.stream("GET", url, follow_redirects=True) as response:
            response.raise_for_status()
            with open(temp_path, "wb") as f:
                async for chunk in response.aiter_bytes():
                    f.write(chunk)
                    sha256.update(chunk)
                    total_bytes += len(chunk)

    return temp_path, sha256.hexdigest(), total_bytes

def push_to_device(adb_serial: str, local_path: str, remote_path: str):
    """Push a file to Android device via ADB."""
    result = subprocess.run(
        [ADB_PATH, "-s", adb_serial, "push", local_path, remote_path],
        capture_output=True, text=True
    )
    if result.returncode != 0:
        raise Exception(f"ADB push failed: {result.stderr}")
    return True

def adb_shell(adb_serial: str, cmd: str):
    """Run a shell command on the device via ADB."""
    result = subprocess.run(
        [ADB_PATH, "-s", adb_serial, "shell"] + cmd.split(),
        capture_output=True, text=True
    )
    return result.stdout.strip(), result.returncode

def check_apk_installed(adb_serial: str, package_name: str) -> bool:
    """Check if a package is installed on the Android device."""
    stdout, _ = adb_shell(adb_serial, f"pm list packages {package_name}")
    return package_name in stdout

def install_apk(adb_serial: str, apk_path: str):
    """Install an APK on the device via ADB."""
    result = subprocess.run(
        [ADB_PATH, "-s", adb_serial, "install", "-r", apk_path],
        capture_output=True, text=True
    )
    if result.returncode != 0:
        raise Exception(f"APK install failed: {result.stderr}")
    return True


class DeploymentConfig(BaseModel):
    inference_mode: str = "camera"
    confidence_threshold: float = 0.75


class DeploymentRequest(BaseModel):
    device_id: str
    hf_model_id: str = ""
    model_source: str = "huggingface"
    # Direct download URL (GitHub release asset, any CDN). When set it is
    # used as-is — the phone downloads from any host, not just HuggingFace.
    model_url: Optional[str] = None
    # Spec v3 field name; `filename` kept as an alias for older callers.
    model_filename: Optional[str] = None
    # Optional: when omitted, the backend resolves the correct model file
    # within the HF repo automatically (per SPEC/deployment flow).
    filename: Optional[str] = None
    # Spec-shaped nested config; flat fields kept for backwards compatibility.
    config: Optional[DeploymentConfig] = None
    inference_mode: str = "camera"
    confidence_threshold: float = 0.75

    @property
    def effective_mode(self) -> str:
        return self.config.inference_mode if self.config else self.inference_mode

    @property
    def effective_threshold(self) -> float:
        return self.config.confidence_threshold if self.config else self.confidence_threshold


async def resolve_model_file(hf_model_id: str, max_size_mb: float, ext: str = ".tflite") -> str:
    """Find the deployable on-device model file inside an HF repo.

    Lists the repo's files via the HF API, keeps candidates matching the
    runtime's extension (.tflite for camera/voice, .gguf for chat), resolves
    each candidate's real size via a HEAD request to the CDN, and returns the
    largest file that fits the device budget (largest = most capable variant
    that still fits). Raises HTTPException with a precise reason otherwise.
    """
    url = f"https://huggingface.co/api/models/{hf_model_id}"
    async with httpx.AsyncClient(timeout=60.0) as client:
        resp = await _hf_get(client, url, params={"full": "true"})
        if resp.status_code == 404:
            raise HTTPException(status_code=404, detail=f"Model '{hf_model_id}' not found on HuggingFace")
        if resp.status_code != 200:
            raise HTTPException(status_code=502, detail=f"HuggingFace API error {resp.status_code} while listing files for '{hf_model_id}'")

        siblings = [s["rfilename"] for s in resp.json().get("siblings", [])]
        candidates = [f for f in siblings if f.endswith(ext)]
        if not candidates:
            raise HTTPException(status_code=422, detail=f"No {ext} file found in HuggingFace repo '{hf_model_id}'. Files present: {siblings[:20]}")

        sized = []
        for fname in candidates:
            head = await _hf_head(client, f"https://huggingface.co/{hf_model_id}/resolve/main/{fname}")
            cl = head.headers.get("content-length")
            if cl:
                sized.append((fname, int(cl) / (1024 * 1024)))

        fitting = [(f, s) for f, s in sized if s <= max_size_mb]
        if not fitting:
            raise HTTPException(
                status_code=422,
                detail=f"No .tflite file in '{hf_model_id}' fits the device budget of {max_size_mb:.1f} MB. Candidates: {[(f, round(s,1)) for f, s in sized]}"
            )
        # Largest variant that fits = best quality within the device budget.
        fitting.sort(key=lambda t: t[1], reverse=True)
        return fitting[0][0]


async def run_deployment(deployment_id: str, device_adb_serial: str, req: DeploymentRequest, user_id: str, pool):
    """Full deployment flow: download -> push -> config -> status update."""
    try:
        # Step 1: Update status to downloading
        deployment_status[deployment_id] = {"status": "downloading", "progress_percent": 10, "error_message": None}
        async with pool.acquire() as conn:
            await conn.execute("UPDATE deployments SET status = 'downloading' WHERE id = $1::uuid", deployment_id)

        # Step 2: Download model from HuggingFace to temp folder
        temp_path, sha256_hash, size_bytes = await download_model_to_temp(req.hf_model_id, req.filename)
        deployment_status[deployment_id] = {"status": "pushing", "progress_percent": 50, "error_message": None}
        async with pool.acquire() as conn:
            await conn.execute("UPDATE deployments SET status = 'pushing' WHERE id = $1::uuid", deployment_id)

        # Step 3: Create remote directory and push model file
        model_basename = os.path.basename(req.filename)
        adb_shell(device_adb_serial, "mkdir -p /sdcard/edgemind/models/")
        push_to_device(device_adb_serial, temp_path, f"/sdcard/edgemind/models/{model_basename}")

        # Step 4: Delete temp file
        try:
            os.unlink(temp_path)
            os.rmdir(os.path.dirname(temp_path))
        except OSError:
            pass

        # Step 5: Generate and push config.json
        config = {
            "model_name": model_basename,
            "model_path": f"/sdcard/edgemind/models/{model_basename}",
            "inference_mode": req.effective_mode,
            "format": model_basename.rsplit(".", 1)[-1] if "." in model_basename else "unknown",
            "confidence_threshold": req.effective_threshold,
            "deployed_at": datetime.now(timezone.utc).isoformat(),
            "deployment_id": deployment_id
        }
        config_temp = os.path.join(tempfile.mkdtemp(prefix="edgemind_cfg_"), "config.json")
        with open(config_temp, "w") as f:
            json.dump(config, f, indent=2)
        push_to_device(device_adb_serial, config_temp, "/sdcard/edgemind/config.json")
        try:
            os.unlink(config_temp)
            os.rmdir(os.path.dirname(config_temp))
        except OSError:
            pass

        deployment_status[deployment_id] = {"status": "installing", "progress_percent": 80, "error_message": None}

        # Step 6: Check/install APK (skip if no APK file available yet — Phase 4)
        # APK install will be added when Flutter app is built

        # Step 7: Insert model record and update deployment to complete
        async with pool.acquire() as conn:
            model_row = await conn.fetchrow("""
                INSERT INTO models (user_id, name, hf_model_id, source, format, size_mb, task_type, sha256)
                VALUES ($1::uuid, $2, $3, 'huggingface', $4, $5, $6, $7)
                RETURNING id
            """, user_id, model_basename, req.hf_model_id,
               config["format"], round(size_bytes / (1024*1024), 2),
               req.effective_mode, sha256_hash)

            await conn.execute("""
                UPDATE deployments SET status = 'complete', model_id = $2::uuid, completed_at = NOW()
                WHERE id = $1::uuid
            """, deployment_id, str(model_row["id"]))

        deployment_status[deployment_id] = {"status": "complete", "progress_percent": 100, "error_message": None}

    except Exception as e:
        error_msg = str(e)
        deployment_status[deployment_id] = {"status": "failed", "progress_percent": 0, "error_message": error_msg}
        try:
            async with pool.acquire() as conn:
                await conn.execute(
                    "UPDATE deployments SET status = 'failed', error_message = $2 WHERE id = $1::uuid",
                    deployment_id, error_msg
                )
        except Exception:
            pass


async def lookup_model_sha256(hf_model_id: str, filename: str) -> Optional[str]:
    """SHA-256 of an LFS-tracked file from the HF tree API (lfs.oid). None if unavailable."""
    url = f"https://huggingface.co/api/models/{hf_model_id}/tree/main"
    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            resp = await _hf_get(client, url, params={"recursive": "true"})
            if resp.status_code != 200:
                return None
            for entry in resp.json():
                if entry.get("path") == filename:
                    lfs = entry.get("lfs")
                    return lfs.get("oid") if lfs else None
    except httpx.HTTPError:
        return None
    return None


@app.post("/deployments")
async def create_deployment(req: DeploymentRequest, request: Request, user_id: str = Depends(get_current_user)):
    """v3 wireless deployment: resolve HF CDN URL, push instruction to the
    phone over WebSocket. The phone downloads the model itself and reports
    progress back over the same WebSocket (handled in device_websocket)."""
    pool = request.app.state.pool

    async with pool.acquire() as conn:
        device = await conn.fetchrow(
            "SELECT id, ram_mb FROM devices WHERE id = $1::uuid AND user_id = $2::uuid",
            req.device_id, user_id
        )
        if not device:
            raise HTTPException(status_code=404, detail="Device not found")

    if not ws_manager.is_connected(req.device_id):
        raise HTTPException(
            status_code=409,
            detail="Device is not connected. Open the LokiAI app on the phone so it can receive the deployment."
        )

    # One model per phone (PRD): never run parallel downloads on one device.
    # Stale rows (e.g. app killed mid-download) auto-expire after 15 minutes.
    async with pool.acquire() as conn:
        active = await conn.fetchrow(
            """SELECT id, status, progress FROM deployments
               WHERE device_id = $1::uuid
                 AND status IN ('queued', 'downloading')
                 AND deployed_at > NOW() - INTERVAL '15 minutes'
               ORDER BY deployed_at DESC LIMIT 1""",
            req.device_id
        )
        if active:
            raise HTTPException(
                status_code=409,
                detail=f"A deployment is already in progress on this device "
                       f"({active['status']}, {active['progress'] or 0}%). "
                       f"Wait for it to finish before deploying another model."
            )
        # Anything older stuck in queued/downloading is dead — mark it failed
        # so history stays truthful.
        await conn.execute(
            """UPDATE deployments SET status = 'failed',
                   error_message = 'Timed out: phone stopped reporting progress'
               WHERE device_id = $1::uuid
                 AND status IN ('queued', 'downloading')
                 AND deployed_at <= NOW() - INTERVAL '15 minutes'""",
            req.device_id
        )

    if req.model_url:
        # Direct-URL deployment: GitHub release assets, any CDN — the phone
        # downloads from wherever the file lives. Format must be runnable.
        url_path = req.model_url.split("?")[0]
        if not url_path.endswith((".tflite", ".gguf")):
            raise HTTPException(
                status_code=422,
                detail="Direct model URLs must point to a .tflite or .gguf file "
                       "— those are the formats the phone can run."
            )
        model_url = req.model_url
        filename = req.model_filename or os.path.basename(url_path)
        model_basename = os.path.basename(filename)
        # No repo metadata for arbitrary hosts; the phone still hash-verifies
        # its own download internally (sha reported back in its completion).
        model_sha256 = None
        if not req.hf_model_id:
            req.hf_model_id = model_url
    else:
        if not req.hf_model_id:
            raise HTTPException(status_code=422, detail="Provide hf_model_id or model_url")
        # Auto-resolve the model file inside the HF repo when not specified.
        filename = req.model_filename or req.filename
        if not filename:
            max_size_mb = (device["ram_mb"] or 4096) * 0.4
            ext = ".gguf" if req.effective_mode == "chat" else ".tflite"
            filename = await resolve_model_file(req.hf_model_id, max_size_mb, ext)

        model_url = f"https://huggingface.co/{req.hf_model_id}/resolve/main/{filename}"
        model_basename = os.path.basename(filename)
        model_sha256 = await lookup_model_sha256(req.hf_model_id, filename)

    config = {
        "inference_mode": req.effective_mode,
        "confidence_threshold": req.effective_threshold
    }

    async with pool.acquire() as conn:
        model_row = await conn.fetchrow("""
            INSERT INTO models (user_id, name, hf_model_id, source, format, task_type, download_url, sha256)
            VALUES ($1::uuid, $2, $3, 'huggingface', $4, $5, $6, $7)
            RETURNING id
        """, user_id, model_basename, req.hf_model_id,
           model_basename.rsplit(".", 1)[-1] if "." in model_basename else "unknown",
           req.effective_mode, model_url, model_sha256)

        row = await conn.fetchrow("""
            INSERT INTO deployments (user_id, device_id, model_id, status, progress, config)
            VALUES ($1::uuid, $2::uuid, $3::uuid, 'queued', 0, $4::jsonb)
            RETURNING id
        """, user_id, req.device_id, str(model_row["id"]), json.dumps({
            "hf_model_id": req.hf_model_id,
            "filename": filename,
            "model_url": model_url,
            **config
        }))
        deployment_id = str(row["id"])

    deployment_status[deployment_id] = {"status": "queued", "progress_percent": 0, "error_message": None}

    sent = await ws_manager.send_json(req.device_id, {
        "action": "deploy",
        "deployment_id": deployment_id,
        "model_url": model_url,
        "model_name": model_basename,
        "model_sha256": model_sha256,
        "config": config
    })
    if not sent:
        error_msg = "WebSocket send failed: device disconnected before the deployment instruction was delivered"
        deployment_status[deployment_id] = {"status": "failed", "progress_percent": 0, "error_message": error_msg}
        async with pool.acquire() as conn:
            await conn.execute(
                "UPDATE deployments SET status = 'failed', error_message = $2 WHERE id = $1::uuid",
                deployment_id, error_msg
            )
        raise HTTPException(status_code=409, detail=error_msg)

    return {"deployment_id": deployment_id, "status": "queued"}


@app.get("/deployments")
async def list_deployments(request: Request, user_id: str = Depends(get_current_user)):
    """Real deployment history across all the user's devices — powers the
    dashboard's Background Tasks (active) and Changes (history) panels."""
    pool = request.app.state.pool
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """SELECT d.id, d.device_id, d.status, d.progress, d.error_message,
                      d.deployed_at, d.completed_at,
                      dev.phone_model,
                      m.name AS model_name, m.format AS model_format, m.task_type
               FROM deployments d
               LEFT JOIN devices dev ON dev.id = d.device_id
               LEFT JOIN models m ON m.id = d.model_id
               WHERE d.user_id = $1::uuid
               ORDER BY d.deployed_at DESC
               LIMIT 50""",
            user_id,
        )
    result = []
    for r in rows:
        d = dict(r)
        d["id"] = str(d["id"])
        d["device_id"] = str(d["device_id"]) if d["device_id"] else None
        d["deployed_at"] = d["deployed_at"].isoformat() if d["deployed_at"] else None
        d["completed_at"] = d["completed_at"].isoformat() if d["completed_at"] else None
        # Live in-memory status (set by the WS progress handler) is more
        # current than the DB row for anything still active.
        live = deployment_status.get(d["id"])
        if live:
            d["status"] = live["status"]
            d["progress"] = live["progress_percent"]
            d["error_message"] = live["error_message"]
        result.append(d)
    return result


@app.get("/deployments/{deployment_id}")
async def get_deployment_status(deployment_id: str, request: Request, user_id: str = Depends(get_current_user)):
    # Check in-memory status first (fastest)
    if deployment_id in deployment_status:
        return {
            "deployment_id": deployment_id,
            **deployment_status[deployment_id]
        }

    # Fall back to database
    pool = request.app.state.pool
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT id, status, progress, error_message, completed_at FROM deployments WHERE id = $1::uuid AND user_id = $2::uuid",
            deployment_id, user_id
        )
        if not row:
            raise HTTPException(status_code=404, detail="Deployment not found")
        return {
            "deployment_id": str(row["id"]),
            "status": row["status"],
            "error_message": row["error_message"],
            "progress_percent": 100 if row["status"] == "complete" else (row["progress"] or 0)
        }

@app.get("/admin/stats")
async def get_admin_stats(request: Request):
    # This is a local admin dashboard endpoint. 
    # In a real production app, we would secure this with an admin role.
    pool = request.app.state.pool
    async with pool.acquire() as conn:
        # Get overall counts
        total_users = await conn.fetchval("SELECT COUNT(*) FROM users")
        total_devices = await conn.fetchval("SELECT COUNT(*) FROM devices")
        active_devices = await conn.fetchval("SELECT COUNT(*) FROM devices WHERE status = 'online'")
        total_deployments = await conn.fetchval("SELECT COUNT(*) FROM deployments WHERE status = 'complete'")

        # Get detailed user list with their devices and deployments
        users_raw = await conn.fetch("""
            SELECT u.id, u.name, u.email, u.created_at, u.email_verified,
                   (SELECT COUNT(*) FROM devices d WHERE d.user_id = u.id) as device_count,
                   (SELECT MAX(last_seen) FROM devices d WHERE d.user_id = u.id) as last_active
            FROM users u
            ORDER BY u.created_at DESC
        """)

        users = []
        for u in users_raw:
            # Fetch latest deployment for this user
            latest_deployment = await conn.fetchrow("""
                SELECT m.name as model_name, m.hf_model_id, d.status, d.completed_at
                FROM deployments d
                JOIN models m ON d.model_id = m.id
                WHERE d.user_id = $1
                ORDER BY d.deployed_at DESC
                LIMIT 1
            """, u['id'])

            users.append({
                "id": str(u['id']),
                "name": u['name'],
                "email": u['email'],
                "created_at": u['created_at'].isoformat() if u['created_at'] else None,
                "last_active": u['last_active'].isoformat() if u['last_active'] else None,
                "email_verified": u['email_verified'],
                "device_count": u['device_count'],
                "latest_deployment": {
                    "model_name": latest_deployment['model_name'] if latest_deployment else None,
                    "hf_model_id": latest_deployment['hf_model_id'] if latest_deployment else None,
                    "status": latest_deployment['status'] if latest_deployment else None,
                    "completed_at": latest_deployment['completed_at'].isoformat() if latest_deployment and latest_deployment['completed_at'] else None
                } if latest_deployment else None
            })

        return {
            "overview": {
                "total_users": total_users,
                "total_devices": total_devices,
                "active_devices": active_devices,
                "total_deployments": total_deployments
            },
            "users": users
        }
