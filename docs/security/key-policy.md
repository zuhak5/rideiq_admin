# Supabase key policy (client vs server)

## Purpose

This repo uses Supabase in **two trust contexts**:

1. **Client (web / mobile)** — untrusted. Anything shipped here can be copied.
2. **Server** — trusted (Supabase Edge Functions, CI jobs, admin scripts).

Keys must be handled differently in each context.

## Key taxonomy

Supabase has two families of API keys:

### 1) Legacy keys
- **anon** key (JWT): intended for client use.
- **service_role** key (JWT): server-only; bypasses RLS.

Legacy keys are tied to the JWT signing secret and are rotated together.

### 2) Modern keys
- **publishable** key (`sb_publishable_...`): drop-in replacement for the legacy anon key.
- **secret** key (`sb_secret_...`): drop-in replacement for the legacy service role key.

Modern keys can be managed/rotated independently (preferred).

## Policy rules

### Client
- ✅ Allowed: **anon/publishable** key.
- ❌ Forbidden: **service_role/secret** key.

Client access must be protected by **RLS policies**, not by secrecy of the client key.

### Server
- ✅ Allowed: anon/publishable key when you want RLS enforcement (user-scoped reads/writes).
- ✅ Allowed: service_role/secret key only when you need privileged operations (admin tasks, background jobs).

Anything using the service role key must:
- be server-only
- be audited / logged
- minimize scope (only the operations needed)

## Required environment variables

We standardize on these names across CI, Edge Functions, and scripts:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY` (may contain a publishable key or a legacy anon key)
- `SUPABASE_SERVICE_ROLE_KEY` (may contain a secret key or a legacy service_role key)

### Backwards-compatible aliases

To reduce churn, the code also accepts these aliases:

- `SUPABASE_PUBLISHABLE_KEY` → treated as `SUPABASE_ANON_KEY`
- `SUPABASE_SECRET_KEY` → treated as `SUPABASE_SERVICE_ROLE_KEY`

**Recommendation:** set the canonical variables above and avoid aliases in new deployments.

## Edge Functions: declaring required key access

Each Edge Function must be categorized as one of:

- `anon` — uses only the anon/publishable key.
- `service_role` — requires the service role/secret key.
- `none` — does not use Supabase API keys.

The authoritative mapping lives in:

- `supabase/functions/key-requirements.json` (v2)

CI enforces that:

- Any function using `createServiceClient()` / `requireSupabaseSecret()` is declared `service_role`.
- Any function declared `service_role` includes a non-empty human justification (`reason`).

## Guardrails

- The web app has a runtime guard that **refuses to run** if a service role / secret key is accidentally provided to the browser.
- CI includes a lightweight denylist scan for real-looking Supabase keys (publishable/secret) to prevent accidental commits.
