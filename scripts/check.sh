#!/usr/bin/env bash
set -euo pipefail

# Local/dev CI-style checks for RideIQ.
# - Web: typecheck, lint, unit tests, build
# - Contract: schema ↔ code contract check
# - Optional: Supabase DB lint + pgTAP (if Supabase CLI + Docker are available)

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if ! command -v pnpm >/dev/null 2>&1; then
  echo "pnpm is not installed. Install Node.js then run: corepack enable && corepack prepare pnpm@9.0.0 --activate" >&2
  exit 1
fi

if [ ! -d node_modules ]; then
  echo "Installing dependencies (pnpm install)..."
  pnpm install
fi

echo "Running repo checks (pnpm check)..."
pnpm check

echo "Running schema contract check..."
pnpm schema:check

echo "Attempting Supabase database lint/tests (optional)..."
if command -v supabase >/dev/null 2>&1; then
  # Note: Supabase CLI uses Docker for local dev. If Docker isn't available, these will fail.
  set +e
  supabase start >/dev/null 2>&1
  DB_STARTED=$?
  set -e

  if [ "$DB_STARTED" -eq 0 ]; then
    echo "Supabase stack started. Resetting local DB (apply migrations), then running db lint + pgTAP..."
    supabase db reset --no-seed
    supabase db lint --level error
    supabase test db
    echo "Stopping Supabase..."
    supabase stop
  else
    echo "Supabase CLI is installed but local DB could not be started (is Docker running?). Skipping db lint/tests." >&2
  fi
else
  echo "Supabase CLI not found; skipping db lint/tests. (Install: npm i -g supabase)" >&2
fi

echo "✅ All checks completed."
