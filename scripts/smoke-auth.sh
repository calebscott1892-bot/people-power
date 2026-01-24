#!/usr/bin/env bash
set -eEuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

BACKEND_HOST="127.0.0.1"
BACKEND_PORT="3001"
FRONTEND_HOST="127.0.0.1"
FRONTEND_PORT="5173"

export PEOPLEPOWER_BACKEND_PORT="$BACKEND_PORT"
export C4_BACKEND_PORT="$BACKEND_PORT"

ENV_FILES_LOADED=(".env" ".env.local" "Server/.env" ".env.e2e")

print_nonsecret_diagnostics() {
  echo "[smoke][diag] envFilesLoaded=${ENV_FILES_LOADED[*]}"

  for k in VITE_SUPABASE_URL VITE_SUPABASE_ANON_KEY SUPABASE_URL SUPABASE_ANON_KEY; do
    if [ -n "${!k:-}" ]; then
      echo "[smoke][diag] ${k}_present=true"
    else
      echo "[smoke][diag] ${k}_present=false"
    fi
  done

  local hasServiceRole=false
  for k in SUPABASE_SERVICE_ROLE_KEY SUPABASE_SERVICE_KEY SUPABASE_SERVICE_ROLE SUPABASE_SERVICE; do
    if [ -n "${!k:-}" ]; then
      hasServiceRole=true
    fi
  done
  echo "[smoke][diag] SUPABASE_SERVICE_ROLE_any_present=${hasServiceRole}"
  echo "[smoke][diag] backendPortExpected=${BACKEND_PORT}"
  if curl -fsS "http://${BACKEND_HOST}:${BACKEND_PORT}/__health" >/dev/null 2>&1; then
    echo "[smoke][diag] backendHealthOnExpectedPort=true"
  else
    echo "[smoke][diag] backendHealthOnExpectedPort=false"
  fi
}

on_err() {
  local code=$?
  echo "[smoke] FAIL (exit=${code})" >&2
  print_nonsecret_diagnostics >&2
  exit "$code"
}
trap on_err ERR

load_env_file_no_override() {
  local file="$1"
  if [ ! -f "$file" ]; then
    return 0
  fi
  # shellcheck disable=SC2162
  while IFS= read -r line || [ -n "$line" ]; do
    # Trim leading/trailing whitespace
    line="${line#${line%%[![:space:]]*}}"
    line="${line%${line##*[![:space:]]}}"
    [ -z "$line" ] && continue
    case "$line" in
      \#*) continue;;
    esac
    # Allow "export KEY=..." syntax
    if [[ "$line" == export\ * ]]; then
      line="${line#export }"
      line="${line#export\t}"
    fi
    if [[ "$line" =~ ^([A-Za-z_][A-Za-z0-9_]*)=(.*)$ ]]; then
      local key="${BASH_REMATCH[1]}"
      local val="${BASH_REMATCH[2]}"
      # Don't override existing env
      if [ -n "${!key+x}" ]; then
        continue
      fi
      # Strip surrounding quotes only
      if [[ "$val" =~ ^\".*\"$ ]]; then
        val="${val:1:${#val}-2}"
      elif [[ "$val" =~ ^\'.*\'$ ]]; then
        val="${val:1:${#val}-2}"
      fi
      export "$key=$val"
    fi
  done <"$file"
}

echo "[smoke] loading env (no override): .env -> .env.local -> Server/.env -> .env.e2e"
load_env_file_no_override ".env"
load_env_file_no_override ".env.local"
load_env_file_no_override "Server/.env"
load_env_file_no_override ".env.e2e"

require_env_or_actionable_error() {
  local name="$1"
  local hintFile="$2"
  if [ -z "${!name:-}" ]; then
    echo "[smoke] ERROR: missing required env var: $name" >&2
    echo "[smoke] HINT: expected to come from $hintFile (or .env/.env.local)." >&2
    exit 2
  fi
}

require_env_or_actionable_error "VITE_SUPABASE_URL" ".env.local.example"
require_env_or_actionable_error "VITE_SUPABASE_ANON_KEY" ".env.local.example"

echo "[smoke] clean start"
BACKEND_STARTED_BY_SMOKE=0

DEV_LOG="$(mktemp -t peoplepower-smoke-backend.XXXXXX.log)"
chmod 600 "$DEV_LOG"

cleanup() {
  # Keep cleanup quiet; do not print secrets.
  if [ "$BACKEND_STARTED_BY_SMOKE" = "1" ]; then
    (kill "${BACKEND_PID:-}" >/dev/null 2>&1 || true)
    (wait "${BACKEND_PID:-}" >/dev/null 2>&1 || true)
    (pkill -f "node.*Server/index.js" || true) >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

wait_for_url() {
  local url="$1"
  local name="$2"
  local i
  for i in {1..160}; do
    if curl -fsS "$url" >/dev/null 2>&1; then
      echo "[smoke] $name is up: $url"
      return 0
    fi
    sleep 0.25
  done
  echo "[smoke] ERROR: timed out waiting for $name: $url" >&2
  return 1
}

if curl -fsS "http://${BACKEND_HOST}:${BACKEND_PORT}/__health" >/dev/null 2>&1; then
  echo "[smoke] backend already up: http://${BACKEND_HOST}:${BACKEND_PORT}"
else
  echo "[smoke] starting backend (port=$BACKEND_PORT)"
  npm run dev:server >"$DEV_LOG" 2>&1 &
  BACKEND_PID=$!
  BACKEND_STARTED_BY_SMOKE=1
  disown "$BACKEND_PID" >/dev/null 2>&1 || true
  wait_for_url "http://${BACKEND_HOST}:${BACKEND_PORT}/__health" "backend"
fi

echo "[smoke] backend startup auth line (raw):"
grep -m 1 "\[startup\]\[auth\]" "$DEV_LOG" || true

echo "[smoke] backend __health (raw):"
curl -fsS "http://${BACKEND_HOST}:${BACKEND_PORT}/__health" | cat

echo "[smoke] backend __whoami status (expect 200):"
WHOAMI_STATUS="$(curl -sS -o /dev/null -w "%{http_code}" "http://${BACKEND_HOST}:${BACKEND_PORT}/__whoami")"
echo "$WHOAMI_STATUS"
if [ "$WHOAMI_STATUS" != "200" ]; then
  echo "[smoke] ERROR: /__whoami expected 200" >&2
  exit 1
fi

echo "[smoke] PHASE 1: obtain credentials"

SERVICE_ROLE_KEY=""
for k in SUPABASE_SERVICE_ROLE_KEY SUPABASE_SERVICE_KEY SUPABASE_SERVICE_ROLE SUPABASE_SERVICE; do
  if [ -n "${!k:-}" ]; then
    SERVICE_ROLE_KEY="${!k}"
    SERVICE_ROLE_KEY_NAME="$k"
    break
  fi
done

EMAIL="${E2E_EMAIL:-${E2E_USER_EMAIL:-${E2E_ADMIN_EMAIL:-}}}"
PASSWORD="${E2E_PASSWORD:-${E2E_USER_PASSWORD:-${E2E_ADMIN_PASSWORD:-}}}"

CREDS_EMAIL_FILE="$(mktemp -t peoplepower-smoke-email.XXXXXX)"
CREDS_PASS_FILE="$(mktemp -t peoplepower-smoke-pass.XXXXXX)"
chmod 600 "$CREDS_EMAIL_FILE" "$CREDS_PASS_FILE"

if [ -n "$EMAIL" ] && [ -n "$PASSWORD" ]; then
  echo "[smoke] using existing E2E_EMAIL/E2E_PASSWORD"
  printf "%s" "$EMAIL" >"$CREDS_EMAIL_FILE"
  printf "%s" "$PASSWORD" >"$CREDS_PASS_FILE"
elif [ -n "$SERVICE_ROLE_KEY" ]; then
  echo "[smoke] creating temporary Supabase Auth user via ${SERVICE_ROLE_KEY_NAME} (no secrets logged)"
  if CREDS_EMAIL_FILE="$CREDS_EMAIL_FILE" CREDS_PASS_FILE="$CREDS_PASS_FILE" node --input-type=module <<'NODE'
import fs from 'node:fs';
import crypto from 'node:crypto';

function decodeJwtPayload(token) {
  const parts = String(token || '').split('.');
  if (parts.length < 2) return null;
  const payload = parts[1];
  const pad = '='.repeat((4 - (payload.length % 4)) % 4);
  const b64 = (payload + pad).replace(/-/g, '+').replace(/_/g, '/');
  try {
    return JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
  } catch {
    return null;
  }
}

const baseUrl = String(process.env.VITE_SUPABASE_URL || '').trim().replace(/\/$/, '');
const serviceRole = String(
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_KEY ||
  process.env.SUPABASE_SERVICE_ROLE ||
  process.env.SUPABASE_SERVICE ||
  ''
).trim();

const emailFile = String(process.env.CREDS_EMAIL_FILE || '').trim();
const passFile = String(process.env.CREDS_PASS_FILE || '').trim();

if (!baseUrl || !serviceRole || !emailFile || !passFile) {
  console.error('[smoke] ERROR: cannot create user; missing VITE_SUPABASE_URL, service role key, or temp file paths');
  process.exit(2);
}

// Only a true service-role key can hit the admin endpoint.
const role = decodeJwtPayload(serviceRole)?.role;
if (role !== 'service_role') {
  console.error('[smoke] ERROR: provided service role key is not a service_role JWT');
  process.exit(4);
}

const ts = Date.now();
const email = `pp_smoke_${ts}@example.com`;
const password = crypto.randomBytes(24).toString('base64url') + 'Aa1!';

const url = `${baseUrl}/auth/v1/admin/users`;
const res = await fetch(url, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    apikey: serviceRole,
    Authorization: `Bearer ${serviceRole}`,
  },
  body: JSON.stringify({
    email,
    password,
    email_confirm: true,
  }),
});

const text = await res.text().catch(() => '');
if (!res.ok) {
  console.error(`[smoke] ERROR: admin create user failed (status=${res.status})`);
  // Do not print body (may include details). Print length only.
  console.error(`[smoke] admin error body length=${text.length}`);
  process.exit(3);
}

fs.writeFileSync(emailFile, email, 'utf8');
fs.writeFileSync(passFile, password, 'utf8');
console.log('[smoke] temp user created');
NODE
  then
    :
  else
    echo "[smoke] admin user creation unavailable; falling back to anon sign-up"
    CREDS_EMAIL_FILE="$CREDS_EMAIL_FILE" CREDS_PASS_FILE="$CREDS_PASS_FILE" node --input-type=module <<'NODE'
import fs from 'node:fs';
import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const baseUrl = String(process.env.VITE_SUPABASE_URL || '').trim();
const anon = String(process.env.VITE_SUPABASE_ANON_KEY || '').trim();
const emailFile = String(process.env.CREDS_EMAIL_FILE || '').trim();
const passFile = String(process.env.CREDS_PASS_FILE || '').trim();

if (!baseUrl || !anon || !emailFile || !passFile) {
  console.error('[smoke] ERROR: cannot sign up; missing VITE_SUPABASE_URL/VITE_SUPABASE_ANON_KEY or temp file paths');
  process.exit(2);
}

const ts = Date.now();
const email = `pp_smoke_${ts}@example.com`;
const password = crypto.randomBytes(24).toString('base64url') + 'Aa1!';

const supabase = createClient(baseUrl, anon, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});

const { data: signUpData, error: signUpError } = await supabase.auth.signUp({ email, password });
if (signUpError) {
  console.error('[smoke] ERROR: signUp failed:', signUpError?.message || 'unknown_error');
  process.exit(3);
}

// Some projects return a session immediately; others require sign-in.
const sessionToken = signUpData?.session?.access_token;
if (!sessionToken) {
  const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({ email, password });
  if (signInError || !signInData?.session?.access_token) {
    console.error('[smoke] ERROR: signIn after signUp failed:', signInError?.message || 'no_session');
    process.exit(4);
  }
}

fs.writeFileSync(emailFile, email, 'utf8');
fs.writeFileSync(passFile, password, 'utf8');
console.log('[smoke] temp user created (anon signup)');
NODE
  fi
else
  echo "[smoke] no E2E creds and no service role key; using anon sign-up"
  CREDS_EMAIL_FILE="$CREDS_EMAIL_FILE" CREDS_PASS_FILE="$CREDS_PASS_FILE" node --input-type=module <<'NODE'
import fs from 'node:fs';
import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const baseUrl = String(process.env.VITE_SUPABASE_URL || '').trim();
const anon = String(process.env.VITE_SUPABASE_ANON_KEY || '').trim();
const emailFile = String(process.env.CREDS_EMAIL_FILE || '').trim();
const passFile = String(process.env.CREDS_PASS_FILE || '').trim();

if (!baseUrl || !anon || !emailFile || !passFile) {
  console.error('[smoke] ERROR: cannot sign up; missing VITE_SUPABASE_URL/VITE_SUPABASE_ANON_KEY or temp file paths');
  process.exit(2);
}

const ts = Date.now();
const email = `pp_smoke_${ts}@example.com`;
const password = crypto.randomBytes(24).toString('base64url') + 'Aa1!';

const supabase = createClient(baseUrl, anon, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});

const { data: signUpData, error: signUpError } = await supabase.auth.signUp({ email, password });
if (signUpError) {
  console.error('[smoke] ERROR: signUp failed:', signUpError?.message || 'unknown_error');
  process.exit(3);
}

const sessionToken = signUpData?.session?.access_token;
if (!sessionToken) {
  const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({ email, password });
  if (signInError || !signInData?.session?.access_token) {
    console.error('[smoke] ERROR: signIn after signUp failed:', signInError?.message || 'no_session');
    process.exit(4);
  }
}

fs.writeFileSync(emailFile, email, 'utf8');
fs.writeFileSync(passFile, password, 'utf8');
console.log('[smoke] temp user created (anon signup)');
NODE
fi

EMAIL="$(cat "$CREDS_EMAIL_FILE")"
PASSWORD="$(cat "$CREDS_PASS_FILE")"

echo "[smoke] PHASE 2: Supabase password sign-in (no token logging)"

# Validate supabase-js exists (already in repo deps)
node --input-type=module - <<'NODE'
await import('@supabase/supabase-js');
NODE

TOKEN_FILE="$(mktemp -t peoplepower-smoke-token.XXXXXX)"
chmod 600 "$TOKEN_FILE"

E2E_EMAIL="$EMAIL" E2E_PASSWORD="$PASSWORD" TOKEN_FILE="$TOKEN_FILE" node --input-type=module <<'NODE'
import fs from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const email = String(process.env.E2E_EMAIL || '').trim();
const password = String(process.env.E2E_PASSWORD || '').trim();
const url = String(process.env.VITE_SUPABASE_URL || '').trim();
const anon = String(process.env.VITE_SUPABASE_ANON_KEY || '').trim();
const tokenFile = String(process.env.TOKEN_FILE || '').trim();

if (!email || !password || !url || !anon || !tokenFile) {
  console.error('[smoke] ERROR: missing email/password or VITE_SUPABASE_*');
  process.exit(2);
}

const supabase = createClient(url, anon, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});

const { data, error } = await supabase.auth.signInWithPassword({ email, password });
if (error || !data?.session?.access_token) {
  console.error('[smoke] ERROR: Supabase signInWithPassword failed:', error?.message || 'no session');
  process.exit(3);
}

const token = String(data.session.access_token);
fs.writeFileSync(tokenFile, token, { encoding: 'utf8' });

const dotCount = (token.match(/\./g) || []).length;
console.log(`[smoke] tokenLen=${token.length} dotCount=${dotCount}`);
NODE

AUTH_HEADER_FILE="$(mktemp -t peoplepower-smoke-authhdr.XXXXXX)"
chmod 600 "$AUTH_HEADER_FILE"
TOKEN="$(cat "$TOKEN_FILE")"
printf "Authorization: Bearer %s\n" "$TOKEN" > "$AUTH_HEADER_FILE"

BASE="http://${BACKEND_HOST}:${BACKEND_PORT}"

echo "[smoke] PHASE 3: backend auth endpoints (raw)"

echo "[smoke] GET /__debug/auth-check"
RESP_AUTH_CHECK="$(curl -fsS -H @"$AUTH_HEADER_FILE" -H "Accept: application/json" "${BASE}/__debug/auth-check")" || {
  echo "[smoke] ERROR: /__debug/auth-check request failed" >&2
  echo "[smoke] backend startup auth line (raw):" >&2
  grep -m 1 "\[startup\]\[auth\]" "$DEV_LOG" >&2 || true
  exit 1
}
echo "$RESP_AUTH_CHECK"

RESP="$RESP_AUTH_CHECK" node --input-type=module <<'NODE'
const raw = String(process.env.RESP || '');
let j;
try { j = JSON.parse(raw); } catch {
  console.error('[smoke] ERROR: /__debug/auth-check not valid JSON');
  process.exit(1);
}
if (j?.ok !== true) {
  console.error('[smoke] ERROR: /__debug/auth-check expected ok:true');
  process.exit(1);
}
NODE

curl_json_check() {
  local url="$1"
  local label="$2"
  local tmpBody
  tmpBody="$(mktemp -t peoplepower-smoke-body.XXXXXX)"
  local status
  status="$(curl -sS -o "$tmpBody" -w "%{http_code}" -H @"$AUTH_HEADER_FILE" -H "Accept: application/json" "$url")"
  echo "[smoke] ${label} status=${status}"
  cat "$tmpBody"
  rm -f "$tmpBody"
  if [ "$status" != "200" ]; then
    echo "[smoke] ERROR: ${label} expected 200" >&2
    exit 1
  fi
}

echo "[smoke] GET /auth/me (headers + body; expect HTTP 200)"
RESP_AUTH_ME_HEADERS="$(mktemp -t peoplepower-smoke-authme.XXXXXX)"
chmod 600 "$RESP_AUTH_ME_HEADERS"
curl -sS -i -H @"$AUTH_HEADER_FILE" -H "Accept: application/json" "${BASE}/auth/me" | tee "$RESP_AUTH_ME_HEADERS"
echo

if ! grep -q "^HTTP/.* 200" "$RESP_AUTH_ME_HEADERS"; then
  echo "[smoke] ERROR: /auth/me did not return HTTP 200" >&2
  echo "[smoke] backend startup auth line (raw):" >&2
  grep -m 1 "\[startup\]\[auth\]" "$DEV_LOG" >&2 || true
  VITE_URL_HOST=""; SERVER_URL_HOST="";
  VITE_URL_HOST="$(node -p "try{new URL(process.env.VITE_SUPABASE_URL||'').host}catch(e){''}")"
  SERVER_URL_HOST="$(node -p "try{new URL(process.env.SUPABASE_URL||'').host}catch(e){''}")"
  if [ -n "$VITE_URL_HOST" ] || [ -n "$SERVER_URL_HOST" ]; then
    echo "[smoke] issuerHost(vite)=${VITE_URL_HOST:-unset} issuerHost(server)=${SERVER_URL_HOST:-unset} differs=$([ "$VITE_URL_HOST" != "$SERVER_URL_HOST" ] && echo true || echo false)" >&2
  fi
  echo "[smoke] /auth/me raw (first lines):" >&2
  head -n 25 "$RESP_AUTH_ME_HEADERS" >&2 || true
  exit 1
fi

echo "[smoke] PASS"
