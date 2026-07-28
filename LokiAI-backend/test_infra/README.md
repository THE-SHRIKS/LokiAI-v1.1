# Batch 0 disposable test database

Created 2026-07-27 for `LOKIAI_IMPLEMENTATION_PLAN.md` Batch 0. Everything in this
directory is throwaway test infrastructure — never used by the real application,
never deployed, never committed with its binaries/data (see `.gitignore`).

Docker Desktop's engine would not start on this machine (`ERROR: Docker Desktop
is unable to start`), so `docker-compose.test.yml` is kept for reference /
a future machine where Docker works, but the database actually used for Batch 0
was a portable local PostgreSQL 18.4.0 (official Windows binaries from
`theseus-rs/postgresql-binaries` on GitHub, sha256-verified against the
release's published checksum before extracting).

## To bring it up again (portable-binary path — what was actually used)

```bash
cd LokiAI-backend/test_infra

# one-time setup (already done, kept here for reproducibility):
#   1. download+verify postgresql-18.4.0-x86_64-pc-windows-msvc.zip from
#      https://github.com/theseus-rs/postgresql-binaries/releases/tag/18.4.0
#   2. extract to pg_portable/
#   3. "$PGROOT/bin/initdb.exe" -D pgdata -U lokiai_test --auth=trust -E UTF8

PGROOT="pg_portable/postgresql-18.4.0-x86_64-pc-windows-msvc"
"$PGROOT/bin/pg_ctl.exe" -D pgdata -l pg_log.txt -o "-p 5433 -h 127.0.0.1" start
"$PGROOT/bin/createdb.exe" -h 127.0.0.1 -p 5433 -U lokiai_test lokiai_test   # first time only
"$PGROOT/bin/psql.exe" -h 127.0.0.1 -p 5433 -U lokiai_test -d lokiai_test -f schema_baseline.sql  # first time only

# to stop:
"$PGROOT/bin/pg_ctl.exe" -D pgdata stop
```

Connection string: `postgresql://lokiai_test@127.0.0.1:5433/lokiai_test` (no
password, `auth=trust`, bound to `127.0.0.1` only — never exposed beyond
localhost, never a real secret).

## To boot the real backend against it (without touching the real `.env`)

Export these in the shell **before** starting uvicorn — `main.py`'s
`load_dotenv()` only fills in variables not already set, so anything exported
here overrides the real `.env` file for that process without editing it:

```bash
export DATABASE_URL="postgresql://lokiai_test@127.0.0.1:5433/lokiai_test"
export JWT_SECRET_KEY="batch0-disposable-test-secret-not-used-in-production"
export CORS_ALLOWED_ORIGINS="http://localhost:8080,http://127.0.0.1:8080"
export DASHBOARD_URL="http://localhost:8080"
# IMPORTANT: poison these, don't unset them — unsetting lets load_dotenv()
# backfill the REAL production values from .env (this is exactly what went
# wrong the first time — see LOKIAI_TEST_AND_CHANGE_AUDIT.md Entry 2).
export SMTP_HOST="smtp.invalid.batch0test"
export SMTP_USER="batch0"
export SMTP_PASSWORD="batch0"
export SMTP_FROM_EMAIL="batch0@invalid.test"
export EMAIL_RELAY_URL=""
export EMAIL_RELAY_SECRET=""
export NVIDIA_API_KEY=""
export BACKEND_PUBLIC_URL=""
export APK_DOWNLOAD_URL=""

cd ../  # LokiAI-backend/
./venv/Scripts/python.exe -m uvicorn main:app --host 127.0.0.1 --port 8000
```

## Known gap

`pgserver` (a pip package that would have made this a one-line `pip install`)
does not ship wheels for Python 3.14, which is what this machine's default
Python is (`C:\Python314`). Its newest supported version is 3.12. The
project's own backend venv is also on 3.14. If a lower Python is ever
available, `pip install pgserver` is a simpler alternative to the manual
portable-binary steps above.
