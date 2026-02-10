import type { MapsProvider } from './mapsConfig';
import { invokeEdge } from './edgeInvoke';

export type GeoLatLng = { lat: number; lng: number };

export type GeoLineString = {
  type: 'LineString';
  // GeoJSON coordinates: [lng, lat]
  coordinates: Array<[number, number]>;
};

export type GeoSearchResult = {
  label: string;
  location: GeoLatLng;
  provider_place_id?: string;
  context?: Record<string, unknown>;
  raw?: Record<string, unknown>;
};

export type GeoRouteResponse = {
  distance_meters: number;
  duration_seconds: number;
  geometry?: GeoLineString;
  polyline?: string;
  polyline_type?: 'google_encoded_polyline' | 'here_flexible_polyline';
  provider_details?: Record<string, unknown>;
};

export type GeoOk<T> = {
  ok: true;
  provider: MapsProvider;
  capability: 'geocode' | 'directions' | 'distance_matrix';
  cache?: { hit: boolean };
  data: T;
  request_id?: string;
};

export type GeoRouteMeta = {
  provider: MapsProvider;
  request_id?: string;
  cache_hit?: boolean;
  route: GeoRouteResponse;
};

function defaultLanguageRegion(opts?: { language?: string; region?: string }) {
  return { language: opts?.language ?? 'ar', region: opts?.region ?? 'IQ' };
}

export async function geoGeocode(query: string, opts?: {
  limit?: number;
  renderer?: MapsProvider | null;
  language?: string;
  region?: string;
}): Promise<GeoSearchResult[]> {
  const { language, region } = defaultLanguageRegion(opts);
  const { data } = await invokeEdge<GeoOk<GeoSearchResult[]>>('geo', {
    action: 'geocode',
    query,
    limit: opts?.limit ?? 6,
    language,
    region,
    renderer: opts?.renderer ?? undefined,
  });
  return data?.data ?? [];
}

export async function geoReverse(at: GeoLatLng, opts?: {
  limit?: number;
  renderer?: MapsProvider | null;
  language?: string;
  region?: string;
}): Promise<GeoSearchResult[]> {
  const { language, region } = defaultLanguageRegion(opts);
  const { data } = await invokeEdge<GeoOk<GeoSearchResult[]>>('geo', {
    action: 'reverse',
    at,
    limit: opts?.limit ?? 1,
    language,
    region,
    renderer: opts?.renderer ?? undefined,
  });
  return data?.data ?? [];
}

export async function geoRoute(origin: GeoLatLng, destination: GeoLatLng, opts?: {
  renderer?: MapsProvider | null;
  language?: string;
  region?: string;
}): Promise<GeoRouteMeta | null> {
  const payload: Record<string, unknown> = {
    action: 'route',
    origin,
    destination,
    renderer: opts?.renderer ?? undefined,
  };
  if (opts?.language) payload.language = opts.language;
  if (opts?.region) payload.region = opts.region;

  const { data } = await invokeEdge<GeoOk<GeoRouteResponse>>('geo', payload);
  if (!data?.data) return null;
  return { provider: data.provider, request_id: data.request_id, cache_hit: data.cache?.hit, route: data.data };
}
