# REAL mode manual smoke test (persistence)

Assumptions:
- Backend is running with DEMO_MODE=false and a working DATABASE_URL.
- Supabase RLS on public.user_profiles is enabled with policies requiring (auth.uid())::text = id for SELECT/INSERT/UPDATE/DELETE.
- The server’s /me/profile handlers write user_profiles.id as the authenticated Supabase user id (string), so writes comply with RLS.

## 0) Start the backend (REAL mode)

1. Create a backend env file at Server/.env (this file is intentionally git-ignored).
2. Set at minimum:
   - DEMO_MODE=false
   - DATABASE_URL=... (Postgres connection string)
   - SUPABASE_URL=...
   - SUPABASE_ANON_KEY=...
3. From the repo root, start the backend:
   - npm run dev:server

Useful health checks:
- `GET http://localhost:3001/health`
- GET http://localhost:3001/status (watch demoMode=false, storageMode=postgres, dbOk=true)

## 1) Start the frontend

4. From the repo root, start the frontend:
   - npm run dev:client

(Or start both together: npm run dev:all.)

Open the app:
- `http://localhost:5173`

## 2) Login (Supabase Auth)

5. Go to `/login` in the UI and sign in.
   - Frontend auth uses Supabase JS; the backend uses the access token to authorize requests.

## 3) Profile persistence (RLS-aligned)

6. Go to the Profile screen: `/profile`.
   - Expected backend call: GET /me/profile.
   - Note: if a profile row did not exist, the server may auto-create one with id = auth.uid()::text.
     (Per your current DB status, you already have a 1:1 auth.users ↔ user_profiles match, so this should normally just load.)

7. Edit something in your profile (display name / username / bio) and save.
   - Expected backend call: POST /me/profile.

8. Verify persistence across **reloads**:
   - Hard reload the page (Ctrl+R) and confirm the profile fields are unchanged.
   - Expected backend call: GET /me/profile.

9. Verify persistence across **server restarts**:
   - Stop the backend (Ctrl+C) and re-run npm run dev:server.
   - Reload `/profile` and confirm the profile is still the same.

10. Verify persistence across **another browser / incognito**:
   - Open an incognito window, log in as the same user, open `/profile`.
   - Confirm you see the same profile values.

## 4) Movements persistence

11. Create a movement via `/create-movement`.
   - Expected backend call: POST /movements.

12. Return to the home feed (`/`) and confirm it appears.
   - Expected backend call: GET /movements.

13. Click into the movement detail page (`/movements/:id`).
   - Expected backend call: GET /movements/:id (some clients can fall back to list lookup if needed).

## 5) Comments persistence

14. Add a comment on the movement.
   - Expected backend call: POST /movements/:id/comments.

15. Refresh the movement detail page and confirm the comment is still there.
   - Expected backend call: GET /movements/:id/comments.

16. Restart the backend again and confirm the comment persists.

## 6) Impact updates (optional)

17. If the movement UI exposes “impact updates”, create one and confirm it persists.
   - Expected backend calls:
   - POST /movements/:id/impact
   - GET /movements/:id/impact

## 7) Follow state (optional)

18. Follow the movement (or toggle follow state) and confirm the follower count.
   - Expected backend calls:
   - POST /movements/:id/follow
   - GET /movements/:id/follow and/or GET /movements/:id/follow/count

19. Restart backend + refresh and confirm follow state is unchanged.

## 8) What “DB broken” should look like (REAL mode)

These checks are to validate the **new behavior**: no silent memory fallback.

20. With `DEMO_MODE=false`, intentionally break `DATABASE_URL` (e.g., typo the host) and restart the backend.
   - Expected: **startup fails fast** (server should not quietly switch to memory mode).

21. If Postgres becomes unreachable while the server is running, routes that need storage should return:
   - HTTP 503 with {"error":"STORAGE_UNAVAILABLE"} (and possibly a detail field).

22. Confirm GET /status shows dbOk=false when Postgres is down.

## Quick UI → backend route map (reference)

- Health/status checks
   - /health → GET /health
   - (any browser) → GET /status
- Profile
   - /profile → GET /me/profile
   - Profile save → POST /me/profile
- Movements
   - Home feed (/) → GET /movements
   - Create movement (/create-movement) → POST /movements
   - Movement detail (/movements/:id) → GET /movements/:id
- Comments
   - Movement detail comments load → GET /movements/:id/comments
   - Add comment → POST /movements/:id/comments
- Impact updates (if enabled in UI)
   - Load impact updates → GET /movements/:id/impact
   - Add impact update → POST /movements/:id/impact
- Follow state
   - Follow toggle → POST /movements/:id/follow
   - Follow state/count → GET /movements/:id/follow and/or GET /movements/:id/follow/count
