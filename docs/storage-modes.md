# Storage modes (REAL vs DEMO)

This backend supports **two modes** controlled by `DEMO_MODE`.

## REAL mode (`DEMO_MODE=false`)

- **Postgres is required.** The server expects `DATABASE_URL` to be present and reachable.
- **No in-memory fallbacks.** Any code paths that would otherwise serve “memory data” are blocked.
- **Failure behavior:**
  - If `DATABASE_URL` is missing (or the Postgres pool cannot be initialized), the server **fails fast on startup**.
  - If Postgres becomes unavailable at runtime, affected routes return **`503`** with `{"error":"STORAGE_UNAVAILABLE"}` via the server’s `sendStorageUnavailable(...)` helper.

## DEMO mode (`DEMO_MODE=true`)

- The server may use **in-memory** storage for various entities.
- This is intended for development/demo environments where persistence is not required.

## How the server decides

- `DEMO_MODE` is read from `process.env.DEMO_MODE`.
- `DATABASE_URL` is read from `process.env.DATABASE_URL`.
- You can also check runtime state via:
  - `GET /status` (returns `storageMode`, `demoMode`, `hasDatabaseUrl`, `dbOk`)
  - `GET /debug/storage-mode`

## Notes for Supabase

- The server validates Supabase access tokens server-side, so it also requires:
  - `SUPABASE_URL`
  - `SUPABASE_ANON_KEY`
