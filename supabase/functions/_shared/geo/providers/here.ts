import { decodeHereFlexiblePolylineToLineString } from '../flexiblePolyline.ts';
import { GeoRouteResponse, GeoSearchResult, LatLng } from '../types.ts';
import { upstreamHttpError } from '../upstreamError.ts';

function withTimeout(signal: AbortSignal | undefined, timeoutMs: number): { signal: AbortSignal; cleanup: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener('abort', () => controller.abort(), { once: true });
  }
  return { signal: controller.signal, cleanup: () => clearTimeout(timer) };
}

export async function hereRoutes(args: {
  apiKey: string;
  origin: LatLng;
  destination: LatLng;
  transportMode: 'car' | 'pedestrian' | 'bicycle';
  language: string;
  signal?: AbortSignal;
  timeoutMs?: number;
}): Promise<{ raw: unknown; normalized: GeoRouteResponse }> {
  const url = new URL('https://router.hereapi.com/v8/routes');
  url.searchParams.set('transportMode', args.transportMode);
  url.searchParams.set('origin', `${args.origin.lat},${args.origin.lng}`);
  url.searchParams.set('destination', `${args.destination.lat},${args.destination.lng}`);
  url.searchParams.set('return', 'summary,polyline');
  url.searchParams.set('lang', args.language);
  url.searchParams.set('apikey', args.apiKey);

  const { signal, cleanup } = withTimeout(args.signal, args.timeoutMs ?? 12_000);
  try {
    const res = await fetch(url, { signal });
    const raw = await res.json().catch(() => ({}));
    if (!res.ok) throw upstreamHttpError('here_routes', res, raw);
    const section = raw?.routes?.[0]?.sections?.[0];
    const summary = section?.summary;
    const length = Number(summary?.length);
    const duration = Number(summary?.duration);
    const polyline = section?.polyline;
    if (!Number.isFinite(length) || !Number.isFinite(duration)) throw new Error('here_routes_bad_numbers');
    let geometry: GeoRouteResponse['geometry'] | undefined;
    if (typeof polyline === 'string' && polyline) {
      try {
        geometry = decodeHereFlexiblePolylineToLineString(polyline);
      } catch {
        geometry = undefined;
      }
    }

    const normalized: GeoRouteResponse = {
      distance_meters: Math.round(length),
      duration_seconds: Math.round(duration),
      geometry,
      polyline: typeof polyline === 'string' ? polyline : undefined,
      polyline_type: typeof polyline === 'string' ? 'here_flexible_polyline' : undefined,
      provider_details: { transportMode: args.transportMode },
    };
    return { raw, normalized };
  } finally {
    cleanup();
  }
}

export async function hereGeocode(args: {
  apiKey: string;
  query: string;
  language: string;
  limit: number;
  // Use Iraq focus filter when possible.
  inFilter?: string; // e.g. "countryCode:IRQ"
  signal?: AbortSignal;
  timeoutMs?: number;
}): Promise<{ raw: unknown; normalized: GeoSearchResult[] }> {
  const url = new URL('https://geocode.search.hereapi.com/v1/geocode');
  url.searchParams.set('q', args.query);
  url.searchParams.set('lang', args.language);
  url.searchParams.set('limit', String(args.limit));
  if (args.inFilter) url.searchParams.set('in', args.inFilter);
  url.searchParams.set('apiKey', args.apiKey);

  const { signal, cleanup } = withTimeout(args.signal, args.timeoutMs ?? 12_000);
  try {
    const res = await fetch(url, { signal });
    const raw = await res.json().catch(() => ({}));
    if (!res.ok) throw upstreamHttpError('here_geocode', res, raw);
    const items = Array.isArray(raw?.items) ? raw.items : [];
    const normalized: GeoSearchResult[] = items.slice(0, args.limit).map((it: any) => ({
      label: String(it?.title ?? it?.address?.label ?? ''),
      location: { lat: Number(it?.position?.lat), lng: Number(it?.position?.lng) },
      provider_place_id: typeof it?.id === 'string' ? it.id : undefined,
      raw: { resultType: it?.resultType, houseNumberType: it?.houseNumberType },
      context: it?.address ?? undefined,
    })).filter((r: GeoSearchResult) => Number.isFinite(r.location.lat) && Number.isFinite(r.location.lng) && r.label);
    return { raw, normalized };
  } finally {
    cleanup();
  }
}

export async function hereRevGeocode(args: {
  apiKey: string;
  at: LatLng;
  language: string;
  limit: number;
  signal?: AbortSignal;
  timeoutMs?: number;
}): Promise<{ raw: unknown; normalized: GeoSearchResult[] }> {
  const url = new URL('https://revgeocode.search.hereapi.com/v1/revgeocode');
  url.searchParams.set('at', `${args.at.lat},${args.at.lng}`);
  url.searchParams.set('lang', args.language);
  url.searchParams.set('limit', String(args.limit));
  url.searchParams.set('apiKey', args.apiKey);

  const { signal, cleanup } = withTimeout(args.signal, args.timeoutMs ?? 12_000);
  try {
    const res = await fetch(url, { signal });
    const raw = await res.json().catch(() => ({}));
    if (!res.ok) throw upstreamHttpError('here_revgeocode', res, raw);
    const items = Array.isArray(raw?.items) ? raw.items : [];
    const normalized: GeoSearchResult[] = items.slice(0, args.limit).map((it: any) => ({
      label: String(it?.title ?? it?.address?.label ?? ''),
      location: { lat: Number(it?.position?.lat), lng: Number(it?.position?.lng) },
      provider_place_id: typeof it?.id === 'string' ? it.id : undefined,
      raw: { resultType: it?.resultType },
      context: it?.address ?? undefined,
    })).filter((r: GeoSearchResult) => Number.isFinite(r.location.lat) && Number.isFinite(r.location.lng) && r.label);
    return { raw, normalized };
  } finally {
    cleanup();
  }
}
