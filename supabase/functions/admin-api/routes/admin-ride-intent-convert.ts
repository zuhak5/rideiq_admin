import { createServiceClient } from '../../_shared/supabase.ts';
import { errorJson, json } from '../../_shared/json.ts';
import { requirePermission } from '../../_shared/admin.ts';
import { enforceAdminRateLimit } from '../../_shared/adminRateLimit.ts';
import { requireMethod, validateJsonBody } from '../../_shared/validate.ts';
import type { FareQuoteInput } from '../../_shared/schemas.ts';
import { rideIntentConvertBodySchema } from '../../_shared/schemas.ts';
import { FareEngineError, quoteAndStoreFare } from '../../_shared/fareQuoteCore.ts';

export async function handle(req: Request, ctx: any): Promise<Response> {
  const methodRes = requireMethod(req, ctx, 'POST');
  if (methodRes) return methodRes;

  const gate = await requirePermission(req, ctx, 'rides.convert_intent');
  if ('res' in gate) return gate.res;
  ctx.setUserId(gate.user.id);

  const rlRes = await enforceAdminRateLimit(ctx, {
    action: 'ride_intent_convert',
    adminId: gate.user.id,
    windowSeconds: 60,
    limit: 10,
    failOpen: false,
  });
  if (rlRes) return rlRes;
  const parsed = await validateJsonBody(req, ctx, rideIntentConvertBodySchema);
  if (!parsed.ok) return parsed.res;

  const intentId = parsed.data.intent_id;

  ctx.setCorrelationId(intentId);

  const svc = createServiceClient();

  const { data: intent, error: intentErr } = await svc
    .from('ride_intents')
    .select('*')
    .eq('id', intentId)
    .maybeSingle();

  if (intentErr) {
    ctx.error('admin.ride_intent_convert.intent_query_failed', { error: intentErr.message, intent_id: intentId });
    return errorJson('Query failed', 500, 'QUERY_FAILED', undefined, ctx.headers);
  }
  if (!intent) return errorJson('Intent not found', 404, 'NOT_FOUND', undefined, ctx.headers);
  if (intent.status !== 'new') return errorJson('Intent already processed', 409, 'CONFLICT', undefined, ctx.headers);

  // Compute and store an auditable quote using a service-role client.
  // This ensures admin-created requests participate in the same pricing system as rider-created requests.
  const quoteInput: FareQuoteInput = {
    pickup_lat: intent.pickup_lat,
    pickup_lng: intent.pickup_lng,
    dropoff_lat: intent.dropoff_lat,
    dropoff_lng: intent.dropoff_lng,
    product_code: intent.product_code ?? 'standard',
    vehicle_class: null,
    vehicle_year: null,
    pickup_deadhead_m: null,
    context: {
      source: 'admin-ride-intent-convert',
      intent_id: intent.id,
    },
  };

  let quoteResult: any;
  try {
    quoteResult = await quoteAndStoreFare({
      supabase: svc,
      riderId: intent.rider_id,
      input: quoteInput,
      engineName: 'fare-engine-v1',
      ctx,
    });
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

  const serviceAreaId: string | null = quoteResult?.service_area_id ?? null;
  if (!serviceAreaId) {
    return errorJson('Pickup is outside supported service areas', 400, 'OUTSIDE_SERVICE_AREA', undefined, ctx.headers);
  }

  const totalIqd = Number(quoteResult?.quote?.total_iqd ?? 0);
  if (!Number.isFinite(totalIqd) || totalIqd <= 0) {
    return errorJson('Invalid fare quote', 500, 'INVALID_QUOTE', undefined, ctx.headers);
  }

  const insertReq = {
    rider_id: intent.rider_id,
    pickup_lat: intent.pickup_lat,
    pickup_lng: intent.pickup_lng,
    dropoff_lat: intent.dropoff_lat,
    dropoff_lng: intent.dropoff_lng,
    pickup_address: intent.pickup_address,
    dropoff_address: intent.dropoff_address,
    product_code: intent.product_code ?? 'standard',
    preferences: (intent as { preferences?: Record<string, unknown> }).preferences ?? {},
    service_area_id: serviceAreaId,
    fare_quote_id: quoteResult.quote_id as string,
    quote_amount_iqd: Math.trunc(totalIqd),
    currency: 'IQD',
    // Iraq-first: default to cash for operator-created intents.
    // (Rider app can explicitly select wallet.)
    payment_method: 'cash',
    status: 'requested',
  };

  const { data: rr, error: rrErr } = await svc
    .from('ride_requests')
    .insert(insertReq)
    .select('id,status,created_at,service_area_id')
    .single();

  if (rrErr) {
    ctx.error('admin.ride_intent_convert.insert_request_failed', { error: rrErr.message, intent_id: intentId });
    return errorJson('Create ride request failed', 500, 'CREATE_FAILED', undefined, ctx.headers);
  }

  const { error: updErr } = await svc
    .from('ride_intents')
    .update({ status: 'converted', converted_request_id: rr.id, service_area_id: serviceAreaId })
    .eq('id', intent.id);

  if (updErr) {
    ctx.error('admin.ride_intent_convert.update_intent_failed', { error: updErr.message, intent_id: intentId, request_id: rr.id });
    return errorJson('Update intent failed', 500, 'UPDATE_FAILED', undefined, ctx.headers);
  }

  // Best-effort audit log entry.
  try {
    await svc.from('admin_audit_log').insert({
      actor_id: gate.user.id,
      action: 'convert_ride_intent',
      target_user_id: intent.rider_id,
      note: 'Converted ride intent to ride request',
      details: {
        intent_id: intentId,
        ride_request_id: rr.id,
        fare_quote_id: quoteResult.quote_id,
        service_area_id: serviceAreaId,
        quote_amount_iqd: Math.trunc(totalIqd),
      },
    } as any);
  } catch (e) {
    ctx.warn('admin.ride_intent_convert.audit_insert_failed', { error: String((e as any)?.message ?? e) });
  }

  return json({ converted: true, ride_request: rr }, 200, ctx.headers);
}
