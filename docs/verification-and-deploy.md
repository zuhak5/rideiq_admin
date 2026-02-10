# RideIQ verification & deployment checklist

This repo uses:
- **Supabase Postgres** for data + RPCs (`supabase/migrations/`)
- **Supabase Edge Functions** (Deno) (`supabase/functions/`)
- **Web frontend** in `apps/web/` (pnpm workspace)

---

## 1) Repo-level checks (no DB required)
From the repo root:

```bash
node scripts/schema-contract-check.mjs
node scripts/audit-edge-functions.mjs
node scripts/audit-function-key-requirements.mjs
node scripts/audit-rpc-allowlist.mjs
```

These checks validate:
- schema GRANT contract consistency
- `verify_jwt=false` policy + auth-model mapping
- declared key requirements vs actual code
- RPC usage vs allowlist

---

## 2) Install dependencies (for full frontend checks)

```bash
pnpm install
```

Then run:

```bash
pnpm check:strict
```

This runs (at a minimum): typecheck, lint, tests (web), schema contract check, and audits.

---

## 3) Local Supabase (recommended end-to-end verification)

### 3.1 Start local Supabase

```bash
# Required if auth.hook.send_sms is enabled in supabase/config.toml.
# Format: v1,whsec_<base64_encoded_secret>
export AUTH_HOOK_SECRET="v1,whsec_..."
supabase start
```

### 3.2 Apply migrations cleanly

```bash
supabase db reset
```

This recreates the local DB and applies all migrations in `supabase/migrations/`.

### 3.3 Run database tests (if configured)

```bash
supabase test db
```

### 3.4 Run Edge Functions locally

```bash
supabase functions serve
```

If you run functions independently (without the CLI), ensure these env vars exist in the function runtime:
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY` (or alias `SUPABASE_PUBLISHABLE_KEY`)
- `SUPABASE_SERVICE_ROLE_KEY` (or alias `SUPABASE_SECRET_KEY`)

You can get local keys via:

```bash
supabase status
```

---

## 4) Production secrets & scheduled jobs

### 4.1 Required shared secrets
Set these as **Edge Function secrets** in your Supabase project:

- `CRON_SECRET`
  - used by cron endpoints: `edge-webhook-dispatcher`, `edge-webhook-prune`, and other `*-runner` jobs.
- `DISPATCH_WEBHOOK_SECRET`
  - used by the internal webhook chain: DB outbox → `edge-webhook-dispatcher` → internal webhook edge functions (e.g. `trip-share-auto`).
- `AUTH_HOOK_SECRET`
  - used by `sms-hook` (Supabase Auth SMS hook).

### 4.2 Cron schedules (minimum)
You should schedule:

- **edge-webhook-dispatcher**: every 30–60 seconds
- **edge-webhook-prune**: daily (or hourly) depending on volume

The caller must include the cron secret (example header):
- `x-cron-secret: <CRON_SECRET>`

---

## 5) Deployment checklist

### 5.1 Environment mismatch guard
Before deploying, set:

- `SUPABASE_PROJECT_REF`

Then run:

```bash
node scripts/audit-supabase-env.mjs
```

This prevents accidental deploys to the wrong project by checking refs embedded in `supabase/config.toml`.

### 5.2 Deploy DB + functions
Typical flow:

```bash
supabase link --project-ref <SUPABASE_PROJECT_REF>

# Apply migrations to the linked project
supabase db push

# Deploy edge functions
supabase functions deploy
```

(If your org deploys functions selectively, deploy only the changed ones.)

---

## 6) Manual regression test checklist (high value)

1. **Ride flow**: intent create → match → accept → arrived → in_progress → complete
2. **Pickup PIN**: verify wrong pin locks out; correct pin transitions properly
3. **Chat**: send message, list messages, mark read
4. **Scheduled rides**: create → list → cancel
5. **Trip share**: create share link; public view; auto-share on in_progress (via outbox)
6. **Outbox health**: ensure dispatcher drains queue and prune reduces old rows

---

## Notes
- The repo intentionally keeps Edge Functions for: webhooks, external API orchestration, notifications dispatch, and cron workers.
- Critical state transitions and hot paths are centralized in Postgres RPCs for atomicity and concurrency safety.
