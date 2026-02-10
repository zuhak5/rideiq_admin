import { createAnonClient, createServiceClient, requireUserStrict as requireUser } from '../_shared/supabase.ts';
import { errorJson, json } from '../_shared/json.ts';
import { withRequestContext } from '../_shared/requestContext.ts';
import type { FareQuoteInput } from '../_shared/schemas.ts';
import { FareEngineError, quoteAndStoreFare } from '../_shared/fareQuoteCore.ts';

type Body = {
  intent_id?: string;
};

function isUuid(v: unknown): v is string {
  return (
    typeof v === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v)
  );
}

Deno.serve((req) =>
  withRequestContext('admin-ride-intent-convert', req, async (ctx) => {

    if (req.method !== 'POST') {
      return errorJson('Method not allowed', 405, 'METHOD_NOT_ALLOWED', undefined, ctx.headers);
    }

    // Validate user JWT, then gate by admin role (do not trust client-side flags)
    const { user, error: authErr } = await requireUser(req);
    if (!user) {
      return errorJson(String(authErr ?? 'Unauthorized'), 401, 'UNAUTHORIZED', undefined, ctx.headers);
    }

    const anon = createAnonClient(req);
    const { data: isAdmin, error: adminErr } = await anon.rpc('is_admin');
    if (adminErr) return errorJson(adminErr.message, 400, 'DB_ERROR', undefined, ctx.headers);
    if (!isAdmin) return errorJson('Forbidden', 403, 'FORBIDDEN', undefined, ctx.headers);

    let body: Body;
    try {
      body = (await req.json()) as Body;
    } catch {
      return errorJson('Invalid JSON body', 400, 'INVALID_JSON', undefined, ctx.headers);
    }

    if (!isUuid(body.intent_id)) {
      return errorJson('intent_id is required (uuid)', 400, 'VALIDATION_ERROR', undefined, ctx.headers);
    }

    // Use service client for the conversion workflow (bypasses RLS safely)
    const svc = createServiceClient();

    const { data: intent, error: intentErr } = await svc
      .from('ride_intents')
      .select('*')
      .eq('id', body.intent_id)
      .maybeSingle();

    if (intentErr) return errorJson(intentErr.message, 400, 'DB_ERROR', undefined, ctx.headers);
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
      quoteResult = await quoteAndStoreFare({ supabase: svc, riderId: intent.rider_id, input: quoteInput, engineName: 'fare-engine-v1', ctx });
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

    if (rrErr) return errorJson(rrErr.message, 400, 'DB_ERROR', undefined, ctx.headers);

    const { error: updErr } = await svc
      .from('ride_intents')
      .update({ status: 'converted', converted_request_id: rr.id, service_area_id: serviceAreaId })
      .eq('id', intent.id);

    if (updErr) return errorJson(updErr.message, 400, 'DB_ERROR', undefined, ctx.headers);

    return json({ converted: true, ride_request: rr }, 200, ctx.headers);
  }),
);
