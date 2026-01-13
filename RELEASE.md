# Release (Render backend + Vite frontend)

This document is the **release checklist** for People Power. It is written to minimize deployment risk and avoid regressions to `npm run proof:stability`.

## Pre-flight hygiene (must be true before any deploy)

- Working tree is clean: `git status --porcelain=v1` returns no output.
- No local artifacts are tracked in git (DBs, cookies, logs, pid files, build outputs).

### Do-not-commit artifacts

These should exist only locally and must remain ignored:

- `.env`, `.env.local`, `Server/.env`
- `cookies.txt`
- `server/*.db*`, `Server/*.db*`, `**/*.db*`
- `dist/`, `test-results/`, `playwright-report/`
- `*.log`, `*.pid`

## Local release gate (must be green)

Run from repo root:

```bash
npm ci
npm --prefix Server ci
npm run lint
npm run proof:stability
npm run build
```

Notes:
- `npm run proof:stability` enforces a **clean git tree**.
- Lint currently emits warnings but must have **0 errors**.

## Deployment architecture (current)

- Backend: Node/Fastify at `Server/index.js`.
- Frontend: Vite build output `dist/`.
- Frontend API base URL selection:
  - If `VITE_API_BASE_URL` is set at build time, the frontend uses it.
  - Otherwise, production falls back to a hard-coded Render origin in [src/api/serverBase.js](src/api/serverBase.js).

## Backend (Render) configuration

### Render service type

- **Web Service** (Node)

### Root directory

- Repo root (required because the backend depends on packages installed at the repo root, e.g. `better-sqlite3`).

### Build command

```bash
npm ci && npm --prefix Server ci
```

### Start command

```bash
node Server/index.js
```

### Health check path

- `/health`

### Required environment variables (production)

Render provides `PORT` automatically; set the rest explicitly.

- `NODE_ENV=production`
- `HOST=0.0.0.0` (Render requires binding to all interfaces; default code host is `127.0.0.1`)
- `LOG_LEVEL=info` (optional)

Database (Postgres):
- `DATABASE_URL=<Render Postgres URL>`
- `DATABASE_SSL=1` (if required by your Render Postgres settings)
- `PG_CONNECTION_TIMEOUT_MS=7000` (optional)

Supabase (Auth):
- `SUPABASE_URL=<your supabase project url>`
- `SUPABASE_ANON_KEY=<your supabase anon key>`
- `SUPABASE_AUTH_TIMEOUT_MS=7000` (optional)

CORS:
- `CORS_ORIGINS=https://<your-frontend-domain>,https://<your-frontend-domain-2>`
  - The backend already allows `peoplepower.app`, `www.peoplepower.app`, and `*.pages.dev` by hostname.
  - Add your exact production frontend origins here if you use a different domain.

Email (optional; only if enabling outbound email features):
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_SECURE`
- `RESEND_API_KEY` (if using Resend)
- `EMAIL_FROM`, `EMAIL_REPLY_TO`
- `REPORT_EMAIL_FROM`, `REPORT_EMAIL_REPLY_TO`

### Backend env vars (dev / non-prod)

- `PORT=8787` (default)
- `HOST=127.0.0.1` (default)
- `ENABLE_DEBUG_ROUTES=1` (optional)
- `DEV_ALLOW_MEMORY_MOVEMENT_MERGE=true` (optional; dev-only)

Proof-pack only (local verification; **never set in production**):
- `C4_PROOF_PACK=1`
- `C4_BACKEND_PORT=8787`
- `C4_DB_PATH=server/dev.db`

## Frontend deployment (Vite)

This repo contains Cloudflare Pages scaffolding (see [wrangler.toml](wrangler.toml)).

### Cloudflare Pages build

- Build command: `npm ci && npm run build`
- Output directory: `dist`

### Frontend environment variables (build-time)

- `VITE_API_BASE_URL=https://<your-render-backend-origin>`

Notes:
- Must be an absolute `http(s)` URL in production.
- Must not include an `/api` path prefix.

## Post-deploy smoke tests (run with curl)

Set:

```bash
BACKEND_BASE="https://<your-render-backend-origin>"
FRONTEND_ORIGIN="https://<your-frontend-origin>"
```

### 1) Health

Expected: `200` and JSON with `ok: true`.

```bash
curl -sS -D - "$BACKEND_BASE/health" -o /dev/null
curl -sS "$BACKEND_BASE/health"
```

### 2) Auth `/auth/me` (no cookie / no token)

Expected: `401` (production auth is bearer-token based; without auth it should reject).

```bash
curl -sS -D - "$BACKEND_BASE/auth/me" -o /dev/null
curl -sS "$BACKEND_BASE/auth/me"
```

### 3) One core API endpoint: movements list

Expected: `200` and JSON payload.

```bash
curl -sS -D - "$BACKEND_BASE/movements?limit=1&offset=0" -o /dev/null
curl -sS "$BACKEND_BASE/movements?limit=1&offset=0" | head
```

### 4) CORS preflight sanity

Expected (for allowed origins):
- `access-control-allow-origin: <FRONTEND_ORIGIN>`
- `access-control-allow-credentials: true`

```bash
curl -sS -i -X OPTIONS \
  -H "Origin: $FRONTEND_ORIGIN" \
  -H "Access-Control-Request-Method: GET" \
  "$BACKEND_BASE/health" | sed -n '1,120p'
```

If CORS fails:
- Ensure `CORS_ORIGINS` includes your frontend origin exactly.
- Confirm Render service is using `HOST=0.0.0.0` and is reachable.
