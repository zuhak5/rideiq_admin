# Environments

RideIQ runs in multiple environments to reduce operational risk and prevent accidental cross-environment access.

## Canonical environments

| Environment | Purpose | Supabase project | Deploy cadence |
|---|---|---|---|
| **local/dev** | Developer machines + local Supabase | local stack (Docker) | on-demand |
| **staging** | Pre-production validation | dedicated Supabase project | frequent |
| **production** | End-user traffic | dedicated Supabase project | controlled / approvals |

### Non-negotiables

- **No production secrets** in local/dev or staging.
- **No shared Supabase projects** between staging and production.
- **No secrets in frontend bundles**. Browsers only use publishable/anon keys.

## Configuration sources

### Frontend / server runtime

- Frontend apps (browser) use **anon/publishable** keys only.
- Server-side runtimes (Edge Functions, backend workers) can use **service role** keys.

Prefer environment-specific secret stores:

- **GitHub Actions Environments** (`staging`, `production`) with per-env secrets.
- Supabase **Function Secrets** for Edge Functions (`supabase secrets set ...`).

## Deploy safety and environment mismatch detection

The repo includes a CI audit (`scripts/audit-supabase-env.mjs`) intended to prevent an easy-to-make mistake:

> Deploying code to the wrong Supabase project because CI secrets were misconfigured.

The audit enforces that:

- `SUPABASE_PROJECT_REF` is present in CI deploy jobs.
- Any `https://<ref>.supabase.(co|in)` URLs embedded in `supabase/config.toml` match `SUPABASE_PROJECT_REF`.
- If `SUPABASE_URL` is provided, its host-derived project ref matches `SUPABASE_PROJECT_REF`.

## Feature flags

Feature flags should be environment-scoped:

- Staging can enable features early for QA.
- Production rollouts should include kill-switches.

## Migration promotion workflow

Follow the “expand/contract” discipline:

1. **Expand** — additive migrations (new columns/tables) that do not break old code.
2. **Switch** — deploy code that starts using the new schema.
3. **Contract** — later, remove unused fields after a stability window.

Promotion should be:

1. Apply migrations to **staging**.
2. Validate end-to-end flows.
3. Promote the exact same migrations to **production**.

See `docs/db-migrations.md` and `docs/deploy/checklist.md`.
