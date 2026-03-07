# Maps usage inventory

This repo uses a three-provider maps stack for Iraq with Arabic localization and controlled fallback.

Active providers in priority order:
1. Google Maps
2. Mapbox
3. HERE

Provider selection is controlled in Postgres (`maps_providers`, `maps_provider_capabilities`) and served to clients through `maps-config-v2`. Web renderers initialize the selected provider and can fall back at runtime if a renderer fails to load.

## Where maps is used

### Flutter app
- `lib/features/maps/` renders ride maps through provider-specific host documents and route previews.

### Admin dashboard
- `admin_dashboard/src/app/(protected)/maps` shows live drivers and GeoJSON overlays on a Mapbox display map fed by `maps-config-v2`.
- `admin_dashboard/src/app/(protected)/service-areas` edits polygons with Mapbox GL Draw.

### Legacy web app
- `apps/web/src/components/maps/MapView.tsx` renders Google, Mapbox, or HERE.
- `apps/web/src/pages/AdminMapsPage.tsx` exposes provider controls and Geo API diagnostics.

## Required client SDKs

Keys are never embedded in Vite environment variables. Clients fetch provider config at runtime from `maps-config-v2`.

- Google Maps JavaScript API
- Mapbox GL JS
- HERE Maps JavaScript API

Excluded from the client stack:
- unsupported tile providers
- legacy polygon editors
- Places UI

## Server-side geo providers

Server-side routing/geocoding is orchestrated by the `geo` Edge Function with provider selection, quota enforcement, and optional short-lived caching.

- Google web services are only allowed when the active renderer is Google.
- Mapbox web services are only allowed when the active renderer is Mapbox.
- HERE is allowed for rendering and geo services.

## Admin-specific note

Polygon editing is Mapbox-only. Google's Drawing library is deprecated, so admin/service-area editing uses Mapbox GL Draw while the broader renderer stack remains Google, Mapbox, and HERE.
