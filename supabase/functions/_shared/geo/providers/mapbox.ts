import { GeoMatrixResponse, GeoRouteResponse, GeoSearchResult, LatLng } from '../types.ts';
import { upstreamHttpError } from '../upstreamError.ts';

type FetchOpts = { timeoutMs?: number };

function withTimeout(signal: AbortSignal | undefined, timeoutMs: number): { signal: AbortSignal; cleanup: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener('abort', () => controller.abort(), { once: true });
  }
  return {
    signal: controller.signal,
    cleanup: () => clearTimeout(timer),
  };
}

export async function mapboxDirections(args: {
  accessToken: string;
  origin: LatLng;
  destination: LatLng;
  profile: 'driving' | 'walking' | 'cycling' | 'driving-traffic';
  language: string;
  steps: boolean;
  alternatives: boolean;
  signal?: AbortSignal;
  timeoutMs?: number;
}): Promise<{ raw: unknown; normalized: GeoRouteResponse }> {
  const { accessToken, origin, destination, profile, language, steps, alternatives } = args;
  const coords = `${origin.lng},${origin.lat};${destination.lng},${destination.lat}`;
  const url = new URL(`https://api.mapbox.com/directions/v5/mapbox/${profile}/${coords}`);
  url.searchParams.set('access_token', accessToken);
  url.searchParams.set('geometries', 'geojson');
  url.searchParams.set('overview', 'full');
  url.searchParams.set('alternatives', String(alternatives));
  url.searchParams.set('steps', String(steps));
  url.searchParams.set('language', language);

  const { signal, cleanup } = withTimeout(args.signal, args.timeoutMs ?? 12_000);
  try {
    const res = await fetch(url, { signal });
    const raw = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw upstreamHttpError('mapbox_directions', res, raw);
    }
    const route = raw?.routes?.[0];
    if (!route) throw new Error('mapbox_directions_no_route');
    const geometry = route.geometry;
    const distance = Number(route.distance);
    const duration = Number(route.duration);
    if (!Number.isFinite(distance) || !Number.isFinite(duration)) throw new Error('mapbox_directions_bad_numbers');
    const normalized: GeoRouteResponse = {
      distance_meters: Math.round(distance),
      duration_seconds: Math.round(duration),
      geometry: geometry && geometry.type === 'LineString' ? geometry : undefined,
      provider_details: {
        profile,
        weight_name: route.weight_name,
      },
    };
    return { raw, normalized };
  } finally {
    cleanup();
  }
}

export async function mapboxGeocode(args: {
  accessToken: string;
  query: string;
  language: string;
  country: string; // ISO 3166-1 alpha-2
  limit: number;
  permanent?: boolean; // Set true only if you have storage rights for results
  signal?: AbortSignal;
  timeoutMs?: number;
}): Promise<{ raw: unknown; normalized: GeoSearchResult[] }> {
  // Geocoding API v6 (recommended). Note: response use and caching terms depend on your Mapbox plan.
  const url = new URL('https://api.mapbox.com/search/geocode/v6/forward');
  url.searchParams.set('access_token', args.accessToken);
  url.searchParams.set('q', args.query);
  url.searchParams.set('language', args.language);
  url.searchParams.set('country', args.country.toLowerCase());
  url.searchParams.set('limit', String(args.limit));
  url.searchParams.set('autocomplete', 'true');
  // Mapbox distinguishes between temporary vs permanent results for storage/caching.
  url.searchParams.set('permanent', args.permanent ? 'true' : 'false');

  const { signal, cleanup } = withTimeout(args.signal, args.timeoutMs ?? 12_000);
  try {
    const res = await fetch(url, { signal });
    const raw = await res.json().catch(() => ({}));
    if (!res.ok) throw upstreamHttpError('mapbox_geocode', res, raw);
    const features = Array.isArray((raw as any)?.features) ? (raw as any).features : [];
    const normalized: GeoSearchResult[] = features
      .slice(0, args.limit)
      .map((f: any) => {
        const coords = f?.properties?.coordinates;
        const lng = typeof coords?.longitude === 'number' ? coords.longitude : Number(f?.geometry?.coordinates?.[0]);
        const lat = typeof coords?.latitude === 'number' ? coords.latitude : Number(f?.geometry?.coordinates?.[1]);
        const label =
          String(f?.properties?.full_address ?? '') ||
          String(f?.properties?.place_formatted ?? '') ||
          String(f?.properties?.name_preferred ?? f?.properties?.name ?? '');
        const id = typeof f?.properties?.mapbox_id === 'string' ? f.properties.mapbox_id : (typeof f?.id === 'string' ? f.id : undefined);
        return {
          label,
          location: { lng, lat },
          provider_place_id: id,
          raw: { type: f?.properties?.feature_type, accuracy: f?.properties?.accuracy },
        } as GeoSearchResult;
      })
      .filter((r: GeoSearchResult) => Number.isFinite(r.location.lat) && Number.isFinite(r.location.lng) && r.label);
    return { raw, normalized };
  } finally {
    cleanup();
  }
}

export async function mapboxReverse(args: {
  accessToken: string;
  at: LatLng;
  language: string;
  country: string;
  limit: number;
  permanent?: boolean;
  signal?: AbortSignal;
  timeoutMs?: number;
}): Promise<{ raw: unknown; normalized: GeoSearchResult[] }> {
  const url = new URL('https://api.mapbox.com/search/geocode/v6/reverse');
  url.searchParams.set('access_token', args.accessToken);
  url.searchParams.set('longitude', String(args.at.lng));
  url.searchParams.set('latitude', String(args.at.lat));
  url.searchParams.set('language', args.language);
  url.searchParams.set('country', args.country.toLowerCase());
  // Reverse geocode: Mapbox v6 requires a single type if limit is 1.
  url.searchParams.set('types', 'address');
  url.searchParams.set('limit', String(args.limit));
  url.searchParams.set('permanent', args.permanent ? 'true' : 'false');

  const { signal, cleanup } = withTimeout(args.signal, args.timeoutMs ?? 12_000);
  try {
    const res = await fetch(url, { signal });
    const raw = await res.json().catch(() => ({}));
    if (!res.ok) throw upstreamHttpError('mapbox_reverse', res, raw);
    const features = Array.isArray((raw as any)?.features) ? (raw as any).features : [];
    const normalized: GeoSearchResult[] = features
      .slice(0, args.limit)
      .map((f: any) => {
        const coords = f?.properties?.coordinates;
        const lng = typeof coords?.longitude === 'number' ? coords.longitude : Number(f?.geometry?.coordinates?.[0]);
        const lat = typeof coords?.latitude === 'number' ? coords.latitude : Number(f?.geometry?.coordinates?.[1]);
        const label =
          String(f?.properties?.full_address ?? '') ||
          String(f?.properties?.place_formatted ?? '') ||
          String(f?.properties?.name_preferred ?? f?.properties?.name ?? '');
        const id = typeof f?.properties?.mapbox_id === 'string' ? f.properties.mapbox_id : (typeof f?.id === 'string' ? f.id : undefined);
        return {
          label,
          location: { lng, lat },
          provider_place_id: id,
          raw: { type: f?.properties?.feature_type, accuracy: f?.properties?.accuracy },
        } as GeoSearchResult;
      })
      .filter((r: GeoSearchResult) => Number.isFinite(r.location.lat) && Number.isFinite(r.location.lng) && r.label);
    return { raw, normalized };
  } finally {
    cleanup();
  }
}

export async function mapboxMatrix(args: {
  accessToken: string;
  profile: 'driving' | 'walking' | 'cycling' | 'driving-traffic';
  coordinates: LatLng[];
  sources?: number[];
  destinations?: number[];
  annotations: Array<'duration' | 'distance'>;
  signal?: AbortSignal;
  timeoutMs?: number;
}): Promise<{ raw: unknown; normalized: GeoMatrixResponse }> {
  const coords = args.coordinates.map((p) => `${p.lng},${p.lat}`).join(';');
  const url = new URL(`https://api.mapbox.com/directions-matrix/v1/mapbox/${args.profile}/${coords}`);
  url.searchParams.set('access_token', args.accessToken);
  url.searchParams.set('annotations', args.annotations.join(','));
  if (args.sources?.length) url.searchParams.set('sources', args.sources.join(';'));
  if (args.destinations?.length) url.searchParams.set('destinations', args.destinations.join(';'));

  const { signal, cleanup } = withTimeout(args.signal, args.timeoutMs ?? 15_000);
  try {
    const res = await fetch(url, { signal });
    const raw = await res.json().catch(() => ({}));
    if (!res.ok) throw upstreamHttpError('mapbox_matrix', res, raw);
    const durations = raw?.durations;
    const distances = raw?.distances;
    const normalized: GeoMatrixResponse = {
      durations_seconds: Array.isArray(durations) ? durations : undefined,
      distances_meters: Array.isArray(distances) ? distances : undefined,
    };
    return { raw, normalized };
  } finally {
    cleanup();
  }
}
