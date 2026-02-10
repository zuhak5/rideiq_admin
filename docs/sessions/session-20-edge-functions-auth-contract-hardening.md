# Session 20 — Edge Functions auth contract hardening

## Goals

1. Ensure **every** `verify_jwt=false` Edge Function has an explicit entry in the auth contract.
2. Ensure the static audit (`pnpm security:audit`) is accurate enough to catch real regressions (without false failures).
3. Fix a correctness bug in the `rate-limit-prune` maintenance endpoint.

## Changes

### 1) Completed the auth contract coverage

Updated `config/security/edge-auth-contract.json` to include missing `verify_jwt=false` functions:

- `ops-dashboard` → `user_jwt`
- `payout-job-action` → `user_jwt`
- `rate-limit-prune` → `cron_secret`

This prevents “drift” where a function is made callable without gateway JWT verification but is not tracked by the contract.

### 2) Improved the audit’s guard detection

Updated `scripts/audit-edge-functions.mjs`:

- Accept `requireAdmin(...)` as a valid `user_jwt` guard.
- Require an explicit `requireCronSecret(...)` match for `cron_secret` endpoints (more precise than matching "cron" strings).

### 3) Fixed `rate-limit-prune` runtime issues

`supabase/functions/rate-limit-prune/index.ts` had two issues:

- Incorrect `errorJson(...)` argument ordering (headers were being passed as the `extra` payload).
- Incorrect `emitMetricBestEffort(...)` call signature (missing request context argument).

Both are now corrected, and the endpoint emits structured metric events:

- `metric.rate_limit.prune_failed`
- `metric.rate_limit.pruned`

### 4) Improved traceability for `payout-job-action`

`supabase/functions/payout-job-action/index.ts` now passes `ctx.headers` into `json(...)` / `errorJson(...)` so request IDs and trace IDs are preserved in responses.

## Validation

- `node scripts/audit-edge-functions.mjs` passes (no failures).

## Next targets

- Convert remaining legacy Edge Functions that do not use `withRequestContext(...)` to the shared pipeline (consistent CORS, request IDs, and error formatting).
- Add explicit unit tests for the auth contract parser and the `verify_jwt=false` list extraction.
