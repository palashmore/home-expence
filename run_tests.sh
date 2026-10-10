#!/usr/bin/env bash
# Runs the Node API test suites against a throwaway copy of data/.
#
# Safety guarantees:
#   - data/ is copied to a scratch dir; the real files are never opened for write
#   - CLOUD_SYNC_DISABLED=1 so nothing reaches the shared GitHub Gist
#   - the scratch dir is removed on exit, success or failure
#
# Usage: bash ./run_tests.sh [suite ...]      (default: every suite)
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$REPO_ROOT"

# Snapshot the working tree so the guard can tell "already dirty" from
# "this run dirtied it".
BEFORE_SNAPSHOT="$(git status --porcelain=v1 2>/dev/null | sort)"

SCRATCH="$(mktemp -d "${TMPDIR:-/tmp}/homeexp_tests_XXXXXX")"
PORT="${TEST_PORT:-8000}"
SERVER_PID=""

cleanup() {
    if [ -n "$SERVER_PID" ] && kill -0 "$SERVER_PID" 2>/dev/null; then
        kill "$SERVER_PID" 2>/dev/null || true
        wait "$SERVER_PID" 2>/dev/null || true
    fi
    rm -rf "$SCRATCH"
}
trap cleanup EXIT INT TERM

echo "=============================================="
echo " HOME EXPENCE :: API TEST SUITES"
echo "=============================================="
echo "scratch data : $SCRATCH/data"
echo "port         : $PORT"
echo "cloud sync   : DISABLED"
echo

# --- 1. scratch copy of the real data --------------------------------------
mkdir -p "$SCRATCH/data" "$SCRATCH/tmp"
cp -R data/. "$SCRATCH/data/"

export HOMEEXPENSES_DATA_DIR="$SCRATCH/data"
export HOMEEXPENSES_TMP_DIR="$SCRATCH/tmp"
export CLOUD_SYNC_DISABLED=1
export JWT_SECRET="${JWT_SECRET:-test-only-secret-not-for-production-use-32ch}"
export PORT="$PORT"
export NODE_ENV=test

# --- 2. boot the server ----------------------------------------------------
node server.js > "$SCRATCH/server.log" 2>&1 &
SERVER_PID=$!

echo -n "waiting for server "
for _ in $(seq 1 60); do
    if curl -sf -o /dev/null "http://localhost:$PORT/api/auth?action=ping" 2>/dev/null \
       || curl -s -o /dev/null "http://localhost:$PORT/" 2>/dev/null; then
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

# --- 3. run the suites -----------------------------------------------------
if [ "$#" -gt 0 ]; then
    SUITES=("$@")
else
    SUITES=(test_boot_suite.js test_cloud_recovery_suite.js test_verification_suite.js test_master_settings_and_expenses.js test_config_rules_suite.js test_dashboard_config_suite.js test_password_suite.js test_notifications_suite.js test_permissions_suite.js test_production_correction_suite.js)
fi

FAILED=0
declare -a RESULTS=()

for suite in "${SUITES[@]}"; do
    if [ ! -f "$suite" ]; then
        echo "!! missing suite: $suite"
        RESULTS+=("MISSING  $suite")
        FAILED=1
        continue
    fi
    echo "----------------------------------------------"
    echo ">> $suite"
    echo "----------------------------------------------"
    if node "$suite"; then
        RESULTS+=("PASS     $suite")
    else
        RESULTS+=("FAIL     $suite")
        FAILED=1
    fi
    echo
done

# --- 4. verify the run touched no tracked file -------------------------------
# Compared against a snapshot taken BEFORE the run, not against HEAD: work in
# progress is normal, a file the RUN changed is not. Checking against HEAD
# would flag every uncommitted edit and quickly be ignored.
#
# This used to watch only data/, which is how api/_db.js writing
# initial_expenses.json at the repository root went unnoticed - a test run
# silently edited a tracked file and the suite reported "data/ untouched".
AFTER_SNAPSHOT="$(git status --porcelain=v1 2>/dev/null | sort)"
if [ "$AFTER_SNAPSHOT" != "$BEFORE_SNAPSHOT" ]; then
    echo "!! FATAL: the run modified tracked files in the repository"
    diff <(printf '%s
' "$BEFORE_SNAPSHOT") <(printf '%s
' "$AFTER_SNAPSHOT") || true
    FAILED=1
else
    RESULTS+=("PASS     repository untouched")
fi

echo "=============================================="
echo " SUMMARY"
echo "=============================================="
for r in "${RESULTS[@]}"; do echo "  $r"; done
echo

if [ "$FAILED" -ne 0 ]; then
    echo "RESULT: FAILED"
    echo "(server log: tail below)"
    tail -30 "$SCRATCH/server.log" 2>/dev/null || true
    exit 1
fi

echo "RESULT: ALL SUITES PASSED"
