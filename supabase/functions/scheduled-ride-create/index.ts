import { createAnonClient, requireUser } from '../_shared/supabase.ts';
import { consumeRateLimit } from '../_shared/rateLimit.ts';
import { errorJson, json } from '../_shared/json.ts';
import { withRequestContext } from '../_shared/requestContext.ts';
import { type FareQuoteInput } from '../_shared/schemas.ts';
import { FareEngineError, quoteAndStoreFare } from '../_shared/fareQuoteCore.ts';

type Body = {
  pickup_lat?: number;
  pickup_lng?: number;
  dropoff_lat?: number;
  dropoff_lng?: number;
  pickup_address?: string | null;
  dropoff_address?: string | null;
  product_code?: string;
  scheduled_at?: string; // ISO string
  preferences?: Record<string, unknown>;
  payment_method?: 'wallet' | 'cash';
};

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

Deno.serve((req) =>
  withRequestContext('scheduled-ride-create', req, async (ctx) => {

    const { user, error } = await requireUser(req);
    if (error || !user) return errorJson('Unauthorized', 401, 'UNAUTHORIZED', undefined, ctx.headers);

    let body: Body;
    try {
      body = (await req.json()) as Body;
    } catch {
      return errorJson('Invalid JSON body', 400, 'INVALID_JSON', undefined, ctx.headers);
    }

    if (!isFiniteNumber(body.pickup_lat) || !isFiniteNumber(body.pickup_lng)) {
      return errorJson('Missing pickup_lat/pickup_lng', 400, 'VALIDATION_ERROR', undefined, ctx.headers);
    }
    if (!isFiniteNumber(body.dropoff_lat) || !isFiniteNumber(body.dropoff_lng)) {
      return errorJson('Missing dropoff_lat/dropoff_lng', 400, 'VALIDATION_ERROR', undefined, ctx.headers);
    }
    if (!body.scheduled_at || typeof body.scheduled_at !== 'string') {
      return errorJson('Missing scheduled_at', 400, 'VALIDATION_ERROR', undefined, ctx.headers);
    }

    const when = new Date(body.scheduled_at);
    if (Number.isNaN(when.getTime())) {
      return errorJson('scheduled_at must be a valid ISO date string', 400, 'VALIDATION_ERROR', undefined, ctx.headers);
    }

    // Guardrails:
    // - require >= 5 minutes in the future (avoid race with cron, allow user corrections)
    // - restrict max scheduling window (keep operations predictable)
    const minMs = 5 * 60 * 1000;
    const maxMs = 14 * 24 * 60 * 60 * 1000; // 14 days
    const now = Date.now();
    if (when.getTime() < now + minMs) {
      return errorJson('scheduled_at must be at least 5 minutes in the future', 400, 'VALIDATION_ERROR', undefined, ctx.headers);
    }
    if (when.getTime() > now + maxMs) {
      return errorJson('scheduled_at is too far in the future (max 14 days)', 400, 'VALIDATION_ERROR', undefined, ctx.headers);
    }

    // Rate limit: protect from abuse (fail-open by design in helper)
    const rl = await consumeRateLimit({
      key: `scheduled_ride_create:${user.id}`,
      windowSeconds: 60,
      limit: 10,
    });
    if (!rl.allowed) {
      return errorJson('Too many requests. Please try again later.', 429, 'RATE_LIMITED', undefined, ctx.headers);
    }

    const supa = createAnonClient(req);

    // Normalize inputs (final validation/limits are enforced by the DB RPC).
    const productCode = body.product_code ?? 'standard';
    const paymentMethod = body.payment_method === 'cash' ? 'cash' : 'wallet';
    // Compute and store an auditable quote at schedule time.
    // Scheduled rides MUST carry a fare_quote_id so the cron job can create a request without DB-side pricing.
    const quoteInput: FareQuoteInput = {
      pickup_lat: body.pickup_lat,
      pickup_lng: body.pickup_lng,
      dropoff_lat: body.dropoff_lat,
      dropoff_lng: body.dropoff_lng,
      product_code: productCode,
      vehicle_class: null,
      context: {
        source: 'scheduled-ride-create',
        scheduled_at: when.toISOString(),
      },
    };

    let quoteResult: any;
    try {
      // Engine name is tracked inside fare_quotes for auditability.
      quoteResult = await quoteAndStoreFare({ supabase: supa, riderId: user.id, input: quoteInput, engineName: 'fare-engine-v1', ctx });
    } catch (e) {
      if (e instanceof FareEngineError) {
        return errorJson(e.message, e.status, e.code, e.details, ctx.headers);
      }
      ctx.error('fare_engine.unhandled', { err: String(e) });
      return errorJson('Failed to compute fare quote', 500, 'FARE_ENGINE_ERROR', undefined, ctx.headers);
    }

    if (!quoteResult?.quote_id) {
      return errorJson('Unable to store fare quote', 503, 'QUOTE_STORE_FAILED', undefined, ctx.headers);
    }

    const totalIqd = Number(quoteResult?.quote?.total_iqd ?? 0);
    if (!Number.isFinite(totalIqd) || totalIqd <= 0) {
      return errorJson('Invalid fare quote', 500, 'INVALID_QUOTE', undefined, ctx.headers);
    }

    const { data: out, error: rpcErr } = await supa.rpc('scheduled_ride_create_user_v1', {
      p_pickup_lat: body.pickup_lat,
      p_pickup_lng: body.pickup_lng,
      p_dropoff_lat: body.dropoff_lat,
      p_dropoff_lng: body.dropoff_lng,
      p_pickup_address: body.pickup_address ?? null,
      p_dropoff_address: body.dropoff_address ?? null,
      p_product_code: productCode,
      p_scheduled_at: when.toISOString(),
      p_preferences: body.preferences ?? {},
      p_payment_method: paymentMethod,
      p_fare_quote_id: quoteResult.quote_id as string,
    });

    if (rpcErr) {
      const msg = String(rpcErr.message ?? '').toLowerCase();
      if (msg.includes('unauthorized')) return errorJson('Unauthorized', 401, 'UNAUTHORIZED', undefined, ctx.headers);
      if (msg.includes('forbidden')) return errorJson('Forbidden', 403, 'FORBIDDEN', undefined, ctx.headers);
      if (msg.includes('scheduled_at_too_soon')) {
        return errorJson('scheduled_at must be at least 5 minutes in the future', 400, 'VALIDATION_ERROR', undefined, ctx.headers);
      }
      if (msg.includes('scheduled_at_too_far')) {
        return errorJson('scheduled_at is too far in the future (max 14 days)', 400, 'VALIDATION_ERROR', undefined, ctx.headers);
      }
      if (msg.includes('outside_service_area')) {
        return errorJson('Pickup location is outside the service area', 400, 'VALIDATION_ERROR', undefined, ctx.headers);
      }
      if (msg.includes('invalid_product')) {
        return errorJson('Invalid product_code', 400, 'VALIDATION_ERROR', undefined, ctx.headers);
      }
      if (msg.includes('too_many_pending_today')) {
        return errorJson('Too many scheduled rides for that day (max 5)', 400, 'VALIDATION_ERROR', undefined, ctx.headers);
      }
      if (msg.includes('too_many_pending')) {
        return errorJson('Too many pending scheduled rides (max 20)', 400, 'VALIDATION_ERROR', undefined, ctx.headers);
      }
      ctx.error('db.rpc_failed', { err: rpcErr.message });
      return errorJson('Failed to create scheduled ride', 500, 'DB_ERROR', undefined, ctx.headers);
    }

    const scheduledRide = (out as any)?.scheduled_ride ?? out;
    ctx.log('scheduled_ride.created', { id: scheduledRide?.id, scheduled_at: scheduledRide?.scheduled_at });

    return json({ scheduled_ride: scheduledRide }, 200, ctx.headers);
  }),
);
