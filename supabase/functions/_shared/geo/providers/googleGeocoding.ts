import { GeoSearchResult, LatLng } from '../types.ts';
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

export async function googleGeocode(args: {
  apiKey: string;
  address: string;
  language: string;
  region: string; // ISO 3166-1 alpha-2
  limit: number;
  signal?: AbortSignal;
  timeoutMs?: number;
}): Promise<{ raw: unknown; normalized: GeoSearchResult[] }> {
  const url = new URL('https://maps.googleapis.com/maps/api/geocode/json');
  url.searchParams.set('address', args.address);
  url.searchParams.set('key', args.apiKey);
  url.searchParams.set('language', args.language);
  url.searchParams.set('region', args.region.toLowerCase());
  // Strong bias for Iraq if configured.
  if (args.region.toUpperCase() === 'IQ') url.searchParams.set('components', 'country:IQ');

  const { signal, cleanup } = withTimeout(args.signal, args.timeoutMs ?? 12_000);
  try {
    const res = await fetch(url, { signal });
    const raw = await res.json().catch(() => ({}));
    if (!res.ok) throw upstreamHttpError('google_geocode', res, raw);
    const status = raw?.status;
    if (status && status !== 'OK' && status !== 'ZERO_RESULTS') {
      throw new Error(`google_geocode_${String(status).toLowerCase()}`);
    }
    const results = Array.isArray(raw?.results) ? raw.results : [];
    const normalized: GeoSearchResult[] = results.slice(0, args.limit).map((r: any) => ({
      label: String(r?.formatted_address ?? ''),
      location: { lat: Number(r?.geometry?.location?.lat), lng: Number(r?.geometry?.location?.lng) },
      provider_place_id: typeof r?.place_id === 'string' ? r.place_id : undefined,
      raw: { types: r?.types, location_type: r?.geometry?.location_type },
      context: { address_components: r?.address_components },
    })).filter((x: GeoSearchResult) => x.label && Number.isFinite(x.location.lat) && Number.isFinite(x.location.lng));
    return { raw, normalized };
  } finally {
    cleanup();
  }
}

export async function googleReverseGeocode(args: {
  apiKey: string;
  at: LatLng;
  language: string;
  region: string;
  limit: number;
  signal?: AbortSignal;
  timeoutMs?: number;
}): Promise<{ raw: unknown; normalized: GeoSearchResult[] }> {
  const url = new URL('https://maps.googleapis.com/maps/api/geocode/json');
  url.searchParams.set('latlng', `${args.at.lat},${args.at.lng}`);
  url.searchParams.set('key', args.apiKey);
  url.searchParams.set('language', args.language);
  url.searchParams.set('region', args.region.toLowerCase());
  // Prefer addresses (avoid big administrative results).
  url.searchParams.set('result_type', 'street_address|premise|route|neighborhood|locality');

  const { signal, cleanup } = withTimeout(args.signal, args.timeoutMs ?? 12_000);
  try {
    const res = await fetch(url, { signal });
    const raw = await res.json().catch(() => ({}));
    if (!res.ok) throw upstreamHttpError('google_reverse', res, raw);
    const status = raw?.status;
    if (status && status !== 'OK' && status !== 'ZERO_RESULTS') {
      throw new Error(`google_reverse_${String(status).toLowerCase()}`);
    }
    const results = Array.isArray(raw?.results) ? raw.results : [];
    const normalized: GeoSearchResult[] = results.slice(0, args.limit).map((r: any) => ({
      label: String(r?.formatted_address ?? ''),
      location: { lat: Number(r?.geometry?.location?.lat), lng: Number(r?.geometry?.location?.lng) },
      provider_place_id: typeof r?.place_id === 'string' ? r.place_id : undefined,
      raw: { types: r?.types, location_type: r?.geometry?.location_type },
      context: { address_components: r?.address_components },
    })).filter((x: GeoSearchResult) => x.label && Number.isFinite(x.location.lat) && Number.isFinite(x.location.lng));
    return { raw, normalized };
  } finally {
    cleanup();
  }
}
