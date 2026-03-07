import { invokeEdge } from './edgeInvoke';

export type MapsProvider = 'google' | 'mapbox' | 'here';
export type MapsCapability = 'render' | 'directions' | 'geocode' | 'distance_matrix';

// maps-config-v2 contract. The `config` object is provider-specific, but always
// includes { language, region }.
export type MapsConfigV2 = {
  ok: boolean;
  capability: MapsCapability;
  provider: MapsProvider;
  config: Record<string, unknown> & {
    language: string;
    region: string;
  };
  fallback_order?: MapsProvider[];
  // Render telemetry: stable request id for a single map initialization session,
  // and a short-lived token that authorizes anonymous telemetry events.
  request_id?: string;
  telemetry_token?: string;
  telemetry_expires_at?: string;
};

const CACHE_TTL_MS = 30_000;

type CacheEntry = {
  promise: Promise<MapsConfigV2>;
  expiresAt: number;
};

const _cache = new Map<string, CacheEntry>();
let _lastMapsConfig: MapsConfigV2 | null = null;

export function getLastMapsConfig(): MapsConfigV2 | null {
  return _lastMapsConfig;
}

export async function fetchMapsConfigV2(opts?: {
  capability?: MapsCapability;
  exclude?: MapsProvider[];
  supported?: MapsProvider[];
  request_id?: string;
}): Promise<MapsConfigV2> {
  const capability = opts?.capability ?? 'render';
  const exclude = opts?.exclude ?? [];
  const supported = opts?.supported ?? ['google', 'mapbox', 'here'];
  const request_id = opts?.request_id;

  const key = JSON.stringify({ capability, exclude, supported, request_id: capability === 'render' ? request_id ?? null : null });
  const now = Date.now();
  const cached = _cache.get(key);
  if (cached && cached.expiresAt > now) return cached.promise;
  if (cached) _cache.delete(key);

  const fetcher = async () => {
    const { data } = await invokeEdge<MapsConfigV2>('maps-config-v2', {
      capability,
      supported,
      exclude,
      ...(request_id ? { request_id } : {}),
    });
    if (!data?.ok) throw new Error('maps-config-v2 returned not ok');
    _lastMapsConfig = data;
    return data;
  };

  const promise = fetcher();
  _cache.set(key, { promise, expiresAt: now + CACHE_TTL_MS });
  promise.catch(() => {
    _cache.delete(key);
  });
  return promise;
}

export function clearMapsConfigCache() {
  _cache.clear();
}
