# Runbook: Maps billing spike / abuse

## Alert signals
- `maps_origin_denied_high` (ticket)

## Dashboards
- SQL:
  - `select * from public.ops_maps_metrics_15m;`
- Logs:
  - Filter Edge Function logs for `component=maps-config`.

## Immediate triage (0–15 min)
1. **Confirm symptom**
   - `origin_denied` indicates requests from non-allowlisted origins (blocked by our origin allowlist).
   - `rate_limited` indicates our server-side throttling is actively protecting.

2. **Identify source origin(s)**
   - Check `Origin` / `Referer` in `maps-config` logs.
   - Validate that production domains are allowlisted.

3. **Check Google Maps key restrictions**
   - Ensure the underlying Google Maps key is restricted (HTTP referrer restrictions + API restrictions + quotas).
   - Rotate the key if there is evidence of exfiltration.

## Common causes / fixes
### A) New domain / subdomain not allowlisted
- Symptoms: `origin_denied` rises, user map loads fail.
- Fix:
  - Add the new domain to allowed origins in environment configuration (do not loosen to `*`).

### B) Misconfigured publishable key
- Symptoms: `misconfigured` rises.
- Fix:
  - Validate required env vars are present.
  - Ensure secrets are not being referenced from the frontend bundle.

### C) Key abuse / leak
- Symptoms: billing spike, normal traffic does not explain usage.
- Fix:
  - Immediately rotate the Google Maps key.
  - Apply strict referrer + API restrictions.
  - Set hard daily quota and alerts in Google Cloud.

## Verification
- `origin_denied` returns to baseline.
- End-user map loads succeed from production domains.

## Rollback
- Revert allowlist changes if they inadvertently expand access.
- Roll back any key rotation changes if they break legitimate production domains.
