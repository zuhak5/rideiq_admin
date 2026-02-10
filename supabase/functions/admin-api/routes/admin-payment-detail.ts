import { errorJson, json } from '../../_shared/json.ts';
import { createServiceClient } from '../../_shared/supabase.ts';
import { requirePermission } from '../../_shared/admin.ts';
import { enforceAdminRateLimit } from '../../_shared/adminRateLimit.ts';
import { adminPaymentDetailQuerySchema } from '../../_shared/schemas.ts';
import { requireMethod, validateQuery } from '../../_shared/validate.ts';

export async function handle(req: Request, ctx: any): Promise<Response> {
  const methodRes = requireMethod(req, ctx, 'GET');
  if (methodRes) return methodRes;

  const gate = await requirePermission(req, ctx, 'payments.read');
  if ('res' in gate) return gate.res;
  ctx.setUserId(gate.user.id);

  const rlRes = await enforceAdminRateLimit(ctx, {
    action: 'payment_detail',
    adminId: gate.user.id,
    windowSeconds: 60,
    limit: 240,
    failOpen: true,
  });
  if (rlRes) return rlRes;

  const parsed = validateQuery(req, ctx, adminPaymentDetailQuerySchema);
  if (!parsed.ok) return parsed.res;

  const paymentId = parsed.data.payment_id;
  ctx.setCorrelationId(paymentId);

  const svc = createServiceClient();

  const { data: payment, error: payErr } = await svc
    .from('payments')
    .select('*')
    .eq('id', paymentId)
    .maybeSingle();

  if (payErr) {
    ctx.error('admin.payment_detail.payment_query_failed', { error: payErr.message });
    return errorJson('Query failed', 500, 'QUERY_FAILED', undefined, ctx.headers);
  }

  if (!payment) {
    return errorJson('Not found', 404, 'NOT_FOUND', undefined, ctx.headers);
  }

  const rideId = (payment as any).ride_id as string | null;

  let ride: any = null;
  if (rideId) {
    const { data: rideRow, error: rideErr } = await svc
      .from('rides')
      .select('*,request:ride_requests!rides_request_id_fkey(*),rider:profiles!rides_rider_id_fkey(id,display_name,phone),driver:drivers!rides_driver_id_fkey(id,status,profile:profiles!drivers_id_fkey(id,display_name,phone))')
      .eq('id', rideId)
      .maybeSingle();
    if (rideErr) {
      ctx.warn('admin.payment_detail.ride_query_failed', { error: rideErr.message });
    } else {
      ride = rideRow;
    }
  }

  const intentId = (payment as any).payment_intent_id as string | null;
  let paymentIntent: any = null;
  if (intentId) {
    const { data: pi, error: piErr } = await svc.from('payment_intents').select('*').eq('id', intentId).maybeSingle();
    if (piErr) {
      ctx.warn('admin.payment_detail.intent_query_failed', { error: piErr.message });
    } else {
      paymentIntent = pi;
    }
  }

  let receipt: any = null;
  if (rideId) {
    const { data: rec, error: recErr } = await svc.from('ride_receipts').select('*').eq('ride_id', rideId).maybeSingle();
    if (recErr) {
      ctx.warn('admin.payment_detail.receipt_query_failed', { error: recErr.message });
    } else {
      receipt = rec;
    }
  }

  return json(
    {
      ok: true,
      payment,
      ride,
      receipt,
      payment_intent: paymentIntent,
    },
    200,
    ctx.headers,
  );
}
