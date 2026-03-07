import { withRequestContext } from '../_shared/requestContext.ts';
import { errorJson, json } from '../_shared/json.ts';
import { requireUser } from '../_shared/supabase.ts';
import { buildRateLimitHeaders, consumeRateLimit, getClientIp } from '../_shared/rateLimit.ts';

import { googleComputeRoutes, googleComputeRouteMatrix } from '../_shared/geo/providers/googleRoutes.ts';
import { googleGeocode, googleReverseGeocode } from '../_shared/geo/providers/googleGeocoding.ts';
import { mapboxDirections, mapboxGeocode, mapboxMatrix, mapboxReverse } from '../_shared/geo/providers/mapbox.ts';
import { hereGeocode, hereRevGeocode, hereRoutes } from '../_shared/geo/providers/here.ts';
import {
  createServiceClientForGeo,
  getProviderDefaults,
  getServerKey,
  makeCacheKey,
  pickProvider,
  providerHasServerKey,
} from '../_shared/geo/orchestrator.ts';
import { parseProviderCode, type Capability, type LatLng, type ProviderCode } from '../_shared/geo/types.ts';

type Action = 'route' | 'geocode' | 'reverse' | 'matrix';

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function validateLatLng(v: any): LatLng | null {
  if (!v) return null;
  const lat = Number(v.lat);
  const lng = Number(v.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { lat, lng };
}

function clampLanguage(lang: unknown): string {
  const s = typeof lang === 'string' ? lang.trim() : '';
  // Keep it simple: accept `ar` or `ar-IQ` etc; fallback to Arabic.
  if (!s) return 'ar';
  if (s.length > 16) return 'ar';
  return s;
}

function clampRegion(region: unknown): string {
  const s = typeof region === 'string' ? region.trim().toUpperCase() : '';
  if (!s) return 'IQ';
  if (!/^[A-Z]{2}$/.test(s)) return 'IQ';
  return s;
}

function estimateUnits(action: Action, body: any): number {
  if (action === 'matrix') {
    const o = Array.isArray(body?.origins) ? body.origins.length : 1;
    const d = Array.isArray(body?.destinations) ? body.destinations.length : 1;
    const units = o * d;
    return Math.max(1, Math.min(100000, Math.trunc(units)));
  }
  return 1;
}

function normalizeProviderCode(v: unknown): ProviderCode | null {
  return parseProviderCode(v);
}

function defaultCapabilityForAction(action: Action): Capability {
  if (action === 'route') return 'directions';
  if (action === 'matrix') return 'distance_matrix';
  return 'geocode';
}

function googleAllowedForRenderer(renderer: ProviderCode | null): boolean {
  // Google Maps Platform terms restrict using Google Maps Content with non-Google maps.
  // To stay compliant by default, only allow Google web-services when the renderer is Google.
  return renderer === 'google';
}

function mapboxAllowedForRenderer(renderer: ProviderCode | null): boolean {
  // Mapbox Geocoding terms restrict using responses in conjunction with non-Mapbox maps.
  // We therefore only allow Mapbox web-services when the renderer is Mapbox.
  return renderer === 'mapbox';
}

function summarizeLatLng(p: LatLng | null): string | null {
  if (!p) return null;
  return `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`;
}

function endpointHint(provider: ProviderCode, action: Action): string {
  switch (provider) {
    case 'google':
      if (action === 'route' || action === 'matrix') return 'routes.googleapis.com/directions/v2';
      return 'maps.googleapis.com/maps/api/geocode';
    case 'mapbox':
      if (action === 'route') return 'api.mapbox.com/directions/v5';
      if (action === 'matrix') return 'api.mapbox.com/directions-matrix/v1';
      return 'api.mapbox.com/search/geocode/v6';
    case 'here':
      if (action === 'route') return 'router.hereapi.com/v8/routes';
      return 'geocode.search.hereapi.com/v1';
    default:
      return 'n/a';
  }
}

export default Deno.serve((req: Request) => withRequestContext('geo', req, async (ctx) => {
  if (req.method !== 'POST') return errorJson('Method not allowed', 405, 'method_not_allowed');

  const auth = await requireUser(req, ctx);
  if (!auth.user) return errorJson(auth.error ?? 'Unauthorized', 401, 'unauthorized');
  const userId = auth.user.id;

  let body: any;
  try {
    body = await req.json();
  } catch {
    return errorJson('Invalid JSON body', 400, 'bad_json');
  }

  const action = body?.action as Action;
  if (action !== 'route' && action !== 'geocode' && action !== 'reverse' && action !== 'matrix') {
    return errorJson('Invalid action', 400, 'bad_action');
  }

  const renderer = normalizeProviderCode(body?.renderer) ?? null;
  const capability = defaultCapabilityForAction(action);

  // Rate-limit: fail-closed because this endpoint can incur third-party API spend.
  const ip = getClientIp(req) ?? 'unknown';
  const rlKey = `geo:${action}:${userId}:${ip}`;
  const limit = action === 'route' ? 120 : action === 'matrix' ? 60 : 90;
  const windowSeconds = 60;
  const rl = await consumeRateLimit({ key: rlKey, windowSeconds, limit, failOpen: false });
  if (!rl.allowed) {
    return errorJson('Rate limit exceeded', 429, 'rate_limited', undefined, buildRateLimitHeaders({
      limit,
      remaining: rl.remaining,
      resetAt: rl.resetAt,
    }));
  }

  const service = createServiceClientForGeo();
  const requestUuid = crypto.randomUUID();

  // Exclusions and compliance: avoid Google content when rendering non-Google maps.
  const exclude: ProviderCode[] = Array.isArray(body?.exclude)
    ? (body.exclude.map(normalizeProviderCode).filter(Boolean) as ProviderCode[])
    : [];
  if (!googleAllowedForRenderer(renderer)) {
    if (!exclude.includes('google')) exclude.push('google');
  }
  if (!mapboxAllowedForRenderer(renderer)) {
    if (!exclude.includes('mapbox')) exclude.push('mapbox');
  }
  const missingServerKeyProviders: ProviderCode[] = [];
  for (const p of ['google', 'mapbox', 'here'] as ProviderCode[]) {
    if (!providerHasServerKey(p) && !exclude.includes(p)) {
      exclude.push(p);
      missingServerKeyProviders.push(p);
    }
  }

  async function logAttempt(params: {
    provider: ProviderCode;
    httpStatus: number;
    latencyMs: number;
    billedUnits: number;
    attemptNumber: number;
    fallbackReason?: string | null;
    errorCode?: string | null;
    errorDetail?: string | null;
    triedProviders?: ProviderCode[];
    requestSummary?: Record<string, unknown>;
    responseSummary?: Record<string, unknown>;
    cacheHit?: boolean;
  }) {
    try {
      await service.from('maps_requests_log').insert({
        request_id: requestUuid,
        actor_user_id: userId,
        client_renderer: renderer,
        action,
        capability,
        provider_code: params.provider,
        http_status: params.httpStatus,
        latency_ms: params.latencyMs,
        billed_units: params.billedUnits,
        error_code: params.errorCode ?? null,
        error_detail: params.errorDetail ?? null,
        tried_providers: (params.triedProviders ?? []).length ? (params.triedProviders ?? []) : null,
        request_summary: { endpoint: endpointHint(params.provider, action), ...(params.requestSummary ?? {}) },
        response_summary: params.responseSummary ?? {},
        cache_hit: !!params.cacheHit,
        attempt_number: Math.max(1, Math.min(50, Math.trunc(params.attemptNumber))),
        fallback_reason: params.fallbackReason ?? null,
      });
    } catch {
      // Do not fail the request due to logging issues.
    }
  }

  async function healthOnFailure(params: {
    provider: ProviderCode;
    httpStatus: number | null;
    errorCode: string;
    baseCooldownSeconds: number;
  }) {
    try {
      await service.rpc('maps_provider_health_on_failure_v1', {
        p_provider_code: params.provider,
        p_capability: capability,
        p_http_status: params.httpStatus,
        p_error_code: params.errorCode,
        p_base_cooldown_seconds: params.baseCooldownSeconds,
      });
    } catch {
      // Non-fatal
    }
  }

  async function healthOnSuccess(provider: ProviderCode) {
    try {
      await service.rpc('maps_provider_health_on_success_v1', {
        p_provider_code: provider,
        p_capability: capability,
      });
    } catch {
      // Non-fatal
    }
  }

  async function usageIncrement(provider: ProviderCode, units: number) {
    try {
      await service.rpc('maps_usage_increment_v1', {
        p_provider_code: provider,
        p_capability: capability,
        p_units: Math.max(0, Math.min(100000, Math.floor(units))),
      });
    } catch {
      // Non-fatal
    }
  }

  async function cacheGet(cacheKey: string) {
    try {
      const { data, error } = await service.rpc('geo_cache_get_v1', { p_cache_key: cacheKey });
      if (error) return null;
      return data ?? null;
    } catch {
      return null;
    }
  }

  async function cachePut(cacheKey: string, provider: ProviderCode, responseJson: unknown, ttlSeconds: number) {
    try {
      if (!Number.isFinite(ttlSeconds) || ttlSeconds <= 0) return;
      await service.rpc('geo_cache_put_v1', {
        p_cache_key: cacheKey,
        p_provider_code: provider,
        p_capability: capability,
        p_response: responseJson,
        p_ttl_seconds: Math.max(60, Math.min(60 * 60 * 24 * 7, Math.trunc(ttlSeconds))),
      });
    } catch {
      // ignore
    }
  }

  // Choose provider and retry on provider errors, excluding failed providers.
  const tried: ProviderCode[] = [];
  type AttemptFailure = {
    provider: ProviderCode;
    http_status: number;
    error_code: string;
    error_detail: string;
    kind: 'no_route' | 'upstream';
  };
  const failures: AttemptFailure[] = [];
  const maxAttempts = 4;

  function failureSummaries(limit = 8) {
    return failures.slice(-limit).map((f) => ({
      provider: f.provider,
      http_status: f.http_status,
      error_code: f.error_code,
      error_detail: f.error_detail,
      kind: f.kind,
    }));
  }

  function allFailuresNoRoute(): boolean {
    return failures.length > 0 && failures.every((f) => f.kind === 'no_route');
  }

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const pickExclude = Array.from(new Set([...exclude, ...tried]));
    const provider = await pickProvider(service, capability, pickExclude);
    if (!provider) {
      if (tried.length > 0) {
        if (action === 'route' && allFailuresNoRoute()) {
          return errorJson('No route found between origin and destination', 404, 'no_route_found', {
            action,
            capability,
            tried,
            failures: failureSummaries(),
            hint: 'Move pickup/dropoff to nearby roads and retry.',
          });
        }
        return errorJson('All providers failed', 502, 'providers_failed', {
          action,
          capability,
          tried,
          failures: failureSummaries(),
        });
      }
      return errorJson('No provider available for this capability', 503, 'no_provider', {
        action,
        capability,
        exclude: pickExclude,
        missing_server_keys: missingServerKeyProviders.length ? missingServerKeyProviders : undefined,
      });
    }
    tried.push(provider);

    // Ensure provider has a configured server key.
    if (!providerHasServerKey(provider)) {
      await logAttempt({
        provider,
        httpStatus: 424,
        latencyMs: 0,
        billedUnits: 0,
        attemptNumber: attempt + 1,
        triedProviders: [...tried],
        fallbackReason: 'missing_key',
        errorCode: 'missing_provider_key',
        requestSummary: { note: 'provider selected but missing server key' },
      });
      continue;
    }

    const defaults = await getProviderDefaults(service, provider);
    const language = clampLanguage(body?.language ?? defaults?.language ?? 'ar');
    const region = clampRegion(body?.region ?? defaults?.region ?? 'IQ');

    // Persistent caching is OFF by default. Enable per-provider via Admin, and keep TTL conservative.
    const cacheEnabled = Boolean(defaults?.cache_enabled) && isFiniteNumber(defaults?.cache_ttl_seconds) && defaults.cache_ttl_seconds > 0;
    const cacheTtlSeconds = cacheEnabled ? Math.min(Math.max(60, Math.trunc(defaults!.cache_ttl_seconds!)), 60 * 60 * 24 * 7) : 0;

    const t0 = Date.now();
    let attemptRequestSummary: Record<string, unknown> | undefined;
    try {
      if (action === 'route') {
        const origin = validateLatLng(body?.origin);
        const destination = validateLatLng(body?.destination);
        if (!origin || !destination) return errorJson('Invalid origin/destination', 400, 'bad_coords');

        const profile = (body?.profile === 'walking' || body?.profile === 'cycling') ? body.profile : 'driving';
        const steps = Boolean(body?.steps ?? false);
        const alternatives = Boolean(body?.alternatives ?? false);
        const cacheBypass = Boolean(body?.cache_bypass ?? false);
        attemptRequestSummary = {
          origin: summarizeLatLng(origin),
          destination: summarizeLatLng(destination),
          profile,
          language,
          region,
          steps,
          alternatives,
        };

        const cacheKey = await makeCacheKey({
          v: 1,
          action,
          capability,
          provider,
          origin,
          destination,
          profile,
          language,
          region,
          steps,
          alternatives,
        });
        if (cacheEnabled && !cacheBypass) {
          const cached = await cacheGet(cacheKey);
          if (cached) {
            await logAttempt({
              provider,
              httpStatus: 200,
              latencyMs: Date.now() - t0,
              billedUnits: 0,
              attemptNumber: attempt + 1,
              triedProviders: [...tried],
              cacheHit: true,
              requestSummary: { origin: summarizeLatLng(origin), destination: summarizeLatLng(destination), profile, language, region },
              responseSummary: {
                distance_meters: Number((cached as any)?.distance_meters ?? (cached as any)?.distanceMeters ?? null),
              },
            });
            return json({ ok: true, request_id: requestUuid, provider, capability, cache: { hit: true }, data: cached });
          }
        }

        // Bill only after a successful upstream call (cache hits are free).

        const key = getServerKey(provider);
        let normalized: unknown;
        let raw: unknown;
        if (provider === 'google') {
          const travelMode = profile === 'walking' ? 'WALK' : profile === 'cycling' ? 'BICYCLE' : 'DRIVE';
          const out = await googleComputeRoutes({
            apiKey: key,
            origin,
            destination,
            travelMode,
            languageCode: language,
            regionCode: region,
          });
          raw = out.raw; normalized = out.normalized;
        } else if (provider === 'mapbox') {
          const mbProfile = profile === 'walking' ? 'walking' : profile === 'cycling' ? 'cycling' : 'driving';
          const out = await mapboxDirections({
            accessToken: key,
            origin,
            destination,
            profile: mbProfile,
            language,
            steps,
            alternatives,
          });
          raw = out.raw; normalized = out.normalized;
        } else if (provider === 'here') {
          const transportMode = profile === 'walking' ? 'pedestrian' : profile === 'cycling' ? 'bicycle' : 'car';
          const out = await hereRoutes({
            apiKey: key,
            origin,
            destination,
            transportMode,
            language,
          });
          raw = out.raw; normalized = out.normalized;
        } else {
          throw new Error('provider_unsupported_for_route');
        }

        await healthOnSuccess(provider);
        await usageIncrement(provider, 1);

        const latencyMs = Date.now() - t0;
        if (cacheEnabled && !cacheBypass) {
          await cachePut(cacheKey, provider, normalized, cacheTtlSeconds);
        }
        await logAttempt({
          provider,
          httpStatus: 200,
          latencyMs,
          billedUnits: 1,
          attemptNumber: attempt + 1,
          triedProviders: [...tried],
          requestSummary: { origin: summarizeLatLng(origin), destination: summarizeLatLng(destination), profile, language, region },
          responseSummary: {
            distance_meters: Number((normalized as any)?.distance_meters ?? null),
            duration_seconds: Number((normalized as any)?.duration_seconds ?? null),
          },
        });
        return json({ ok: true, request_id: requestUuid, provider, capability, cache: { hit: false }, data: normalized, debug: { tried } });
      }

      if (action === 'geocode') {
        const query = typeof body?.query === 'string' ? body.query.trim() : '';
        if (!query || query.length > 256) return errorJson('Invalid query', 400, 'bad_query');
        const limit = Math.max(1, Math.min(10, Number(body?.limit ?? 5)));
        const cacheBypass = Boolean(body?.cache_bypass ?? false);
        attemptRequestSummary = { query_len: query.length, language, region, limit };

        const cacheKey = await makeCacheKey({ v: 1, action, capability, provider, query, language, region, limit });
        if (cacheEnabled && !cacheBypass) {
          const cached = await cacheGet(cacheKey);
          if (cached) {
            await logAttempt({
              provider,
              httpStatus: 200,
              latencyMs: Date.now() - t0,
              billedUnits: 0,
              attemptNumber: attempt + 1,
              triedProviders: [...tried],
              cacheHit: true,
              requestSummary: { query_len: query.length, language, region, limit },
            });
            return json({ ok: true, request_id: requestUuid, provider, capability, cache: { hit: true }, data: cached });
          }
        }

        const key = getServerKey(provider);
        let normalized: unknown;
        let raw: unknown;
        if (provider === 'google') {
          const out = await googleGeocode({
            apiKey: key,
            address: query,
            language,
            region,
            limit,
          });
          raw = out.raw; normalized = out.normalized;
        } else if (provider === 'mapbox') {
          const out = await mapboxGeocode({
            accessToken: key,
            query,
            language,
            country: region.toLowerCase(),
            limit,
            permanent: cacheEnabled,
          });
          raw = out.raw; normalized = out.normalized;
        } else if (provider === 'here') {
          const out = await hereGeocode({ apiKey: key, query, language, limit, inFilter: `countryCode:${region === 'IQ' ? 'IRQ' : region}` });
          raw = out.raw; normalized = out.normalized;
        } else {
          throw new Error('provider_unsupported_for_geocode');
        }

        await healthOnSuccess(provider);
        await usageIncrement(provider, 1);

        const latencyMs = Date.now() - t0;
        if (cacheEnabled && !cacheBypass) {
          await cachePut(cacheKey, provider, normalized, cacheTtlSeconds);
        }
        await logAttempt({
          provider,
          httpStatus: 200,
          latencyMs,
          billedUnits: 1,
          attemptNumber: attempt + 1,
          triedProviders: [...tried],
          requestSummary: { query_len: query.length, language, region, limit },
          responseSummary: { results: Array.isArray(normalized) ? normalized.length : undefined },
        });
        return json({ ok: true, request_id: requestUuid, provider, capability, cache: { hit: false }, data: normalized, debug: { tried } });
      }

      if (action === 'reverse') {
        const at = validateLatLng(body?.at);
        if (!at) return errorJson('Invalid coordinates', 400, 'bad_coords');
        const limit = Math.max(1, Math.min(10, Number(body?.limit ?? 3)));
        const cacheBypass = Boolean(body?.cache_bypass ?? false);
        attemptRequestSummary = { at: summarizeLatLng(at), language, region, limit };

        const cacheKey = await makeCacheKey({ v: 1, action, capability, provider, at, language, region, limit });
        if (cacheEnabled && !cacheBypass) {
          const cached = await cacheGet(cacheKey);
          if (cached) {
            await logAttempt({
              provider,
              httpStatus: 200,
              latencyMs: Date.now() - t0,
              billedUnits: 0,
              attemptNumber: attempt + 1,
              triedProviders: [...tried],
              cacheHit: true,
              requestSummary: { at: summarizeLatLng(at), language, region, limit },
            });
            return json({ ok: true, request_id: requestUuid, provider, capability, cache: { hit: true }, data: cached });
          }
        }

        const key = getServerKey(provider);
        let normalized: unknown;
        let raw: unknown;
        if (provider === 'google') {
          const out = await googleReverseGeocode({
            apiKey: key,
            at,
            language,
            region,
            limit,
          });
          raw = out.raw; normalized = out.normalized;
        } else if (provider === 'mapbox') {
          const out = await mapboxReverse({ accessToken: key, at, language, country: region.toLowerCase(), limit, permanent: cacheEnabled });
          raw = out.raw; normalized = out.normalized;
        } else if (provider === 'here') {
          const out = await hereRevGeocode({ apiKey: key, at, language, limit });
          raw = out.raw; normalized = out.normalized;
        } else {
          throw new Error('provider_unsupported_for_reverse');
        }

        await healthOnSuccess(provider);
        await usageIncrement(provider, 1);

        const latencyMs = Date.now() - t0;
        if (cacheEnabled && !cacheBypass) {
          await cachePut(cacheKey, provider, normalized, cacheTtlSeconds);
        }
        await logAttempt({
          provider,
          httpStatus: 200,
          latencyMs,
          billedUnits: 1,
          attemptNumber: attempt + 1,
          triedProviders: [...tried],
          requestSummary: { at: summarizeLatLng(at), language, region, limit },
          responseSummary: { results: Array.isArray(normalized) ? normalized.length : undefined },
        });
        return json({ ok: true, request_id: requestUuid, provider, capability, cache: { hit: false }, data: normalized, debug: { tried } });
      }

      if (action === 'matrix') {
        const origins = Array.isArray(body?.origins) ? body.origins.map(validateLatLng).filter(Boolean) as LatLng[] : [];
        const destinations = Array.isArray(body?.destinations) ? body.destinations.map(validateLatLng).filter(Boolean) as LatLng[] : [];
        if (!origins.length || !destinations.length) return errorJson('Invalid origins/destinations', 400, 'bad_coords');
        if (origins.length > 25 || destinations.length > 25) return errorJson('Matrix too large (max 25x25)', 400, 'matrix_too_large');
        const elements = origins.length * destinations.length;
        const cacheBypass = Boolean(body?.cache_bypass ?? false);
        attemptRequestSummary = { origins: origins.length, destinations: destinations.length, language, region };

        const cacheKey = await makeCacheKey({ v: 1, action, capability, provider, origins, destinations, language, region });
        if (cacheEnabled && !cacheBypass) {
          const cached = await cacheGet(cacheKey);
          if (cached) {
            await logAttempt({
              provider,
              httpStatus: 200,
              latencyMs: Date.now() - t0,
              billedUnits: 0,
              attemptNumber: attempt + 1,
              triedProviders: [...tried],
              cacheHit: true,
              requestSummary: { origins: origins.length, destinations: destinations.length, language, region },
            });
            return json({ ok: true, request_id: requestUuid, provider, capability, cache: { hit: true }, data: cached });
          }
        }

        const key = getServerKey(provider);
        let normalized: unknown;
        let raw: unknown;
        if (provider === 'google') {
          const out = await googleComputeRouteMatrix({
            apiKey: key,
            origins,
            destinations,
            travelMode: 'DRIVE',
            languageCode: language,
            regionCode: region,
          });
          raw = out.raw; normalized = out.normalized;
        } else if (provider === 'mapbox') {
          const coordinates = [...origins, ...destinations];
          const sources = origins.map((_, i) => i);
          const destinationsIdx = destinations.map((_, i) => i + origins.length);
          const out = await mapboxMatrix({
            accessToken: key,
            profile: 'driving',
            coordinates,
            sources,
            destinations: destinationsIdx,
            annotations: ['duration', 'distance'],
          });
          raw = out.raw; normalized = out.normalized;
        } else {
          throw new Error('provider_unsupported_for_matrix');
        }

        await healthOnSuccess(provider);
        await usageIncrement(provider, elements);

        const latencyMs = Date.now() - t0;
        if (cacheEnabled && !cacheBypass) {
          await cachePut(cacheKey, provider, normalized, cacheTtlSeconds);
        }
        await logAttempt({
          provider,
          httpStatus: 200,
          latencyMs,
          billedUnits: elements,
          attemptNumber: attempt + 1,
          triedProviders: [...tried],
          requestSummary: { origins: origins.length, destinations: destinations.length, language, region },
          responseSummary: { elements },
        });
        return json({ ok: true, request_id: requestUuid, provider, capability, cache: { hit: false }, data: normalized, debug: { tried } });
      }
    } catch (err) {
      const latencyMs = Date.now() - t0;
      const message = err instanceof Error ? err.message : String(err);

      const errAny = err as any;
      const retryAfterSeconds =
        typeof errAny?.rateLimit?.retryAfterSeconds === 'number' && Number.isFinite(errAny.rateLimit.retryAfterSeconds)
          ? Math.trunc(errAny.rateLimit.retryAfterSeconds)
          : null;

      const parsedStatus = (() => {
        const m = message.match(/_http_(\d{3})$/);
        return m ? Number(m[1]) : null;
      })();

      const isTimeout = (err as any)?.name === 'AbortError' || message.toLowerCase().includes('timeout');
      const httpStatus = isTimeout
        ? 504
        : (typeof errAny?.httpStatus === 'number' && Number.isFinite(errAny.httpStatus) ? errAny.httpStatus : (parsedStatus ?? 502));
      const isInternal = message.startsWith('provider_unsupported_');
      const noRoute =
        action === 'route' &&
        (
          message === 'no_route_found' ||
          message.toLowerCase().includes('no route') ||
          message.toLowerCase().includes('route_not_found') ||
          httpStatus === 404
        );

      let fallbackReason = 'upstream_error';
      let baseCooldownSeconds = 60;
      if (httpStatus === 429) {
        fallbackReason = 'rate_limited';
        baseCooldownSeconds = retryAfterSeconds != null ? Math.max(60, Math.min(86400, retryAfterSeconds)) : 600;
      } else if (httpStatus === 503) {
        fallbackReason = 'service_unavailable';
        baseCooldownSeconds = retryAfterSeconds != null ? Math.max(60, Math.min(86400, retryAfterSeconds)) : 300;
      } else if (httpStatus === 401 || httpStatus === 403) {
        fallbackReason = 'auth_or_quota';
        baseCooldownSeconds = 6 * 60 * 60;
      } else if (httpStatus >= 500) {
        fallbackReason = isTimeout ? 'timeout' : 'upstream_5xx';
        baseCooldownSeconds = 120;
      } else if (httpStatus >= 400 && httpStatus < 500) {
        fallbackReason = 'upstream_4xx';
        baseCooldownSeconds = 0;
      }
      if (noRoute) {
        fallbackReason = 'no_route';
        baseCooldownSeconds = 0;
      }

      const errorCode = noRoute
        ? 'no_route_found'
        : (parsedStatus ? `upstream_http_${parsedStatus}` : (isTimeout ? 'timeout' : 'upstream_error'));

      const shouldRecordHealth =
        !isInternal &&
        (isTimeout || httpStatus === 429 || httpStatus === 503 || httpStatus === 401 || httpStatus === 403 || httpStatus >= 500);

      if (shouldRecordHealth) {
        await healthOnFailure({
          provider,
          httpStatus: Number.isFinite(httpStatus) ? httpStatus : null,
          errorCode,
          baseCooldownSeconds,
        });
      }

      const failureDetail = message;
      failures.push({
        provider,
        http_status: httpStatus,
        error_code: errorCode,
        error_detail: failureDetail,
        kind: noRoute ? 'no_route' : 'upstream',
      });

      const responseSummary: Record<string, unknown> = {};
      if (retryAfterSeconds != null) {
        responseSummary.retry_after_seconds = retryAfterSeconds;
        responseSummary.rate_limit_headers = errAny?.rateLimit?.headers;
      }

      await logAttempt({
        provider,
        httpStatus,
        latencyMs,
        billedUnits: 0,
        attemptNumber: attempt + 1,
        triedProviders: [...tried],
        fallbackReason,
        errorCode,
        errorDetail: failureDetail,
        requestSummary: { attempted_provider: provider, tried, ...(attemptRequestSummary ?? {}) },
        responseSummary: Object.keys(responseSummary).length ? responseSummary : undefined,
      });
      // Try next provider.
      continue;
    }
  }

  if (action === 'route' && allFailuresNoRoute()) {
    return errorJson('No route found between origin and destination', 404, 'no_route_found', {
      action,
      capability,
      tried,
      failures: failureSummaries(),
      hint: 'Move pickup/dropoff to nearby roads and retry.',
    });
  }
  return errorJson('All providers failed', 502, 'providers_failed', {
    action,
    capability,
    tried,
    failures: failureSummaries(),
  });
}));
