import { getCorsHeadersForRequest} from '../_shared/cors.ts';
import { envTrim } from '../_shared/config.ts';
import { errorJson, json } from '../_shared/json.ts';
import { buildRateLimitHeaders, consumeRateLimit, getClientIp } from '../_shared/rateLimit.ts';
import { isProduction } from '../_shared/env.ts';
import { withRequestContext } from '../_shared/requestContext.ts';
import { emitMetricBestEffort } from '../_shared/metrics.ts';

// Returns the Google Maps browser key for the web client.
// This endpoint must be callable by unauthenticated users because
// the /share/<token> page is public.
// Note: this key will be visible to end-users in the browser regardless.
// Security must be enforced via Google Cloud key restrictions
// (HTTP referrers, API restrictions) rather than trying to hide it.

Deno.serve((req) =>
  withRequestContext('maps-config', req, async (ctx) => {

    // This endpoint returns a browser key, which is effectively public.
    // Restrict access using Google Cloud key restrictions (HTTP referrers + API restrictions),
    // not CORS. We still emit metrics when the origin is not allowlisted.
    const origin = req.headers.get('origin') ?? '';
    const cors = getCorsHeadersForRequest(req);
    if (isProduction() && origin && cors['Access-Control-Allow-Origin'] === '*') {
      emitMetricBestEffort(ctx, { event_type: 'metric.maps.origin_unlisted', level: 'warn', payload: { origin } });
    }

    // Basic abuse control (this key is "public" by design, but we still reduce scraping).
    const ip = getClientIp(req) ?? 'unknown';
    const limit = 60; // per minute
    const rl = await consumeRateLimit({ key: `maps-config:${ip}`, windowSeconds: 60, limit, failOpen: true });
    if (!rl.allowed) {
      emitMetricBestEffort(ctx, { event_type: 'metric.maps.rate_limited', level: 'warn', payload: { origin: origin || null } });
      return errorJson(
        'Too many requests',
        429,
        'RATE_LIMITED',
        undefined,
        {
          ...ctx.headers,
          ...cors,
          ...buildRateLimitHeaders({ limit, remaining: rl.remaining, resetAt: rl.resetAt }),
        },
      );
    }

    if (req.method !== 'GET' && req.method !== 'POST') {
      emitMetricBestEffort(ctx, { event_type: 'metric.maps.config_ignored', level: 'warn', payload: { reason: 'method' } });
      return errorJson('Method not allowed', 405, 'METHOD_NOT_ALLOWED', undefined, { ...ctx.headers, ...cors });
    }

    // Do NOT require an authenticated JWT here.
    // Some clients send the anon key as `Authorization: Bearer <anon-jwt>`,
    // which fails user validation (missing `sub`). That is expected for public usage.

    const clientKey = envTrim('MAPS_CLIENT_KEY');
    const legacyKey = envTrim('MAPS_API_KEY');
    const apiKey = clientKey || legacyKey;
    if (!apiKey) {
      emitMetricBestEffort(ctx, { event_type: 'metric.maps.misconfigured', level: 'error', payload: {} });
      return errorJson('MAPS_CLIENT_KEY is not configured', 500, 'MISCONFIGURED', undefined, { ...ctx.headers, ...cors });
    }
    if (!clientKey && legacyKey) {
      ctx.warn('Using legacy MAPS_API_KEY fallback; set MAPS_CLIENT_KEY', {});
    }

    emitMetricBestEffort(ctx, {
      event_type: 'metric.maps.config_served',
      payload: {
        origin: origin || null,
        allow_origin: cors['Access-Control-Allow-Origin'] ?? null,
      },
    });

    // Keep response cacheable by the browser (short), but do not cache by shared proxies.
    return json(
      {
        // Backwards compatible contract:
        // - Older web clients expect `google_maps_api_key`.
        // - Newer clients can read `apiKey`.
        google_maps_api_key: apiKey,
        apiKey,
        // Optional: allow wiring a Map ID later without changing the contract.
        mapId: envTrim('MAPS_MAP_ID') || undefined,
        // Explicitly indicate this endpoint is public.
        public: true,
      },
      200,
      {
        ...ctx.headers,
        ...cors,
        'cache-control': 'private, max-age=300',
        'x-content-type-options': 'nosniff',
        ...buildRateLimitHeaders({ limit, remaining: rl.remaining, resetAt: rl.resetAt }),
      },
    );
  }),
);
