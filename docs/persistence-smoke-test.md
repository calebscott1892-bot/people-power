# Persistence smoke test (REAL mode)

Goal: prove that **REAL mode** uses Postgres as the source of truth, fails fast when Postgres is unavailable, and does not silently fall back to in-memory storage.

## Preconditions

- You have a valid `Server/.env` with:
  - `DEMO_MODE=false`
  - `DATABASE_URL=postgres://...` (Supabase pooler or direct)
  - `PORT=3001` (or your preferred port)

For the “DB down at runtime” test below, also set:
- `ENABLE_DEBUG_ROUTES=true` (must be exactly `true`; dev-only; do not use in production)
- `DEBUG_ROUTE_TOKEN=<hard-to-guess value>`

And include the header on every debug request:
- `X-Debug-Token: <DEBUG_ROUTE_TOKEN>`

Notes:
- The server does **not** mutate `DATABASE_URL`. Instead it parses `sslmode` and builds explicit Node `pg` SSL options so behavior is portable and predictable.

## Start backend (REAL mode)

From repo root:

- `npm run dev:server`

Expected startup output includes:
- `[storage] mode=postgres database_host=...`
- `People Power API listening on http://0.0.0.0:3001`

## Verify health + status

Use `curl.exe` on Windows (PowerShell `curl` is usually an alias):

- `curl.exe -sS http://127.0.0.1:3001/health`
  - Expect: `{ "ok": true, ... }`

- `curl.exe -sS http://127.0.0.1:3001/status`
  - Expect:
    - `"demoMode": false`
    - `"storageMode": "postgres"`
    - `"dbOk": true`

## Persistence contract (server)

In REAL mode (`DEMO_MODE=false`):
- Startup must fail fast if Postgres is missing/unreachable.
- If Postgres becomes unavailable at runtime, requests must not fall back to memory; return `503 STORAGE_UNAVAILABLE`.

In DEMO mode (`DEMO_MODE=true`):
- In-memory storage is allowed (ephemeral) and may be used as a fallback when DB is unavailable.

### Contract matrix (high level)

This is the intended contract for core data domains:

| Domain | Example endpoints | REAL mode source of truth | DEMO mode behavior |
|---|---|---|---|
| Movements | `GET /movements`, `POST /movements`, `GET /movements/:id` | Postgres | Memory-backed demo store allowed |
| Movement follows/votes | `POST /movements/:id/follow`, `POST /movements/:id/vote` | Postgres | Memory-backed demo store allowed |
| Movement content | comments/resources/evidence/events/petitions/tasks/discussions | Postgres | Memory-backed demo store allowed |
| Reports | `POST /reports`, `GET /reports` | Postgres | May allow demo fallback (ephemeral) |
| Incidents | `POST /incidents`, admin incident views | Postgres | May allow demo fallback (ephemeral) |
| Messaging | conversations/messages/reactions | Postgres | May allow demo fallback (ephemeral) |

## Negative test: DB unavailable

### Test A: fail-fast on startup

1) Temporarily break `DATABASE_URL` in `Server/.env` (e.g. change host to an invalid value).
2) Start the server:
   - `npm run dev:server`

Expected:
- The process exits non-zero.
- Logs contain a fatal storage message indicating Postgres connection failure and `DEMO_MODE=false`.

### Test B: no silent fallback at runtime

This repo includes a dev-only debug toggle that simulates the DB going down **while the server stays running**.

1) Start the server in REAL mode (`DEMO_MODE=false`) with `ENABLE_DEBUG_ROUTES=true`.

2) Confirm the simulator is currently off:
- `curl.exe -sS http://127.0.0.1:3001/__debug/storage/simulated-down -H "X-Debug-Token: <DEBUG_ROUTE_TOKEN>"`
  - Expect: `{ "ok": true, "simulatedDbDown": false }`

3) Turn the simulator on:
- `curl.exe -sS -X POST http://127.0.0.1:3001/__debug/storage/simulated-down -H "X-Debug-Token: <DEBUG_ROUTE_TOKEN>" -H "Content-Type: application/json" -d "{\"down\":true}"`
  - Expect: `{ "ok": true, "simulatedDbDown": true }`

4) Hit a storage-backed endpoint that does not require auth:
- `curl.exe -i http://127.0.0.1:3001/movements`

Expected:
- HTTP `503`
- JSON body includes:
  - `error: "STORAGE_UNAVAILABLE"`
  - `detail: "Postgres query failed"`

Optional (authenticated write example):
- Set a token: `$env:PP_AUTH_TOKEN = "<your supabase jwt>"`
- `curl.exe -i -X PATCH http://127.0.0.1:3001/me/profile -H "Authorization: Bearer $env:PP_AUTH_TOKEN" -H "Content-Type: application/json" -d "{\"display_name\":\"Smoke Test\"}"`
  - Expect: HTTP `503` + `STORAGE_UNAVAILABLE`

5) Turn the simulator back off:
- `curl.exe -sS -X POST http://127.0.0.1:3001/__debug/storage/simulated-down -H "X-Debug-Token: <DEBUG_ROUTE_TOKEN>" -H "Content-Type: application/json" -d "{\"down\":false}"`

6) Confirm the endpoint works again:
- `curl.exe -i http://127.0.0.1:3001/movements`
  - Expect: HTTP `200`
