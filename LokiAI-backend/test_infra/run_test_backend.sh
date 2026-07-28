#!/usr/bin/env bash
# Boot the real backend against the DISPOSABLE test database.
#
# Every variable main.py reads from .env is explicitly SET here (to an inert
# value where the real one must not be used). Do NOT `unset` these — main.py
# calls load_dotenv(), which only fills in variables that are not already set,
# so unsetting silently restores the REAL production values from .env.
# See Docs/test/LOKIAI_TEST_AND_CHANGE_AUDIT.md Entry 2 §6.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND="$(cd "$HERE/.." && pwd)"

export DATABASE_URL="postgresql://lokiai_test@127.0.0.1:5433/lokiai_test"
export JWT_SECRET_KEY="batch0-disposable-test-secret-not-used-in-production"
export CORS_ALLOWED_ORIGINS="http://localhost:8080,http://127.0.0.1:8080"
export DASHBOARD_URL="http://localhost:8080"

# Inert, unresolvable values — never the real credentials.
export SMTP_HOST="smtp.invalid.batch0test"
export SMTP_PORT="587"
export SMTP_USER="batch0"
export SMTP_PASSWORD="batch0"
export SMTP_FROM_EMAIL="batch0@invalid.test"
export SMTP_FROM_NAME="LokiAI Test"
export EMAIL_RELAY_URL=""
export EMAIL_RELAY_SECRET=""
export NVIDIA_API_KEY=""
export BACKEND_PUBLIC_URL=""
export APK_DOWNLOAD_URL=""
export APK_SIZE_MB=""
export ADMIN_EMAILS="${ADMIN_EMAILS:-}"

cd "$BACKEND"
exec ./venv/Scripts/python.exe -m uvicorn main:app --host 127.0.0.1 --port 8000 "$@"
