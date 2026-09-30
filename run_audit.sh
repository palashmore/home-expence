#!/usr/bin/env bash
# Runs the mobile UI audit against a throwaway copy of data/.
#
# Same safety guarantees as run_tests.sh: scratch data dir, cloud sync off,
# real data/ verified untouched afterwards.
#
# Usage: bash ./run_audit.sh [--headed]
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$REPO_ROOT"

SCRATCH="$(mktemp -d "${TMPDIR:-/tmp}/homeexp_audit_XXXXXX")"
PORT="${AUDIT_PORT:-8011}"
SERVER_PID=""

cleanup() {
    if [ -n "$SERVER_PID" ] && kill -0 "$SERVER_PID" 2>/dev/null; then
        kill "$SERVER_PID" 2>/dev/null || true
        wait "$SERVER_PID" 2>/dev/null || true
    fi
    rm -rf "$SCRATCH"
}
trap cleanup EXIT INT TERM

PY="${PYTHON:-python}"
if ! "$PY" -c "import playwright" 2>/dev/null; then
    echo "!! Playwright for Python is not installed."
    echo "   python -m pip install playwright && python -m playwright install chromium"
    exit 1
fi

echo "=============================================="
echo " HOME EXPENCE :: MOBILE UI AUDIT"
echo "=============================================="
echo "scratch data : $SCRATCH/data"
echo "port         : $PORT"
echo "cloud sync   : DISABLED"
echo

mkdir -p "$SCRATCH/data" "$SCRATCH/tmp"
cp -R data/. "$SCRATCH/data/"

export HOMEEXPENSES_DATA_DIR="$SCRATCH/data"
export HOMEEXPENSES_TMP_DIR="$SCRATCH/tmp"
export CLOUD_SYNC_DISABLED=1
export JWT_SECRET="${JWT_SECRET:-test-only-secret-not-for-production-use-32ch}"
export PORT="$PORT"
export NODE_ENV=test
export AUDIT_BASE_URL="http://localhost:$PORT"

node server.js > "$SCRATCH/server.log" 2>&1 &
SERVER_PID=$!

echo -n "waiting for server "
for _ in $(seq 1 60); do
    if curl -s -o /dev/null "http://localhost:$PORT/" 2>/dev/null; then
        echo "up (pid $SERVER_PID)"
        break
    fi
    if ! kill -0 "$SERVER_PID" 2>/dev/null; then
        echo
        echo "SERVER DIED ON STARTUP:"
        cat "$SCRATCH/server.log"
        exit 1
    fi
    echo -n "."
    sleep 0.5
done
echo

"$PY" audit_mobile_flows.py --json-out "$SCRATCH/audit.json" "$@"
AUDIT_RC=$?

if ! git diff --quiet -- data/ 2>/dev/null; then
    echo
    echo "!! FATAL: the audit modified tracked files in data/"
    git diff --stat -- data/
    AUDIT_RC=1
else
    echo
    echo "  OK   real data/ untouched"
fi

if [ "$AUDIT_RC" -ne 0 ]; then
    echo "RESULT: AUDIT FAILED"
    exit 1
fi
echo "RESULT: AUDIT CLEAN"
