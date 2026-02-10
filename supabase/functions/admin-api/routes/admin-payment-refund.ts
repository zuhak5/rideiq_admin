import { errorJson, json } from '../../_shared/json.ts';
import { createServiceClient, createUserClient } from '../../_shared/supabase.ts';
import { requirePermission } from '../../_shared/admin.ts';
import { enforceAdminRateLimit } from '../../_shared/adminRateLimit.ts';
import { paymentRefundBodySchema } from '../../_shared/schemas.ts';
import { requireMethod, validateJsonBody } from '../../_shared/validate.ts';

function isUuid(v: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
}

export async function handle(req: Request, ctx: any): Promise<Response> {
  const methodRes = requireMethod(req, ctx, 'POST');
  if (methodRes) return methodRes;

  const gate = await requirePermission(req, ctx, 'payments.refund');
  if ('res' in gate) return gate.res;
  ctx.setUserId(gate.user.id);

  const rlRes = await enforceAdminRateLimit(ctx, {
    action: 'payment_refund',
    adminId: gate.user.id,
    windowSeconds: 60,
    limit: 60,
    failOpen: true,
  });
  if (rlRes) return rlRes;

  const parsed = await validateJsonBody(req, ctx, paymentRefundBodySchema);
  if (!parsed.ok) return parsed.res;

  const paymentId = parsed.data.payment_id ?? null;
  const rideIdFromBody = parsed.data.ride_id ?? null;
  const reason = parsed.data.reason;
  const idemKey = parsed.data.idempotency_key;
  const refundAmount: number | null = parsed.data.refund_amount_iqd ?? null;

  const svc = createServiceClient();

  // Resolve ride/payment context.
  let rideId = rideIdFromBody;
  let payment: any = null;
  if (paymentId) {
    const { data, error } = await svc
      .from('payments')
      .select('id,ride_id,status,amount_iqd,refund_amount_iqd,provider')
      .eq('id', paymentId)
      .maybeSingle();
    if (error) {
      ctx.error('admin.payment_refund.payment_query_failed', { error: error.message });
      return errorJson('Query failed', 500, 'QUERY_FAILED', undefined, ctx.headers);
    }
    if (!data) {
      return errorJson('Not found', 404, 'NOT_FOUND', undefined, ctx.headers);
    }
    payment = data;
    rideId = String((data as any).ride_id ?? '').trim();
  }

  if (!rideId || !isUuid(rideId)) {
    return errorJson('Unable to resolve ride_id', 400, 'VALIDATION_ERROR', undefined, ctx.headers);
  }

  ctx.setCorrelationId(paymentId || rideId);

  // Best-practice sanity check: only refund succeeded/refunded payments.
  if (payment && !['succeeded', 'refunded'].includes(String(payment.status))) {
    return errorJson(
      'Only succeeded payments can be refunded',
      409,
      'INVALID_STATE',
      { status: payment.status },
      ctx.headers,
    );
  }

  // Execute refund as the authenticated admin (so auth.uid() checks + RBAC are enforced in SQL).
  const userClient = createUserClient(req);
  const { data: result, error: rpcErr } = await userClient.rpc('admin_record_ride_refund_v2', {
    p_ride_id: rideId,
    p_refund_amount_iqd: refundAmount,
    p_reason: reason,
    p_idempotency_key: idemKey,
  });

  if (rpcErr) {
    const msg = rpcErr.message ?? 'refund_failed';
    const code = msg.includes('not_admin') || msg.includes('forbidden') ? 403 : msg.includes('not_found') ? 404 : 400;
    ctx.warn('admin.payment_refund.rpc_failed', { error: msg, ride_id: rideId, payment_id: paymentId });
    return errorJson(msg, code, 'REFUND_FAILED', undefined, ctx.headers);
  }

  // Best-effort audit entry.
  try {
    const { data: ride } = await svc
      .from('rides')
      .select('id,rider_id')
      .eq('id', rideId)
      .maybeSingle();

    await svc.from('admin_audit_log').insert({
      actor_id: gate.user.id,
      action: 'refund_payment',
      // Keep target_user_id non-null to satisfy schema constraints.
      // If we cannot resolve the rider (should be rare), fall back to the actor.
      target_user_id: (ride as any)?.rider_id ?? gate.user.id,
      note: reason,
      details: {
        ride_id: rideId,
        payment_id: paymentId || (result as any)?.payment_id || null,
        idempotency_key: idemKey,
        refund_amount_iqd: refundAmount,
        result,
      },
    } as any);
  } catch (e) {
    ctx.warn('admin.payment_refund.audit_insert_failed', { error: String((e as any)?.message ?? e) });
  }

  return json({ ok: true, result }, 200, ctx.headers);
}
