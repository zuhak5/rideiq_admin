# Deploy checklist

This checklist is the “muscle memory” for safe staging → production promotion.

## Before you deploy

- [ ] Identify the target environment (**staging** vs **production**).
- [ ] Confirm CI secrets are scoped to the correct GitHub Actions Environment.
- [ ] Confirm `SUPABASE_PROJECT_REF` matches the target project.
- [ ] Confirm **no production secrets** exist in staging.
- [ ] If DB changes are included, verify the migration plan is **expand → switch → contract**.

## Database migrations

Follow `docs/db-migrations.md`.

- [ ] New schema changes are in `supabase/migrations/` only.
- [ ] `supabase db reset` succeeds locally (replayable/deterministic).
- [ ] RLS policies and grants reviewed for any new tables/functions.
- [ ] Apply to **staging** first (`supabase db push --dry-run`, then `supabase db push`).
- [ ] Validate product flows against staging.
- [ ] Promote to **production** via CI with an approval gate.

## Edge Functions

- [ ] If you changed or added an Edge Function, update **all three** in the same patch:
  - [ ] `supabase/config.toml` (`verify_jwt`)
  - [ ] `supabase/functions/key-requirements.json` (required keys)
  - [ ] `config/security/edge-auth-contract.json` (required whenever `verify_jwt=false`; in this repo most functions run with `verify_jwt=false`)
- [ ] Run required audits:
  - [ ] `node scripts/audit-edge-functions.mjs`
  - [ ] `node scripts/audit-function-key-requirements.mjs`
  - [ ] `node scripts/schema-contract-check.mjs` (if present)
- [ ] Confirm webhook handlers remain **verify → persist → enqueue → respond 2xx**.
- [ ] Confirm cron endpoints require a secret header (no unauthenticated cron endpoints).

## After you deploy

- [ ] Confirm deploy target project is correct (audit step should enforce this).
- [ ] Smoke test critical flows:
  - [ ] rider signup/login
  - [ ] ride request creation
  - [ ] driver accept
  - [ ] webhook processing path (provider callback → job queue → processing)
- [ ] Check logs/alerts for elevated errors.

## Emergency rollback

When a deploy causes incidents:

- Prefer **feature flag kill-switch** first.
- Revert Edge Function changes via redeploy of last known-good commit.
- For migrations: avoid destructive rollbacks; instead deploy code that is compatible with the expanded schema.
