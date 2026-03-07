# Maps key restrictions

`maps-config-v2` is the only public runtime config endpoint for browser/mobile map rendering.

## Google

### Browser key
Used by:
- `maps-config-v2` when Google render is selected
- web renderers that dynamically load the Maps JavaScript API
- Flutter web host documents that call `google.maps.importLibrary(...)`

Restrictions:
- HTTP referrers only
- production domains, including `https://rideiqadmin.vercel.app`
- local development origins such as `http://localhost:3000/*`, `http://localhost:3001/*`, `http://localhost:5173/*`, `http://127.0.0.1:3000/*`, `http://127.0.0.1:3001/*`, and `http://127.0.0.1:5173/*`
- API restriction: Maps JavaScript API only

Do not reuse the browser key for server-side Google Routes or Geocoding.

### Server key
Used by:
- `supabase/functions/geo` for Google routing/geocoding only when renderer=`google`

Restrictions:
- server-side only
- restrict to the exact Google web services in use

## Mapbox

### Public token
Used by:
- `maps-config-v2`
- admin dashboard display maps
- Mapbox GL Draw polygon editor
- Flutter/web Mapbox renderers

Restrictions:
- URL/domain restrictions for production and local development
- default style should be Mapbox Standard unless a vetted custom style is configured

### Secret token
Only for server-side Mapbox web services used by `geo`. Keep it out of shipped bundles.

## HERE

### JavaScript/api key
Used by:
- `maps-config-v2`
- HERE web renderers
- `geo` when HERE is selected

Restrictions:
- restrict to approved web origins and server workloads
- keep separate prod and non-prod keys when possible

## Operational notes

- Rotate keys after any suspected leakage.
- Keep separate environments isolated.
- Do not introduce unsupported providers, legacy editors, or the legacy `maps-config` endpoint anywhere in the client stack.
