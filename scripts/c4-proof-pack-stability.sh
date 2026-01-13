#!/usr/bin/env bash
set -euo pipefail

# Standard C4 Proof Pack env vars
export C4_DB_PATH="server/dev.db"
export C4_BACKEND_PORT="8787"
export C4_FRONTEND_PORT="5173"
export C4_HEALTH_ENDPOINT="/api/health"
export C4_BOOTSTRAP_COMMAND="npm run bootstrap"
export C4_DEV_COMMAND="npm run dev"

for n in 1 2 3 4 5; do
  echo "=== RUN $n ==="
  LOG="/tmp/c4-proof-pack.stability.$n.log"
  rm -f "$LOG"
  bash scripts/c4-proof-pack.sh >"$LOG" 2>&1
  code=$?
  echo "exit=$code"
  tail -n 40 "$LOG"
  echo
  if [ "$code" -ne 0 ]; then
    echo "FAILED on run $n (see $LOG)"
    exit "$code"
  fi
done
echo "ALL RUNS PASSED"
