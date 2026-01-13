# C4 Proof Pack

## What this is
A deterministic CI proof system that guarantees an app is real, bootstrapped, and not fake/stubbed.

This is designed to be copied into a repo and run in CI and locally. It is intentionally strict.

## What it guarantees
- Missing data fails fast (exit code `2`) with a single deterministic guidance line.
- Bootstrap creates real data (DB must become non-empty).
- Backend and frontend are live (reachable on configured ports).
- CI never hangs (all waits are bounded; processes are cleaned up).
- Dirty trees are forbidden (only an allowlist of generated artifacts is tolerated).
- No Base44 / stubs / mocks exist (ripgrep token gates).
- No direct `fetch` / `axios` usage in `src/**` (frontend must use the project’s API client layer).

## Required configuration
Set these environment variables (in CI and locally):

- `C4_DB_PATH` — path to the dev DB file (relative to repo root or absolute)
- `C4_BACKEND_PORT` — backend port the dev server listens on
- `C4_FRONTEND_PORT` — frontend port the dev server listens on
- `C4_HEALTH_ENDPOINT` — backend health endpoint path (example: `/api/health`)
- `C4_BOOTSTRAP_COMMAND` — command that creates the dev DB + data (example: `npm run bootstrap`)
- `C4_DEV_COMMAND` — command that starts backend + frontend in dev mode (must bind the ports above)

Optional override:
- `C4_AUTH_ENDPOINT` — defaults to `/auth/me` in the verifiers

## How to integrate into a new repo
1. Copy this folder into the repo root: `c4-proof-pack/`.
2. Ensure your project’s bootstrap/dev commands honor the required `C4_*` env vars.
3. Add the GitHub Action:
   - Copy `c4-proof-pack/proof-pack.yml` to `.github/workflows/proof-pack.yml`.
   - Configure GitHub “Variables” for the required env vars (`C4_*`).
4. Run locally (from a clean tree):
   - `bash c4-proof-pack/ci-proof-pack-local.sh`
5. Expect green:
   - Step 1 must fail fast with exit code `2` and guidance line.
   - Step 2 and Proof Pack A–G must pass.

## Files
- `proof-pack.yml` — GitHub Actions workflow template
- `ci-proof-pack-local.sh` — local simulator of the CI Proof Pack
- `verify-backend-contract.mjs` — bounded backend contract verifier
- `verify-runtime.mjs` — bounded runtime verifier (backend + frontend + Playwright)
- `verify-no-direct-fetch.mjs` — forbids direct network calls in `src/**`
