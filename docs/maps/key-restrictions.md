# Maps key restrictions

Session 04 requires treating the Maps browser key as **public**, and preventing abuse via **application restrictions** + **API restrictions** in Google Cloud Console.

## Keys

### `MAPS_CLIENT_KEY` (public / browser)
Used by:
- `supabase/functions/maps-config` to return the key to the web client at runtime.
- The web client loads Maps JS with `key=<MAPS_CLIENT_KEY>`.

**Do not** reuse this key for server-side requests.

### `MAPS_SERVER_KEY` (secret / server)
Not currently used in this repo. Reserve for any future server-side calls to Google Maps Web Services (Directions / Geocoding / Places Web Service, etc.).

## Application restrictions

### Web (required)
Restrict `MAPS_CLIENT_KEY` by **HTTP referrers** for each environment.

Minimum suggested allowlist patterns:
- Production:
  - `https://<your-prod-domain>/*`
- Staging:
  - `https://<your-staging-domain>/*`
- Local development:
  - `http://localhost:5173/*` (or your Vite port)
  - `http://127.0.0.1:5173/*`

> If you serve the web app via GitHub Pages, also include the repository pages domain pattern.

### Android (when a mobile app is added)
Restrict by:
- package name (e.g. `com.rideiq.app`)
- SHA-1 signing certificate fingerprint(s) for debug + release keys

### iOS (when a mobile app is added)
Restrict by:
- bundle identifier (e.g. `com.rideiq.app`)

## API restrictions (fail-closed)

### `MAPS_CLIENT_KEY`
Restrict to only:
- **Maps JavaScript API**

If you later add Places UI/autocomplete or the Drawing/Geometry libraries, update both:
1) this allowlist, and
2) `docs/maps/inventory.md`.

### `MAPS_SERVER_KEY`
Restrict to only the exact Google Maps Web Services you use (e.g. Directions, Geocoding).

## Operational notes
- Keep separate keys per environment where feasible (prod vs staging) to isolate risk and simplify incident response.
- Rotate keys after any suspected leakage or abuse.

## Server-side calls (when added)
For Google Maps Web Services, do **not** send keys in URL query parameters. Prefer the `x-goog-api-key` header as recommended in Google Cloud API key guidance.
