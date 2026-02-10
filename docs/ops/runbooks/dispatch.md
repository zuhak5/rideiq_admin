# Runbook: Dispatch matching & geospatial performance

This runbook covers the Session 08 dispatch matching performance work:

- `public.driver_locations` PostGIS-backed geospatial storage
- `public.dispatch_match_ride()` uses radius filtering + KNN ordering
- How to validate index usage and measure latency

## System model

Dispatch matching is performed by the `match-ride` Edge Function which delegates to the database RPC:

- Edge Function: `match-ride` (auth: user JWT; deployed with `verify_jwt=false` and explicit in-function auth)
- DB function: `public.dispatch_match_ride(...)` (security definer)

Key query properties in the RPC:

- Freshness filter on driver locations (by `updated_at`)
- Radius filter using PostGIS `ST_DWithin()`
- Candidate ordering using KNN distance operator (`<->`) against a GiST-backed geography column

## Required indexes

These are created by the Session 08 migration:

- `ix_driver_locations_loc_gist` on `public.driver_locations(loc)`
- `ix_driver_locations_updated_at` on `public.driver_locations(updated_at desc)`

Optional (best-effort guarded in migration):

- `ix_drivers_status_available` partial index for available drivers

## Validation: DB query plans

Run these in SQL (with representative data sizes) and confirm there is no full-table scan on `driver_locations`.

### 1) Confirm indexes exist

```sql
select indexname, indexdef
from pg_indexes
where schemaname = 'public'
  and tablename = 'driver_locations'
order by indexname;
```

### 2) EXPLAIN the candidate selection

Use a real ride request (or construct a pickup point) and run:

```sql
explain (analyze, buffers)
with pickup as (
  select (select pickup_loc from public.ride_requests where id = '<REQUEST_ID>') as pickup
), candidates as (
  select d.id as driver_id
  from public.drivers d
  cross join pickup
  join public.driver_locations dl
    on dl.driver_id = d.id
   and dl.updated_at >= now() - interval '120 seconds'
  where d.status = 'available'
    and extensions.st_dwithin(dl.loc, pickup.pickup, 5000)
  order by dl.loc <-> pickup.pickup
  limit 20
)
select * from candidates;
```

Acceptance target:

- Planner uses the `ix_driver_locations_loc_gist` index for distance/radius filtering and ordering.

If you see sequential scans:

- Confirm `loc` is populated and uses `geography(Point,4326)`
- Confirm the GiST index exists
- Confirm `extensions` schema is used for PostGIS in your project

## Validation: Edge latency (load test)

A no-deps load test harness exists in `scripts/loadtest-http.mjs`.
For dispatch matching convenience, use the wrapper:

- `scripts/loadtest/dispatch-match.mjs`

### Example

```bash
export SUPABASE_URL="https://<project-ref>.supabase.co"
export SUPABASE_ANON_KEY="<anon key>"
export RIDER_JWT="<rider access token>"

node scripts/loadtest/dispatch-match.mjs \
  --request-id <ride_request_uuid> \
  --concurrency 20 \
  --duration-seconds 30 \
  --target-p95-ms 250
```

Notes:

- Ensure the request is in `requested` status and has a valid `pickup_loc`.
- Ensure there are enough `available` drivers with fresh `driver_locations`.
- If failures occur (non-2xx), inspect `public.ops_dispatch_metrics_15m` and function logs.

## Rollback

- Rollback is by reverting the Session 08 migration(s) only if absolutely necessary.
- Prefer forward-fixes: indexing changes are typically safe to keep once deployed.
