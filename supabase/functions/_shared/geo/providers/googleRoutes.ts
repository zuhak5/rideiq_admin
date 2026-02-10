import { decodeGooglePolyline } from '../polyline.ts';
import { GeoMatrixResponse, GeoRouteResponse, GeoRouteMatrixElement, LatLng } from '../types.ts';
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

function parseDurationSeconds(d: unknown): number {
  // Routes API returns protobuf Duration as a string like "123s".
  if (typeof d !== 'string') return NaN;
  const m = d.match(/^([0-9]+)(?:\.[0-9]+)?s$/);
  return m ? Number(m[1]) : NaN;
}

export async function googleComputeRoutes(args: {
  apiKey: string;
  origin: LatLng;
  destination: LatLng;
  travelMode: 'DRIVE' | 'WALK' | 'BICYCLE';
  languageCode: string; // BCP-47, e.g. ar
  regionCode: string; // CLDR region, e.g. IQ
  signal?: AbortSignal;
  timeoutMs?: number;
}): Promise<{ raw: unknown; normalized: GeoRouteResponse }> {
  const url = 'https://routes.googleapis.com/directions/v2:computeRoutes';
  const body = {
    origin: { location: { latLng: { latitude: args.origin.lat, longitude: args.origin.lng } } },
    destination: { location: { latLng: { latitude: args.destination.lat, longitude: args.destination.lng } } },
    travelMode: args.travelMode,
    languageCode: args.languageCode,
    regionCode: args.regionCode,
  };

  const fieldMask = [
    'routes.distanceMeters',
    'routes.duration',
    'routes.polyline.encodedPolyline',
  ].join(',');

  const { signal, cleanup } = withTimeout(args.signal, args.timeoutMs ?? 12_000);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-goog-api-key': args.apiKey,
        'x-goog-fieldmask': fieldMask,
      },
      body: JSON.stringify(body),
      signal,
    });
    const raw = await res.json().catch(() => ({}));
    if (!res.ok) throw upstreamHttpError('google_computeRoutes', res, raw);
    const route = raw?.routes?.[0];
    if (!route) throw new Error('google_computeRoutes_no_route');
    const distance = Number(route?.distanceMeters);
    const duration = parseDurationSeconds(route?.duration);
    const encoded = route?.polyline?.encodedPolyline;
    if (!Number.isFinite(distance) || !Number.isFinite(duration) || typeof encoded !== 'string') {
      throw new Error('google_computeRoutes_bad_payload');
    }
    const coords = decodeGooglePolyline(encoded);
    const geometry = { type: 'LineString', coordinates: coords } as const;
    const normalized: GeoRouteResponse = {
      distance_meters: Math.round(distance),
      duration_seconds: Math.round(duration),
      geometry,
      polyline: encoded,
      polyline_type: 'google_encoded_polyline',
      provider_details: { travelMode: args.travelMode },
    };
    return { raw, normalized };
  } finally {
    cleanup();
  }
}

export async function googleComputeRouteMatrix(args: {
  apiKey: string;
  origins: LatLng[];
  destinations: LatLng[];
  travelMode: 'DRIVE' | 'WALK' | 'BICYCLE';
  languageCode: string;
  regionCode: string;
  signal?: AbortSignal;
  timeoutMs?: number;
}): Promise<{ raw: unknown[]; normalized: GeoMatrixResponse }> {
  const url = 'https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix';
  const body = {
    origins: args.origins.map((o) => ({ waypoint: { location: { latLng: { latitude: o.lat, longitude: o.lng } } } })),
    destinations: args.destinations.map((d) => ({ waypoint: { location: { latLng: { latitude: d.lat, longitude: d.lng } } } })),
    travelMode: args.travelMode,
    languageCode: args.languageCode,
    regionCode: args.regionCode,
  };

  const fieldMask = [
    'originIndex',
    'destinationIndex',
    'distanceMeters',
    'duration',
    'condition',
  ].join(',');

  const { signal, cleanup } = withTimeout(args.signal, args.timeoutMs ?? 15_000);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-goog-api-key': args.apiKey,
        'x-goog-fieldmask': fieldMask,
      },
      body: JSON.stringify(body),
      signal,
    });

    // REST returns a *stream* of JSON objects (chunked). Parse line-delimited JSON defensively.
    const text = await res.text();
    if (!res.ok) throw upstreamHttpError('google_computeRouteMatrix', res, { body: text });
    const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const raw: unknown[] = [];
    const elements: GeoRouteMatrixElement[] = [];
    for (const line of lines) {
      const obj = JSON.parse(line);
      raw.push(obj);
      const oi = Number(obj?.originIndex);
      const di = Number(obj?.destinationIndex);
      const dist = Number(obj?.distanceMeters);
      const dur = parseDurationSeconds(obj?.duration);
      const cond = typeof obj?.condition === 'string' ? obj.condition : undefined;
      if (Number.isFinite(oi) && Number.isFinite(di)) {
        elements.push({
          origin_index: oi,
          destination_index: di,
          distance_meters: Number.isFinite(dist) ? Math.round(dist) : undefined,
          duration_seconds: Number.isFinite(dur) ? Math.round(dur) : undefined,
          status: cond,
        });
      }
    }
    const normalized: GeoMatrixResponse = { elements };
    return { raw, normalized };
  } finally {
    cleanup();
  }
}
