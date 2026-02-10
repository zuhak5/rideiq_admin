# Geo Orchestrator (Maps, Directions, Geocoding) — Architecture Notes

This repo supports multiple map providers with **fallback** (Google → Mapbox → HERE → OpenRouteService) and a server-side **Geo API** that centralizes all third-party routing/geocoding calls. Thunderforest remains the renderer-only tile provider.

## Goals

1. Keep provider keys **server-side** (Edge Functions).
2. Provide a normalized API (`/functions/v1/geo`) for:
   - Directions / routing
   - Forward geocoding
   - Reverse geocoding
   - Distance matrix
3. Enforce per-provider monthly quotas and automatic fallback.
4. Ensure Iraqi UX defaults: Arabic (`ar`) + Iraq region (`IQ`).
5. Provide strong observability: request logs + admin live view.

## Provider compliance: Google “no mixing” constraint

Google Maps Platform terms restrict use of certain Google content (e.g., directions/geocoding/distance matrix output) in conjunction with a non-Google map.

In this repo, the Geo API excludes Google for these capabilities unless the currently active renderer is also Google.

If you want a different behavior, discuss with counsel and re-evaluate compliance.

## Key components

### Database

- `maps_providers`, `maps_provider_capabilities`, `maps_usage_monthly` — provider config + quotas.
- `maps_requests_log` — immutable request log for routing/geocoding/matrix (used by Admin UI).
- `geo_cache` — short-lived normalized cache to reduce redundant provider calls.

### Edge Function: `geo`

Located at `supabase/functions/geo/index.ts`.

Inputs (JSON):

- `action`: `route` | `geocode` | `reverse` | `matrix`
- `language` (optional): defaults to Arabic.
- `region` (optional): defaults to Iraq.
- `renderer` (optional): map renderer currently in use. Used for compliance gating.

Outputs are normalized across providers.

### Admin UI

`apps/web/src/pages/AdminMapsPage.tsx` now shows:

- Live route test (calls the Geo API).
- Recent Geo requests table (polling the log RPC).

## Environment variables

Set these in your Supabase Edge Function environment:

- `MAPS_SERVER_KEY` (Google server key for Routes API + Geocoding)
- `MAPBOX_PUBLIC_TOKEN` (Mapbox token)
- `HERE_API_KEY`
- `THUNDERFOREST_API_KEY`
- `ORS_API_KEY` (OpenRouteService)
- `OPENROUTESERVICE_API_KEY` (OpenRouteService fallback alias)
- `ORS_DIRECTIONS_SNAP_RADIUS_METERS` (optional, default `1200`; increases ORS road-snap tolerance for pickup/dropoff points)
