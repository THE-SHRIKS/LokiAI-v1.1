-- Disposable-DB baseline schema for LokiAI, Batch 0 test infrastructure.
--
-- Reconstructed read-only, on 2026-07-27, from the LIVE production Neon
-- schema via information_schema.columns / pg_indexes / table_constraints
-- (structure only — no row data was ever read). See
-- Docs/test/LOKIAI_DEEP_AUDIT.md Section 3 for the full ownership map this
-- was derived from.
--
-- These five tables (users, devices, models, deployments, pairing_tokens)
-- have NO creation script anywhere else in the repository — production's
-- copy was created out-of-band. This file exists ONLY to stand up a
-- disposable local test database; it is never read by the application and
-- must never be pointed at production. `_run_migrations()` in main.py adds
-- the remaining tables (email_otps, password_reset_tokens, token_blacklist)
-- and later ALTERs on top of this baseline the same way it does in
-- production, on every backend boot.

CREATE EXTENSION IF NOT EXISTS pgcrypto; -- gen_random_uuid()

CREATE TABLE users (
    id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email                     TEXT NOT NULL UNIQUE,
    password_hash             TEXT NOT NULL,
    created_at                TIMESTAMPTZ DEFAULT now(),
    name                      TEXT,
    email_verified            BOOLEAN NOT NULL DEFAULT true,
    nvidia_api_key_encrypted  TEXT
);

CREATE TABLE devices (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id          UUID NOT NULL REFERENCES users(id),
    name             TEXT,
    phone_model      TEXT,
    cpu_arch         TEXT,
    ram_mb           INTEGER,
    storage_free_gb  DOUBLE PRECISION,
    android_version  TEXT,
    adb_serial       TEXT UNIQUE,
    status           TEXT DEFAULT 'paired',
    last_seen        TIMESTAMPTZ,
    paired_at        TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE models (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       UUID NOT NULL REFERENCES users(id),
    name          TEXT NOT NULL,
    hf_model_id   TEXT,
    source        TEXT NOT NULL,
    format        TEXT NOT NULL,
    size_mb       DOUBLE PRECISION,
    task_type     TEXT,
    download_url  TEXT,
    sha256        TEXT,
    created_at    TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE deployments (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id        UUID NOT NULL REFERENCES users(id),
    device_id      UUID REFERENCES devices(id),
    model_id       UUID REFERENCES models(id),
    status         TEXT DEFAULT 'queued',
    progress       INTEGER DEFAULT 0,
    config         JSONB,
    deployed_at    TIMESTAMPTZ DEFAULT now(),
    completed_at   TIMESTAMPTZ,
    error_message  TEXT
);

CREATE TABLE pairing_tokens (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES users(id),
    token       TEXT NOT NULL UNIQUE,
    used        BOOLEAN DEFAULT false,
    expires_at  TIMESTAMPTZ NOT NULL,
    created_at  TIMESTAMPTZ DEFAULT now()
);

-- email_otps, password_reset_tokens, token_blacklist are intentionally NOT
-- created here — main.py's own _run_migrations() creates them on boot,
-- exactly as it does against production. Running that function against
-- this disposable database (rather than hand-duplicating it here) is part
-- of the Batch 0 baseline test itself: it proves _run_migrations() is safe
-- and idempotent against a fresh schema, which is otherwise untested.
