# Session 08 — Dispatch + geospatial performance

## Goal
Improve matching latency and correctness at scale.

## Plan (high level)
- Adopt PostGIS-first queries for candidate selection.
- Introduce geohash/H3 indexing (optional) to reduce search space.
- Cache hot areas / driver availability in Redis-like store (if available) or Postgres materialized views.
- Enforce consistent ETA computation and fallback behavior.

## Deliverables
- Schema: `driver_locations` with spatial index
- Query patterns:
  - `ST_DWithin` for radius
  - `ORDER BY <->` KNN for nearest neighbor
- Load tests and p95 latency targets per region.

## Acceptance criteria
- p95 match latency < target under representative load.
- No full-table scans for dispatch queries (verified via EXPLAIN).
