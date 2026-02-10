# Maps usage inventory

This repo uses a **multi-provider maps stack** for Iraq, with Arabic localization and automated fallback.

Active providers (in priority order):
1) Google Maps
2) Mapbox
3) HERE
4) OpenRouteService (server-side directions/geocoding)
5) Thunderforest (Leaflet tiles)

Provider selection is controlled in Postgres (`maps_providers`, `maps_provider_capabilities`) and served to the web app via the `maps-config-v2` Edge Function. The web app (`MapView`) initializes the selected renderer and falls back at runtime if a provider fails to load.

## Where Maps is used

### Public pages
- `apps/web/src/pages/ShareTripPage.tsx` → `MapView` (pickup/dropoff markers; optional driver marker)

### Admin pages
- `apps/web/src/components/maps/AdminDriversPreviewMap.tsx` (driver markers + radius circle + optional bbox rectangle)
- `apps/web/src/components/maps/AdminServiceAreaMap.tsx` (editable service area rectangle)
- `apps/web/src/components/maps/AdminServiceAreaGeoJsonMap.tsx` (GeoJSON overlay via Data layer)

## Required Maps APIs / SDKs (allowlist)

### Client keys (browser)

Keys are **never** embedded in Vite environment variables. The browser fetches provider config at runtime from `maps-config-v2`.

- **Google Maps JavaScript API** (required when Google render is enabled)
- **Mapbox GL JS** (token required when Mapbox render is enabled)
- **HERE Maps JS** (apikey required when HERE render is enabled)
- **Thunderforest tiles** (API key required when Thunderforest render is enabled)

No usage of:
- Places (JS or Web Service)
- Routes/Directions API
- Geocoding API
- Elevation API
- Distance Matrix API
- Drawing library
- Geometry library

> Note: Maps overlays used (`Marker`, `Circle`, `Rectangle`, `Data` layer) are provided by the base Maps JS API and do not require extra JS libraries.

### Server keys (geo/directions)

Server-side routing/geocoding is orchestrated by the `geo` Edge Function (provider selection + caching + rate limiting). Use separate server keys per provider if you enable these capabilities (including OpenRouteService for non-Google/Mapbox rendering). For ORS, set `ORS_API_KEY` (or `OPENROUTESERVICE_API_KEY`).

Google-specific key restriction guidance still applies; see `docs/maps/key-restrictions.md`.
