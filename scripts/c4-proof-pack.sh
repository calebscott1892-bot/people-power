#!/usr/bin/env bash
set -euo pipefail

# This runs the full C4 Proof Pack locally (CI-equivalent).
# You MUST export the C4_* env vars before running.

bash c4-proof-pack/ci-proof-pack-local.sh
