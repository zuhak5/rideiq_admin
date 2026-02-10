# Edge Function Auth Contract

This repo uses an explicit **auth contract** to prevent accidental exposure of Supabase Edge Functions.

## Why this exists

Supabase Edge Functions support a `verify_jwt` flag in `supabase/config.toml`.

- When `verify_jwt = true`, the platform validates the user JWT before running your code.
- When `verify_jwt = false`, your code runs even without a user JWT, so **your function must enforce its own guards**.

In this codebase we intentionally rely on **in-function authentication** (e.g., `requireUser()`, `requireUserStrict()`, `requireAdmin()`) for many user-facing functions, and we keep `verify_jwt = false` for predictable behavior across:

- Browser CORS preflights (OPTIONS requests often have no `Authorization` header)
- Provider callbacks/return handlers
- Cron endpoints
- Compatibility with Supabase auth/JWT key changes (defense-in-depth: auth logic lives in code)

Because `verify_jwt = false` increases the blast radius of mistakes, the auth contract exists to make the intended auth model explicit and auditable.

## Files

- `supabase/config.toml` — function config (`verify_jwt` flags)
- `config/security/edge-auth-contract.json` — declared auth model per function
- `scripts/audit-edge-functions.mjs` — static audit enforced by CI/local `pnpm security:audit`

## Auth types

The auth contract supports these values (see the audit script for exact checks):

- `user_jwt` — must verify the user (e.g., `requireUser()` / `requireUserStrict()`)
- `cron_secret` — must enforce `CRON_SECRET` (e.g., `requireCronSecret()`)
- `webhook_signature` — must verify integrity/authenticity of provider callbacks (signature/JWT/HMAC)
- `token_public` — public access gated by a strong unguessable token (and ideally hashed storage)
- `public_readonly` — public read-only content only
- `return_handler` — provider return/redirect handlers (should not do privileged operations)
- `optional_jwt` — can run without JWT but uses auth where present (use sparingly)

## Running the audit

```bash
pnpm security:audit
```

The audit fails if:

- A `verify_jwt=false` function is missing from the contract
- The function does not contain a recognizable guard for its declared auth type

Additionally, the audit warns when a `user_jwt` endpoint directly uses the **service role** (`createServiceClient()`), since this bypasses Row Level Security (RLS). Prefer:

- `createUserClient(req)` for RLS-scoped reads/writes tied to the caller's JWT, and
- DB-side wrappers that bind `auth.uid()` when privileged SQL is required.
