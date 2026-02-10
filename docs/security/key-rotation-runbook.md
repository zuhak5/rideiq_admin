# Supabase key rotation runbook

## Goal

Rotate Supabase keys with minimal downtime and clear rollback.

## Canonical env var names

This repo standardizes on:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY` (client key: may be `sb_publishable_...` or legacy `anon` JWT)
- `SUPABASE_SERVICE_ROLE_KEY` (server key: may be `sb_secret_...` or legacy `service_role` JWT)

The code also accepts aliases for compatibility:

- `SUPABASE_PUBLISHABLE_KEY` -> treated as `SUPABASE_ANON_KEY`
- `SUPABASE_SECRET_KEY` -> treated as `SUPABASE_SERVICE_ROLE_KEY`

## Routine rotation (modern keys)

Modern publishable/secret keys can be managed and revoked independently.

1) **Create new keys**
- In Supabase Dashboard -> Project Settings -> API Keys, create a new publishable and/or secret key.

2) **Rotate server first (secret/service_role)**
- Update secrets in:
  - Supabase Edge Functions environment: set `SUPABASE_SERVICE_ROLE_KEY` to the new server key.
  - CI secret store: update `SUPABASE_SERVICE_ROLE_KEY` used by workflows/scripts.
- Redeploy Edge Functions.
- Smoke test server-only flows (admin endpoints, background/cron tasks).

3) **Rotate client (publishable/anon)**
- Update the client build secret (`VITE_SUPABASE_ANON_KEY`) to the new publishable/anon key.
- Deploy web.
- For mobile, plan an app release window; keep old client key valid until adoption.

4) **Observe**
- Watch for increases in:
  - 401/403 from Edge Functions
  - auth refresh failures in clients
  - PostgREST errors (if used)

5) **Revoke old keys**
- After the overlap window, revoke the old publishable/secret keys.

### Suggested overlap windows
- Server key: minutes to hours (Edge Functions can be redeployed quickly).
- Web client key: hours to a day (web deploy is fast).
- Mobile client key: days to weeks (app store review + slow updates).

## Emergency revoke

### Scenario A: server key leak (`SUPABASE_SERVICE_ROLE_KEY`)

1) Revoke the leaked key in the Supabase Dashboard immediately.
2) Create a new server key.
3) Update Edge Function env and CI secrets, redeploy.
4) Review logs for anomalous DB writes / RPC usage.

### Scenario B: client key abuse (`SUPABASE_ANON_KEY`)

The client key is expected to be public. Abuse usually indicates one of:

- missing or incorrect RLS policies
- missing rate limits on public endpoints

Actions:

1) Validate RLS for the abused tables/views.
2) Add or tighten rate limiting on public Edge Functions.
3) Rotate the client key only if necessary (and follow the overlap plan).

## Legacy key rotation (anon/service_role JWTs)

Legacy `anon` and `service_role` keys are tied to the JWT signing secret and typically rotate together.

1) Rotate JWT signing keys in Supabase Dashboard (JWT Keys / Signing Keys).
2) Deploy server updates first.
3) Release client updates.
4) Revoke older keys only after clients have moved.

## Rollback

If rotation causes breakage:

- Re-enable the prior key (or re-add it) in the Supabase Dashboard if it was revoked.
- Roll back Edge Function env vars to the last known-good key.
- Roll back client build configuration and redeploy.

## Validation checklist

- Edge Functions respond 2xx for healthy requests.
- Authenticated flows succeed.
- No service role key is present in client bundles.
