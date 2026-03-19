# Security notes

## Data / persistence model (production)
- **Primary database:** Render-hosted Postgres (accessed by the Node/Fastify backend in `Server/index.js`).
- **Supabase:** Used for **Auth only** (access tokens validated server-side via Supabase Auth; the frontend uses Supabase JS for sign-in/sign-up/session refresh).
- **Supabase Postgres tables:** Not intended to be a source of truth for app data. If Supabase dashboard warns about RLS disabled on legacy `public.*` tables, treat those warnings as applying to **unused legacy tables** unless you intentionally re-enable Supabase DB usage.

## Production safety (no silent fallbacks)
- Production must not serve user-visible state from local/memory stubs when the DB/API is unavailable.
- Backend routes should return **5xx** on DB failures (or **503 STORAGE_UNAVAILABLE** when DB is unavailable) rather than returning “fake success” from in-memory fallback.

## Secrets & history rewrite
- Secrets (env files, connection strings, API keys) were previously committed.
- Git history was rewritten to remove env files and `node_modules` artifacts.

Recommended follow-through:
- Rotate **Render Postgres** credentials (`DATABASE_URL` user/password).
- Rotate **Supabase** keys (anon/public, service role if ever present).
- Rotate any third-party API keys that may have lived in `.env` (e.g. email provider, payment keys, etc.).

## Local-only pre-commit guard
A local git hook is installed at `.git/hooks/pre-commit` to reduce the risk of accidentally committing secrets.
- This is **local-only** and is not intended to run in CI.
- It blocks committing `.env`-like files and staged content that looks like common secret/URL patterns.
