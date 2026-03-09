# Geo orchestrator architecture notes

This repo supports a three-provider maps stack with fallback:

- Google
- Mapbox
- HERE

The `geo` Edge Function centralizes routing, forward geocoding, reverse geocoding, and distance matrix calls.

## Goals

1. Keep provider keys server-side.
2. Normalize geo responses across providers.
3. Enforce quotas, provider health cooldowns, and fallback.
4. Default to Arabic (`ar`) and Iraq (`IQ`).
5. Keep observability in `maps_requests_log`, `maps_usage_daily`, and the admin maps surfaces.

## Compliance routing

Google Maps Platform content should only be combined with a Google renderer. In this repo:

- Google web services are only used when the active renderer is Google.
- Mapbox web services are only used when the active renderer is Mapbox.
- HERE can serve both rendering and geo requests.

## Database

- `maps_providers`
- `maps_provider_capabilities`
- `maps_provider_health`
- `maps_usage_daily`
- `maps_requests_log`
- `geo_cache`

## Edge functions

- `maps-config-v2`: renderer/config selection for approved origins and authenticated callers
- `maps-usage`: render telemetry and usage metering
- `geo`: server-side routing/geocoding orchestration

Flutter render requests must send `required_capabilities: ['geocode', 'directions']`
to `maps-config-v2` so the selected renderer can also satisfy the app's geo flows.

## Admin surfaces

- `admin_dashboard/src/app/(protected)/maps`
- `admin_dashboard/src/app/(protected)/service-areas`
- `apps/web/src/pages/AdminMapsPage.tsx`

## Environment variables

Set these in Supabase Edge Functions:

- `MAPS_SERVER_KEY` for Google server-side web services
- `MAPS_CLIENT_KEY` for Google browser rendering
- `MAPBOX_PUBLIC_TOKEN`
- `MAPBOX_SECRET_TOKEN` for server-side Mapbox services (preferred; public token is only a compatibility fallback)
- `HERE_API_KEY`

Do not configure ORS, Thunderforest, Leaflet, or legacy `maps-config` dependencies.
