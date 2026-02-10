# Database migrations (Supabase)

This project tracks all database schema changes as **SQL migrations** in `supabase/migrations/`.

**Primary rule:** do **not** make ad-hoc schema changes in production via the Supabase Dashboard SQL editor. Always create a migration, test it locally, then deploy via the CLI/CI to avoid schema drift.

## Key concepts

- Migrations are applied in timestamp order.
- Remote migration history is recorded in `supabase_migrations.schema_migrations` on the target database.
- The local workflow assumes Docker + the Supabase CLI.


## Local development workflow

1. **Start the local Supabase stack**

   ```bash
   supabase start
   ```

2. **Create a new migration file**

   ```bash
   supabase migration new <short_descriptive_name>
   ```

   This creates a file like `supabase/migrations/20260203123456_<short_descriptive_name>.sql`.

3. **Write the SQL**

   Guidelines:
   - Prefer **additive** changes (new tables/columns, new indexes) over destructive ones.
   - Make statements **idempotent** where practical (`create table if not exists`, `create index if not exists`, guarded `alter table` patterns).
   - Keep “big” operations (large backfills, index rebuilds) explicitly documented in the migration body.

4. **Apply migrations locally (reset to a known state)**

   ```bash
   supabase db reset
   ```

   This recreates the local database and replays all migrations. If you have `supabase/seed.sql`, it will run after migrations.

5. **Verify**

   - Run the app locally and cover the flows impacted by the schema change.
   - For security-sensitive changes: verify RLS policies and privileges.


## Deploy workflow (staging -> production)

This repo is intended to run with **multiple environments** (`local` → `staging` → `prod`). Deploy migrations to staging first, validate, then promote to production.

> In production, prefer deploying via CI/CD (e.g., GitHub Actions) with an approval gate. Avoid running migrations directly from a developer laptop.

Typical CLI sequence (interactive/manual):

1. Log in:

   ```bash
   supabase login
   ```

2. Link your repo to the target Supabase project:

   ```bash
   supabase link --project-ref <project_ref>
   ```

3. Preview what would be applied:

   ```bash
   supabase db push --dry-run
   ```

4. Apply migrations:

   ```bash
   supabase db push
   ```

## Handling schema drift or out-of-sync migration history

Schema drift typically happens when someone changes schema directly in a remote database without a corresponding migration in git.

### If the remote schema changed without migrations

1. Make sure your local branch is up to date.
2. Generate a migration that captures the remote changes:

   ```bash
   supabase db pull --linked <optional_migration_name>
   ```

3. Review the generated migration carefully and commit it.
4. Re-apply locally (`supabase db reset`) to ensure the repo is self-contained.

### If local and remote migration history differs

1. Inspect differences:

   ```bash
   supabase migration list --linked
   ```

2. Repair remote migration history when prompted (or when you’re certain about the intended state):

   ```bash
   supabase migration repair <timestamp> --status applied
   # or
   supabase migration repair <timestamp> --status reverted
   ```

   Use this to align the remote history table with your repo’s migrations (it edits migration history; it does not run SQL).

## Writing safe migrations (practical guardrails)

- **Avoid long locks in production**
  - Prefer small, incremental migrations.
  - Use `lock_timeout` for safety if you’re touching hot tables.

- **Be careful with large tables**
  - Adding a `NOT NULL` column with a default can rewrite the table depending on Postgres version and expression; prefer:
    1) add nullable column
    2) backfill in batches
    3) add NOT NULL constraint

- **Index creation**
  - For large tables, prefer `create index concurrently`.
  - Note: `CONCURRENTLY` cannot run inside a transaction block. If your migration runner wraps statements in a transaction, put such statements in their own migration file.

- **RLS and privileges**
  - New tables should have RLS enabled (when appropriate) and explicit policies.
  - Functions that act as “workers” should use `service_role` only (never make them public).

## Pull request checklist

Before merging a DB change:

- [ ] A new migration exists under `supabase/migrations/` with a clear name.
- [ ] `supabase db reset` succeeds on a clean clone.
- [ ] RLS policies updated/added for any new tables.
- [ ] Any data migrations/backfills are safe under load (batched, resumable).
- [ ] For destructive changes (drops/renames), there is an explicit rollout plan and backwards compatibility window.

## Current migrations in this repo

Baseline migrations are checked in:

- `20260201000000_extensions.sql` — creates the `extensions` schema and enables required extensions.
- `20260201001000_public_schema.sql` — baseline for the application's `public` schema (types, tables, functions, policies, grants, triggers).
- `20260206004000_storage_buckets_and_policies.sql` — seeds required Storage buckets and defines Storage RLS policies (avatars, chat media, driver docs, KYC).

Follow-up changes should be introduced as additional timestamped migrations; avoid editing the baseline files unless you are intentionally regenerating them.
