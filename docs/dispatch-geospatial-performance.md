# Dispatch geospatial performance

This repo’s matching stack uses **PostGIS-first** queries to keep dispatch latency stable as active driver counts grow.

## Data model

### `public.driver_locations`

### RLS + access

`driver_locations` is protected by **Row Level Security**:

- `authenticated`: a driver can read/write only their own row (`driver_id = auth.uid()`).
- `service_role`: full access for dispatch/backends.


One row per driver (upserted on each location update). Key columns:

- `lat`, `lng` — last known coordinates
- `loc` — generated `geography(Point, 4326)` built from `lng/lat`
- `updated_at` — freshness cutoff for candidate selection

The critical index is a **GiST** index on `loc`, enabling radius + nearest-neighbor search.

## Query patterns

Dispatch candidate selection uses two complementary PostGIS patterns:

1) **Radius filter**

- `ST_DWithin(loc, pickup, radius_m)` filters to candidates inside a circle.

2) **Nearest-neighbor ordering (KNN)**

- `ORDER BY loc <-> pickup` orders by increasing distance using GiST KNN.

The current implementation applies both in `public.dispatch_match_ride(...)`.

## How to verify index usage (EXPLAIN)

You should verify that matching queries do not regress into full-table scans, especially for `driver_locations`.

Example plan check (run in your DB console):

```sql
EXPLAIN (ANALYZE, BUFFERS)
WITH pickup AS (
  SELECT extensions.st_setsrid(extensions.st_makepoint(44.3661, 33.3152), 4326)::extensions.geography AS pickup
)
SELECT dl.driver_id
FROM public.driver_locations dl
CROSS JOIN pickup
WHERE dl.updated_at >= now() - interval '120 seconds'
  AND extensions.st_dwithin(dl.loc, pickup.pickup, 5000)
ORDER BY dl.loc <-> pickup.pickup
LIMIT 20;
```

**What you want to see** (examples):

- an `Index Scan`/`Bitmap Index Scan` referencing `ix_driver_locations_loc_gist`
- no `Seq Scan on driver_locations`

If you see sequential scans, confirm:

- PostGIS is installed under the expected schema (commonly `extensions` in Supabase)
- the GiST index on `driver_locations.loc` exists
- the query uses `ST_DWithin` and `ORDER BY <->` on the same `geography` type

## Load testing matching latency

This repo includes `scripts/loadtest-http.mjs` for quick HTTP load tests.

Typical usage against the `match-ride` Edge Function:

```bash
node scripts/loadtest-http.mjs \
  --url "$SUPABASE_URL/functions/v1/match-ride" \
  --method POST \
  --header "Authorization: Bearer $RIDER_JWT" \
  --header "apikey: $SUPABASE_ANON_KEY" \
  --json '{"request_id":"<uuid>","radius_m":5000,"limit_n":20}' \
  --concurrency 20 \
  --duration-seconds 30 \
  --target-p95-ms 250
```

Notes:

- Targets should be set **per region** (network RTT matters).
- Use realistic request bodies and a representative driver population.
- Run in staging first; promote to prod only after observing stable p95.
