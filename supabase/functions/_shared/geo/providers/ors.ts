import { GeoMatrixResponse, GeoRouteResponse, GeoSearchResult, LatLng } from '../types.ts';
import { upstreamHttpError } from '../upstreamError.ts';

type OrsProfile = 'driving-car' | 'foot-walking' | 'cycling-regular';

type OrsStep = {
  distance?: number;
  duration?: number;
  instruction?: string;
  name?: string;
  type?: number;
  way_points?: number[];
};

// OpenRouteService directions does not accept all BCP-47 language tags.
// Keep this list conservative and map locale variants (e.g. ar-IQ -> ar).
const ORS_DIRECTIONS_LANGUAGES = new Set([
  'cs',
  'da',
  'de',
  'en',
  'eo',
  'es',
  'fi',
  'fr',
  'gr',
  'he',
  'hu',
  'id',
  'it',
  'ja',
  'nb',
  'ne',
  'nl',
  'pl',
  'pt',
  'ro',
  'ru',
  'sv',
  'tr',
  'ua',
  'vi',
  'zh',
]);

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

function buildHeaders(apiKey: string): Headers {
  const headers = new Headers();
  headers.set('Authorization', apiKey);
  headers.set('Content-Type', 'application/json');
  return headers;
}

function clampLanguage(lang: string): string {
  const trimmed = lang.trim();
  if (!trimmed) return 'ar';
  if (trimmed.length > 16) return 'ar';
  return trimmed;
}

function clampRegion(region: string): string {
  const trimmed = region.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(trimmed)) return 'IQ';
  return trimmed;
}

export function normalizeOrsDirectionsLanguage(lang: string): string | null {
  const trimmed = lang.trim().toLowerCase();
  if (!trimmed) return null;
  const base = trimmed.split('-')[0];
  if (!base) return null;
  return ORS_DIRECTIONS_LANGUAGES.has(base) ? base : null;
}

function normalizeSteps(steps: unknown): OrsStep[] | null {
  if (!Array.isArray(steps)) return null;
  const normalized = steps
    .map((s) => ({
      distance: typeof (s as any)?.distance === 'number' ? (s as any).distance : undefined,
      duration: typeof (s as any)?.duration === 'number' ? (s as any).duration : undefined,
      instruction: typeof (s as any)?.instruction === 'string' ? (s as any).instruction : undefined,
      name: typeof (s as any)?.name === 'string' ? (s as any).name : undefined,
      type: typeof (s as any)?.type === 'number' ? (s as any).type : undefined,
      way_points: Array.isArray((s as any)?.way_points) ? (s as any).way_points : undefined,
    }))
    .filter((s) => s.instruction || s.name || Number.isFinite(s.distance) || Number.isFinite(s.duration));
  return normalized.length ? normalized : null;
}

export async function orsDirections(args: {
  apiKey: string;
  origin: LatLng;
  destination: LatLng;
  profile: OrsProfile;
  language: string;
  steps: boolean;
  snapRadiusMeters?: number;
  signal?: AbortSignal;
  timeoutMs?: number;
}): Promise<{ raw: unknown; normalized: GeoRouteResponse }> {
  const url = `https://api.openrouteservice.org/v2/directions/${args.profile}/geojson`;
  const body: Record<string, unknown> = {
    coordinates: [
      [args.origin.lng, args.origin.lat],
      [args.destination.lng, args.destination.lat],
    ],
    instructions: args.steps,
    units: 'm',
  };
  if (Number.isFinite(args.snapRadiusMeters) && Number(args.snapRadiusMeters) > 0) {
    const radius = Math.trunc(Number(args.snapRadiusMeters));
    body.radiuses = [radius, radius];
  }
  const directionsLanguage = normalizeOrsDirectionsLanguage(clampLanguage(args.language));
  if (args.steps && directionsLanguage) {
    body.language = directionsLanguage;
  }

  const { signal, cleanup } = withTimeout(args.signal, args.timeoutMs ?? 12_000);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: buildHeaders(args.apiKey),
      body: JSON.stringify(body),
      signal,
    });
    const raw = await res.json().catch(() => ({}));
    if (!res.ok) throw upstreamHttpError('ors_directions', res, raw);

    const feature = (raw as any)?.features?.[0];
    if (!feature) throw new Error('ors_directions_no_route');

    const summary = feature?.properties?.summary ?? {};
    const distance = Number(summary?.distance ?? feature?.properties?.segments?.[0]?.distance);
    const duration = Number(summary?.duration ?? feature?.properties?.segments?.[0]?.duration);
    if (!Number.isFinite(distance) || !Number.isFinite(duration)) throw new Error('ors_directions_bad_numbers');

    const geometry = feature?.geometry;
    const steps = normalizeSteps(feature?.properties?.segments?.[0]?.steps);

    const normalized: GeoRouteResponse = {
      distance_meters: Math.round(distance),
      duration_seconds: Math.round(duration),
      geometry: geometry && geometry.type === 'LineString' ? geometry : undefined,
      provider_details: {
        profile: args.profile,
        steps: steps ?? undefined,
      },
    };

    return { raw, normalized };
  } finally {
    cleanup();
  }
}

export async function orsMatrix(args: {
  apiKey: string;
  profile: OrsProfile;
  locations: LatLng[];
  sources?: number[];
  destinations?: number[];
  metrics: Array<'distance' | 'duration'>;
  signal?: AbortSignal;
  timeoutMs?: number;
}): Promise<{ raw: unknown; normalized: GeoMatrixResponse }> {
  const url = `https://api.openrouteservice.org/v2/matrix/${args.profile}`;
  const body: Record<string, unknown> = {
    locations: args.locations.map((p) => [p.lng, p.lat]),
    metrics: args.metrics,
    units: 'm',
  };
  if (args.sources?.length) body.sources = args.sources;
  if (args.destinations?.length) body.destinations = args.destinations;

  const { signal, cleanup } = withTimeout(args.signal, args.timeoutMs ?? 15_000);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: buildHeaders(args.apiKey),
      body: JSON.stringify(body),
      signal,
    });
    const raw = await res.json().catch(() => ({}));
    if (!res.ok) throw upstreamHttpError('ors_matrix', res, raw);

    const normalized: GeoMatrixResponse = {
      durations_seconds: Array.isArray((raw as any)?.durations) ? (raw as any).durations : undefined,
      distances_meters: Array.isArray((raw as any)?.distances) ? (raw as any).distances : undefined,
    };
    return { raw, normalized };
  } finally {
    cleanup();
  }
}

export async function orsGeocode(args: {
  apiKey: string;
  query: string;
  language: string;
  region: string;
  limit: number;
  signal?: AbortSignal;
  timeoutMs?: number;
}): Promise<{ raw: unknown; normalized: GeoSearchResult[] }> {
  const url = new URL('https://api.openrouteservice.org/geocode/search');
  url.searchParams.set('text', args.query);
  url.searchParams.set('size', String(args.limit));
  url.searchParams.set('lang', clampLanguage(args.language));
  url.searchParams.set('boundary.country', clampRegion(args.region));

  const { signal, cleanup } = withTimeout(args.signal, args.timeoutMs ?? 12_000);
  try {
    const res = await fetch(url, { headers: buildHeaders(args.apiKey), signal });
    const raw = await res.json().catch(() => ({}));
    if (!res.ok) throw upstreamHttpError('ors_geocode', res, raw);

    const features = Array.isArray((raw as any)?.features) ? (raw as any).features : [];
    const normalized: GeoSearchResult[] = features
      .slice(0, args.limit)
      .map((f: any) => {
        const coords = f?.geometry?.coordinates;
        const lng = Number(coords?.[0]);
        const lat = Number(coords?.[1]);
        const label = String(f?.properties?.label ?? f?.properties?.name ?? '');
        const id = typeof f?.properties?.id === 'string' ? f.properties.id : undefined;
        return {
          label,
          location: { lng, lat },
          provider_place_id: id,
          context: {
            country: f?.properties?.country,
            region: f?.properties?.region,
            locality: f?.properties?.locality,
          },
          raw: {
            confidence: f?.properties?.confidence,
            layer: f?.properties?.layer,
          },
        } as GeoSearchResult;
      })
      .filter((r: GeoSearchResult) => Number.isFinite(r.location.lat) && Number.isFinite(r.location.lng) && r.label);

    return { raw, normalized };
  } finally {
    cleanup();
  }
}

export async function orsReverse(args: {
  apiKey: string;
  at: LatLng;
  language: string;
  region: string;
  limit: number;
  signal?: AbortSignal;
  timeoutMs?: number;
}): Promise<{ raw: unknown; normalized: GeoSearchResult[] }> {
  const url = new URL('https://api.openrouteservice.org/geocode/reverse');
  url.searchParams.set('point.lat', String(args.at.lat));
  url.searchParams.set('point.lon', String(args.at.lng));
  url.searchParams.set('size', String(args.limit));
  url.searchParams.set('lang', clampLanguage(args.language));
  url.searchParams.set('boundary.country', clampRegion(args.region));

  const { signal, cleanup } = withTimeout(args.signal, args.timeoutMs ?? 12_000);
  try {
    const res = await fetch(url, { headers: buildHeaders(args.apiKey), signal });
    const raw = await res.json().catch(() => ({}));
    if (!res.ok) throw upstreamHttpError('ors_reverse', res, raw);

    const features = Array.isArray((raw as any)?.features) ? (raw as any).features : [];
    const normalized: GeoSearchResult[] = features
      .slice(0, args.limit)
      .map((f: any) => {
        const coords = f?.geometry?.coordinates;
        const lng = Number(coords?.[0]);
        const lat = Number(coords?.[1]);
        const label = String(f?.properties?.label ?? f?.properties?.name ?? '');
        const id = typeof f?.properties?.id === 'string' ? f.properties.id : undefined;
        return {
          label,
          location: { lng, lat },
          provider_place_id: id,
          context: {
            country: f?.properties?.country,
            region: f?.properties?.region,
            locality: f?.properties?.locality,
          },
          raw: {
            confidence: f?.properties?.confidence,
            layer: f?.properties?.layer,
          },
        } as GeoSearchResult;
      })
      .filter((r: GeoSearchResult) => Number.isFinite(r.location.lat) && Number.isFinite(r.location.lng) && r.label);

    return { raw, normalized };
  } finally {
    cleanup();
  }
}
