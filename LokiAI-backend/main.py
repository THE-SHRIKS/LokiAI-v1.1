from fastapi import FastAPI, HTTPException, Request, Response, Depends, UploadFile, File, Form
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, StreamingResponse
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from jose import JWTError
from typing import Optional, List
from pydantic import BaseModel, EmailStr
from datetime import datetime, timezone, timedelta
import asyncio
import html
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
        await conn.execute("""
            CREATE TABLE IF NOT EXISTS feedback (
                id              UUID PRIMARY KEY,
                user_id         UUID REFERENCES users(id) NOT NULL,
                user_email      TEXT NOT NULL,
                user_name       TEXT,
                category        TEXT NOT NULL,
                message         TEXT NOT NULL,
                email_status    TEXT NOT NULL DEFAULT 'queued',
                email_error     TEXT,
                created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """)
        await conn.execute(
            "CREATE INDEX IF NOT EXISTS feedback_user_created_idx "
            "ON feedback (user_id, created_at DESC)"
        )
        # Feedback delivery is deliberately separate from submission.  A
        # Render restart used to discard the request-scoped create_task before
        # it got to SMTP; this durable outbox is safe across restarts and
        # multiple web workers.
        await conn.execute("ALTER TABLE feedback ADD COLUMN IF NOT EXISTS correlation_id TEXT")
        await conn.execute("ALTER TABLE feedback ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()")
        await conn.execute("ALTER TABLE feedback ADD COLUMN IF NOT EXISTS delivery_attempt_count INTEGER NOT NULL DEFAULT 0")
        await conn.execute("ALTER TABLE feedback ADD COLUMN IF NOT EXISTS last_delivery_attempt_at TIMESTAMPTZ")
        await conn.execute("ALTER TABLE feedback ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ")
        await conn.execute("ALTER TABLE feedback ADD COLUMN IF NOT EXISTS last_error_code TEXT")
        await conn.execute("ALTER TABLE feedback ADD COLUMN IF NOT EXISTS last_error_message TEXT")
        await conn.execute("ALTER TABLE feedback ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'web'")
        await conn.execute("ALTER TABLE feedback ADD COLUMN IF NOT EXISTS application_version TEXT")
        await conn.execute("ALTER TABLE feedback ADD COLUMN IF NOT EXISTS platform TEXT")
        await conn.execute("ALTER TABLE feedback ADD COLUMN IF NOT EXISTS subject TEXT")
        await conn.execute("""
            CREATE TABLE IF NOT EXISTS feedback_email_outbox (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                feedback_id UUID NOT NULL UNIQUE REFERENCES feedback(id) ON DELETE CASCADE,
                status TEXT NOT NULL DEFAULT 'pending',
                attempt_count INTEGER NOT NULL DEFAULT 0,
                next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                locked_at TIMESTAMPTZ,
                locked_by TEXT,
                last_error_code TEXT,
                last_error_message TEXT,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                delivered_at TIMESTAMPTZ
            )
        """)
        await conn.execute("CREATE INDEX IF NOT EXISTS feedback_delivery_idx ON feedback (email_status, created_at DESC)")
        await conn.execute("CREATE INDEX IF NOT EXISTS feedback_correlation_idx ON feedback (correlation_id)")
        await conn.execute("CREATE INDEX IF NOT EXISTS feedback_outbox_due_idx ON feedback_email_outbox (status, next_attempt_at)")

        # Normalised model descriptions. Downloading the same model card on
        # every request is the reason descriptions were dropped rather than
        # computed; caching them makes the section 11 contract affordable.
        await conn.execute("""
            CREATE TABLE IF NOT EXISTS model_descriptions (
                model_id    TEXT PRIMARY KEY,
                description TEXT NOT NULL,
                source      TEXT NOT NULL,
                source_url  TEXT,
                updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """)
        # Rows written before the formatter was versioned default to 1 and are
        # therefore ignored and rewritten on the next request. Without this a
        # cached description outlived every improvement to the code that
        # produced it.
        await conn.execute(
            "ALTER TABLE model_descriptions "
            "ADD COLUMN IF NOT EXISTS schema_version INTEGER NOT NULL DEFAULT 1"
        )

        # Conversation / message / run lifecycle.
        #
        # Nothing about a chat turn was persisted before this: history lived in
        # the browser's localStorage and a request that died mid-flight took the
        # user's message with it. These tables make a submitted message durable
        # before inference starts, give every turn an explicit terminal status,
        # and let a restarted process recover runs that were still in flight.
        await conn.execute("""
            CREATE TABLE IF NOT EXISTS conversations (
                id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                device_id   UUID,
                title       TEXT,
                created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """)
        await conn.execute(
            "CREATE INDEX IF NOT EXISTS conversations_user_idx "
            "ON conversations (user_id, updated_at DESC)"
        )
        await conn.execute("""
            CREATE TABLE IF NOT EXISTS chat_messages (
                id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
                role            TEXT NOT NULL,
                content         TEXT NOT NULL,
                run_id          UUID,
                created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """)
        await conn.execute(
            "CREATE INDEX IF NOT EXISTS chat_messages_conversation_idx "
            "ON chat_messages (conversation_id, created_at)"
        )
        await conn.execute("""
            CREATE TABLE IF NOT EXISTS chat_runs (
                id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
                user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                device_id       UUID,
                status          TEXT NOT NULL DEFAULT 'queued',
                idempotency_key TEXT NOT NULL,
                correlation_id  TEXT NOT NULL,
                user_message    TEXT NOT NULL,
                response        JSONB,
                error_code      TEXT,
                error_message   TEXT,
                claimed_by      TEXT,
                claimed_at      TIMESTAMPTZ,
                created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                finished_at     TIMESTAMPTZ
            )
        """)
        # Idempotency is per account, so a network retry of the same submission
        # returns the original run instead of creating a duplicate message.
        await conn.execute(
            "CREATE UNIQUE INDEX IF NOT EXISTS chat_runs_idempotency_idx "
            "ON chat_runs (user_id, idempotency_key)"
        )
        await conn.execute(
            "CREATE INDEX IF NOT EXISTS chat_runs_conversation_idx "
            "ON chat_runs (conversation_id, created_at)"
        )
        await conn.execute(
            "CREATE INDEX IF NOT EXISTS chat_runs_active_idx "
            "ON chat_runs (status, created_at) "
            "WHERE status IN ('queued', 'routing', 'generating')"
        )


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


# Presence liveness. The phone heartbeats every 20s; a device whose last_seen
# is older than this is treated as gone regardless of what the status column
# says. Without this, a device that vanished without a clean socket close
# (process killed, network black-holed, backend restarted) stayed 'connected'
# in the database forever, because only an orderly WebSocketDisconnect ever
# wrote 'offline'.
PRESENCE_TTL_SECONDS = int(os.getenv("PRESENCE_TTL_SECONDS", "70"))
PRESENCE_SWEEP_SECONDS = 30


async def _presence_sweep(pool):
    """Mark devices offline once their heartbeat goes stale."""
    while True:
        try:
            await asyncio.sleep(PRESENCE_SWEEP_SECONDS)
            async with pool.acquire() as conn:
                stale = await conn.fetch(
                    """UPDATE devices SET status = 'offline'
                       WHERE status = 'connected'
                         AND (last_seen IS NULL
                              OR last_seen < NOW() - ($1 || ' seconds')::interval)
                       RETURNING id""",
                    str(PRESENCE_TTL_SECONDS),
                )
            for row in stale:
                device_id = str(row["id"])
                # Drop any socket we still think is live for a device that has
                # stopped heartbeating.
                socket = ws_manager.active.pop(device_id, None)
                if socket is not None:
                    try:
                        await socket.close(code=WS_CLOSE_SUPERSEDED, reason="heartbeat expired")
                    except Exception:
                        pass
                print(f"[presence] device {device_id} -> offline (heartbeat stale)")
        except asyncio.CancelledError:
            raise
        except Exception as e:
            # A sweep failure must never kill the loop.
            print(f"[presence] sweep error: {type(e).__name__}: {e}")


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.pool = await _create_pool_with_retry()
    await _run_migrations(app.state.pool)

    # A restart wipes the in-memory socket registry while the database still
    # says 'connected'. Reconcile immediately so presence reflects reality
    # until each device reconnects and heartbeats again.
    async with app.state.pool.acquire() as conn:
        reset = await conn.execute("UPDATE devices SET status = 'offline' WHERE status = 'connected'")
    print(f"[presence] startup reconciliation: {reset}")

    # Chat runs that a previous process left mid-flight can never finish; they
    # are exactly the "stuck on Thinking" case and must reach a terminal state.
    try:
        await _recover_interrupted_runs(app.state.pool)
    except Exception as e:
        print(f"[chat] run recovery failed: {type(e).__name__}: {e}")

    sweep_task = asyncio.create_task(_presence_sweep(app.state.pool))
    feedback_task = asyncio.create_task(_feedback_outbox_worker(app.state.pool))
    run_recovery_task = asyncio.create_task(_run_recovery_sweep(app.state.pool))
    try:
        yield
    finally:
        for task in (sweep_task, feedback_task, run_recovery_task):
            task.cancel()
        for task in (sweep_task, feedback_task, run_recovery_task):
            try:
                await task
            except asyncio.CancelledError:
                pass
        await app.state.pool.close()


async def _run_recovery_sweep(pool):
    """Periodic safety net for runs abandoned by a worker that died mid-turn."""
    while True:
        try:
            await asyncio.sleep(60)
            await _recover_interrupted_runs(pool)
        except asyncio.CancelledError:
            raise
        except Exception as e:
            print(f"[chat] recovery sweep error: {type(e).__name__}: {e}")

app = FastAPI(lifespan=lifespan)

# A conservative default protects every HTTP endpoint, including routes that
# don't have a bespoke limit. More expensive actions retain tighter limits
# below. This is intentionally high enough for normal app polling/download
# setup while making a free-tier Render instance much less attractive to
# simple request floods.
limiter = Limiter(key_func=get_remote_address, default_limits=["120/minute"])
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
from starlette.middleware.trustedhost import TrustedHostMiddleware
from starlette.middleware.base import BaseHTTPMiddleware
import time, collections, uuid as _uuid

# The production dashboard origin is always allowed, whether or not
# CORS_ALLOWED_ORIGINS names it.
#
# This is an EXPLICIT single origin, not a wildcard — the defect being fixed
# was `https://.*\.vercel\.app`, which trusted every site on a public PaaS.
# Naming our own dashboard is the opposite of that.
#
# It exists because removing the wildcard makes the dashboard's access depend
# entirely on an environment variable that cannot be read from outside the
# Render console. If it were unset or wrong, the deploy that closes the
# security hole would simultaneously take the whole dashboard offline. The app
# already hardcodes this same origin in /system/info, so it is not new
# knowledge — just applied where a mistake is unrecoverable.
PRODUCTION_DASHBOARD_ORIGIN = "https://lokiai-v11.vercel.app"
CUSTOM_DOMAIN_ORIGIN = "https://lokiai.theshriks.space"

_default_origins = "http://localhost:8080,http://127.0.0.1:8080"
ALLOWED_ORIGINS = list(dict.fromkeys(
    [o.strip() for o in os.getenv("CORS_ALLOWED_ORIGINS", _default_origins).split(",") if o.strip()]
    + [PRODUCTION_DASHBOARD_ORIGIN, CUSTOM_DOMAIN_ORIGIN]
))

# Credentialed CORS (allow_credentials=True + a SameSite=None refresh cookie in
# production) means any origin accepted here can call /auth/refresh from a
# victim's browser and read a fresh access token out of the response — a full
# session takeover with no XSS on our own origin required.
#
# This previously matched `https://.*\.vercel\.app`, i.e. EVERY site on a
# public PaaS anyone can deploy to for free. Vercel preview deployments that
# genuinely need API access must now be listed explicitly in
# CORS_ALLOWED_ORIGINS. Localhost stays regex-matched: dev servers pick
# arbitrary ports (Vite falls back to 8081+ when 8080 is taken) and a local
# origin cannot be registered by an attacker.
_LOCALHOST_ORIGIN_REGEX = r"http://(localhost|127\.0\.0\.1)(:\d+)?"

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_origin_regex=_LOCALHOST_ORIGIN_REGEX,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "Accept"],
)

# Host-header poisoning is only meaningful in production. Local development
# and LAN pairing deliberately accept their local host/IP; Render only accepts
# the known backend names unless an operator explicitly adds another host.
if os.getenv("RENDER"):
    _default_hosts = "lokiai.onrender.com,lokiai.theshriks.space"
    _allowed_hosts = [h.strip() for h in os.getenv("ALLOWED_HOSTS", _default_hosts).split(",") if h.strip()]
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=_allowed_hosts)


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["X-XSS-Protection"] = "1; mode=block"
        response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
        response.headers["Content-Security-Policy"] = "default-src 'self'"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
        # Authentication and account responses must never be cached by a
        # browser, shared proxy, or intermediary.
        if request.url.path.startswith("/auth/") or request.headers.get("authorization"):
            response.headers["Cache-Control"] = "no-store, private"
        return response


app.add_middleware(SecurityHeadersMiddleware)

# 10MB cap on request bodies to blunt abuse. /models/upload gets a much larger
# but still finite cap — its job is accepting real GGUF/TFLite model files that
# routinely run to hundreds of MB (see uploaded_models/ and the deploy history
# in REPORT.md), so 10MB would break a working feature. It was previously
# exempt entirely, which let any authenticated account fill the server's disk.
MAX_BODY_SIZE = 10 * 1024 * 1024
MAX_UPLOAD_SIZE = int(os.getenv("MAX_UPLOAD_MB", "600")) * 1024 * 1024
_LARGE_BODY_PATHS = {"/models/upload": MAX_UPLOAD_SIZE}


class BodySizeLimitMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        limit = _LARGE_BODY_PATHS.get(request.url.path, MAX_BODY_SIZE)
        content_length = request.headers.get("content-length")
        if content_length:
            try:
                declared = int(content_length)
            except ValueError:
                return JSONResponse(status_code=400, content={"error": "Invalid Content-Length"})
            if declared > limit:
                return JSONResponse(status_code=413, content={"error": "Request body too large"})
        return await call_next(request)


app.add_middleware(BodySizeLimitMiddleware)


# ── Typed assistant outcome boundary ─────────────────────────────────────────
# Every failure path in the assistant used to collapse into a 502 carrying the
# raw provider exception string — internal detail the user cannot act on, and
# a channel through which provider/SDK text reached the UI. These codes are the
# contract: the frontend branches on `error_code`, the `message` is written for
# a human, and the raw provider text is logged server-side only.
#
# Defined here (well above its first use) because FastAPI resolves
# @app.exception_handler(...) at import time.
class AssistantError(Exception):
    """A failure with a stable machine-readable code and a user-safe message."""

    def __init__(self, code: str, message: str, http_status: int = 200, detail: str = ""):
        super().__init__(f"{code}: {message}")
        self.code = code
        self.message = message
        self.http_status = http_status
        # Server-side only. Never serialized to a client.
        self.detail = detail


ASSISTANT_ERROR_CODES = (
    "NIM_KEY_MISSING", "NIM_KEY_INVALID", "NIM_RATE_LIMITED", "NIM_TIMEOUT",
    "NIM_EMPTY_RESPONSE", "NIM_SCHEMA_INVALID", "NIM_PROVIDER_UNAVAILABLE",
    "HF_UNAVAILABLE", "MODEL_NOT_FOUND", "MODEL_INCOMPATIBLE",
    "NO_DEVICE_SELECTED",
)


@app.exception_handler(asyncpg.exceptions.DataError)
async def _pg_data_error_handler(request: Request, exc: asyncpg.exceptions.DataError):
    # Malformed UUIDs (or other bad literals) hitting a $1::uuid cast land
    # here instead of surfacing as a raw 500 with DB internals in the body.
    return JSONResponse(status_code=422, content={"error": "Invalid ID format"})


@app.exception_handler(AssistantError)
async def _assistant_error_handler(request: Request, exc: "AssistantError"):
    """Typed assistant failures. The user-safe message and a stable code go to
    the client; the raw provider text is logged and never serialized."""
    if exc.detail:
        print(f"[assistant] {exc.code} on {request.url.path}: {exc.detail}")
    return JSONResponse(
        status_code=exc.http_status,
        content={
            "response": exc.message,
            "action": None,
            "search_results": [],
            "error_code": exc.code,
        },
    )


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
                # The operator UI does not need exception text; retaining it
                # would make an unexpected secret/driver error visible there.
                "ms": elapsed, "error": "Unhandled request error",
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


# ── Authenticated-user dependency ────────────────────────────────────────────
# Defined here (rather than beside the /auth routes) because FastAPI evaluates
# Depends(...) at import time, and the first route that needs it — /feedback —
# appears immediately below.
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
        account_exists = await conn.fetchval("SELECT 1 FROM users WHERE id = $1::uuid", user_id)
    if blacklisted or not account_exists:
        raise HTTPException(status_code=401, detail="Token is no longer valid")
    return user_id


# Operator-only routes (cross-tenant aggregates and request logs). There is no
# role column on users, so membership is an explicit email allowlist from the
# environment. Empty by default: with ADMIN_EMAILS unset nobody is an admin and
# these routes are closed to everyone, which is the safe failure mode.
ADMIN_EMAILS = {
    e.strip().lower()
    for e in os.getenv("ADMIN_EMAILS", "").split(",")
    if e.strip()
}


async def require_admin(request: Request, user_id: str = Depends(get_current_user)) -> str:
    """Authenticated AND on the operator allowlist.

    Returns 404 rather than 403 for non-admins so the existence of these
    routes isn't confirmed to an authenticated attacker probing for them.
    """
    pool = request.app.state.pool
    async with pool.acquire() as conn:
        email = await conn.fetchval("SELECT email FROM users WHERE id = $1::uuid", user_id)
    if not email or email.lower() not in ADMIN_EMAILS:
        raise HTTPException(status_code=404, detail="Not found")
    return user_id


@app.get("/monitor/status")
async def monitor_status(request: Request, _admin: str = Depends(require_admin)):
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
async def monitor_get_log(limit: int = 50, _admin: str = Depends(require_admin)):
    return monitor_log[-limit:]

# ── Feedback ──────────────────────────────────────────────────────────────────
class FeedbackPayload(BaseModel):
    category: str
    message: str
    subject: Optional[str] = None
    source: Optional[str] = None
    application_version: Optional[str] = None
    platform: Optional[str] = None


_FEEDBACK_WORKER_ID = f"feedback-{os.getpid()}-{_uuid.uuid4().hex[:8]}"
_FEEDBACK_BACKOFF_SECONDS = (60, 300, 900, 3600, 21600)


def _feedback_error_code(exc: Exception) -> str:
    text = str(exc).lower()
    if "not configured" in text:
        return "EMAIL_CONFIGURATION_MISSING"
    if "auth" in text or "535" in text:
        return "SMTP_AUTH_REJECTED"
    if "recipient" in text or "rcpt" in text:
        return "SMTP_RECIPIENT_REJECTED"
    if "sender" in text or "mail from" in text:
        return "SMTP_SENDER_REJECTED"
    if "timeout" in text:
        return "SMTP_TIMEOUT"
    return "EMAIL_DELIVERY_FAILED"


async def _claim_feedback_outbox(pool: asyncpg.Pool) -> Optional[asyncpg.Record]:
    """Atomically claim one due record. SKIP LOCKED keeps concurrent workers safe."""
    async with pool.acquire() as conn:
        async with conn.transaction():
            row = await conn.fetchrow(
                """SELECT o.id, o.feedback_id, o.attempt_count, f.user_id, f.user_email,
                          f.user_name, f.category, f.subject, f.message, f.created_at,
                          f.source, f.application_version, f.platform, f.correlation_id
                   FROM feedback_email_outbox o JOIN feedback f ON f.id=o.feedback_id
                   WHERE o.status IN ('pending','retrying') AND o.next_attempt_at <= NOW()
                   ORDER BY o.next_attempt_at, o.created_at
                   FOR UPDATE SKIP LOCKED LIMIT 1"""
            )
            if not row:
                return None
            await conn.execute(
                "UPDATE feedback_email_outbox SET status='sending', locked_at=NOW(), locked_by=$2, updated_at=NOW() WHERE id=$1",
                row["id"], _FEEDBACK_WORKER_ID,
            )
            await conn.execute(
                "UPDATE feedback SET email_status='sending', last_delivery_attempt_at=NOW(), updated_at=NOW() WHERE id=$1",
                row["feedback_id"],
            )
            return row


async def _deliver_claimed_feedback(pool: asyncpg.Pool, row: asyncpg.Record) -> None:
    feedback_id, outbox_id = row["feedback_id"], row["id"]
    correlation_id = row["correlation_id"] or _uuid.uuid4().hex
    attempt = int(row["attempt_count"]) + 1
    if not FEEDBACK_TO_EMAIL:
        error = RuntimeError("FEEDBACK_TO_EMAIL is not configured")
    else:
        account = f"{row['user_name']} <{row['user_email']}>" if row["user_name"] else row["user_email"]
        subject = row["subject"] or f"[LokiAI Feedback] {row['category']} - {row['user_email']}"
        text_body = (f"Feedback ID: {feedback_id}\nAccount ID: {row['user_id']}\nAccount: {account}\n"
                     f"Category: {row['category']}\nSubmitted: {row['created_at'].isoformat()}\n"
                     f"Source: {row['source']}\nVersion: {row['application_version'] or 'unknown'}\n"
                     f"Platform: {row['platform'] or 'unknown'}\nCorrelation ID: {correlation_id}\n\n{row['message']}")
        html_body = f"<h2>New LokiAI feedback</h2><p><b>Feedback:</b> {feedback_id}<br><b>Account:</b> {html.escape(account)}<br><b>Category:</b> {html.escape(row['category'])}<br><b>Correlation:</b> {correlation_id}</p><pre>{html.escape(row['message'])}</pre>"
        try:
            # Reply-To is the submitting account, so the team can answer the
            # user directly; From stays the verified application sender.
            provider_response = await send_email(
                FEEDBACK_TO_EMAIL, subject, text_body, html_body,
                reply_to=row["user_email"],
            )
        except Exception as exc:
            error = exc
        else:
            async with pool.acquire() as conn:
                await conn.execute("UPDATE feedback_email_outbox SET status='delivered', attempt_count=$2, delivered_at=NOW(), updated_at=NOW(), locked_at=NULL, locked_by=NULL, last_error_code=NULL, last_error_message=$3 WHERE id=$1", outbox_id, attempt, str(provider_response)[:500])
                await conn.execute("UPDATE feedback SET email_status='delivered', delivery_attempt_count=$2, delivered_at=NOW(), email_error=NULL, last_error_code=NULL, last_error_message=NULL, updated_at=NOW(), correlation_id=$3 WHERE id=$1", feedback_id, attempt, correlation_id)
            # Accepted by the transport. Inbox delivery is a separate fact and
            # is deliberately not claimed here.
            print(f"[feedback] accepted by {email_delivery_path()} "
                  f"feedback_id={feedback_id} correlation_id={correlation_id} "
                  f"provider={provider_response}")
            return

    code = _feedback_error_code(error)
    permanent = code in {"EMAIL_CONFIGURATION_MISSING", "SMTP_AUTH_REJECTED", "SMTP_RECIPIENT_REJECTED", "SMTP_SENDER_REJECTED"} or attempt >= len(_FEEDBACK_BACKOFF_SECONDS) + 1
    status = "permanently_failed" if permanent else "retrying"
    delay = _FEEDBACK_BACKOFF_SECONDS[min(attempt - 1, len(_FEEDBACK_BACKOFF_SECONDS) - 1)]
    async with pool.acquire() as conn:
        await conn.execute("UPDATE feedback_email_outbox SET status=$2, attempt_count=$3, next_attempt_at=NOW() + ($4 || ' seconds')::interval, last_error_code=$5, last_error_message=$6, locked_at=NULL, locked_by=NULL, updated_at=NOW() WHERE id=$1", outbox_id, status, attempt, str(delay), code, str(error)[:500])
        await conn.execute("UPDATE feedback SET email_status=$2, email_error=$3, delivery_attempt_count=$4, last_error_code=$5, last_error_message=$6, updated_at=NOW(), correlation_id=$7 WHERE id=$1", feedback_id, status, str(error)[:500], attempt, code, str(error)[:500], correlation_id)
    print(f"[feedback] delivery {status} feedback_id={feedback_id} correlation_id={correlation_id} code={code}")


async def _feedback_outbox_worker(pool: asyncpg.Pool) -> None:
    while True:
        try:
            row = await _claim_feedback_outbox(pool)
            if row:
                await _deliver_claimed_feedback(pool, row)
            else:
                await asyncio.sleep(5)
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            print(f"[feedback] worker error: {type(exc).__name__}: {exc}")
            await asyncio.sleep(5)

@app.post("/feedback")
async def submit_feedback(payload: FeedbackPayload, request: Request, user_id: str = Depends(get_current_user)):
    # Previously called a `verify_token` helper that was never defined, so both
    # /feedback endpoints raised NameError -> 500 on every call. get_current_user
    # is the same JWT validation every other authenticated route already uses
    # (signature, expiry, jti, type, and blacklist revocation).
    message = payload.message.strip()
    category = payload.category.strip()
    if not message:
        raise HTTPException(status_code=422, detail="Message cannot be empty")
    if len(message) > 2000:
        raise HTTPException(status_code=422, detail="Message too long (max 2000 chars)")
    if not category or len(category) > 80:
        raise HTTPException(status_code=422, detail="Invalid feedback category")

    pool = request.app.state.pool
    async with pool.acquire() as conn:
        user = await conn.fetchrow(
            "SELECT email, name FROM users WHERE id = $1::uuid", user_id,
        )
        if not user:
            raise HTTPException(status_code=401, detail="Account not found")
        feedback_id = _uuid.uuid4()
        created_at = datetime.now(timezone.utc)
        correlation_id = _uuid.uuid4().hex
        async with conn.transaction():
            await conn.execute(
                """INSERT INTO feedback
                   (id, user_id, user_email, user_name, category, subject, message, source,
                    application_version, platform, correlation_id, created_at, email_status)
                   VALUES ($1, $2::uuid, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'pending')""",
                feedback_id, user_id, user["email"], user["name"], category,
                (payload.subject or "").strip()[:200] or None, message,
                (payload.source or "web").strip()[:80],
                (payload.application_version or "").strip()[:80] or None,
                (payload.platform or "").strip()[:80] or None, correlation_id, created_at,
            )
            await conn.execute("INSERT INTO feedback_email_outbox (feedback_id) VALUES ($1)", feedback_id)
    return {"ok": True, "id": str(feedback_id), "email_status": "pending", "correlation_id": correlation_id}

@app.get("/feedback")
async def get_feedback(request: Request, user_id: str = Depends(get_current_user)):
    """Return only the authenticated account's persisted submissions."""
    async with request.app.state.pool.acquire() as conn:
        rows = await conn.fetch(
            """SELECT id, category, message, email_status, created_at
               FROM feedback WHERE user_id = $1::uuid ORDER BY created_at DESC""",
            user_id,
        )
    return [dict(row) for row in rows]


@app.get("/admin/feedback")
async def get_all_feedback(request: Request, _admin: str = Depends(require_admin)):
    """Cross-tenant feedback view with delivery state, operator-only.

    This is the retrieval path that makes the team independent of email: every
    submission and its full delivery history is readable here even when no
    message ever reaches the inbox.
    """
    async with request.app.state.pool.acquire() as conn:
        rows = await conn.fetch(
            """SELECT f.id, f.user_id, f.user_email, f.user_name, f.category,
                      f.subject, f.message, f.source, f.application_version,
                      f.platform, f.correlation_id, f.email_status,
                      f.email_error, f.last_error_code, f.last_error_message,
                      f.delivery_attempt_count, f.last_delivery_attempt_at,
                      f.delivered_at, f.created_at,
                      o.status AS outbox_status, o.attempt_count,
                      o.next_attempt_at
                 FROM feedback f
                 LEFT JOIN feedback_email_outbox o ON o.feedback_id = f.id
                ORDER BY f.created_at DESC"""
        )
    return [dict(row) for row in rows]


@app.get("/admin/email/status")
async def email_delivery_status(request: Request, _admin: str = Depends(require_admin)):
    """Which delivery path the running process will actually use.

    Reports only whether each variable is present, never its value, so it is
    safe to call in production while diagnosing why mail is not arriving.
    """
    async with request.app.state.pool.acquire() as conn:
        counts = await conn.fetch(
            "SELECT status, COUNT(*) AS n FROM feedback_email_outbox GROUP BY status"
        )
        oldest_pending = await conn.fetchval(
            "SELECT MIN(created_at) FROM feedback_email_outbox "
            "WHERE status IN ('pending','retrying','sending')"
        )
        last_error = await conn.fetchrow(
            "SELECT last_error_code, last_error_message, updated_at "
            "FROM feedback_email_outbox WHERE last_error_code IS NOT NULL "
            "ORDER BY updated_at DESC LIMIT 1"
        )
    return {
        "delivery_path": email_delivery_path(),
        "configured": {
            "SMTP_HOST": bool(SMTP_HOST),
            "SMTP_PORT": SMTP_PORT,
            "SMTP_USER": bool(SMTP_USER),
            "SMTP_PASSWORD": bool(SMTP_PASSWORD),
            "SMTP_FROM_EMAIL": bool(SMTP_FROM_EMAIL),
            "SMTP_FROM_NAME": bool(SMTP_FROM_NAME),
            "FEEDBACK_TO_EMAIL": bool(FEEDBACK_TO_EMAIL),
            "EMAIL_RELAY_URL": bool(EMAIL_RELAY_URL),
            "EMAIL_RELAY_SECRET": bool(EMAIL_RELAY_SECRET),
        },
        "outbox": {row["status"]: row["n"] for row in counts},
        "oldest_unsent_at": oldest_pending,
        "last_error": dict(last_error) if last_error else None,
    }


class TestDeliveryRequest(BaseModel):
    to_email: Optional[EmailStr] = None


@app.post("/admin/email/test")
@limiter.limit("6/minute", key_func=_user_or_ip_key)
async def send_test_email(payload: TestDeliveryRequest, request: Request,
                          _admin: str = Depends(require_admin)):
    """Send one message through the real configured delivery path.

    Returns the provider's own response and a correlation id. A 200 here means
    the transport accepted the message; it is NOT proof of inbox delivery, and
    the response says so explicitly.
    """
    correlation_id = _uuid.uuid4().hex
    to_email = payload.to_email or FEEDBACK_TO_EMAIL
    if not to_email:
        raise HTTPException(
            status_code=422,
            detail="No recipient: FEEDBACK_TO_EMAIL is unset and none was given.",
        )
    subject = f"[LokiAI] delivery test {correlation_id}"
    text_body = (
        f"LokiAI delivery test\nCorrelation ID: {correlation_id}\n"
        f"Delivery path: {email_delivery_path()}\n"
        f"Sent at: {datetime.now(timezone.utc).isoformat()}\n"
    )
    html_body = (
        f"<h2>LokiAI delivery test</h2><p>Correlation ID: <code>{correlation_id}</code><br>"
        f"Delivery path: {email_delivery_path()}</p>"
    )
    started = time.time()
    try:
        provider_response = await send_email(to_email, subject, text_body, html_body)
    except Exception as exc:
        # The exception text can name a host but never a credential.
        return {
            "ok": False,
            "correlation_id": correlation_id,
            "delivery_path": email_delivery_path(),
            "error_code": _feedback_error_code(exc),
            "provider_response": str(exc)[:500],
            "elapsed_seconds": round(time.time() - started, 2),
            "note": "The configured transport rejected the message.",
        }
    return {
        "ok": True,
        "correlation_id": correlation_id,
        "delivery_path": email_delivery_path(),
        "provider_response": str(provider_response)[:500],
        "elapsed_seconds": round(time.time() - started, 2),
        "note": "Accepted by the transport. This is not proof of inbox "
                "delivery - confirm receipt in the destination mailbox.",
    }


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
# Dedicated destination for product feedback. Falling back to the sender keeps
# existing deployments working while allowing the team inbox to be configured
# independently.
FEEDBACK_TO_EMAIL = os.getenv("FEEDBACK_TO_EMAIL", SMTP_FROM_EMAIL)

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


def _send_email_sync(to_email: str, subject: str, text_body: str, html_body: str,
                     reply_to: Optional[str] = None) -> str:
    if not (SMTP_HOST and SMTP_USER and SMTP_PASSWORD):
        raise RuntimeError("SMTP is not configured (SMTP_HOST/SMTP_USER/SMTP_PASSWORD missing in .env)")
    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    # From is always the verified application sender; the account's own address
    # goes in Reply-To so replying reaches the user without forging the sender
    # (which is what gets a domain's mail rejected or spam-filed).
    msg["From"] = f"{SMTP_FROM_NAME} <{SMTP_FROM_EMAIL}>"
    msg["To"] = to_email
    if reply_to:
        msg["Reply-To"] = reply_to
    msg.attach(MIMEText(text_body, "plain"))
    msg.attach(MIMEText(html_body, "html"))
    with _IPv4SMTP(SMTP_HOST, SMTP_PORT, timeout=20) as server:
        server.starttls()
        server.login(SMTP_USER, SMTP_PASSWORD)
        response = server.sendmail(SMTP_FROM_EMAIL, [to_email], msg.as_string())
    # An empty dict from sendmail means every recipient was accepted. This is
    # SMTP acceptance, not inbox delivery, and is reported as such.
    return f"smtp:accepted refused={response or 'none'}"


async def _send_email_via_relay(to_email: str, subject: str, text_body: str,
                                html_body: str,
                                reply_to: Optional[str] = None) -> str:
    payload = {"to": to_email, "subject": subject, "text": text_body,
               "html": html_body}
    if reply_to:
        payload["replyTo"] = reply_to
    async with httpx.AsyncClient(timeout=20.0) as client:
        resp = await client.post(
            EMAIL_RELAY_URL,
            json=payload,
            headers={"X-Relay-Secret": EMAIL_RELAY_SECRET},
        )
    if resp.status_code != 200:
        raise RuntimeError(f"Email relay returned {resp.status_code}: {resp.text}")
    return f"relay:{resp.status_code} {resp.text[:200]}"


def email_delivery_path() -> str:
    """Which transport send_email will actually use. No secrets."""
    if EMAIL_RELAY_URL and EMAIL_RELAY_SECRET:
        return "relay"
    if SMTP_HOST and SMTP_USER and SMTP_PASSWORD:
        return "smtp"
    return "unconfigured"


async def send_email(to_email: str, subject: str, text_body: str, html_body: str,
                     reply_to: Optional[str] = None) -> str:
    """Returns the provider's own response string for the delivery record.

    Render's free tier blocks outbound SMTP, so the relay is preferred whenever
    it is configured; direct SMTP remains the local-dev path.
    """
    if EMAIL_RELAY_URL and EMAIL_RELAY_SECRET:
        return await _send_email_via_relay(
            to_email, subject, text_body, html_body, reply_to
        )
    # Local dev fallback: direct SMTP (smtplib is synchronous — run off the event loop).
    return await asyncio.to_thread(
        _send_email_sync, to_email, subject, text_body, html_body, reply_to
    )


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
    # The deployed commit is reported so a release can be verified from
    # outside, rather than assumed from a green deploy page. Render injects
    # RENDER_GIT_COMMIT; anywhere else this is "unknown" and says so.
    return {
        "status": "ok",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "commit": os.getenv("RENDER_GIT_COMMIT", "unknown"),
        "branch": os.getenv("RENDER_GIT_BRANCH", "unknown"),
        "service": os.getenv("RENDER_SERVICE_NAME", "local"),
    }


# ------------------------------------------------------------------
# APK distribution over LAN (QR onboarding flow).
# The phone scans a QR encoding http://<laptop-lan-ip>:8000/install,
# downloads the APK in its browser, and sideloads it — no USB install.
# ------------------------------------------------------------------

# Optional external host for the APK (e.g. a GitHub Release asset). When set,
# /apk/download redirects there instead of serving the file shipped in the
# repo. Preferred for production: it keeps a ~141MB binary out of git.
APK_DOWNLOAD_URL = os.getenv("APK_DOWNLOAD_URL")
APK_SIZE_MB = os.getenv("APK_SIZE_MB")

# There is exactly ONE APK delivery route: GET /apk/download (defined below).
#
# A second route lived here — GET /apk — serving
# ../LokiAImobile UI/build/app/outputs/flutter-apk/app-debug.apk, a path that
# only exists on a machine that has just run `flutter build`. It does not exist
# on Render, so /apk returned 404 in production while /install linked straight
# at it: the QR onboarding flow could not deliver the app to any phone at all.
# Removed rather than repaired, so there is no second path to drift out of sync
# again.
#
# /apk is deliberately NOT redirected to /apk/download. Nothing in the current
# app or dashboard references it (verified), and a silent alias would hide the
# same class of mistake next time.


@app.get("/install", response_class=HTMLResponse)
async def install_page():
    # Size is read from the file this page actually links to. It previously
    # measured a different file (the local flutter build output) than the one
    # served, so the advertised size could not be trusted.
    if APK_DOWNLOAD_URL:
        size_mb = float(APK_SIZE_MB) if APK_SIZE_MB else None
    else:
        size_mb = (round(os.path.getsize(_APK_PATH) / (1024 * 1024), 1)
                   if os.path.isfile(_APK_PATH) else None)
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
  <a class="btn" href="/apk/download">Download LokiAI</a>
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
    # Render terminates TLS before forwarding to Uvicorn, so request.url can
    # appear as HTTP even though the browser is using HTTPS. Honor the proxy's
    # protocol marker to keep production refresh cookies Secure.
    is_https = request.url.scheme == "https" or request.headers.get("x-forwarded-proto", "").split(",")[0].strip() == "https"
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
@limiter.limit("10/minute")
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
@limiter.limit("5/minute")
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
@limiter.limit("30/minute")
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
        account_exists = await conn.fetchval("SELECT 1 FROM users WHERE id = $1::uuid", user_id)
        if blacklisted or not account_exists:
            raise HTTPException(status_code=401, detail="Refresh token is no longer valid")
        exp = datetime.fromtimestamp(payload["exp"], tz=timezone.utc)
        await _blacklist_jti(conn, jti, exp)

    return _issue_tokens(user_id, request, response)


@app.post("/auth/logout")
@limiter.limit("30/minute")
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
        # Status only — the key itself is never returned to any client. It is
        # decrypted exclusively inside the NIM provider call in assistant_chat().
        # (A previous revision returned the decrypted key here via a
        # `_decrypt_key` helper that never existed, so this endpoint 500'd for
        # every user who had saved a key.)
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
#
# On Render, defaulting to localhost would put an unusable link in every
# password-reset email, so the real dashboard origin is the default there.
# An explicit DASHBOARD_URL still wins.
DASHBOARD_URL = os.getenv("DASHBOARD_URL") or (
    PRODUCTION_DASHBOARD_ORIGIN if os.getenv("RENDER") else "http://localhost:8080"
)

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


def _apk_proxy_headers(headers) -> dict[str, str]:
    """Return only safe file-delivery headers from an upstream APK host."""
    allowed = {
        "accept-ranges", "content-length", "content-range", "etag",
        "last-modified",
    }
    return {
        name.title(): value
        for name, value in headers.items()
        if name.lower() in allowed
    }


async def _stream_external_apk(request: Request):
    """Stream an externally hosted APK without exposing its URL to users."""
    forwarded_headers = {}
    if range_header := request.headers.get("range"):
        forwarded_headers["Range"] = range_header

    if request.method == "HEAD":
        async with httpx.AsyncClient(timeout=30.0, follow_redirects=True) as client:
            upstream = await client.head(APK_DOWNLOAD_URL, headers=forwarded_headers)
        if upstream.is_error:
            raise HTTPException(status_code=502, detail="APK host is unavailable")
        return Response(
            status_code=upstream.status_code,
            headers={
                **_apk_proxy_headers(upstream.headers),
                "Content-Disposition": "attachment; filename=lokiai.apk",
            },
        )

    client = httpx.AsyncClient(
        timeout=httpx.Timeout(30.0, read=None), follow_redirects=True,
    )
    try:
        upstream = await client.send(
            client.build_request("GET", APK_DOWNLOAD_URL, headers=forwarded_headers),
            stream=True,
        )
    except httpx.HTTPError as exc:
        await client.aclose()
        raise HTTPException(status_code=502, detail="APK host is unavailable") from exc
    if upstream.is_error:
        await upstream.aclose()
        await client.aclose()
        raise HTTPException(status_code=502, detail="APK host is unavailable")

    async def stream_apk():
        try:
            async for chunk in upstream.aiter_bytes():
                yield chunk
        finally:
            await upstream.aclose()
            await client.aclose()

    return StreamingResponse(
        stream_apk(),
        status_code=upstream.status_code,
        media_type="application/vnd.android.package-archive",
        headers={
            **_apk_proxy_headers(upstream.headers),
            "Content-Disposition": "attachment; filename=lokiai.apk",
        },
    )

@app.api_route("/apk/download", methods=["GET", "HEAD"])
async def download_apk(request: Request):
    """The single canonical APK delivery route, linked from GET /install.

    Redirects to APK_DOWNLOAD_URL when one is configured (preferred in
    production — it keeps a ~141MB binary out of the repository); otherwise
    serves the copy shipped alongside the backend.
    """
    if APK_DOWNLOAD_URL:
        return await _stream_external_apk(request)
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
        dashboard_base = CUSTOM_DOMAIN_ORIGIN
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
@limiter.limit("20/minute", key_func=_user_or_ip_key)
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


def _websocket_url(request: Request, device_id: str, device_token: Optional[str] = None) -> str:
    base = _public_base_url(request)
    ws_base = base.replace("https://", "wss://").replace("http://", "ws://")
    url = f"{ws_base}/ws/device/{device_id}"
    if device_token:
        # Carried as a query parameter because the WebSocket browser/Dart APIs
        # cannot set arbitrary headers on the upgrade request.
        url = f"{url}?token={device_token}"
    return url


# Device credentials are long-lived: the phone must be able to reconnect on its
# own after being offline for days without the user re-pairing. Revocation is
# by deleting the device (DELETE /devices/{id}), which the WS handler checks on
# every connect.
DEVICE_TOKEN_TTL_DAYS = 365


def _make_device_token(device_id: str, user_id) -> str:
    """Bearer credential proving 'I am this specific paired device'.

    Signed with the same key as user sessions but carries type='device', so it
    can never be used as a user access token (get_current_user requires
    type='access') and vice versa.
    """
    payload = {
        "sub": str(device_id),
        "uid": str(user_id),
        "jti": str(_uuid.uuid4()),
        "type": "device",
        "exp": datetime.now(timezone.utc) + timedelta(days=DEVICE_TOKEN_TTL_DAYS),
    }
    return jwt.encode(payload, JWT_SECRET_KEY, algorithm=ALGORITHM)


def _verify_device_token(token: str, device_id: str) -> Optional[str]:
    """Returns the owning user_id when the token is valid FOR THIS device_id."""
    try:
        payload = jwt.decode(token, JWT_SECRET_KEY, algorithms=[ALGORITHM])
    except JWTError:
        return None
    if payload.get("type") != "device":
        return None
    if payload.get("sub") != str(device_id):
        return None
    return payload.get("uid")


@app.post("/devices/pair")
@limiter.limit("10/minute")
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

    # Device-scoped credential for the WebSocket. The socket used to accept any
    # device_id with no proof at all; the phone stores this and presents it on
    # every connect.
    device_token = _make_device_token(device_id, user_id)
    return {
        "device_id": device_id,
        "device_token": device_token,
        "websocket_url": _websocket_url(request, device_id, device_token),
    }


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


# POST /devices/register was removed here (Batch 4).
#
# It upserted on the globally-unique adb_serial and unconditionally set
# user_id = EXCLUDED.user_id on conflict, with no check on the existing row's
# owner — so any authenticated account that knew or guessed another user's
# adb_serial could move that device into its own account in a single call,
# locking the real owner out (their next GET /devices/{id} 404s) and making
# the device a valid target for the attacker's own deployments.
#
# It was ADB-era surface area from v2 with no remaining callers: the current
# wireless flow registers devices through POST /devices/pair, which is scoped
# to a single-use, expiring, user-bound pairing token. Verified before removal
# that neither the dashboard (LokiAI-Desktop/.../src) nor the Flutter app
# (LokiAImobile UI/lib) references this route. See Docs/06_RULES.md Rule 12
# ("No USB, No ADB").


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
            if name.endswith(ext) and not is_split_shard(name):
                return name
    return None


# llama.cpp's split-model naming convention, e.g.
# "GLM-5.2-UD-IQ4_NL-00001-of-00009.gguf". A shard is NOT a model: its tensors
# are spread across every part, and llama.cpp aborts the process - not raises,
# aborts - when it is handed one alone. That is a native crash no Dart or
# Python handler can intercept.
#
# This is exactly how a 9 MB "GLM-5.2" was recommended, passed the device
# budget, deployed, and then killed the Android app on the first message: the
# CDN HEAD returned the size of shard 1, not of the model.
_SPLIT_SHARD_RE = re.compile(r"-\d{5}-of-\d{5}\.gguf$", re.IGNORECASE)

# A GGUF small enough to be a fragment, adapter, or vocab-only file rather than
# something llama.cpp can hold a conversation with.
MIN_CHAT_MODEL_MB = float(os.getenv("MIN_CHAT_MODEL_MB", "20"))

# How many real alternatives to surface per requested capability. A single
# result is not a recommendation, it is a take-it-or-leave-it.
MIN_OPTIONS_PER_CAPABILITY = int(os.getenv("MIN_OPTIONS_PER_CAPABILITY", "3"))

# Upper bound on cards in one reply, across all requested capabilities.
MAX_RENDERED_CANDIDATES = int(os.getenv("MAX_RENDERED_CANDIDATES", "6"))


def is_split_shard(filename: str) -> bool:
    return bool(_SPLIT_SHARD_RE.search(filename or ""))


def is_usable_chat_file(filename: str, size_mb: Optional[float]) -> bool:
    """Whether a .gguf can actually be loaded on its own by the phone."""
    if is_split_shard(filename):
        return False
    if size_mb is not None and size_mb < MIN_CHAT_MODEL_MB:
        return False
    return True


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


# A HuggingFace repo reference the user typed or pasted. Deliberately strict:
# it must look like a real huggingface.co link or a bare `org/name` that is not
# an ordinary sentence, so plain prose is never mistaken for a repo id.
_HF_URL_RE = re.compile(
    r"https?://(?:www\.)?huggingface\.co/([A-Za-z0-9][\w.-]*/[\w.-]+)", re.IGNORECASE)
_BARE_REPO_RE = re.compile(r"(?<![\w./-])([A-Za-z0-9][\w.-]{1,}/[A-Za-z0-9][\w.-]{2,})(?![\w/])")


_RESERVED_HF_SEGMENTS = {
    "models", "datasets", "spaces", "docs", "blog", "papers",
    "collections", "settings", "join", "login",
}


def _looks_like_repo_id(cand: str) -> bool:
    """Shape check for a HuggingFace `org/name`.

    Applied to anything headed for the HF API — including values the language
    model extracted — so prose or a URL fragment is never looked up as a
    repository.
    """
    if not cand or cand.count("/") != 1:
        return False
    org, _, name = cand.partition("/")
    if not org or not name:
        return False
    if "." in org or org.lower() in _RESERVED_HF_SEGMENTS:
        return False
    if len(org) < 2 or len(name) < 3:
        return False
    return all(c.isalnum() or c in "._-" for c in org + name)


def _extract_direct_repo(message: str) -> Optional[str]:
    """Return an explicit HF repo id when the user clearly named one.

    Used to bypass the intent model entirely for direct-link requests, which
    are unambiguous and should not depend on a provider round trip.
    """
    m = _HF_URL_RE.search(message)
    if m:
        # Trim trailing path segments (/tree/main, /blob/...) — keep org/name.
        return "/".join(m.group(1).split("/")[:2]).rstrip("/.,)")
    m = _BARE_REPO_RE.search(message.strip())
    if m:
        cand = m.group(1).rstrip(".,)")
        # _looks_like_repo_id rejects a dotted "org" (a hostname, not an owner)
        # and HuggingFace's own reserved path segments — without which
        # "huggingface.co/models?filter=tflite" was extracted as a repository
        # and looked up, surfacing as a misleading HF_UNAVAILABLE.
        if _looks_like_repo_id(cand) and not cand.lower().endswith(
                (".com", ".org", ".net", ".io", ".py", ".md", ".json")):
            return cand
    return None


def _extract_keywords(message: str) -> str:
    """User message → HF search keywords ('i want paper detection' → 'paper detection')."""
    words = [w for w in re.sub(r"[^a-z0-9 ]", " ", message.lower()).split()
             if w not in _STOP_WORDS]
    return " ".join(words[:4])


# Quantity words the planner fallback understands, so "two image models"
# preserves the requested count rather than silently collapsing to one.
_NUMBER_WORDS = {
    "one": 1, "a": 1, "an": 1, "single": 1, "two": 2, "couple": 2, "both": 2,
    "three": 3, "four": 4, "five": 5,
}

# Keyword table per capability. Every capability whose keywords appear is
# returned, in the order it appears in the message. The previous
# implementation was a chain of early returns, so "find a vision model and a
# chat model" matched the vision branch and dropped the chat requirement
# entirely — this is failure 10 in the repair plan.
_CAPABILITY_KEYWORDS = [
    ("audio-classification",
     ("sound", "audio", "noise", "hear", "listen", "classify sounds")),
    ("automatic-speech-recognition",
     ("transcribe", "transcription", "speech", "dictat", "voice input",
      "voice note", "voice command")),
    ("object-detection",
     ("detect", "detection", "object", "ocr", "bounding box", "spot")),
    ("image-classification",
     ("camera", "vision", "image", "photo", "picture", "recognize",
      "recognise", "identify", "classify", "see", "watch", "visual")),
    ("text-generation",
     ("chat", "chatbot", "conversation", "assistant", "talk", "llm",
      "language model", "text generation", "converse")),
]


def _extract_quantity(message: str, capability: str) -> int:
    """Best-effort count for one capability from the raw message.

    Deliberately conservative: an unparsed count is 1, never 0, so a
    requirement can never be dropped for want of a number.
    """
    msg = message.lower()
    for match in re.finditer(r"\b(\d+|" + "|".join(_NUMBER_WORDS) + r")\b\s+(\w+\s+){0,3}?models?\b", msg):
        token = match.group(1)
        quantity = int(token) if token.isdigit() else _NUMBER_WORDS.get(token, 1)
        # Only claim the count when the phrase names this capability.
        phrase = msg[match.start():match.end()]
        for keyword in dict(_CAPABILITY_KEYWORDS)[capability]:
            if keyword in phrase:
                return max(1, min(quantity, 5))
    return 1


# Size intent expressed in words, as a fraction of the device budget. A user
# saying "small" is stating a preference about the model, not about the phone,
# so it must both filter and re-rank - previously "small model not big" returned
# the identical three options including a 1.9 GB one.
_SIZE_PREFERENCE_WORDS = [
    ("tiny", ("tiny", "smallest", "very small", "as small as possible",
              "super small", "ultra light", "featherweight")),
    ("small", ("small", "smaller", "light", "lighter", "lightweight", "compact",
               "not big", "not heavy", "no heavy", "nothing big", "less heavy",
               "low memory", "quick")),
    ("large", ("large", "big", "biggest", "most capable", "best quality",
               "powerful", "strongest")),
]

# Fraction of the device budget each preference allows.
_SIZE_PREFERENCE_CEILING = {"tiny": 0.25, "small": 0.5, "any": 1.0, "large": 1.0}


def extract_size_preference(message: str) -> str:
    """'tiny' | 'small' | 'large' | 'any' from the user's own words."""
    msg = message.lower()
    for preference, words in _SIZE_PREFERENCE_WORDS:
        if any(w in msg for w in words):
            return preference
    return "any"


def size_ceiling_for(preference: str, max_size_mb: float) -> float:
    """The effective budget once the user's stated preference is applied."""
    return max_size_mb * _SIZE_PREFERENCE_CEILING.get(preference, 1.0)


def rank_candidates(models: list, size_preference: str) -> list:
    """Order candidates by what the user actually asked for.

    Default ranking is (reputable, downloads). When the user asked for a small
    or tiny model, size becomes the primary key so genuinely smaller options
    come first instead of being buried under more popular large ones.
    """
    if size_preference in ("small", "tiny"):
        return sorted(
            models,
            key=lambda m: (m.get("size_mb") or float("inf"),
                           not m.get("reputable", False)),
        )
    if size_preference == "large":
        return sorted(
            models,
            key=lambda m: (-(m.get("size_mb") or 0), not m.get("reputable", False)),
        )
    return sorted(
        models,
        key=lambda m: (not m.get("reputable", False), -(m.get("downloads") or 0)),
    )


def classify_task_plan(message: str) -> list:
    """User message -> ordered plan of {capability, quantity, constraints}.

    This is the deterministic planner used by /models/search and as the
    fallback when the intent model is unavailable. It is multi-intent: every
    capability the message asks for is preserved, with its requested count.
    """
    msg = message.lower()
    plan = []
    for capability, keywords in _CAPABILITY_KEYWORDS:
        position = min(
            (msg.find(k) for k in keywords if k in msg),
            default=-1,
        )
        if position < 0:
            continue
        plan.append({
            "capability": capability,
            "quantity": _extract_quantity(message, capability),
            "size_preference": extract_size_preference(message),
            "constraints": {},
            "_position": position,
        })
    plan.sort(key=lambda t: t["_position"])
    for task in plan:
        task.pop("_position")
    if not plan:
        # An unrecognised request is a chat request, matching prior behaviour.
        plan = [{
            "capability": "text-generation",
            "quantity": 1,
            "size_preference": extract_size_preference(message),
            "constraints": {},
        }]
    return plan


def classify_tasks(message: str) -> list:
    """Backward-compatible wrapper returning bare capability tags.

    Retained because callers (and existing tests) depend on the flat list
    shape; new code should use classify_task_plan.
    """
    return [task["capability"] for task in classify_task_plan(message)]


def expand_vision_siblings(capabilities: list) -> list:
    """Vision tasks share candidate pools on HuggingFace.

    The proven mobile vision families (MobileNet, EfficientNet) are tagged
    image-classification even when the user asked for detection, so searching
    one without the other loses real candidates. Adding the sibling must never
    drop a simultaneously requested chat or audio capability.
    """
    tasks = list(capabilities)
    if "object-detection" in capabilities and "image-classification" not in tasks:
        tasks.append("image-classification")
    elif "image-classification" in capabilities and "object-detection" not in tasks:
        tasks.append("object-detection")
    return tasks


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
            # Keyword searches are format-filtered but not task-filtered by
            # HuggingFace. Do not let an unrelated TFLite helper file become
            # a recommendation for the user's requested runtime.
            pipeline_tag = m.get("pipeline_tag")
            if pipeline_tag and pipeline_tag not in tasks:
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
                    # Split shards are excluded before anything else: one part
                    # of a multi-part model is unloadable and crashes the
                    # phone's native runtime.
                    matches = [f for f in matches if not is_split_shard(f)]
                    if not matches:
                        continue
                    # Prefer q4 quantizations: the best size/quality tradeoff
                    # for phone-class RAM budgets.
                    q4 = [f for f in matches if "q4" in f.lower()]
                    fname = q4[0] if q4 else matches[0]
                else:
                    # A repository may contain tiny utility models alongside
                    # its actual runtime. DTLN/denoising/VAD files are not
                    # general audio-recognition models and were the source of
                    # the misleading 0.36 MB "Whisper" recommendation.
                    runtime_matches = [
                        f for f in matches
                        if not re.search(r"(?:dtln|denois|enhanc|separat|\bvad\b)", f, re.I)
                    ]
                    fname = (runtime_matches or matches)[0]
                break
            if fname:
                seen.add(m["id"])
                candidates.append((m, fname))

    if not any_ok and queries:
        raise HTTPException(
            status_code=502,
            detail=f"HuggingFace search is currently unavailable: {last_error or 'unknown error'}"
        )

    # Resolving candidate sizes dominates this endpoint's latency: it is one
    # redirect-following CDN HEAD per candidate. Measured before this change at
    # p50 4.8s / p95 13.3s for the whole request (see
    # test_infra/perf_probe.py and Docs/test/LOKIAI_PERFORMANCE_REPORT.md).
    #
    # Two bounded fixes, no behaviour change:
    #  - cache the size per (repo, file): the size of a file on `main` is
    #    stable, and the same popular repos come back for most queries;
    #  - bound concurrency, because firing 40 simultaneous HEADs at the public
    #    (unauthenticated) CDN invites the 429s that produce the slow tail.
    sem = asyncio.Semaphore(HF_HEAD_CONCURRENCY)

    async def sized(m, fname):
        cache_key = f"size|{m['id']}|{fname}"
        cached = _hf_cache_get(cache_key)
        if cached is not None:
            return (m, fname, cached) if cached > 0 else None
        async with sem:
            try:
                head = await _hf_head(client, f"https://huggingface.co/{m['id']}/resolve/main/{fname}")
                cl = head.headers.get("content-length")
            except httpx.HTTPError:
                return None
        if not cl:
            return None
        size_mb = int(cl) / (1024 * 1024)
        _hf_cache_put(cache_key, size_mb)
        return (m, fname, size_mb)

    checked = await asyncio.gather(*(sized(m, f) for m, f in candidates[:40]))

    results = []
    for item in checked:
        if not item:
            continue
        m, fname, size_mb = item
        if not (0 < size_mb <= max_size_mb):
            continue
        # Second gate, now that the real size is known. A .gguf that is under
        # the chat-model floor is a fragment however it was named, and
        # deploying it crashes the phone's native runtime.
        if fname.endswith(".gguf") and not is_usable_chat_file(fname, size_mb):
            print(f"[search] skipping unusable chat file {m['id']}/{fname} "
                  f"({size_mb:.2f} MB)")
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
@limiter.limit("20/minute", key_func=_user_or_ip_key)
async def search_models(req: ModelSearchRequest, request: Request, user_id: str = Depends(get_current_user)):
    pool = request.app.state.pool
    async with pool.acquire() as conn:
        # phone_model/ram_mb feed the "why this fits your device" sentence in
        # every description, so they are read here rather than guessed.
        device = await conn.fetchrow(
            "SELECT phone_model, ram_mb FROM devices "
            "WHERE id = $1::uuid AND user_id = $2::uuid",
            req.device_id, user_id)
        if not device:
            raise HTTPException(status_code=404, detail="Device not found")
            
    max_size_mb = (device["ram_mb"] or 4096) * 0.4

    # The keyword planner is multi-intent too: this endpoint is the fallback
    # recommendation path, and fixing only the model-driven path would leave it
    # returning one capability and no descriptions.
    plan = classify_task_plan(req.user_message)
    device_specs = dict(device)

    recommendations: list = []
    grouped: list = []
    task_failures: list = []
    seen: set = set()
    async with httpx.AsyncClient(timeout=60.0) as client:
        outcomes = await asyncio.gather(
            *(
                search_deployable_models(
                    client, expand_vision_siblings([task["capability"]]),
                    req.user_message, max_size_mb,
                    limit=max(5, task["quantity"] * 4),
                )
                for task in plan
            ),
            return_exceptions=True,
        )
        for task, outcome in zip(plan, outcomes):
            if isinstance(outcome, Exception):
                task_failures.append({
                    "capability": task["capability"],
                    "error_code": "TASK_SEARCH_FAILED",
                    "message": str(outcome),
                })
                continue
            picked = [
                m for m in _apply_task_constraints(outcome, task["constraints"])
                if m["id"] not in seen
            ][:task["quantity"]]
            for m in picked:
                seen.add(m["id"])
                m["requested_capability"] = task["capability"]
            recommendations.extend(picked)
            if picked:
                grouped.append({
                    "capability": task["capability"],
                    "requested_quantity": task["quantity"],
                    "models": picked,
                })

        await _describe_models(
            pool, client, recommendations, device_specs, max_size_mb
        )

    return {"recommendations": recommendations,
            "grouped_results": grouped,
            "task_failures": task_failures}


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
@limiter.limit("5/hour", key_func=_user_or_ip_key)
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
    try:
        with open(dest_path, "wb") as f:
            while chunk := await file.read(1024 * 1024):
                size_bytes += len(chunk)
                # Enforce the cap on bytes actually received, not just the
                # declared Content-Length — that header can be absent (chunked
                # transfer) or simply untrue.
                if size_bytes > MAX_UPLOAD_SIZE:
                    raise HTTPException(
                        status_code=413,
                        detail=f"Model file exceeds the {MAX_UPLOAD_SIZE // (1024*1024)} MB upload limit.",
                    )
                f.write(chunk)
                sha256.update(chunk)
    except Exception:
        # Never leave a partial file behind on disk.
        try:
            os.remove(dest_path)
        except OSError:
            pass
        raise

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
# Greetings are answered by the small, warm model rather than the 70b router.
# The 70b's cold start was the dominant term in "hi" latency.
NIM_GREETING_MODEL = os.getenv("NIM_GREETING_MODEL", NIM_INTENT_MODEL)

# Hard ceiling on one chat turn, end to end. Individual provider calls already
# have their own timeouts, but nothing previously bounded a turn as a whole, so
# a slow classify plus a slow select plus SDK retries could exceed a minute with
# the UI still on "Thinking".
CHAT_TURN_DEADLINE_SECONDS = float(os.getenv("CHAT_TURN_DEADLINE_SECONDS", "75"))
GREETING_DEADLINE_SECONDS = float(os.getenv("GREETING_DEADLINE_SECONDS", "8"))

_DETERMINISTIC_GREETING = (
    "Hey! I'm Loki. Tell me what you want your phone to do - recognise things "
    "through the camera, chat offline, or identify sounds - and I'll find a "
    "model that actually fits it."
)

VALID_TASKS = ["object-detection", "image-classification", "text-generation",
               "audio-classification", "automatic-speech-recognition"]

# The Android runtime currently runs sound classification TFLite models, but
# not multi-file speech-to-text stacks such as Whisper or Moonshine. Keeping
# this explicit prevents the recommender from promising a model the phone
# cannot initialise (for example a random .tflite utility file in a Whisper
# repository).
RUNTIME_SUPPORTED_TASKS = {
    "object-detection", "image-classification", "text-generation", "audio-classification"
}


def _intent_system_prompt() -> str:
    """Stage 1: classify every requested task, or an empty array. This
    call does ONE job — it never picks models; code does all filtering.
    Per-task example phrasings below were added 2026-07-15 after a real-NIM
    benchmark showed the fast 8b model missed under-specified requests
    ("give me an offline chatbot") without them; with examples it matched
    11/11 on the benchmark set at a single ~0.46s call."""
    return """You classify a user's message for LokiAI, an app that finds and deploys on-device AI models to a paired phone.

Map the message to every applicable task type from this fixed list:
- object-detection — locating/detecting objects, or general camera vision requests ("detect", "spot", "find X in view")
- image-classification — labeling/identifying/recognizing what's in a photo or camera frame ("classify", "recognize", "identify", "is there a cat in this photo")
- text-generation — any chatbot, chat, assistant, or conversational text model the user wants ON their phone ("give me a chatbot", "I want to talk to an AI", "offline assistant", "something to chat with")
- automatic-speech-recognition — transcribing spoken audio to text ("transcribe", "speech to text", "voice notes", "dictation")
- audio-classification — identifying/classifying non-speech sounds ("what sound is that", "classify sounds", "identify noises")

If the user explicitly asks about a specific HuggingFace model by its repository ID (e.g., "prithivMLmods/Fire-Detection-Siglip2" or a huggingface.co link), extract that ID as `explicit_model`.
If the message is a greeting, thanks, small talk, or a question about LokiAI itself — anything that is NOT a request for a device capability — tasks is an empty array.

Preserve the COUNT the user asked for ("two image models and one speech model" is quantity 2 then quantity 1) and any constraints they state (max size in MB, quantization such as q4, file format, offline-only, device memory).

Reply with ONLY this JSON, nothing else:
{"tasks": [{"capability": "<one value from the list above>", "quantity": <integer 1-5>, "constraints": {}}], "explicit_model": "<extracted_id_or_null>"}

Return one entry per capability the user requests, in the order they request them. Example: "find a vision model and a chat model" returns
{"tasks": [{"capability": "image-classification", "quantity": 1, "constraints": {}}, {"capability": "text-generation", "quantity": 1, "constraints": {}}], "explicit_model": null}"""


# Constraint keys the backend understands. Anything else the planner invents is
# discarded rather than passed downstream, so a hallucinated field can never
# influence filtering.
_ALLOWED_CONSTRAINT_KEYS = {
    "max_size_mb", "min_size_mb", "quantization", "format", "offline_only",
    "max_memory_mb",
}


def _validate_task_plan(parsed: dict) -> list:
    """Strict validation of planner output into an ordered task list.

    Accepts, in order of preference:
      * the current schema: {"tasks": [{"capability", "quantity", "constraints"}]}
      * the legacy array schema: {"tasks": ["image-classification", ...]}
      * the original single-task schema: {"task": "image-classification"}

    Anything that is not a recognised capability is dropped. Duplicated
    capabilities are merged by summing their quantities, so "two chat models
    and another chat model" does not become two separate plan entries that
    each search the same pool.
    """
    if not isinstance(parsed, dict):
        return []

    raw = parsed.get("tasks")
    if not isinstance(raw, list):
        # Legacy single-task shape.
        raw = [parsed.get("task")] if parsed.get("task") else []

    plan: list = []
    by_capability: dict = {}
    for entry in raw:
        size_preference = "any"
        if isinstance(entry, str):
            capability, quantity, constraints = entry, 1, {}
        elif isinstance(entry, dict):
            capability = entry.get("capability") or entry.get("task")
            raw_quantity = entry.get("quantity", 1)
            try:
                quantity = int(raw_quantity)
            except (TypeError, ValueError):
                quantity = 1
            raw_constraints = entry.get("constraints")
            constraints = {
                k: v for k, v in raw_constraints.items()
                if k in _ALLOWED_CONSTRAINT_KEYS
            } if isinstance(raw_constraints, dict) else {}
            candidate_pref = entry.get("size_preference")
            if candidate_pref in ("tiny", "small", "large", "any"):
                size_preference = candidate_pref
        else:
            continue

        if capability not in VALID_TASKS:
            continue
        quantity = max(1, min(quantity, 5))

        if capability in by_capability:
            existing = by_capability[capability]
            existing["quantity"] = min(5, existing["quantity"] + quantity)
            existing["constraints"].update(constraints)
            if size_preference != "any":
                existing["size_preference"] = size_preference
            continue
        task = {
            "capability": capability,
            "quantity": quantity,
            "size_preference": size_preference,
            "constraints": constraints,
        }
        by_capability[capability] = task
        plan.append(task)
    return plan


def _apply_task_constraints(models: list, constraints: dict) -> list:
    """Filter already-verified candidates by the user's stated constraints.

    Only real, measured fields are used (size from a CDN HEAD, format from the
    filename). Nothing here can introduce a value the backend has not checked.
    """
    if not constraints:
        return models
    result = models
    max_size = constraints.get("max_size_mb")
    if isinstance(max_size, (int, float)) and max_size > 0:
        result = [m for m in result if (m.get("size_mb") or 0) <= max_size]
    min_size = constraints.get("min_size_mb")
    if isinstance(min_size, (int, float)) and min_size > 0:
        result = [m for m in result if (m.get("size_mb") or 0) >= min_size]
    fmt = constraints.get("format")
    if isinstance(fmt, str) and fmt.strip():
        wanted = fmt.strip().lower().lstrip(".")
        result = [m for m in result if (m.get("format") or "").lower() == wanted]
    quantization = constraints.get("quantization")
    if isinstance(quantization, str) and quantization.strip():
        wanted = quantization.strip().lower()
        narrowed = [
            m for m in result
            if wanted in (m.get("filename") or "").lower()
        ]
        # A quantization nobody publishes must not empty the list silently.
        result = narrowed or result
    return result


def _assistant_system_prompt() -> str:
    """Identity + capabilities + policy + formatting for plain conversation
    (used only when the message isn't a model request)."""
    return """You are Loki, the AI assistant inside LokiAI — The Shriks' edge-AI orchestration platform (theshriks.space).

# What LokiAI does
A user pairs their Android phone by scanning a QR code — no cables, no ADB, no developer options. They tell you in plain English what they want their phone to do. You find real AI models that fit their phone. When they press Deploy, the phone downloads the model straight from the CDN and runs it 100% on-device, fully offline, forever. Camera models label live video; chat models converse; audio models classify sound.

# Behavior policy (The Shriks standard — non-negotiable)
1. NEVER NAME A SPECIFIC MODEL. You are answering without having searched anything, so you have no real candidates and no real sizes. Naming one means inventing it. If the user wants a model, say you'll find one and ask what they want it to do — the system then runs a real search and shows real cards.
2. NEVER STATE A SIZE, A FILE NAME, A REPOSITORY ID, OR A BENCHMARK. Every number the user sees must come from a real search, not from you.
3. NO GUESSING. If you are unsure what they want, ask one short question.
4. Cloud-only models (ChatGPT, Claude, big server models) cannot run on a phone. If asked, say so in one sentence.
5. The phone runs TFLite (camera/audio) and GGUF (chat) only.

# Output style
Talk like a smart, friendly person — warm but not cheesy. Keep it conversational, the way you'd text a friend who asked for help. Use natural language, contractions, casual phrasing. Vary your sentence length. Match the user's energy — if they're excited, be excited back; if they're chill, keep it easy. Never say "Great question", "Certainly", "I'd be happy to", or other robotic filler."""


# ── HuggingFace repo metadata cache ──────────────────────────────────────────
# A direct repo URL used to cost a fresh API call plus a HEAD on every message,
# even when the same user pasted the same link twice. Entries are small and
# short-lived; HF repo contents change rarely relative to a chat session.
_HF_REPO_CACHE: dict = {}
_HF_CACHE_TTL_SECONDS = int(os.getenv("HF_CACHE_TTL_SECONDS", "300"))
_HF_CACHE_MAX = 512

# Simultaneous CDN HEAD requests when sizing search candidates. The endpoint
# previously fired one per candidate with no bound (up to 40), which is what
# produced the long tail: the public HuggingFace CDN throttles bursts, and
# _hf_head then sleeps on Retry-After.
HF_HEAD_CONCURRENCY = int(os.getenv("HF_HEAD_CONCURRENCY", "8"))


def _hf_cache_get(key: str):
    entry = _HF_REPO_CACHE.get(key)
    if not entry:
        return None
    if time.time() - entry["at"] > _HF_CACHE_TTL_SECONDS:
        _HF_REPO_CACHE.pop(key, None)
        return None
    return entry["value"]


def _hf_cache_put(key: str, value) -> None:
    if len(_HF_REPO_CACHE) >= _HF_CACHE_MAX:
        # Cheap eviction: drop the oldest entry.
        oldest = min(_HF_REPO_CACHE.items(), key=lambda kv: kv[1]["at"])[0]
        _HF_REPO_CACHE.pop(oldest, None)
    _HF_REPO_CACHE[key] = {"at": time.time(), "value": value}


async def _fetch_repo_siblings(client: httpx.AsyncClient, repo_id: str) -> list:
    """Return a complete list of file siblings for a HuggingFace repo.

    The primary `GET /api/models/{repo_id}?full=True` call includes a
    ``siblings`` array for most repos.  For repositories with very large file
    trees HuggingFace paginates or omits the array entirely.  When ``siblings``
    is empty we fall back to the explicit tree endpoint and page through it.

    This is the single canonical file-discovery path used by BOTH
    ``search_deployable_models`` and ``_resolve_explicit_repo`` so the two
    code paths can never diverge.
    """
    # Primary: model metadata with siblings inline
    try:
        resp = await _hf_get(client,
                             f"https://huggingface.co/api/models/{repo_id}",
                             params={"full": "True"})
    except httpx.HTTPError as e:
        return []  # caller turns this into HF_UNAVAILABLE

    if resp.status_code == 404:
        return None  # sentinel: repo does not exist
    if resp.status_code != 200:
        return []

    meta = resp.json()
    siblings = meta.get("siblings") or []

    if not siblings:
        # Fallback: explicit tree endpoint (paginated)
        page = 1
        while True:
            try:
                tree_resp = await _hf_get(
                    client,
                    f"https://huggingface.co/api/models/{repo_id}/tree/main",
                    params={"recursive": "True", "expand": "True", "p": str(page)},
                )
            except httpx.HTTPError:
                break
            if tree_resp.status_code != 200:
                break
            page_items = tree_resp.json()
            if not isinstance(page_items, list) or not page_items:
                break
            siblings.extend(page_items)
            # HuggingFace tree API returns at most 1000 items per page;
            # stop when a partial page is received (nothing left to fetch).
            if len(page_items) < 1000:
                break
            page += 1

    return siblings


async def _resolve_explicit_repo(client: httpx.AsyncClient, repo_id: str,
                                 max_size_mb: float) -> dict:
    """Deterministically decide whether a named HF repo can run on this phone.

    Returns either {"ok": True, "model": <candidate>} or
    {"ok": False, "code": <taxonomy code>, "message": <user-safe text>}.

    Every value in the returned candidate is real: the filename comes from the
    repo's own file list, the size from a CDN HEAD.  Nothing is assumed and
    nothing is invented, because this feeds both the recommendation shown to
    the user and the deploy action they can press.

    Bug-1 fix (2026-07-28):
    - Uses the canonical _fetch_repo_siblings() which falls back to the tree
      endpoint for repos whose metadata response omits the siblings list.
    - HF_UNAVAILABLE transient failures are never cached; only confirmed
      MODEL_NOT_FOUND and MODEL_INCOMPATIBLE results survive restarts.
    - Stale negative results are guarded by a 0-max_size check so a bad
      device-RAM read can never poison the cache for all future callers.
    """
    # Skip caching entirely if max_size_mb is implausibly small — it means
    # the device RAM could not be read and we must not store a size-based
    # rejection that would block future requests with a valid budget.
    cacheable = max_size_mb > 0
    cache_key = f"repo|{repo_id}|{max_size_mb:.0f}"
    if cacheable:
        cached = _hf_cache_get(cache_key)
        if cached is not None:
            # Invalidate a stale negative that claims MODEL_INCOMPATIBLE with
            # an empty file list — that may have come from an earlier paginated
            # miss before the tree-fallback was added.
            if (cached.get("ok") is False
                    and cached.get("code") == "MODEL_INCOMPATIBLE"
                    and "no .tflite or .gguf" in cached.get("message", "")
                    and "no recognisable" in cached.get("message", "")):
                # Evict and re-probe
                _HF_REPO_CACHE.pop(cache_key, None)
            else:
                return cached

    # ── 1. Fetch the complete file list ──────────────────────────────────────
    try:
        siblings = await _fetch_repo_siblings(client, repo_id)
    except Exception as e:
        return {"ok": False, "code": "HF_UNAVAILABLE",
                "message": "Could not reach HuggingFace to look that model up. "
                           "Try again in a moment.",
                "detail": str(e)}

    if siblings is None:
        # _fetch_repo_siblings returns None for genuine 404s
        result = {"ok": False, "code": "MODEL_NOT_FOUND",
                  "message": f"“{repo_id}” doesn't exist on HuggingFace. "
                             "It may be private, renamed, deleted, or a typo."}
        if cacheable:
            _hf_cache_put(cache_key, result)
        return result

    if not isinstance(siblings, list):
        return {"ok": False, "code": "HF_RESPONSE_INVALID",
                "message": "HuggingFace returned an unexpected response. "
                           "Try again in a moment."}

    # ── 2. Filter to phone-runnable formats ──────────────────────────────────
    # Siblings from the tree endpoint use "path" rather than "rfilename".
    def _fname(s) -> str:
        return s.get("rfilename") or s.get("path") or ""

    # A named repo gets the same shard exclusion as a searched one - a user
    # pasting a link to a split model must not be handed a crash either.
    candidates = [_fname(s) for s in siblings
                  if _fname(s).endswith((".tflite", ".gguf"))
                  and not is_split_shard(_fname(s))]
    if not candidates:
        present = sorted({
            os.path.splitext(_fname(s))[1]
            for s in siblings if os.path.splitext(_fname(s))[1]
        })
        result = {
            "ok": False, "code": "MODEL_INCOMPATIBLE",
            "message": (
                f"“{repo_id}” has no .tflite or .gguf file, so it can’t run "
                f"on the phone. It ships {', '.join(present[:6]) or 'no recognisable model files'}. "
                "On-device inference needs TFLite (camera/audio) or GGUF (chat)."
            ),
        }
        if cacheable:
            _hf_cache_put(cache_key, result)
        return result

    # ── 3. Pick best candidate (q4 GGUF preferred) ───────────────────────────
    q4 = [f for f in candidates if f.endswith(".gguf") and "q4" in f.lower()]
    ordered = q4 + [f for f in candidates if f not in q4]

    # ── 4. Real sizes from the CDN ───────────────────────────────────────────
    sized = []
    for fname in ordered[:6]:
        cache_sz_key = f"size|{repo_id}|{fname}"
        cached_sz = _hf_cache_get(cache_sz_key)
        if cached_sz is not None:
            if cached_sz > 0:
                sized.append((fname, cached_sz))
            continue
        try:
            head = await _hf_head(
                client, f"https://huggingface.co/{repo_id}/resolve/main/{fname}")
            cl = head.headers.get("content-length")
            if cl:
                size_mb = int(cl) / (1024 * 1024)
                _hf_cache_put(cache_sz_key, size_mb)
                sized.append((fname, size_mb))
        except httpx.HTTPError:
            continue

    if not sized:
        # Transient CDN failure — never cache
        return {"ok": False, "code": "HF_UNAVAILABLE",
                "message": f"I found “{repo_id}” but couldn’t read its file sizes "
                           "from the CDN just now. Try again in a moment."}

    # A .gguf under the chat-model floor is a fragment or adapter, not a model
    # llama.cpp can converse with; deploying one aborts the phone's runtime.
    fragments = [(f, s) for f, s in sized
                 if f.endswith(".gguf") and s < MIN_CHAT_MODEL_MB]
    sized = [t for t in sized if t not in fragments]
    if not sized and fragments:
        result = {
            "ok": False, "code": "MODEL_INCOMPATIBLE",
            "message": (
                f"“{repo_id}” only publishes .gguf files under "
                f"{MIN_CHAT_MODEL_MB:.0f} MB, which are fragments rather than a "
                "complete chat model. LokiAI runs single-file models only."
            ),
        }
        if cacheable:
            _hf_cache_put(cache_key, result)
        return result

    fitting = [(f, s) for f, s in sized if 0 < s <= max_size_mb]
    if not fitting:
        smallest_name, smallest_size = min(sized, key=lambda t: t[1])
        result = {
            "ok": False, "code": "MODEL_INCOMPATIBLE",
            "message": (
                f"“{repo_id}” is too large for this phone. Its smallest "
                f"runnable file ({smallest_name}) is {smallest_size:.0f} MB, "
                f"and this device’s budget is {max_size_mb:.0f} MB."
            ),
        }
        if cacheable:
            _hf_cache_put(cache_key, result)
        return result

    # Largest variant that still fits = most capable within budget.
    fitting.sort(key=lambda t: t[1], reverse=True)
    fname, size_mb = fitting[0]
    
    # Re-fetch repo meta for pipeline_tag and downloads (not always in tree resp).
    try:
        meta_resp = await _hf_get(client, f"https://huggingface.co/api/models/{repo_id}")
        meta = meta_resp.json() if meta_resp.status_code == 200 else {}
    except httpx.HTTPError:
        meta = {}

    result = {
        "ok": True,
        "model": {
            "id": meta.get("id", repo_id),
            "name": meta.get("id", repo_id).split("/")[-1],
            "downloads": meta.get("downloads", 0),
            "size_mb": round(size_mb, 2),
            "task": meta.get("pipeline_tag") or "unknown",
            "filename": fname,
            "format": fname.rsplit(".", 1)[-1],
            "reputable": repo_id.split("/")[0].lower() in REPUTABLE_ORGS,
            "download_url": f"https://huggingface.co/{repo_id}/resolve/main/{fname}",
        },
    }
    _hf_cache_put(cache_key, result)
    return result


# ── Model descriptions ───────────────────────────────────────────────────────
# Section 11 of the repair plan: every recommended model must carry a concise,
# sourced explanation. Metadata is preferred in this order:
#   1. verified metadata already in the LokiAI database
#   2. HuggingFace model-card metadata (cardData)
#   3. the repository README / model card prose
#   4. task and pipeline tags
#   5. a clearly marked conservative fallback
# Normalised results are cached in `model_descriptions` so the same card is not
# downloaded on every request.

# Two forms per capability: a full sentence used when the publisher supplied
# no usable prose, and a short clause used to prefix real model-card text.
# Repeating the full sentence in front of every card is what made the
# recommendations read as generated boilerplate.
_TASK_DESCRIPTIONS = {
    "image-classification": (
        "Labels what the camera sees. Give it a frame or photo, get back the "
        "most likely objects with a confidence score for each.",
        "Labels photos and camera frames.",
    ),
    "object-detection": (
        "Finds objects in the camera view and marks where each one is, with a "
        "confidence score.",
        "Finds and locates objects in view.",
    ),
    "text-generation": (
        "An offline chatbot. Type a message and it writes a reply, entirely on "
        "the phone with no network.",
        "Offline chat.",
    ),
    "audio-classification": (
        "Recognises sounds from the microphone and names what it hears, with a "
        "confidence score.",
        "Recognises sounds from the mic.",
    ),
    "automatic-speech-recognition": (
        "Turns recorded speech into written text.",
        "Speech to text.",
    ),
}

_FORMAT_RUNTIME = {
    "tflite": "runs on the phone's TensorFlow Lite runtime",
    "gguf": "runs on the phone's llama.cpp runtime",
}

# Boilerplate that leads many model cards and says nothing about the model.
_CARD_NOISE = re.compile(
    r"^\s*(?:#+\s*|<!--.*?-->|\[!\[.*?\]\(.*?\)\]\(.*?\)|!\[.*?\]\(.*?\)|"
    r"---\s*$|license:.*$|tags:.*$|library_name:.*$)",
    re.IGNORECASE | re.MULTILINE,
)


def _strip_markup(text: str) -> str:
    """Model-card markdown/HTML -> plain readable prose.

    Cards are written for a web page, not for a phone-sized card: they open
    with badge rows, raw <div> blocks and inline links. Passing that through
    verbatim is what put "<div> <p style=..." and "[Run GLM-5.2 Guide!](...)"
    into recommendations.
    """
    out = text
    out = re.sub(r"<!--.*?-->", " ", out, flags=re.DOTALL)
    out = re.sub(r"<[^>]+>", " ", out)          # HTML tags
    out = re.sub(r"!\[[^\]]*\]\([^)]*\)", " ", out)  # images
    out = re.sub(r"\[([^\]]*)\]\([^)]*\)", r"\1", out)  # links -> their text
    out = re.sub(r"`{1,3}", "", out)            # code ticks
    out = re.sub(r"[*_]{1,3}(?=\S)", "", out)   # bold/italic markers
    out = out.replace("&nbsp;", " ").replace("&amp;", "&")
    out = re.sub(r"\s+", " ", out)
    return out.strip()


# A card description sits under a model name in a narrow panel. One sentence.
MAX_DESCRIPTION_CHARS = int(os.getenv("MAX_DESCRIPTION_CHARS", "120"))
MAX_DESCRIPTION_WORDS = int(os.getenv("MAX_DESCRIPTION_WORDS", "20"))

# Sentences that describe the *packaging* rather than the model. These are the
# ones that filled the cards: "This model was converted to GGUF format from
# meta-llama/... using llama.cpp via the ggml.ai's GGUF-my-repo space."
_PACKAGING_NOISE = re.compile(
    r"(converted to \w+ format|gguf-my-repo|using llama\.cpp|quantiz\w+ (?:by|with|using)"
    r"|refer to the original model card|see the original|for more details"
    r"|this (?:repo|repository) contains|these are .{0,30}(?:weights|files)"
    r"|read our|check out|follow us|join our|star (?:us|the repo)"
    r"|^we (?:release|are)|benchmark|discord|newsletter)",
    re.IGNORECASE,
)


def _shorten_description(text: str) -> Optional[str]:
    """One informative sentence, within the card's length budget.

    Model cards open with marketing, conversion history and links. Taking their
    first paragraph verbatim is what put "This model was converted to GGUF
    format from meta-llama/... via the ggml.ai's GGUF-my-repo space" on a card
    where a single line was wanted.
    """
    if not text:
        return None
    cleaned = _strip_markup(text)
    # Split into sentences and take the first that actually describes the model.
    for sentence in re.split(r"(?<=[.!?])\s+", cleaned):
        sentence = sentence.strip()
        if len(sentence) < 25:
            continue
        if _PACKAGING_NOISE.search(sentence):
            continue
        words = sentence.split()
        if len(words) > MAX_DESCRIPTION_WORDS:
            sentence = " ".join(words[:MAX_DESCRIPTION_WORDS]).rstrip(",;:") + "..."
        if len(sentence) > MAX_DESCRIPTION_CHARS:
            window = sentence[:MAX_DESCRIPTION_CHARS]
            cut = window.rfind(" ")
            sentence = (window[:cut] if cut > 40 else window).rstrip(",;:") + "..."
        return sentence
    return None


def _first_card_paragraph(readme: str, limit: int = 220) -> Optional[str]:
    """First substantive prose sentence(s) of a model card, or None.

    Deliberately short: the card sits under a model name on a phone-width
    panel, and a 400-character wall truncated mid-word reads worse than
    nothing.
    """
    if not readme:
        return None
    # Drop the YAML front matter, which is metadata rather than prose.
    body = re.sub(r"\A---\n.*?\n---\n", "", readme, flags=re.DOTALL)
    for block in re.split(r"\n\s*\n", body):
        if block.lstrip().startswith(("|", "```", ">")):
            continue
        cleaned = _strip_markup(_CARD_NOISE.sub("", block))
        if len(cleaned) < 40:
            continue
        # A block that was mostly markup leaves punctuation soup behind.
        letters = sum(c.isalpha() or c.isspace() for c in cleaned)
        if letters / len(cleaned) < 0.75:
            continue
        # Many cards open with conversion/marketing prose and only describe the
        # model further down. Keep scanning until a paragraph actually yields a
        # descriptive sentence, instead of giving up on the first one and
        # falling back to a generic capability line.
        usable = _shorten_description(cleaned)
        if usable:
            return usable
    del limit
    return None


async def _fetch_model_card(client: httpx.AsyncClient, repo_id: str) -> Optional[str]:
    try:
        resp = await client.get(
            f"https://huggingface.co/{repo_id}/raw/main/README.md",
            timeout=10.0,
            follow_redirects=True,
        )
    except httpx.HTTPError:
        return None
    return resp.text if resp.status_code == 200 else None


def _device_fit(size_mb: Optional[float], max_size_mb: float) -> str:
    """A measured statement about headroom, never a guess."""
    if not size_mb or max_size_mb <= 0:
        return "unknown"
    ratio = size_mb / max_size_mb
    if ratio <= 0.4:
        return "comfortable"
    if ratio <= 0.75:
        return "good"
    if ratio <= 1.0:
        return "tight"
    return "over budget"


def _compose_description(
    model: dict,
    capability: str,
    card_summary: Optional[str],
    card_data: Optional[dict],
    source: str,
) -> str:
    """Answers: what it does, what it takes, what it returns, what it is for."""
    full, clause = _TASK_DESCRIPTIONS.get(
        capability,
        (
            "LokiAI could not determine what this model does - its publisher "
            "did not state a task type.",
            "Task not stated by the publisher.",
        ),
    )
    # When the publisher wrote usable prose, it stands alone. The capability is
    # already a chip on the card ("text-generation"), so prefixing a clause to
    # every card was pure repetition. `clause` is retained only for callers
    # that need a bare capability phrase.
    del clause
    if card_summary:
        shortened = _shorten_description(card_summary)
        if shortened:
            return shortened
    return full


def _annotate_comparisons(models: list, max_size_mb: float) -> None:
    """Give each candidate a short note that DISTINGUISHES it from the others.

    This replaces a fixed three-clause template ("At N MB it is inside the M MB
    budget LokiAI allows for <phone> (R MB RAM). It is a .gguf file, which runs
    on the phone's llama.cpp runtime. Published by X, a publisher LokiAI
    recognises.") that rendered verbatim under every single card with only the
    numbers changed. It read as generated because it was: assembled from a
    fixed pattern, and restating the size and format that the card header
    already shows.

    A note is only emitted when it adds something the header does not, so a
    card with nothing distinguishing to say stays quiet instead of padding.
    """
    sized = [m for m in models if isinstance(m.get("size_mb"), (int, float))]
    if not sized:
        for m in models:
            m["why_recommended"] = ""
        return

    smallest = min(sized, key=lambda m: m["size_mb"])
    largest = max(sized, key=lambda m: m["size_mb"])
    multiple = len(sized) > 1

    for model in models:
        size_mb = model.get("size_mb")
        notes = []

        if multiple and model is smallest:
            notes.append("Smallest here - quickest to download and lightest to run.")
        elif multiple and model is largest and model.get("estimated_device_fit") != "tight":
            notes.append("Most capable of these that still fits.")

        if model.get("estimated_device_fit") == "tight" and size_mb:
            headroom = max_size_mb - size_mb
            notes.append(
                f"Only about {headroom:.0f} MB of headroom - close other apps "
                "before running it."
            )

        model["why_recommended"] = " ".join(notes)


# Bump whenever the wording, length, or markup handling of a description
# changes. Cached rows written by an older formatter are ignored and rewritten.
#
# Without this the cache was permanent: improving the formatter had no effect on
# any model that had already been described once, so the markup-dumping
# descriptions kept being served from the database long after the code that
# produced them was gone.
# v3: descriptions are capped at one sentence and packaging/marketing prose is
# stripped, so every v2 row (which could still hold a full card paragraph) is
# recomputed on next use.
DESCRIPTION_SCHEMA_VERSION = 3


async def _load_cached_descriptions(pool, model_ids: list) -> dict:
    if not model_ids:
        return {}
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            "SELECT model_id, description, source, source_url "
            "FROM model_descriptions "
            "WHERE model_id = ANY($1::text[]) AND schema_version = $2",
            model_ids, DESCRIPTION_SCHEMA_VERSION,
        )
    return {r["model_id"]: dict(r) for r in rows}


async def _store_descriptions(pool, entries: list) -> None:
    if not entries:
        return
    async with pool.acquire() as conn:
        await conn.executemany(
            """INSERT INTO model_descriptions
                   (model_id, description, source, source_url, schema_version,
                    updated_at)
               VALUES ($1, $2, $3, $4, $5, NOW())
               ON CONFLICT (model_id) DO UPDATE
                   SET description = EXCLUDED.description,
                       source = EXCLUDED.source,
                       source_url = EXCLUDED.source_url,
                       schema_version = EXCLUDED.schema_version,
                       updated_at = NOW()""",
            [(*e, DESCRIPTION_SCHEMA_VERSION) for e in entries],
        )


async def _describe_models(
    pool,
    client: httpx.AsyncClient,
    models: list,
    device: dict,
    max_size_mb: float,
    verified: Optional[dict] = None,
) -> list:
    """Attach the section 11 response contract to every candidate.

    Mutates and returns `models`. Every entry is guaranteed a non-empty,
    non-identical description; a metadata lookup that fails degrades to the
    next source rather than dropping the model or emitting an empty string.
    """
    if not models:
        return models

    verified = verified or {}
    ids = [m["id"] for m in models]
    cached = await _load_cached_descriptions(pool, ids)

    async def describe(model: dict) -> tuple:
        model_id = model["id"]
        capability = model.get("task") or "unknown"
        source_url = (
            model.get("download_url")
            or (f"https://huggingface.co/{model_id}"
                if "/" in model_id and not model_id.startswith("upload:")
                else None)
        )

        # 1. Verified metadata already stored by LokiAI.
        own = verified.get(model_id)
        if own and (own.get("description") or "").strip():
            return own["description"].strip(), "lokiai_database", source_url

        entry = cached.get(model_id)
        if entry and (entry.get("description") or "").strip():
            return entry["description"], entry["source"], entry["source_url"]

        if model_id.startswith("upload:"):
            return (
                _compose_description(model, capability, None, None, "fallback"),
                "user_upload",
                source_url,
            )

        # 2. HuggingFace model-card metadata, then 3. the README prose.
        card_data, card_summary, source = None, None, "task_tag"
        try:
            meta_resp = await _hf_get(
                client, f"https://huggingface.co/api/models/{model_id}"
            )
            if meta_resp.status_code == 200:
                meta = meta_resp.json()
                card_data = meta.get("cardData") if isinstance(meta, dict) else None
                capability = meta.get("pipeline_tag") or capability
                source = "huggingface_metadata"
        except (httpx.HTTPError, ValueError):
            pass

        readme = await _fetch_model_card(client, model_id)
        if readme:
            card_summary = _first_card_paragraph(readme)
            if card_summary:
                source = "huggingface_model_card"

        # 4/5. Task tags, or the clearly-marked conservative fallback.
        if not card_summary and source not in ("huggingface_metadata",):
            source = "fallback"
        return (
            _compose_description(model, capability, card_summary, card_data, source),
            source,
            source_url,
        )

    described = await asyncio.gather(
        *(describe(m) for m in models), return_exceptions=True
    )

    to_store = []
    for model, outcome in zip(models, described):
        if isinstance(outcome, Exception):
            print(f"[describe] {model['id']}: {type(outcome).__name__}: {outcome}")
            description = _compose_description(
                model, model.get("task") or "unknown", None, None, "fallback"
            )
            source, source_url = "fallback", None
        else:
            description, source, source_url = outcome
            if model["id"] not in cached and source != "user_upload":
                to_store.append((model["id"], description, source, source_url))

        fit = _device_fit(model.get("size_mb"), max_size_mb)
        model["display_name"] = model.get("name") or model["id"].split("/")[-1]
        model["capability"] = model.get("task") or "unknown"
        model["description"] = description
        model["estimated_device_fit"] = fit
        model["source"] = source
        model["source_url"] = source_url
        model["model_id"] = model["id"]
        # Technical evidence belongs behind a Details disclosure, not repeated
        # as prose under every card.
        model["runtime"] = _FORMAT_RUNTIME.get(
            (model.get("format") or "").lower(), "on-device runtime"
        )
        model["publisher"] = (
            model["id"].split("/")[0] if "/" in model["id"] else "unknown"
        )

    # Notes that distinguish the candidates from EACH OTHER, computed once the
    # whole set is known. Silent when there is nothing distinguishing to say.
    _annotate_comparisons(models, max_size_mb)

    try:
        await _store_descriptions(pool, to_store)
    except Exception as exc:  # caching is an optimisation, never a hard failure
        print(f"[describe] cache write failed: {type(exc).__name__}: {exc}")
    return models


def _classify_provider_error(exc: Exception) -> "AssistantError":
    """Map a provider exception onto the typed taxonomy.

    Classification is by exception type first (the SDK's own hierarchy), then
    by status code, and only then by string matching — string matching alone is
    brittle across SDK versions.
    """
    name = type(exc).__name__
    status = getattr(exc, "status_code", None) or getattr(
        getattr(exc, "response", None), "status_code", None)
    text = str(exc)
    low = text.lower()

    # NVIDIA NIM answers a bad key with 403 "Authorization failed", not 401.
    # Matching only 401 sent every rejected key down the generic path, so the
    # user was told "could not reach the AI provider" when the real problem was
    # their key — verified live against the provider on 2026-07-28.
    if (status in (401, 403)
            or "authenticationerror" in name.lower()
            or "permissiondenied" in name.lower()
            or "invalid api key" in low
            or "authorization failed" in low
            or "unauthorized" in low
            or "forbidden" in low):
        return AssistantError(
            "NIM_KEY_INVALID",
            "Your NVIDIA NIM API key was rejected. Check it in Account Settings, "
            "or generate a new one at build.nvidia.com.",
            detail=text)
    if status == 429 or "ratelimit" in name.lower() or "rate limit" in low or "too many requests" in low:
        return AssistantError(
            "NIM_RATE_LIMITED",
            "NVIDIA NIM is rate-limiting this key right now. Wait a moment and try again.",
            detail=text)
    if "timeout" in name.lower() or "timeout" in low or "timed out" in low:
        return AssistantError(
            "NIM_TIMEOUT",
            "I couldn't complete that response just now. Please try sending it again.",
            detail=text)
    if status is not None and 500 <= int(status) < 600:
        return AssistantError(
            "NIM_PROVIDER_UNAVAILABLE",
            "NVIDIA NIM is having trouble right now. Try again shortly.",
            detail=text)
    return AssistantError(
        "NIM_PROVIDER_UNAVAILABLE",
        "Could not reach the AI provider. Try again shortly.",
        detail=text)


# Phrases that only ever appear in instructions written TO the model. If any
# survives into a user-visible reply, the model has echoed its own prompt.
_PROMPT_LEAK_PATTERNS = [
    re.compile(p, re.IGNORECASE) for p in (
        r"\bexplain (?:the )?(?:this|exact)\b[^.]*\bto the user\b",
        r"\btell this to the user\b",
        r"\bdo not include\b",
        r"\breturn only valid json\b",
        r"\breturn only\b[^.]*\bjson\b",
        r"\bsearch_results\b",
        r"\berror_msg\b",
        r"\bsystem prompt\b",
        r"\byou must\b[^.]*\bin your response\b",
        r"^\s*\{.*\"response\"\s*:.*\}\s*$",
    )
]


def _strip_prompt_leakage(text: str) -> str:
    """Remove any internal instruction text the model echoed back.

    Defence in depth: the prompts were also rewritten so the model is no longer
    *told* to repeat these strings, but a model can still parrot its
    instructions, and that must never reach the UI.
    """
    if not text:
        return text
    cleaned_lines = []
    for line in text.splitlines():
        if any(p.search(line) for p in _PROMPT_LEAK_PATTERNS):
            continue
        cleaned_lines.append(line)
    cleaned = "\n".join(cleaned_lines)
    # Collapse the blank runs left behind by removed lines.
    cleaned = re.sub(r"\n{3,}", "\n\n", cleaned).strip()
    return cleaned


# Messages that adjust the previous recommendation rather than starting a new
# search. Deliberately narrow: a message naming a capability is a fresh
# request even if it also contains "smaller".
_REFINEMENT_RE = re.compile(
    r"^\s*(?:no+|nah|nope)?[ ,.!-]*"
    r"(?:i want |i need |give me |show me |make it |something |anything )?"
    r"(?:a |an |the )?"
    r"(?:much |bit |little |way )?"
    r"(?:small|smaller|tiny|tinier|light|lighter|lightweight|compact|big|bigger|"
    r"large|larger|heavier|better|faster|cheaper)"
    r"(?:er)?"
    r"(?:[ ,.!-]*(?:one|ones|model|models|option|options|please|than that|"
    r"not big|not heavy|no heavy|nothing big))*[ ,.!?]*$",
    re.IGNORECASE,
)


def _is_refinement(message: str) -> bool:
    """True when the message only adjusts the previous recommendation."""
    text = message.strip()
    if len(text.split()) > 8:
        return False
    if _REFINEMENT_RE.match(text):
        return True
    # "small model not big" - a size word and no capability of its own, so it
    # can only mean "the thing we were just discussing, but smaller".
    # A message that names a capability ("a model for chat, small one") is a
    # fresh request even though it also expresses a size.
    lowered = text.lower()
    has_size_word = extract_size_preference(lowered) != "any"
    names_capability = any(
        k in lowered
        for _, keywords in _CAPABILITY_KEYWORDS for k in keywords
    )
    return has_size_word and not names_capability


# "the second one", "number 2", "2." - a selection from the previous set.
_ORDINALS = {
    "first": 1, "1st": 1, "one": 1,
    "second": 2, "2nd": 2, "two": 2,
    "third": 3, "3rd": 3, "three": 3,
    "fourth": 4, "4th": 4, "four": 4,
    "fifth": 5, "5th": 5, "five": 5,
    "last": -1,
}
_SELECTION_RE = re.compile(
    r"^\s*(?:the\s+)?(?:number\s+|option\s+|#)?"
    r"(" + "|".join(_ORDINALS) + r"|\d+)"
    r"\s*(?:one|option|model|please)?\s*[.!]?\s*$",
    re.IGNORECASE,
)


def parse_candidate_selection(message: str) -> Optional[int]:
    """1-based index of a candidate the user picked, or None.

    Resolving a numbered choice from the stored candidate list is what makes
    "second one" reliable; parsing it out of the assistant's prose would break
    the moment the wording changed.
    """
    match = _SELECTION_RE.match(message.strip())
    if not match:
        return None
    token = match.group(1).lower()
    if token.isdigit():
        value = int(token)
        return value if 1 <= value <= 10 else None
    return _ORDINALS.get(token)


def select_from_previous(candidates: list, index: int) -> Optional[dict]:
    """Resolve a 1-based (or -1 for last) selection against stored candidates."""
    if not candidates:
        return None
    if index == -1:
        return candidates[-1]
    if 1 <= index <= len(candidates):
        return candidates[index - 1]
    return None


def _previous_plan_from_history(history: list) -> list:
    """Reconstruct the capability plan from the last user turn that had one.

    Uses the deterministic keyword planner over prior user messages, so a
    follow-up inherits the capability under discussion without another
    provider round trip.
    """
    for turn in reversed(history or []):
        if turn.get("role") != "user":
            continue
        content = str(turn.get("content") or "")
        if _is_refinement(content):
            continue
        plan = classify_task_plan(content)
        # classify_task_plan always returns something; only trust it when the
        # message genuinely named a capability.
        if any(
            k in content.lower()
            for _, keywords in _CAPABILITY_KEYWORDS for k in keywords
        ):
            return plan
    return []


def _drop_repeated_model_lines(prose: str) -> str:
    """Remove numbered items that name a model already named earlier.

    Instructing the selector not to repeat itself is necessary but not
    sufficient: with a single candidate it still padded to three by listing
    that model as items 1, 2 and 3. This enforces the rule on the output.
    """
    if not prose:
        return prose
    # Split on "1. ", "2. " ... keeping the delimiter with its item.
    parts = re.split(r"(?m)(?=^\s*\d+\.\s)", prose)
    if len(parts) < 3:
        return prose
    seen_repos: set = set()
    kept, index = [], 0
    for part in parts:
        repos = set(re.findall(r"[A-Za-z0-9._-]+/[A-Za-z0-9._-]+", part))
        if repos and repos <= seen_repos:
            continue  # every model named here was already listed above
        seen_repos |= repos
        if re.match(r"^\s*\d+\.\s", part):
            index += 1
            part = re.sub(r"^\s*\d+\.\s", f"{index}. ", part, count=1)
        kept.append(part)
    return "".join(kept).strip()


def _recommendation_prompt(device: dict, candidates: list, requirements: list) -> str:
    """Prompt for the single generation step, after the facts are decided.

    The backend has already chosen and ordered the candidates. The model's only
    job is to say, in its own words, what it is offering and why - it cannot
    change the selection, so it cannot introduce a model, a size, or a
    compatibility verdict.
    """
    phone = device.get("phone_model") or "the paired phone"
    wants = ", ".join(
        f"{r['capability']}"
        + (f" ({r['size_preference']})" if r.get("size_preference", "any") != "any"
           else "")
        for r in requirements
    ) or "a model"

    facts = json.dumps([
        {
            "model_id": c["id"],
            "size_mb": c.get("size_mb"),
            "task": c.get("task"),
            "device_fit": c.get("estimated_device_fit"),
            "note": c.get("why_recommended") or None,
        }
        for c in candidates
    ], indent=None)

    # Real connection state from the devices.status column - never guessed. The
    # assistant must not stay silent about a phone that cannot currently
    # receive a deployment.
    offline_note = "" if device.get("status") == "connected" else (
        "\n\nThe phone is NOT connected right now. Work one short, honest "
        "clause about it needing to be online before Deploy reaches it into "
        "your sentences."
    )

    return f"""You are Loki, talking to someone about their {phone}.

They asked for: {wants}{offline_note}

These are the models LokiAI has already verified and chosen for them, in the
order they will appear on screen:
{facts}

Write 1 to 3 natural sentences introducing this set. Sound like a person who
just looked something up, not like a product listing.

Rules:
- Do NOT list the models one by one. Each one already has its own card on
  screen showing its name, size, task and fit.
- Do NOT repeat sizes, budgets, RAM figures, file formats, or publisher names.
  The cards show all of that.
- Do NOT mention any model that is not in the list above.
- Do NOT invent numbers.
- If they asked for something small, say briefly how these answer that.
- No bullet points, no numbering, no headings.
- Do not end with instructions about pressing Deploy; the UI already says so.

Reply with only this JSON: {{"response": "<your 1-3 sentences>"}}"""


def _response_grounding_violation(text: str, candidates: list) -> Optional[str]:
    """Return a reason when generated prose escapes the verified facts.

    This is the hard stop on hallucination: a model id or a size that is not in
    the candidate payload cannot reach the user, whatever the language model
    produced.
    """
    if not text:
        return "empty"

    allowed_ids = {c["id"].lower() for c in candidates}
    allowed_names = {c["id"].split("/")[-1].lower() for c in candidates}
    allowed_orgs = {c["id"].split("/")[0].lower() for c in candidates if "/" in c["id"]}

    # Any org/name token must be one of ours.
    for match in re.findall(r"\b[A-Za-z0-9._-]+/[A-Za-z0-9._-]+\b", text):
        if match.lower() not in allowed_ids:
            return f"named unknown repository {match!r}"

    # Bare model names that look like known families but are not on offer.
    for match in re.findall(r"\b(?:distil\w+|t5-\w+|bert\w*|gpt-\w+|mistral\w*|"
                            r"phi-?\d\w*|gemma\w*)\b", text, re.IGNORECASE):
        token = match.lower()
        if token not in allowed_names and not any(
                token in name for name in allowed_names):
            return f"named unverified model {match!r}"

    # Sizes must correspond to a real candidate size (within rounding).
    real_sizes = [c.get("size_mb") for c in candidates
                  if isinstance(c.get("size_mb"), (int, float))]
    for raw in re.findall(r"(\d+(?:\.\d+)?)\s*(?:mb|gb)\b", text, re.IGNORECASE):
        value = float(raw)
        matches_mb = any(abs(value - s) <= max(1.0, s * 0.02) for s in real_sizes)
        matches_gb = any(abs(value * 1024 - s) <= max(1.0, s * 0.05)
                         for s in real_sizes)
        if not (matches_mb or matches_gb):
            return f"stated unverified size {raw!r}"

    _ = allowed_orgs
    return None


# ── Conversation / message / run lifecycle ───────────────────────────────────
# Section 9 of the repair plan. A submitted message is committed before any
# inference is attempted, every run reaches a terminal status, and a restarted
# process recovers whatever was in flight. Coordination is database-backed
# (advisory locks + row state) rather than an in-process boolean, so it stays
# correct when Render runs more than one worker.

_RUN_WORKER_ID = f"chat-{os.getpid()}-{_uuid.uuid4().hex[:8]}"
RUN_TERMINAL_STATUSES = {"completed", "failed", "cancelled"}
RUN_ACTIVE_STATUSES = {"queued", "routing", "generating"}

# How long a request will wait for an earlier run on the same conversation
# before handing the caller a run id to poll instead of holding the socket.
CHAT_QUEUE_WAIT_SECONDS = float(os.getenv("CHAT_QUEUE_WAIT_SECONDS", "25"))
# A run still non-terminal after this is treated as interrupted on recovery.
RUN_STALE_AFTER_SECONDS = int(os.getenv("RUN_STALE_AFTER_SECONDS", "300"))


def _conversation_lock_key(conversation_id) -> int:
    """Stable 63-bit key for pg_advisory_lock, derived from the conversation."""
    digest = hashlib.sha256(str(conversation_id).encode()).digest()
    return int.from_bytes(digest[:8], "big", signed=True)


async def _recover_interrupted_runs(pool: asyncpg.Pool) -> int:
    """Fail runs that a previous process left mid-flight.

    Without this a crash or redeploy left a run in 'generating' for ever, which
    is exactly the "stuck on Thinking" symptom: the UI had nothing that could
    ever move it to a terminal state.
    """
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """UPDATE chat_runs
                  SET status='failed',
                      error_code='RUN_INTERRUPTED',
                      error_message='The server restarted while this message '
                                    'was being answered. Send it again.',
                      finished_at=NOW(), updated_at=NOW()
                WHERE status = ANY($1::text[])
                  AND created_at < NOW() - ($2 || ' seconds')::interval
             RETURNING id""",
            list(RUN_ACTIVE_STATUSES), str(RUN_STALE_AFTER_SECONDS),
        )
    if rows:
        print(f"[chat] recovered {len(rows)} interrupted run(s)")
    return len(rows)


async def _resolve_conversation(conn, user_id: str, device_id: Optional[str],
                                conversation_id: Optional[str]):
    """Return an existing conversation owned by this account, or create one."""
    if conversation_id:
        row = await conn.fetchrow(
            "SELECT id FROM conversations WHERE id = $1::uuid AND user_id = $2::uuid",
            conversation_id, user_id,
        )
        if row:
            return row["id"]
        # A conversation id that is not this account's is not an error the user
        # can act on; start a fresh conversation rather than leaking existence.
    row = await conn.fetchrow(
        "INSERT INTO conversations (user_id, device_id) "
        "VALUES ($1::uuid, $2) RETURNING id",
        user_id, _uuid.UUID(device_id) if device_id else None,
    )
    return row["id"]


async def _claim_or_create_run(pool: asyncpg.Pool, user_id: str,
                               device_id: Optional[str],
                               conversation_id: Optional[str],
                               message: str,
                               idempotency_key: str) -> dict:
    """Persist the user's message and its run before any inference runs.

    Returns {"run": <record>, "duplicate": bool}. A repeated idempotency key
    returns the original run untouched, so a network retry never duplicates the
    message or starts a second generation.
    """
    async with pool.acquire() as conn:
        existing = await conn.fetchrow(
            "SELECT * FROM chat_runs WHERE user_id = $1::uuid AND idempotency_key = $2",
            user_id, idempotency_key,
        )
        if existing:
            return {"run": existing, "duplicate": True}

        async with conn.transaction():
            conv_id = await _resolve_conversation(
                conn, user_id, device_id, conversation_id
            )
            correlation_id = _uuid.uuid4().hex
            try:
                run = await conn.fetchrow(
                    """INSERT INTO chat_runs
                           (conversation_id, user_id, device_id, status,
                            idempotency_key, correlation_id, user_message)
                       VALUES ($1, $2::uuid, $3, 'queued', $4, $5, $6)
                       RETURNING *""",
                    conv_id, user_id,
                    _uuid.UUID(device_id) if device_id else None,
                    idempotency_key, correlation_id, message,
                )
            except asyncpg.exceptions.UniqueViolationError:
                # Another worker inserted the same key between the SELECT and
                # the INSERT. Its row is the authoritative one.
                run = await conn.fetchrow(
                    "SELECT * FROM chat_runs WHERE user_id = $1::uuid "
                    "AND idempotency_key = $2",
                    user_id, idempotency_key,
                )
                return {"run": run, "duplicate": True}

            # The user's message is committed here, before the provider is
            # contacted at all. Losing the request from this point on can lose
            # the answer, never the question.
            await conn.execute(
                "INSERT INTO chat_messages (conversation_id, role, content, run_id) "
                "VALUES ($1, 'user', $2, $3)",
                conv_id, message, run["id"],
            )
            await conn.execute(
                "UPDATE conversations SET updated_at = NOW() WHERE id = $1",
                conv_id,
            )
        return {"run": run, "duplicate": False}


async def _set_run_status(pool: asyncpg.Pool, run_id, status: str,
                          response: Optional[dict] = None,
                          error_code: Optional[str] = None,
                          error_message: Optional[str] = None) -> None:
    finished = status in RUN_TERMINAL_STATUSES
    async with pool.acquire() as conn:
        await conn.execute(
            """UPDATE chat_runs
                  SET status=$2, response=$3::jsonb, error_code=$4,
                      error_message=$5, claimed_by=$6, claimed_at=NOW(),
                      updated_at=NOW(),
                      finished_at = CASE WHEN $7 THEN NOW() ELSE finished_at END
                WHERE id=$1""",
            run_id, status,
            json.dumps(response) if response is not None else None,
            error_code, error_message, _RUN_WORKER_ID, finished,
        )


async def _persist_assistant_message(pool: asyncpg.Pool, run) -> None:
    async with pool.acquire() as conn:
        stored = await conn.fetchval(
            "SELECT response FROM chat_runs WHERE id = $1", run["id"]
        )
        if not stored:
            return
        payload = json.loads(stored) if isinstance(stored, str) else stored
        await conn.execute(
            "INSERT INTO chat_messages (conversation_id, role, content, run_id) "
            "VALUES ($1, 'assistant', $2, $3)",
            run["conversation_id"], str(payload.get("response") or ""), run["id"],
        )
        await conn.execute(
            "UPDATE conversations SET updated_at = NOW() WHERE id = $1",
            run["conversation_id"],
        )


class _ConversationTurnLock:
    """Serialises runs on one conversation across every backend process.

    Different conversations execute concurrently; the same conversation does
    not. Held on a dedicated connection for the life of the turn.
    """

    def __init__(self, pool: asyncpg.Pool, conversation_id):
        self._pool = pool
        self._key = _conversation_lock_key(conversation_id)
        self._conn = None
        self.acquired = False

    async def __aenter__(self):
        self._conn = await self._pool.acquire()
        try:
            # Try without waiting first: the common case is an idle
            # conversation, and this avoids holding a pool connection blocked.
            self.acquired = await self._conn.fetchval(
                "SELECT pg_try_advisory_lock($1)", self._key
            )
            if not self.acquired:
                try:
                    await asyncio.wait_for(
                        self._conn.execute("SELECT pg_advisory_lock($1)", self._key),
                        timeout=CHAT_QUEUE_WAIT_SECONDS,
                    )
                    self.acquired = True
                except asyncio.TimeoutError:
                    self.acquired = False
        except Exception:
            await self._pool.release(self._conn)
            self._conn = None
            raise
        return self

    async def __aexit__(self, *exc):
        if self._conn is None:
            return False
        try:
            if self.acquired:
                await self._conn.execute("SELECT pg_advisory_unlock($1)", self._key)
        finally:
            await self._pool.release(self._conn)
            self._conn = None
        return False


class ChatRequest(BaseModel):
    device_id: str
    message: str
    conversation_history: Optional[List[dict]] = None
    # Both optional so previously distributed mobile and web clients, which
    # send neither, keep working exactly as before.
    conversation_id: Optional[str] = None
    idempotency_key: Optional[str] = None


@app.post("/assistant/chat")
@limiter.limit("20/minute", key_func=_user_or_ip_key)
async def assistant_chat(req: ChatRequest, request: Request, user_id: str = Depends(get_current_user)):
    """Durable chat turn.

    The message is persisted with its run before any provider is contacted, the
    conversation is serialised across every backend process, and the run always
    reaches a terminal status. The answer itself is produced by
    `_assistant_turn`, whose behaviour and response shape are unchanged for
    existing clients.
    """
    pool = request.app.state.pool

    # A client that sends no key still gets idempotency within a turn; one that
    # sends its own gets it across network retries too.
    idempotency_key = (req.idempotency_key or "").strip()[:120] or _uuid.uuid4().hex

    claimed = await _claim_or_create_run(
        pool, user_id, req.device_id, req.conversation_id,
        req.message, idempotency_key,
    )
    run = claimed["run"]
    correlation_id = run["correlation_id"]

    if claimed["duplicate"]:
        # A retry of a submission we already have. Never run it twice.
        stored = run["response"]
        if run["status"] == "completed" and stored:
            payload = json.loads(stored) if isinstance(stored, str) else stored
            return {**payload, "run_id": str(run["id"]),
                    "conversation_id": str(run["conversation_id"]),
                    "run_status": "completed",
                    "correlation_id": correlation_id}
        if run["status"] in RUN_ACTIVE_STATUSES:
            return {"response": "That message is still being answered.",
                    "action": None, "search_results": [],
                    "error_code": None,
                    "run_id": str(run["id"]),
                    "conversation_id": str(run["conversation_id"]),
                    "run_status": run["status"],
                    "correlation_id": correlation_id}
        return {"response": run["error_message"] or "That message could not be answered.",
                "action": None, "search_results": [],
                "error_code": run["error_code"],
                "run_id": str(run["id"]),
                "conversation_id": str(run["conversation_id"]),
                "run_status": run["status"],
                "correlation_id": correlation_id}

    async with _ConversationTurnLock(pool, run["conversation_id"]) as lock:
        if not lock.acquired:
            # An earlier message on this conversation is still generating.
            # The submission is already durable and queued in FIFO order; the
            # caller polls GET /assistant/runs/{id} rather than holding a
            # socket open behind the lock. Documented trade-off, section 9.
            return {"response": "Your message is queued behind the previous one "
                                "on this conversation.",
                    "action": None, "search_results": [], "error_code": None,
                    "run_id": str(run["id"]),
                    "conversation_id": str(run["conversation_id"]),
                    "run_status": "queued",
                    "correlation_id": correlation_id}

        await _set_run_status(pool, run["id"], "routing")
        try:
            payload = await asyncio.wait_for(
                _assistant_turn(pool, req, user_id, correlation_id,
                                run["conversation_id"]),
                timeout=CHAT_TURN_DEADLINE_SECONDS,
            )
        except asyncio.TimeoutError:
            await _set_run_status(
                pool, run["id"], "failed",
                error_code="TURN_DEADLINE_EXCEEDED",
                error_message=(
                    "That took longer than "
                    f"{CHAT_TURN_DEADLINE_SECONDS:.0f}s and was stopped. "
                    "Send it again."
                ),
            )
            raise AssistantError(
                "TURN_DEADLINE_EXCEEDED",
                f"That took longer than {CHAT_TURN_DEADLINE_SECONDS:.0f}s and "
                "was stopped so it could not hang. Try sending it again.",
                http_status=504,
            )
        except AssistantError as exc:
            await _set_run_status(pool, run["id"], "failed",
                                  error_code=exc.code, error_message=str(exc))
            raise
        except Exception as exc:
            await _set_run_status(pool, run["id"], "failed",
                                  error_code="INTERNAL_ERROR",
                                  error_message=f"{type(exc).__name__}: {exc}")
            raise

        await _set_run_status(pool, run["id"], "completed", response=payload)
        await _persist_assistant_message(pool, run)

    return {**payload,
            "run_id": str(run["id"]),
            "conversation_id": str(run["conversation_id"]),
            "run_status": "completed",
            "correlation_id": correlation_id}


@app.get("/assistant/runs/{run_id}")
async def get_run_status(run_id: str, request: Request,
                         user_id: str = Depends(get_current_user)):
    """Terminal-state recovery for a queued or interrupted turn.

    This is what guarantees the UI can always leave "Thinking": whatever
    happened to the process that started the run, its status is readable here.
    """
    async with request.app.state.pool.acquire() as conn:
        run = await conn.fetchrow(
            "SELECT * FROM chat_runs WHERE id = $1::uuid AND user_id = $2::uuid",
            run_id, user_id,
        )
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")
    stored = run["response"]
    payload = (json.loads(stored) if isinstance(stored, str) else stored) or {}
    return {
        "run_id": str(run["id"]),
        "conversation_id": str(run["conversation_id"]),
        "run_status": run["status"],
        "correlation_id": run["correlation_id"],
        "error_code": run["error_code"],
        "response": payload.get("response") or run["error_message"],
        "action": payload.get("action"),
        "search_results": payload.get("search_results", []),
        "created_at": run["created_at"],
        "finished_at": run["finished_at"],
    }


@app.get("/assistant/conversations/{conversation_id}/messages")
async def get_conversation_messages(conversation_id: str, request: Request,
                                    user_id: str = Depends(get_current_user)):
    """Server-side history, so a reinstalled client no longer loses the thread."""
    async with request.app.state.pool.acquire() as conn:
        owner = await conn.fetchval(
            "SELECT user_id FROM conversations WHERE id = $1::uuid", conversation_id
        )
        if str(owner) != str(user_id):
            raise HTTPException(status_code=404, detail="Conversation not found")
        rows = await conn.fetch(
            "SELECT role, content, run_id, created_at FROM chat_messages "
            "WHERE conversation_id = $1::uuid ORDER BY created_at",
            conversation_id,
        )
    return [dict(r) for r in rows]


async def _last_recommendation(pool, conversation_id) -> list:
    """Candidates from the most recent completed recommendation in this thread.

    Stored structured data, not parsed prose, so a numbered selection resolves
    to exactly the model the user saw.
    """
    if conversation_id is None:
        return []
    async with pool.acquire() as conn:
        row = await conn.fetchval(
            """SELECT response FROM chat_runs
                WHERE conversation_id = $1 AND status = 'completed'
                  AND response IS NOT NULL
                ORDER BY created_at DESC LIMIT 1""",
            conversation_id,
        )
    if not row:
        return []
    payload = json.loads(row) if isinstance(row, str) else row
    results = payload.get("search_results") or []
    return [r for r in results if isinstance(r, dict) and r.get("id")]


async def _assistant_turn(pool, req: "ChatRequest", user_id: str,
                          correlation_id: str, conversation_id=None) -> dict:
    """Code filters, AI explains:
    1. Load the real paired device — 404 if not found, never guessed.
    2. One small NIM call classifies the message into every requested task,
       with counts and constraints, or an empty plan for plain conversation.
    3. Real HuggingFace search per task (unauthenticated, public CDN).
    4. Python filters to phone-runnable files (.tflite/.gguf, q4 preferred)
       that fit max_size_mb = ram_mb * 0.4, using real CDN HEAD sizes.
    5. Every candidate is given a sourced description.
    6. A second NIM call — given ONLY the real device specs and the
       filtered candidates — ranks and explains them.
    7. Every returned model id is re-validated against the filtered list
       server-side; hallucinated ids are dropped."""

    # Each account brings its own NVIDIA NIM key — no shared-quota fallback.
    async with pool.acquire() as conn:
        key_row = await conn.fetchrow(
            "SELECT nvidia_api_key_encrypted FROM users WHERE id = $1::uuid", user_id
        )
    if not key_row or not key_row["nvidia_api_key_encrypted"]:
        # 428 Precondition Required is kept for backwards compatibility with
        # the existing dashboard, which already branches on this status to open
        # the key dialog.
        raise AssistantError(
            "NIM_KEY_MISSING",
            "Add your NVIDIA NIM API key before using the AI assistant. "
            "Get one free at https://build.nvidia.com, then save it in LokiAI settings.",
            http_status=428,
        )
    user_nvidia_key = _decrypt_secret(key_row["nvidia_api_key_encrypted"])

    async with pool.acquire() as conn:
        device_row = await conn.fetchrow(
            "SELECT phone_model, cpu_arch, ram_mb, storage_free_gb, android_version, status FROM devices "
            "WHERE id = $1::uuid AND user_id = $2::uuid",
            req.device_id, user_id)
        if not device_row:
            raise AssistantError(
                "NO_DEVICE_SELECTED",
                "I couldn't find that phone on your account. Pair a device from the "
                "dashboard, then try again.",
                http_status=404,
            )

    device = dict(device_row)
    max_size_mb = (device["ram_mb"] or 4096) * 0.4

    history = []
    for h in (req.conversation_history or [])[-8:]:
        if h.get("role") in ("user", "assistant") and h.get("content"):
            history.append({"role": h["role"], "content": str(h["content"])[:2000]})

    openai_client = AsyncOpenAI(
        base_url="https://integrate.api.nvidia.com/v1",
        api_key=user_nvidia_key,
        # Per-call ceiling. A chat turn can make two provider calls (intent,
        # then conversation or selection), so this bounds a turn at ~2x. At the
        # previous 45s a cold 70b router could leave the caller hanging past
        # 90s with no response at all — measured 2026-07-28. Failing at 20s
        # yields a typed NIM_TIMEOUT the UI can act on, which is far better
        # than an indefinite spinner.
        timeout=float(os.getenv("NIM_TIMEOUT_SECONDS", "20")),
        # One SDK-managed retry covers transient connection and timeout errors
        # without changing prompts, models, routing, or response schemas.
        max_retries=int(os.getenv("NIM_MAX_RETRIES", "1")),
    )

    # A greeting must not pay the classifier plus router round-trip, and it must
    # not pay a cold 70b start either — that combination is what made "hi" take
    # far too long. Section 8 allows exactly one low-latency provider call for a
    # trivial greeting, so this uses the small intent model with a tight
    # deadline and falls back to a deterministic local reply. Either way the
    # turn is terminal in seconds, never indefinite.
    normalized_message = re.sub(r"[^a-z0-9? ]", "", req.message.lower()).strip()
    conversational_fast_path = bool(re.fullmatch(
        r"(?:hi+|hello+|hey+|yo+|thanks|thank you|what can you do\??|who are you\??)",
        normalized_message,
    ))
    if conversational_fast_path:
        reply = ""
        try:
            convo = await asyncio.wait_for(
                openai_client.chat.completions.create(
                    model=NIM_GREETING_MODEL,
                    messages=[{"role": "system", "content": _assistant_system_prompt()},
                              *history,
                              {"role": "user", "content": req.message}],
                    temperature=0.6,
                    max_tokens=160,
                ),
                timeout=GREETING_DEADLINE_SECONDS,
            )
            reply = (convo.choices[0].message.content or "").strip()
        except Exception as e:
            # A greeting is the one case where a provider failure must not
            # surface as an error: the deterministic answer is honest, correct,
            # and instant.
            print(f"[assistant] greeting fast path fell back "
                  f"({type(e).__name__}) corr={correlation_id}")
        return {"response": _strip_prompt_leakage(reply) or _DETERMINISTIC_GREETING,
                "action": None, "search_results": [], "error_code": None}

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
        # Strict validation against the planner schema. Accepts the current
        # {capability, quantity, constraints} shape, the legacy flat array, and
        # the original single-task field; anything else is discarded.
        tasks = _validate_task_plan(parsed)

        explicit_model = parsed.get("explicit_model")
        if not explicit_model:
            # Use the same validated extractor as the fast path. The previous
            # pattern here — (?:huggingface\.co/)?([\w-]+/[\w.-]+) — was loose
            # enough to pull "co/models" out of "huggingface.co/models?...",
            # which was then looked up as a repository and surfaced as a
            # misleading HF_UNAVAILABLE.
            explicit_model = _extract_direct_repo(req.message)
        elif not _looks_like_repo_id(explicit_model):
            # The model is asked to extract a repo id; it can return prose.
            # Anything that isn't shaped like org/name is discarded rather
            # than sent to the HuggingFace API.
            explicit_model = None

        return tasks, explicit_model

    # A pasted repo URL is unambiguous — resolving it needs no model call at
    # all. Skipping the intent hop here removes a whole provider round trip
    # (and its failure modes) from the most deterministic request we handle.
    direct_repo = _extract_direct_repo(req.message)
    if direct_repo:
        plan, explicit_model = [], direct_repo
    else:
        try:
            plan, explicit_model = await classify_intent(NIM_INTENT_MODEL)
        except Exception as e:
            if NIM_ROUTER_MODEL == NIM_INTENT_MODEL:
                raise _classify_provider_error(e)
            try:
                plan, explicit_model = await classify_intent(NIM_ROUTER_MODEL)
            except Exception as e2:
                raise _classify_provider_error(e2)

    # The intent model returning an empty plan is not proof the user was making
    # small talk. "small chat models" came back empty, fell through to the
    # free-form conversational branch, and the language model answered by
    # inventing DistilBERT, T5-Small and their sizes - models LokiAI had never
    # searched for and cannot deploy.
    #
    # The deterministic keyword planner is the tie-breaker: if it sees a real
    # capability request, that outcome wins and the request goes to a real
    # HuggingFace search instead of to free-form prose.
    # "second one" resolves against the stored candidate list from the previous
    # recommendation, never by parsing the assistant's prose.
    selection_index = parse_candidate_selection(req.message)
    if selection_index is not None:
        previous = await _last_recommendation(pool, conversation_id)
        chosen = select_from_previous(previous, selection_index)
        if chosen:
            return {
                "response": f"{chosen.get('display_name') or chosen['id']} it is - "
                            "press Deploy on the card and the phone takes it from there.",
                "action": "search_models",
                "search_results": [chosen],
                "grouped_results": [],
                "task_failures": [],
                "error_code": None,
            }
        if previous:
            return {
                "response": f"There were only {len(previous)} options in that "
                            "list. Pick one of those, or ask me for different ones.",
                "action": None, "search_results": previous,
                "grouped_results": [], "task_failures": [], "error_code": None,
            }

    # A follow-up modifies the previous requirement rather than starting an
    # unrelated search. "small model not big" after a chat recommendation must
    # keep the chat capability and tighten the size, which is why it previously
    # came back with the identical three options including a 1.9 GB one.
    previous_plan = _previous_plan_from_history(history)
    if previous_plan and _is_refinement(req.message):
        preference = extract_size_preference(req.message)
        refined = []
        for task in (plan or previous_plan):
            merged = dict(task)
            if preference != "any":
                merged["size_preference"] = preference
            refined.append(merged)
        # A bare refinement ("smaller", "not big") carries no capability of its
        # own; inherit the one already under discussion.
        if not plan:
            refined = [
                {**task, "size_preference": preference if preference != "any"
                 else task.get("size_preference", "any")}
                for task in previous_plan
            ]
        plan = refined
        print(f"[assistant] refinement of previous plan -> "
              f"{[(t['capability'], t.get('size_preference')) for t in plan]} "
              f"corr={correlation_id}")

    if not plan and not explicit_model:
        keyword_plan = classify_task_plan(req.message)
        looks_like_request = any(
            k in req.message.lower()
            for k in ("model", "chat", "camera", "vision", "detect", "sound",
                      "audio", "voice", "speech", "image", "photo", "deploy")
        )
        if keyword_plan and looks_like_request:
            print(f"[assistant] intent model returned no tasks; using keyword "
                  f"plan {[t['capability'] for t in keyword_plan]} "
                  f"corr={correlation_id}")
            plan = keyword_plan

    planned_tasks = [t["capability"] for t in plan]

    # If they gave a specific model link, we proceed even if task is None.
    if planned_tasks and not any(t in RUNTIME_SUPPORTED_TASKS for t in planned_tasks) and not explicit_model:
        return {
            "response": "LokiAI can currently run on-device sound classification, but its Android runtime does not yet support speech-to-text models such as Whisper or Moonshine. I won't recommend a file that the phone cannot initialise.",
            "action": None,
            "search_results": [],
            "error_code": "RUNTIME_UNSUPPORTED_TASK",
        }

    if not planned_tasks and not explicit_model:
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
            raise _classify_provider_error(e)
        return {"response": _strip_prompt_leakage(reply) or "Hey! I'm Loki — your AI sidekick for getting models onto your phone. What are you looking to do?",
                "action": None, "search_results": [], "error_code": None}

    # ── Steps 3-4: real search + Python-only filtering, one task at a time ──
    # Each planned capability is searched independently so that a failure in
    # one does not lose the others, its requested count is honoured, and the
    # results can be grouped back by the capability that asked for them. The
    # previous implementation flattened every capability into a single search
    # and returned one undifferentiated list.
    tasks = expand_vision_siblings(planned_tasks)

    models_data = []
    grouped: list = []
    task_failures: list = []
    explicit_rejection = None
    async with httpx.AsyncClient(timeout=60.0) as client:
        async def run_task(task: dict) -> dict:
            capability = task["capability"]
            preference = task.get("size_preference", "any")
            search_tags = expand_vision_siblings([capability])
            # Search the full device budget, then apply the user's stated size
            # preference as a ceiling and as the ranking key. Searching only the
            # reduced ceiling would starve the result set on a narrow request.
            found = await search_deployable_models(
                client, search_tags, req.message, max_size_mb,
                limit=max(12, task["quantity"] * 6),
            )
            found = _apply_task_constraints(found, task["constraints"])
            ceiling = size_ceiling_for(preference, max_size_mb)
            within = [m for m in found
                      if (m.get("size_mb") or 0) <= ceiling] if preference in (
                          "tiny", "small") else found
            # If nothing meets the stricter ceiling, fall back to the full set
            # rather than answering "nothing found" - but still rank by size so
            # the smallest genuinely comes first.
            return {"task": task,
                    "models": rank_candidates(within or found, preference)}

        if plan:
            outcomes = await asyncio.gather(
                *(run_task(task) for task in plan), return_exceptions=True
            )
            seen = set()
            for task, outcome in zip(plan, outcomes):
                capability = task["capability"]
                if isinstance(outcome, Exception):
                    # One capability failing is reported as that capability's
                    # failure; the rest of the plan still completes.
                    detail = (outcome.detail if isinstance(outcome, HTTPException)
                              else str(outcome))
                    print(f"[assistant] task {capability} failed corr={correlation_id}: "
                          f"{type(outcome).__name__}: {detail}")
                    task_failures.append({
                        "capability": capability,
                        "error_code": "TASK_SEARCH_FAILED",
                        "message": f"I could not complete the {capability} part "
                                   f"of that request: {detail}",
                    })
                    continue
                # quantity is what the user asked to *deploy*, not how many to
                # show. Honouring it literally meant "a small chat model"
                # rendered exactly one card with nothing to compare it
                # against - and left the selector padding its prose by naming
                # that single model three times.
                show = max(task["quantity"], MIN_OPTIONS_PER_CAPABILITY)
                picked = [m for m in outcome["models"]
                          if m["id"] not in seen][:show]
                for m in picked:
                    seen.add(m["id"])
                    m["requested_capability"] = capability
                if picked:
                    grouped.append({
                        "capability": capability,
                        "requested_quantity": task["quantity"],
                        "models": picked,
                    })
                    models_data.extend(picked)
                else:
                    task_failures.append({
                        "capability": capability,
                        "error_code": "NO_DEPLOYABLE_MODEL",
                        "message": f"Nothing deployable for {capability} fits "
                                   f"this phone's {max_size_mb:.0f} MB budget.",
                    })

        # A user naming a specific repo bypasses keyword search entirely. The
        # outcome is decided deterministically here, from real HuggingFace
        # metadata and a real CDN HEAD — never by the language model, and never
        # from invented values. (This path previously fabricated a size of
        # `max_size_mb * 0.5` "so it passes" and used the repo id as a
        # filename, so a repo could be recommended and deployed on the strength
        # of numbers nobody had checked.)
        if explicit_model:
            explicit_outcome = await _resolve_explicit_repo(
                client, explicit_model, max_size_mb)
            if explicit_outcome["ok"]:
                models_data.append(explicit_outcome["model"])
            else:
                explicit_rejection = explicit_outcome

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

    # A specifically-named repo that the backend proved unusable is answered
    # directly, with no model call. The verdict and the wording are both the
    # backend's — the provider is never asked to explain a decision it did not
    # make, which is how internal instruction text used to reach the UI.
    if explicit_rejection is not None and not models_data:
        if explicit_rejection.get("detail"):
            print(f"[assistant] {explicit_rejection['code']}: {explicit_rejection['detail']}")
        return {"response": explicit_rejection["message"],
                "action": "search_models",
                "search_results": [],
                "error_code": explicit_rejection["code"]}

    if not models_data:
        message = ("I searched the live model hubs and found nothing deployable "
                   "that fits your phone for that request. Try different wording "
                   "(e.g. 'recognize objects with my camera', 'offline chatbot', "
                   "'identify sounds').")
        if task_failures:
            message = " ".join(f["message"] for f in task_failures)
        return {"response": message, "action": "search_models",
                "search_results": [], "grouped_results": [],
                "task_failures": task_failures, "error_code": None}

    # ── Step 5: a sourced description for every candidate ────────────────
    # Both the primary path and the selector-failure fallback below return
    # `models_data`, so describing here covers both. Fixing only the primary
    # path would leave the fallback with empty descriptions.
    async with pool.acquire() as conn:
        verified_rows = await conn.fetch(
            "SELECT hf_model_id, name FROM models WHERE user_id = $1::uuid",
            user_id,
        )
    verified = {r["hf_model_id"]: dict(r) for r in verified_rows if r["hf_model_id"]}
    async with httpx.AsyncClient(timeout=30.0) as client:
        await _describe_models(
            pool, client, models_data, device, max_size_mb, verified=verified
        )

    # ── Step 6: the selection is the backend's; only the wording is generated ──
    # The candidate set and its order are already decided from verified data.
    # The model is no longer asked to return ids, so it has no mechanism to
    # introduce one - the previous design handed it the whole candidate payload
    # and asked for search_results back, which is what let it pad and repeat.
    validated: list = []
    seen_result_ids: set = set()
    for entry in grouped:
        for model in entry["models"]:
            if model["id"] not in seen_result_ids:
                seen_result_ids.add(model["id"])
                validated.append(model)
    for model in models_data:
        if model["id"] not in seen_result_ids:
            seen_result_ids.add(model["id"])
            validated.append(model)
    validated = validated[:MAX_RENDERED_CANDIDATES]

    requirements = plan or [{
        "capability": validated[0].get("task") or "text-generation",
        "size_preference": "any",
        "quantity": 1,
    }]

    prose, error_code = await _generate_recommendation_prose(
        openai_client, req.message, device, validated, requirements,
        history, correlation_id,
    )
    if task_failures:
        prose += " " + " ".join(f["message"] for f in task_failures)

    return {"response": prose,
            "action": "search_models",
            "search_results": validated,
            "grouped_results": grouped,
            "task_failures": task_failures,
            "error_code": error_code}


async def _generate_recommendation_prose(
    openai_client, message: str, device: dict, candidates: list,
    requirements: list, history: list, correlation_id: str,
) -> tuple:
    """One generation step, validated against the verified candidates.

    Returns (prose, error_code). A response that names a model or a size the
    backend did not verify is rejected and regenerated once; if the second
    attempt is also ungrounded, or the provider fails, a minimal factual line
    is used instead. An invalid response is never returned to the user.
    """
    prompt = _recommendation_prompt(device, candidates, requirements)

    async def attempt(temperature: float) -> Optional[str]:
        completion = await openai_client.chat.completions.create(
            model=NIM_SELECTOR_MODEL,
            messages=[{"role": "system", "content": prompt},
                      *history[-4:],
                      {"role": "user", "content": message}],
            temperature=temperature,
            max_tokens=220,
            response_format={"type": "json_object"},
        )
        raw = completion.choices[0].message.content
        if not (raw or "").strip():
            return None
        parsed = json.loads(raw)
        if not isinstance(parsed, dict):
            return None
        return _strip_prompt_leakage(str(parsed.get("response") or "").strip())

    last_violation = None
    for index, temperature in enumerate((0.7, 0.3)):
        try:
            text = await attempt(temperature)
        except Exception as exc:
            code = (exc.code if isinstance(exc, AssistantError)
                    else _classify_provider_error(exc).code)
            print(f"[assistant] prose generation failed ({code}: "
                  f"{type(exc).__name__}) corr={correlation_id}")
            return _deterministic_recommendation_line(candidates), code
        if not text:
            last_violation = "empty"
            continue
        text = _drop_repeated_model_lines(text)
        violation = _response_grounding_violation(text, candidates)
        if violation is None:
            return text, None
        last_violation = violation
        print(f"[assistant] ungrounded response rejected (attempt {index + 1}): "
              f"{violation} corr={correlation_id}")

    print(f"[assistant] falling back to factual line after: {last_violation} "
          f"corr={correlation_id}")
    return _deterministic_recommendation_line(candidates), "RESPONSE_UNGROUNDED"


def _deterministic_recommendation_line(candidates: list) -> str:
    """Minimal factual sentence used only when generation cannot be trusted.

    Deliberately states nothing the cards do not already show, so it cannot
    become another piece of boilerplate that repeats their contents.
    """
    count = len(candidates)
    if count == 0:
        return "I couldn't find anything deployable that fits your phone."
    if count == 1:
        return "One model matches and fits your phone."
    return f"{count} models match and fit your phone."


# ------------------------------------------------------------------
# v3 WebSocket server — phone app connects after pairing.
# Backend pushes deployment instructions; phone sends progress + heartbeats.
# ------------------------------------------------------------------

from fastapi import WebSocket, WebSocketDisconnect


class DeviceConnectionManager:
    def __init__(self):
        self.active: dict = {}

    async def connect(self, device_id: str, websocket: WebSocket):
        """Register an already-accepted socket, superseding any previous one.

        A reconnecting phone (backgrounded, network flapped, process restarted)
        can leave the old socket half-open on the server. Replacing the map
        entry without closing the old socket leaked connections and left a
        stale peer that could still receive deployment pushes, so the
        superseded socket is closed explicitly.
        """
        previous = self.active.get(device_id)
        if previous is not None and previous is not websocket:
            try:
                await previous.close(code=4000, reason="superseded by a newer connection")
            except Exception:
                pass
        self.active[device_id] = websocket

    def disconnect(self, device_id: str, websocket: Optional[WebSocket] = None):
        """Remove the socket. When `websocket` is given, only removes it if it
        is still the live one — so a late teardown from a superseded connection
        cannot evict the connection that replaced it."""
        if websocket is not None and self.active.get(device_id) is not websocket:
            return
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
    if not deployment_id or status not in ("downloading", "complete", "failed", "cancelled"):
        return

    # The deployment must belong to the device reporting on it. Without this a
    # connected device could rewrite the status, progress and error text of ANY
    # deployment in the system just by naming its id.
    try:
        async with pool.acquire() as conn:
            current_status = await conn.fetchval(
                "SELECT status FROM deployments WHERE id = $1::uuid AND device_id = $2::uuid",
                deployment_id, device_id,
            )
    except (asyncpg.PostgresError, ValueError):
        return
    if current_status is None:
        print(f"[WS] device {device_id} tried to update foreign deployment {deployment_id} — ignored")
        return

    # A user cancellation wins over a late packet from a phone that had
    # already received the deployment instruction.
    if current_status == "cancelled":
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
            elif status in ("failed", "cancelled"):
                await conn.execute(
                    "UPDATE deployments SET status = $2, progress = $3, error_message = $4 WHERE id = $1::uuid AND status <> 'cancelled'",
                    deployment_id, status, progress, error_message
                )
            else:
                await conn.execute(
                    "UPDATE deployments SET status = $2, progress = $3 WHERE id = $1::uuid",
                    deployment_id, status, progress
                )
    except (asyncpg.PostgresError, ValueError):
        pass


async def _handle_state_report(pool, device_id: str, data: dict, websocket: WebSocket):
    """Phone → server reconciliation of ACTUAL on-device state.

    Sent by the app on connect/resume. The phone previously never told the
    backend what it actually had installed, so after any missed message (offline
    window, backend restart, dropped socket) the two sides could disagree
    permanently with no way to converge. Reported state is advisory: it can only
    resolve a deployment the server already believes is in flight FOR THIS
    device, never create one or alter another device's.
    """
    reported_id = data.get("deployment_id")
    reported_status = data.get("status")

    try:
        async with pool.acquire() as conn:
            if reported_id and reported_status in ("complete", "failed"):
                row = await conn.fetchrow(
                    """SELECT id, status FROM deployments
                       WHERE id = $1::uuid AND device_id = $2::uuid""",
                    reported_id, device_id,
                )
                if row and row["status"] in ("queued", "downloading"):
                    # Server thought it was still running; the device says it
                    # finished while we weren't listening.
                    if reported_status == "complete":
                        await conn.execute(
                            "UPDATE deployments SET status='complete', progress=100, "
                            "completed_at=COALESCE(completed_at, NOW()) WHERE id=$1::uuid",
                            reported_id,
                        )
                    else:
                        await conn.execute(
                            "UPDATE deployments SET status='failed', error_message=$2 WHERE id=$1::uuid",
                            reported_id,
                            str(data.get("error_message") or "Device reported failure after reconnect")[:500],
                        )
                    deployment_status[str(reported_id)] = {
                        "status": reported_status,
                        "progress_percent": 100 if reported_status == "complete" else 0,
                        "error_message": data.get("error_message"),
                    }
                    print(f"[WS] reconciled deployment {reported_id} -> {reported_status} from device report")

            # Anything the server still believes is in flight for this device
            # that the phone did NOT mention is unresolvable from the device's
            # side; leave it for the stale-deployment timeout rather than
            # guessing.
            pending = await conn.fetch(
                """SELECT id, status FROM deployments
                   WHERE device_id = $1::uuid AND status IN ('queued', 'downloading')
                   ORDER BY deployed_at DESC LIMIT 5""",
                device_id,
            )
    except (asyncpg.PostgresError, ValueError) as e:
        print(f"[WS] state_report handling failed for {device_id}: {type(e).__name__}")
        return

    # Tell the device what the server still considers outstanding, so it can
    # resume or re-report rather than both sides waiting on each other.
    try:
        await websocket.send_text(json.dumps({
            "type": "state_ack",
            "pending_deployments": [
                {"deployment_id": str(p["id"]), "status": p["status"]} for p in pending
            ],
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }))
    except Exception:
        pass


# Largest accepted inbound WebSocket frame. Real messages are heartbeats and
# small progress updates; anything near this is abuse.
WS_MAX_MESSAGE_BYTES = 64 * 1024

# WebSocket close codes (4000-4999 is the application-defined range).
WS_CLOSE_SUPERSEDED = 4000
WS_CLOSE_UNAUTHORIZED = 4401
WS_CLOSE_MESSAGE_TOO_LARGE = 4413


@app.websocket("/ws/device/{device_id}")
async def device_websocket(websocket: WebSocket, device_id: str, token: str = ""):
    """Authenticated device socket.

    This endpoint previously accepted ANY device_id with no credential at all,
    so anyone who learned a device id could impersonate that phone: receive its
    deployment instructions, forge heartbeats to fake presence while the real
    device was offline, and corrupt deployment status. A device-scoped token
    (issued by POST /devices/pair) is now required and must match both the
    device_id in the path and a device row that still exists and is still owned
    by the user the token was minted for.
    """
    pool = websocket.app.state.pool

    owner_user_id = _verify_device_token(token, device_id) if token else None
    if not owner_user_id:
        await websocket.close(code=WS_CLOSE_UNAUTHORIZED, reason="Device authentication required")
        print(f"[WS] rejected unauthenticated connect for device {device_id}")
        return

    # The token alone is not enough: the device must still exist and still
    # belong to that user, so unpairing/deleting a device revokes its socket.
    try:
        async with pool.acquire() as conn:
            still_owned = await conn.fetchval(
                "SELECT 1 FROM devices WHERE id = $1::uuid AND user_id = $2::uuid",
                device_id, owner_user_id,
            )
    except (asyncpg.PostgresError, ValueError):
        still_owned = None
    if not still_owned:
        await websocket.close(code=WS_CLOSE_UNAUTHORIZED, reason="Device is no longer paired")
        print(f"[WS] rejected connect for unpaired/unknown device {device_id}")
        return

    await websocket.accept()
    await ws_manager.connect(device_id, websocket)
    print(f"[WS] device {device_id} connected (authenticated)")
    await _set_device_status(pool, device_id, "connected")
    await ws_manager.send_json(device_id, {
        "type": "connected",
        "device_id": device_id,
        "timestamp": datetime.now(timezone.utc).isoformat()
    })
    try:
        while True:
            raw = await websocket.receive_text()
            if len(raw) > WS_MAX_MESSAGE_BYTES:
                await websocket.close(code=WS_CLOSE_MESSAGE_TOO_LARGE, reason="Message too large")
                break
            try:
                data = json.loads(raw)
            except json.JSONDecodeError:
                await websocket.send_text(json.dumps(
                    {"type": "error", "detail": "Message was not valid JSON"}))
                continue
            if not isinstance(data, dict):
                await websocket.send_text(json.dumps(
                    {"type": "error", "detail": "Message must be a JSON object"}))
                continue
            print(f"[WS] from {device_id}: {str(data)[:200]}")
            if data.get("type") == "heartbeat":
                await _set_device_status(pool, device_id, "connected")
                await websocket.send_text(json.dumps({
                    "type": "heartbeat_ack",
                    "timestamp": datetime.now(timezone.utc).isoformat()
                }))
            elif data.get("type") == "state_report":
                await _handle_state_report(pool, device_id, data, websocket)
            elif "deployment_id" in data:
                await _handle_deployment_update(pool, device_id, data)
    except WebSocketDisconnect:
        pass
    finally:
        ws_manager.disconnect(device_id, websocket)
        print(f"[WS] device {device_id} disconnected")
        # Only flip to offline if this socket is genuinely the current one —
        # otherwise a superseded connection's teardown would mark a device
        # offline that has already reconnected.
        if ws_manager.active.get(device_id) is None:
            await _set_device_status(pool, device_id, "offline")


# ============================================================
# Phase 3 — Deployment
# ============================================================

# Deployment is wireless-only (v3). The backend resolves a CDN URL and pushes a
# deploy instruction over the authenticated device WebSocket; the phone
# downloads the model itself. The backend never touches the device directly.
#
# Removed here: the entire v2 ADB/USB cluster — _resolve_adb_path, ADB_PATH,
# push_to_device, adb_shell, check_apk_installed, install_apk,
# download_model_to_temp and run_deployment (~245 lines, with their
# subprocess/threading/shutil imports). It had ZERO call sites: run_deployment
# was the only caller of the adb helpers, and nothing called run_deployment.
# It contradicted Docs/06_RULES.md Rule 12 ("No USB, No ADB") while sitting in
# the same file as the live wireless path, and it invoked subprocess against a
# path resolved from an env var. Dead code that shells out is worth deleting
# rather than leaving for someone to re-wire by accident.

import tempfile
import hashlib

# Live in-memory progress for in-flight deployments, keyed by deployment_id.
# Written by the WebSocket progress handler and read by GET /deployments and
# GET /deployments/{id}, which is fresher than the database row while a
# download is running. It happened to be declared inside the old ADB block, so
# the first pass of that removal took it with it and every POST /deployments
# 500'd with NameError. Kept here, with the wireless path that actually uses it.
deployment_status: dict = {}


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
        # This is the last gate before a file is actually pushed to a phone, so
        # the shard exclusion is repeated here rather than trusted from the
        # search path: /deployments can be called directly with any repo id.
        candidates = [f for f in siblings
                      if f.endswith(ext) and not is_split_shard(f)]
        if not candidates:
            shards = [f for f in siblings if is_split_shard(f)]
            if shards:
                raise HTTPException(
                    status_code=422,
                    detail=(
                        f"'{hf_model_id}' is published as a multi-part model "
                        f"({len(shards)} {ext} shards). LokiAI runs single-file "
                        "models only - one part cannot be loaded on its own and "
                        "would crash the phone's runtime. Choose a single-file "
                        "model instead."
                    ),
                )
            raise HTTPException(status_code=422, detail=f"No {ext} file found in HuggingFace repo '{hf_model_id}'. Files present: {siblings[:20]}")

        sized = []
        for fname in candidates:
            head = await _hf_head(client, f"https://huggingface.co/{hf_model_id}/resolve/main/{fname}")
            cl = head.headers.get("content-length")
            if cl:
                sized.append((fname, int(cl) / (1024 * 1024)))

        if ext == ".gguf":
            too_small = [(f, s) for f, s in sized if s < MIN_CHAT_MODEL_MB]
            sized = [(f, s) for f, s in sized if s >= MIN_CHAT_MODEL_MB]
            if not sized and too_small:
                raise HTTPException(
                    status_code=422,
                    detail=(
                        f"The only .gguf files in '{hf_model_id}' are under "
                        f"{MIN_CHAT_MODEL_MB:.0f} MB "
                        f"({[(f, round(s, 1)) for f, s in too_small][:5]}), which "
                        "is too small to be a working chat model. They are most "
                        "likely fragments or adapters, not a complete model."
                    ),
                )

        fitting = [(f, s) for f, s in sized if s <= max_size_mb]
        if not fitting:
            raise HTTPException(
                status_code=422,
                detail=f"No {ext} file in '{hf_model_id}' fits the device budget of {max_size_mb:.1f} MB. Candidates: {[(f, round(s,1)) for f, s in sized]}"
            )
        # Largest variant that fits = best quality within the device budget.
        fitting.sort(key=lambda t: t[1], reverse=True)
        return fitting[0][0]




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
@limiter.limit("10/minute", key_func=_user_or_ip_key)
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
    # Ownership is checked FIRST, against the database, for every request.
    # The in-memory fast path below used to return before any such check, so
    # any authenticated user holding a deployment id could read another
    # account's live progress and error text.
    pool = request.app.state.pool
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT id, status, progress, error_message, completed_at FROM deployments WHERE id = $1::uuid AND user_id = $2::uuid",
            deployment_id, user_id
        )
        if not row:
            raise HTTPException(status_code=404, detail="Deployment not found")

        # Owner confirmed — the in-memory entry (written by the WebSocket
        # progress handler) is fresher than the row for anything still active.
        live = deployment_status.get(deployment_id)
        if live:
            return {"deployment_id": deployment_id, **live}

        return {
            "deployment_id": str(row["id"]),
            "status": row["status"],
            "error_message": row["error_message"],
            "progress_percent": 100 if row["status"] == "complete" else (row["progress"] or 0)
        }

@app.post("/deployments/{deployment_id}/cancel")
async def cancel_deployment(deployment_id: str, request: Request, user_id: str = Depends(get_current_user)):
    """Cancel an in-flight deployment owned by the signed-in user.

    The database status is changed first so a late phone update cannot revive
    it. If the phone is online, it receives a cancellation instruction to stop
    the active download and discard its partial file.
    """
    pool = request.app.state.pool
    try:
        async with pool.acquire() as conn:
            row = await conn.fetchrow(
                """UPDATE deployments
                   SET status = 'cancelled', error_message = 'Cancelled by user'
                   WHERE id = $1::uuid AND user_id = $2::uuid
                     AND status IN ('queued', 'downloading')
                   RETURNING device_id""",
                deployment_id, user_id,
            )
    except (asyncpg.PostgresError, ValueError):
        raise HTTPException(status_code=404, detail="Deployment not found")
    if not row:
        raise HTTPException(status_code=409, detail="Only queued or downloading deployments can be cancelled")

    deployment_status[deployment_id] = {
        "status": "cancelled", "progress_percent": 0,
        "error_message": "Cancelled by user",
    }
    if row["device_id"]:
        await ws_manager.send_json(str(row["device_id"]), {
            "action": "cancel_deployment", "deployment_id": deployment_id,
        })
    return {"deployment_id": deployment_id, "status": "cancelled"}


@app.get("/admin/stats")
async def get_admin_stats(request: Request, _admin: str = Depends(require_admin)):
    # Cross-tenant: returns every user's email and activity. Restricted to the
    # ADMIN_EMAILS allowlist (see require_admin) — it was previously reachable
    # with no authentication at all.
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
