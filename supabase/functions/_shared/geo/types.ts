// Shared geo types used by the Supabase Edge geo orchestrator and provider adapters.
// These are intentionally provider-agnostic so the frontend can treat the response uniformly.

export const ALL_PROVIDER_CODES = ['google', 'mapbox', 'here'] as const;

export type ProviderCode = (typeof ALL_PROVIDER_CODES)[number];
export type Capability = 'directions' | 'geocode' | 'distance_matrix';

export function isProviderCode(value: unknown): value is ProviderCode {
  return typeof value === 'string' &&
    (ALL_PROVIDER_CODES as readonly string[]).includes(value.trim().toLowerCase());
}

export function parseProviderCode(value: unknown): ProviderCode | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  return isProviderCode(normalized) ? normalized : null;
}

export type LatLng = { lat: number; lng: number };

export type GeoLineString = {
  type: 'LineString';
  // GeoJSON coordinate order: [lng, lat]
  coordinates: Array<[number, number]>;
};

export type GeoRouteResponse = {
  distance_meters: number;
  duration_seconds: number;

  // Preferred geometry representation for UI.
  geometry?: GeoLineString;

  // Encoded polyline fallback when geometry is unavailable.
  polyline?: string;
  polyline_type?: 'google_encoded_polyline' | 'here_flexible_polyline';

  // Provider-specific details (debuggable but stable-ish).
  provider_details?: Record<string, unknown>;
};

export type GeoSearchResult = {
  label: string;
  location: LatLng;
  provider_place_id?: string;
  context?: Record<string, unknown>;
  raw?: Record<string, unknown>;
};

export type GeoRouteMatrixElement = {
  origin_index: number;
  destination_index: number;
  distance_meters?: number;
  duration_seconds?: number;
  status?: string;
};

export type GeoMatrixResponse = {
  // Google Distance Matrix (Routes API v2) returns elements as a list.
  elements?: GeoRouteMatrixElement[];

  // Mapbox Matrix returns dense matrices (row-major: origins x destinations).
  durations_seconds?: (number | null)[][];
  distances_meters?: (number | null)[][];
};
