# Runbook: maps billing spike or abuse

## Alert signals

- `maps_origin_denied_high`

## Dashboards

- SQL: `select * from public.ops_maps_metrics_15m;`
- Logs: filter Edge Function logs for `component=maps-config-v2`

## Immediate triage

1. Confirm the symptom.
   - `origin_denied` means a browser origin is outside the allowlist.
   - `rate_limited` means abuse throttling is working.
2. Identify the origin.
   - Check `Origin` or `Referer` in `maps-config-v2` logs.
   - Verify production/admin domains are allowlisted.
3. Check provider key restrictions.
   - Google browser key: referrer-restricted and Maps JavaScript API only.
   - Mapbox public token: restricted to approved domains.
   - HERE key: restricted to approved origins/workloads.

## Common causes

### New domain not allowlisted
- Symptom: `origin_denied` rises and map loads fail from a new domain.
- Fix: add the exact domain to the allowlist. Do not loosen to `*`.

### Misconfigured provider token
- Symptom: `misconfigured` or render init failures rise.
- Fix: validate `maps-config-v2` env vars and deploy config changes.

### Key abuse or leak
- Symptom: billing spike with no matching legitimate traffic.
- Fix: rotate the affected provider key, keep strict origin restrictions, and review recent deploys/logs.

## Verification

- `origin_denied` returns to baseline.
- `/maps` and `/service-areas` load cleanly.
- No requests hit legacy providers or `maps-config`.
