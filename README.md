# People Power

People Power is a community-driven React app for creating, discovering, and discussing social movements.

This repository is now **self-hosted** and is in the middle of a backend migration. Some advanced features may be temporarily disabled while data models and endpoints are finalized.

## Tech stack

- **Frontend:** Vite + React (`src/`)
- **Backend:** Fastify (`Server/index.js`)
  - Development endpoint: `GET /movements`

## Running locally

### Prerequisites
- Node.js (recommended: current LTS)
- npm

### Install
```bash
npm install
```

### Start the backend (Fastify)
```bash
node Server/index.js
```

### Start the frontend (Vite)
```bash
npm run dev
```

Then open the URL shown in the terminal (typically `http://localhost:5173`).

## Configuration

The frontend can be pointed at a different API base URL via:

- `VITE_API_BASE_URL` (defaults to `http://localhost:3001`)

### Cloudflare Worker API (new app-owned client surface)

The newer `@/api/appClient` can be pointed at the Cloudflare Worker scaffold by setting:

- `VITE_APP_API_BASE_URL`:
  - `http://127.0.0.1:8787` (direct to Worker)
  - `relative` (use same-origin `/api/...` URLs; pairs well with the Vite proxy)

This uses the Worker routes implemented under `cloudflare/src/index.js`:

- `GET /health`
- `GET/POST/PATCH/DELETE /api/entities/:entity[/id]` (Durable Object-backed stub store)
- `POST /api/integrations/core/invoke-llm` (stub)
- `POST /api/integrations/core/upload-file` (stub)

### Run Worker locally

```bash
npm install

# Run Worker + frontend together
npm run dev:all:worker

# In the same shell session (or your .env.local), enable Worker-backed appClient
export VITE_APP_API_BASE_URL=relative
```

Tip: you can copy `.env.local.example` to `.env.local` and edit values there.

### Optional debug routes (RBAC)

For debugging role-based access control during development, the backend can expose a couple of authenticated debug endpoints.

- Disabled by default
- Enable by starting the server with `ENABLE_DEBUG_ROUTES=1`

Examples:

```bash
# Start backend with debug endpoints enabled
ENABLE_DEBUG_ROUTES=1 node Server/index.js

# Replace with a real Supabase user access token
TOKEN="<SUPABASE_USER_ACCESS_TOKEN>"

# Shows computed staff role (admin/moderator/null)
curl -sS \
  -H "Authorization: Bearer $TOKEN" \
  http://127.0.0.1:3001/__debug/whoami

# Shows report moderation capabilities derived from role
curl -sS \
  -H "Authorization: Bearer $TOKEN" \
  http://127.0.0.1:3001/__debug/rbac/reports
```

## Notes

- Some sections may show “Coming soon” while the migration is in progress.
- The app is designed to degrade gracefully (no blank screens) when optional data is missing.

## License

Add your license information here.