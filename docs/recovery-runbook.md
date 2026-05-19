# People Power Recovery Runbook

This runbook is for getting People Power working before paying to restore the
current production infrastructure.

## Current Known Blockers

- `https://people-power.onrender.com/health` returns Render `503 Service Unavailable`
  with `x-render-routing: suspend`.
- The backend `DATABASE_URL` currently points at a Render Postgres host, and local
  connection attempts fail with `Connection terminated unexpectedly`.
- The configured Supabase project host does not currently resolve from this machine.
- There is no `render.yaml`, Dockerfile, Procfile, or Supabase config directory in
  this repo, so hosted infrastructure is controlled mostly from dashboards and env
  vars.

## First Check

Run:

```powershell
npm run doctor
```

This checks dependency folders, backend health, backend DB status, Supabase DNS,
Supabase auth health, and the database host. It redacts secrets.

## No-Pay Local Proof

Use this path to prove login, DMs, comments, follows, and votes before paying to
restore production services.

Prerequisites:

- Node.js
- Docker Desktop
- Supabase CLI

Install dependencies:

```powershell
npm ci
npm --prefix Server ci
```

Start local Supabase:

```powershell
supabase start
supabase status
```

The repo includes `supabase/config.toml` for local development. It is safe to
commit because it contains local ports and settings, not hosted project secrets.

Copy these values from `supabase status`:

- API URL
- anon key
- service role key
- DB URL

Set root `.env.local`:

```env
VITE_API_BASE_URL=http://127.0.0.1:3001
VITE_BACKEND_BASE=http://127.0.0.1:3001
VITE_SUPABASE_URL=http://127.0.0.1:54321
VITE_SUPABASE_ANON_KEY=<local anon key>
```

Set `Server/.env`:

```env
PORT=3001
HOST=127.0.0.1
DATABASE_URL=<local DB URL>
SUPABASE_URL=http://127.0.0.1:54321
SUPABASE_ANON_KEY=<local anon key>
SUPABASE_SERVICE_ROLE_KEY=<local service role key>
ADMIN_EMAILS=<your email>
```

Start backend:

```powershell
npm --prefix Server run dev
```

Start frontend:

```powershell
$env:VITE_BACKEND_BASE="http://127.0.0.1:3001"
npx vite --host 127.0.0.1 --port 5173
```

If you do not want to write env files yet, set the same values only in the
current PowerShell session before starting each process. `scripts/doctor.mjs`
allows process env to override `.env` files, so local checks can target the
temporary stack without changing saved secrets.

Verify:

```powershell
curl.exe http://127.0.0.1:3001/health
curl.exe http://127.0.0.1:3001/__db
npm run doctor
```

Expected:

- `/health` returns HTTP 200.
- `/__db` shows `dbReady:true`.
- `npm run doctor` reports backend and Supabase as reachable.

Auth and realtime smoke tests:

```powershell
npm run e2e:auth
```

For cross-process DM sync, start a second backend on another local port against
the same local Supabase database, then point the smoke at both origins:

```powershell
$env:E2E_SENDER_BACKEND_BASE="http://127.0.0.1:3001"
$env:E2E_RECEIVER_BACKEND_BASE="http://127.0.0.1:3012"
npm run smoke:realtime
```

Manual two-user test:

1. Open `http://127.0.0.1:5173` in a normal browser window.
2. Open the same URL in a private/incognito window.
3. Create or sign into two separate users.
4. Test direct messages both ways.
5. Test message reactions.
6. Test group DM create, settings edit, and participant changes.
7. Test follow/unfollow, vote/boost, and comment posting.
8. Confirm the other browser updates without a manual refresh.

## Free Hosted Staging

Use this only after local proof works.

Backend option:

- Render free web service.
- Root Directory: `Server`
- Build Command: `npm ci`
- Start Command: `npm start`
- Health Check Path: `/health`

Database/auth option:

- New Supabase free project, or another free Postgres provider plus Supabase for auth.
- Keep this as staging data only.

Frontend option:

- Any static host that can run `npm ci && npm run build` and publish `dist`.

Frontend build env:

```env
VITE_API_BASE_URL=https://<staging-backend-origin>
VITE_SUPABASE_URL=https://<project-ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon key>
VITE_ADMIN_EMAILS=<admin emails>
```

Backend env:

```env
NODE_ENV=production
DATABASE_URL=<postgres connection string>
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_ANON_KEY=<anon key>
SUPABASE_SERVICE_ROLE_KEY=<service role key>
ADMIN_EMAILS=<admin emails>
CORS_ORIGINS=https://<frontend-origin>
```

## Production Restore

Only do this after local or free staging passes the manual two-user test.

1. Resume or replace the Render backend service.
2. Resume or replace the Render Postgres database referenced by `DATABASE_URL`.
3. Restore or replace the Supabase project referenced by `SUPABASE_URL`.
4. Rebuild frontend with production env.
5. Verify:

```powershell
curl.exe -i https://people-power.onrender.com/health
curl.exe -i https://people-power.onrender.com/__db
curl.exe -i https://<project-ref>.supabase.co/auth/v1/health
```

Production is not recovered until backend health is 200, `__db` shows
`dbReady:true`, and Supabase DNS/auth health resolve.
