import { createUserClient, requireUser } from '../_shared/supabase.ts';
import { errorJson, json } from '../_shared/json.ts';
import { buildRateLimitHeaders, consumeRateLimit, getClientIp } from '../_shared/rateLimit.ts';
import { logAppEvent } from '../_shared/log.ts';
import { withRequestContext } from '../_shared/requestContext.ts';
import { emitMetricBestEffort, metricTimer } from '../_shared/metrics.ts';

type MatchRideBody = {
  request_id?: string;
  radius_m?: number;
  limit_n?: number;
  match_ttl_seconds?: number;
  stale_after_seconds?: number;
};

function asFiniteNumber(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

function clampNumber(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

function clampInt(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.trunc(v)));
}

Deno.serve((req) => withRequestContext('match-ride', req, async (ctx) => {

  if (req.method !== 'POST') {
    emitMetricBestEffort(ctx, { event_type: 'metric.dispatch.match', level: 'warn', payload: { ok: false, reason: 'method' } });
    return errorJson('Method not allowed', 405, 'METHOD_NOT_ALLOWED', undefined, ctx.headers);
  }

  const { user, error: authError } = await requireUser(req, ctx);
  if (!user) {
    emitMetricBestEffort(ctx, { event_type: 'metric.dispatch.match', level: 'warn', payload: { ok: false, reason: 'unauthorized' } });
    return errorJson(String(authError ?? 'Unauthorized'), 401, 'UNAUTHORIZED', undefined, ctx.headers);
  }

  // Rate limit: matching is expensive (geo + locks)
  const ip = getClientIp(req);
  const rl = await consumeRateLimit({
    key: `match:${user.id}:${ip ?? 'noip'}`,
    windowSeconds: 60,
    limit: 10,
  });
  if (!rl.allowed) {
    emitMetricBestEffort(ctx, { event_type: 'metric.dispatch.match', level: 'warn', payload: { ok: false, reason: 'rate_limited' } });
    return json(
      { error: 'Rate limit exceeded', code: 'RATE_LIMITED', reset_at: rl.resetAt, remaining: rl.remaining },
      429,
      {
        ...ctx.headers,
        ...buildRateLimitHeaders({ limit: 10, remaining: rl.remaining, resetAt: rl.resetAt }),
        'Retry-After': String(Math.max(1, Math.ceil((new Date(rl.resetAt).getTime() - Date.now()) / 1000))),
      },
    );
  }

  const body: MatchRideBody = await req.json().catch(() => ({}));
  const requestId = body.request_id;
  if (!requestId) {
    emitMetricBestEffort(ctx, { event_type: 'metric.dispatch.match', level: 'warn', payload: { ok: false, reason: 'validation' } });
    return errorJson('request_id is required', 400, 'VALIDATION_ERROR', undefined, ctx.headers);
  }

  ctx.setCorrelationId(requestId);
  const stopTimer = metricTimer(ctx, 'metric.dispatch.match_latency', { payload: { ride_request_id: requestId } });

  // Call as the authenticated user so auth.uid() is available to DB wrappers.
  const supabase = createUserClient(req);

  const { data, error } = await supabase.rpc('dispatch_match_ride_user', {
    p_request_id: requestId,
    p_radius_m: clampNumber(asFiniteNumber(body.radius_m) ?? 5000, 100, 50000),
    p_limit_n: clampInt(asFiniteNumber(body.limit_n) ?? 20, 1, 50),
    p_match_ttl_seconds: clampInt(asFiniteNumber(body.match_ttl_seconds) ?? 120, 30, 600),
    // NOTE: Many mobile clients report location on a ~30–60s cadence when idle (battery/network constraints).
    // A 30s freshness window is too strict and results in "no candidates" even when nearby drivers exist.
    // Default to 120s to align with the server-side stale-driver logic and scheduled matching.
    p_stale_after_seconds: clampInt(asFiniteNumber(body.stale_after_seconds) ?? 120, 5, 600),
  });

  if (error) {
    const rawMessage = error.message ?? 'Unknown error';
    const normalizedMessage = rawMessage.replace(/^RPC error:\s*/i, '').trim();
    if (normalizedMessage.includes('insufficient_wallet_balance')) {
      emitMetricBestEffort(ctx, { event_type: 'metric.dispatch.match', level: 'warn', payload: { ok: false, reason: 'insufficient_wallet_balance' } });
      await stopTimer('ok', { ok: false, reason: 'insufficient_wallet_balance' });
      return errorJson('Insufficient wallet balance. Please top up and try again.', 409, 'INSUFFICIENT_FUNDS', undefined, ctx.headers);
    }
    if (normalizedMessage === 'ride_request_not_found') {
      emitMetricBestEffort(ctx, { event_type: 'metric.dispatch.match', level: 'warn', payload: { ok: false, reason: 'ride_request_not_found' } });
      await stopTimer('ok', { ok: false, reason: 'ride_request_not_found' });
      return errorJson('Ride request not found.', 404, 'RIDE_REQUEST_NOT_FOUND', undefined, ctx.headers);
    }
    if (normalizedMessage === 'forbidden') {
      emitMetricBestEffort(ctx, { event_type: 'metric.dispatch.match', level: 'warn', payload: { ok: false, reason: 'forbidden' } });
      await stopTimer('ok', { ok: false, reason: 'forbidden' });
      return errorJson('You are not allowed to match this ride request.', 403, 'FORBIDDEN', undefined, ctx.headers);
    }
    if (normalizedMessage === 'invalid_quote') {
      emitMetricBestEffort(ctx, { event_type: 'metric.dispatch.match', level: 'warn', payload: { ok: false, reason: 'invalid_quote' } });
      await stopTimer('ok', { ok: false, reason: 'invalid_quote' });
      return errorJson('Ride quote is invalid. Please request a new quote.', 422, 'INVALID_QUOTE', undefined, ctx.headers);
    }
    const pgCode = (error as any)?.code as string | undefined;

    // Common PostGIS / schema-mismatch failures (Supabase often installs PostGIS under the `extensions` schema)
    if (/type\s+\"geometry\"\s+does\s+not\s+exist/i.test(normalizedMessage)) {
      emitMetricBestEffort(ctx, { event_type: 'metric.dispatch.match', level: 'error', payload: { ok: false, reason: 'geospatial_schema_mismatch' } });
      await stopTimer('error', { ok: false, reason: 'geospatial_schema_mismatch' });
      return errorJson(
        'Geospatial types are unavailable in the current search_path. This usually happens when PostGIS is installed in the `extensions` schema and code casts to `geometry` without schema-qualifying.',
        503,
        'GEOSPATIAL_SCHEMA_MISMATCH',
        { hint: 'Ensure PostGIS is installed (e.g. `create extension if not exists postgis with schema extensions;`) and avoid `::geometry` casts, or use `extensions.geometry` explicitly.' },
        ctx.headers,
      );
    }

    if (/operator\s+does\s+not\s+exist:.*<->/i.test(normalizedMessage)) {
      emitMetricBestEffort(ctx, { event_type: 'metric.dispatch.match', level: 'error', payload: { ok: false, reason: 'geospatial_schema_mismatch' } });
      await stopTimer('error', { ok: false, reason: 'geospatial_schema_mismatch' });
      return errorJson(
        'Geospatial nearest-neighbor operator `<->` is unavailable for the current PostGIS schema setup.',
        503,
        'GEOSPATIAL_SCHEMA_MISMATCH',
        {
          hint:
            'Verify function search_path is not quoted as a single string. Use `ALTER FUNCTION public.dispatch_match_ride(...) SET search_path TO pg_catalog, public, extensions;` (and same for `dispatch_match_ride_user`). Also verify `driver_locations` has a GiST index on `loc`.',
        },
        ctx.headers,
      );
    }

    if (/(function|procedure).*st_dwithin/i.test(normalizedMessage) || (pgCode === '42883' && /st_dwithin/i.test(normalizedMessage))) {
      emitMetricBestEffort(ctx, { event_type: 'metric.dispatch.match', level: 'error', payload: { ok: false, reason: 'geospatial_unavailable' } });
      await stopTimer('error', { ok: false, reason: 'geospatial_unavailable' });
      return errorJson(
        'Geospatial matching is unavailable. Please enable PostGIS and try again.',
        503,
        'GEOSPATIAL_UNAVAILABLE',
        { hint: 'Run `create extension if not exists postgis with schema extensions;` and ensure your matcher calls `extensions.st_dwithin(...)` (or includes `extensions` in search_path).' },
        ctx.headers,
      );
    }

    await logAppEvent({
      event_type: 'dispatch_match_ride_error',
      actor_id: user.id,
      actor_type: 'rider',
      request_id: requestId,
      payload: { message: rawMessage },
    });
    emitMetricBestEffort(ctx, { event_type: 'metric.dispatch.match', level: 'error', payload: { ok: false, reason: 'dispatch_error', error: rawMessage } });
    await stopTimer('error', { ok: false, reason: 'dispatch_error', error: rawMessage });
    return errorJson(rawMessage, 400, 'DISPATCH_ERROR', undefined, ctx.headers);
  }

  const row = Array.isArray(data) ? data[0] : data;

  await logAppEvent({
    event_type: 'dispatch_match_ride',
    actor_id: user.id,
    actor_type: 'rider',
    request_id: requestId,
    payload: { status: row?.status, assigned_driver_id: row?.assigned_driver_id },
  });

  const matched = Boolean(row?.assigned_driver_id);
  emitMetricBestEffort(ctx, { event_type: 'metric.dispatch.match', payload: { ok: true, matched, status: row?.status ?? null } });
  await stopTimer('ok', { ok: true, matched, status: row?.status ?? null, assigned_driver_id: row?.assigned_driver_id ?? null });

  return json(
    { request: row, rate_limit: { remaining: rl.remaining, reset_at: rl.resetAt } },
    200,
    { ...ctx.headers, ...buildRateLimitHeaders({ limit: 10, remaining: rl.remaining, resetAt: rl.resetAt }) },
  );
}));
