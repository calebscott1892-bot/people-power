#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

header() {
  echo "===== $* ====="
}

required_env() {
  local name="$1"
  if [[ -z "${!name:-}" ]]; then
    echo "ERROR: Missing required env var: $name" >&2
    exit 1
  fi
}

have_lsof() {
  command -v lsof >/dev/null 2>&1
}

kill_listeners_best_effort() {
  local port="$1"
  if ! have_lsof; then
    return 0
  fi

  local pids
  pids="$(lsof -nP -iTCP:"$port" -sTCP:LISTEN 2>/dev/null | awk 'NR>1 {print $2}' | sort -u || true)"
  if [[ -n "$pids" ]]; then
    echo "Best-effort cleanup: killing listeners on port $port: $pids" >&2
    kill $pids 2>/dev/null || true
    sleep 0.5
    kill -9 $pids 2>/dev/null || true
  fi
}

require_no_listeners() {
  local port="$1"
  if ! have_lsof; then
    echo "Note: lsof not found; skipping port $port listener check" >&2
    return 0
  fi

  local pids
  pids="$(lsof -nP -iTCP:"$port" -sTCP:LISTEN 2>/dev/null | awk 'NR>1 {print $2}' | sort -u || true)"
  if [[ -n "$pids" ]]; then
    echo "Port $port has listeners (kill them first):" >&2
    lsof -nP -iTCP:"$port" -sTCP:LISTEN || true
    exit 1
  fi
}

expect_missing() {
  local name="$1"
  local cmd="$2"

  echo "$ ${cmd}; echo \"exit=\$?\""

  set +e
  local out
  out=$(eval "$cmd" 2>&1)
  local code=$?
  set -e

  printf '%s\n' "$out"
  echo "exit=$code"

  if [[ "$code" -ne 2 ]]; then
    echo "${name}: exit=${code} (expected 2)" >&2
    exit 1
  fi

  local expected
  expected="MISSING_DEV_DATA: run ${C4_BOOTSTRAP_COMMAND}"
  if ! printf '%s\n' "$out" | sed -E 's/[[:space:]]+$//' | grep -Fxq "$expected"; then
    echo "${name}: missing guidance line: $expected" >&2
    exit 1
  fi
}

allow_path() {
  local p="$1"
  case "$p" in
    dist/*) return 0 ;;
    "$C4_DB_PATH") return 0 ;;
    playwright-report/*) return 0 ;;
    test-results/*) return 0 ;;
    */.DS_Store|.DS_Store) return 0 ;;
    *) return 1 ;;
  esac
}

proof_e_clean_tree() {
  header "E) git status --porcelain"
  # Deterministic parsing: NUL-delimited porcelain to avoid formatting edge cases.
  # Print full human-readable porcelain only when failing.
  local touched
  touched=()
  local have_touched=0
  local pending_second=0

  while IFS= read -r -d '' token; do
    if [[ "$pending_second" -eq 1 ]]; then
      touched+=("$token")
      have_touched=1
      pending_second=0
      continue
    fi

    if [[ ${#token} -lt 4 || "${token:2:1}" != " " ]]; then
      echo "Proof E failed (unexpected -z porcelain token format)" >&2
      echo "===== E.debug) git status --porcelain =====" >&2
      git status --porcelain >&2
      printf 'token=%q\n' "$token" >&2
      exit 1
    fi

    local status="${token:0:2}"
    local path1="${token:3}"
    touched+=("$path1")
    have_touched=1

    if [[ "${status:0:1}" == "R" || "${status:0:1}" == "C" ]]; then
      pending_second=1
    fi
  done < <(git status --porcelain=v1 -z)

  if [[ "$pending_second" -eq 1 ]]; then
    echo "Proof E failed (unexpected end of rename/copy record)" >&2
    echo "===== E.debug) git status --porcelain =====" >&2
    git status --porcelain >&2
    exit 1
  fi

  local offending
  offending=()
  local p
  if [[ "$have_touched" -eq 1 ]]; then
    for p in "${touched[@]}"; do
      if [[ -n "$p" ]] && ! allow_path "$p"; then
        offending+=("$p")
      fi
    done
  fi

  if [[ ${#offending[@]} -gt 0 ]]; then
    echo "Proof E failed (unexpected working tree paths)" >&2
    echo "===== E.debug) git status --porcelain =====" >&2
    git status --porcelain >&2
    echo "===== E.debug) offending paths =====" >&2
    printf '%s\n' "${offending[@]}" >&2
    exit 1
  fi
}

required_env C4_DB_PATH
required_env C4_BACKEND_PORT
required_env C4_FRONTEND_PORT
required_env C4_HEALTH_ENDPOINT
required_env C4_BOOTSTRAP_COMMAND
required_env C4_DEV_COMMAND

MOVED=0
DB_BAK="/tmp/c4_proof_pack_db.bak"

restore_db() {
  if [[ "$MOVED" -eq 1 ]]; then
    echo "$ mv $DB_BAK $C4_DB_PATH"
    mkdir -p "$(dirname "$C4_DB_PATH")"
    mv "$DB_BAK" "$C4_DB_PATH"
    MOVED=0
  fi
}

cleanup() {
  restore_db || true
  kill_listeners_best_effort "$C4_BACKEND_PORT" || true
  kill_listeners_best_effort "$C4_FRONTEND_PORT" || true
}
trap cleanup EXIT

header "Sanity check ports"
require_no_listeners "$C4_BACKEND_PORT"
require_no_listeners "$C4_FRONTEND_PORT"

header "Preflight: require clean git working tree"
if [[ -n "$(git status --porcelain)" ]]; then
  echo "ERROR: Working tree is dirty. Commit/stash your changes and re-run." >&2
  echo "ERROR: This script must run from a clean tree." >&2
  git status --porcelain >&2
  exit 1
fi

header "npm ci (root)"
( set -x; npm ci )

header "npm ci (Server)"
( set -x; npm --prefix Server ci )

header "Playwright install (chromium)"
if [[ "$(uname -s)" == "Linux" ]]; then
  ( set -x; npx playwright install --with-deps chromium )
else
  ( set -x; npx --yes playwright install chromium )
fi

header "Step 1 — BEFORE BOOTSTRAP"
if [[ -f "$C4_DB_PATH" ]]; then
  echo "$ mv $C4_DB_PATH $DB_BAK"
  mv "$C4_DB_PATH" "$DB_BAK"
  MOVED=1
fi

# Ensure no DB exists at all during Step 1.
rm -f "$C4_DB_PATH"

expect_missing "verify-backend-contract" "node c4-proof-pack/verify-backend-contract.mjs"
expect_missing "verify-runtime" "node c4-proof-pack/verify-runtime.mjs"

header "Step 2 — AFTER BOOTSTRAP"
( set -x; bash -lc "$C4_BOOTSTRAP_COMMAND" )
( set -x; node c4-proof-pack/verify-backend-contract.mjs )
( set -x; node c4-proof-pack/verify-runtime.mjs )

header "Step 3 — Proof Pack A–G"

header "A)"
A_CMD_B64="cmcgLW4gLS1oaWRkZW4gLS1nbG9iICchLmdpdC8qKicgLWkgImJhc2U0NENsaWVudHxzdHViRGJ8dmVyaWZ5LXN0dWItY29udHJhY3R8XFxiYmFzZTQ0XFxffGJhc2U0NFxcLmNvbSIgLiB8fCB0cnVl"
A_CMD="$(printf '%s' "$A_CMD_B64" | base64 -d)"
printf '%s\n' "$ $A_CMD"
A_OUT=$(eval "$A_CMD")
printf '%s\n' "$A_OUT"
if [[ -n "$A_OUT" ]]; then
  echo "Proof A failed" >&2
  exit 1
fi

header "B)"
B_CMD_B64="cmcgLW4gLS1oaWRkZW4gLS1nbG9iICchLmdpdC8qKicgLWkgIm1vY2t8c3R1YnxmaXh0dXJlfHNlZWR8ZGVtbyBtb2RlfGdlbmVyYXRlU2FtcGxlfHJhbmRvbS4qKGRhdGF8cmVjb3JkfGVudGl0eXx1c2VyKXxwbGFjZWhvbGRlci4qKGRhdGF8cmVjb3JkfGVudGl0eXx1c2VyKXxmYWtlLiogKGRhdGF8cmVjb3JkfGVudGl0eXx1c2VyKXxsb2NhbFN0b3JhZ2UuKihtb2NrfHN0dWJ8ZGVtb3xmaXh0dXJlfGZha2UpIiBzcmMgc2VydmVyIHNjcmlwdHMgfHwgdHJ1ZQ=="
B_CMD="$(printf '%s' "$B_CMD_B64" | base64 -d)"
printf '%s\n' "$ $B_CMD"
B_OUT=$(eval "$B_CMD")
printf '%s\n' "$B_OUT"
if [[ -n "$B_OUT" ]]; then
  echo "Proof B failed" >&2
  exit 1
fi

header "C)"
( set -x; node c4-proof-pack/verify-no-direct-fetch.mjs )

header "D)"
( set -x; npm run build )

proof_e_clean_tree

header "F)"
( set -x; node c4-proof-pack/verify-backend-contract.mjs )

header "G)"
( set -x; node c4-proof-pack/verify-runtime.mjs )

echo "PROOF PACK PASSED"
