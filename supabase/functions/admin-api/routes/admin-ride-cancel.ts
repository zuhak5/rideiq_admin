import { errorJson, json } from '../../_shared/json.ts';
import { createServiceClient } from '../../_shared/supabase.ts';
import { requirePermission } from '../../_shared/admin.ts';
import { enforceAdminRateLimit } from '../../_shared/adminRateLimit.ts';
import { rideCancelBodySchema } from '../../_shared/schemas.ts';
import { requireMethod, validateJsonBody } from '../../_shared/validate.ts';

export async function handle(req: Request, ctx: any): Promise<Response> {
  const methodRes = requireMethod(req, ctx, 'POST');
  if (methodRes) return methodRes;

  const gate = await requirePermission(req, ctx, 'rides.cancel');
  if ('res' in gate) return gate.res;

  ctx.setUserId(gate.user.id);

  const rlRes = await enforceAdminRateLimit(ctx, {
    action: 'ride_cancel',
    adminId: gate.user.id,
    windowSeconds: 60,
    limit: 20,
    failOpen: false,
  });
  if (rlRes) return rlRes;

  const parsed = await validateJsonBody(req, ctx, rideCancelBodySchema);
  if (!parsed.ok) return parsed.res;

  const rideId = parsed.data.ride_id;
  const reason = parsed.data.reason;
  const expectedVersionOverride = parsed.data.expected_version;

  ctx.setCorrelationId(rideId);

  const svc = createServiceClient();

  // Load current state (also used for audit metadata).
  const { data: ride, error: rideErr } = await svc
    .from('rides')
    .select('id,status,version,rider_id,driver_id')
    .eq('id', rideId)
    .maybeSingle();

  if (rideErr) {
    ctx.error('admin.ride_cancel.ride_query_failed', { error: rideErr.message });
    return errorJson('Query failed', 500, 'QUERY_FAILED', undefined, ctx.headers);
  }
  if (!ride) {
    return errorJson('Not found', 404, 'NOT_FOUND', undefined, ctx.headers);
  }

  const expectedVersion = expectedVersionOverride ?? (ride as any).version;

  const { data: transitioned, error: trErr } = await svc.rpc('transition_ride_v3', {
    p_ride_id: rideId,
    p_to_status: 'canceled',
    p_actor_id: gate.user.id,
    p_actor_type: 'system',
    p_expected_version: expectedVersion,
    p_cash_collected_amount_iqd: null,
    p_cash_change_given_iqd: null,
  });

  if (trErr) {
    const msg = trErr.message ?? 'transition_failed';
    const code = msg.includes('version_mismatch') ? 409 : msg.includes('invalid_transition') ? 409 : 400;
    ctx.warn('admin.ride_cancel.transition_failed', { error: msg, ride_id: rideId });
    return errorJson(msg, code, 'TRANSITION_FAILED', undefined, ctx.headers);
  }

  // Best-effort admin audit log entry (server-side, service_role).
  try {
    await svc.from('admin_audit_log').insert({
      actor_id: gate.user.id,
      action: 'ride_cancel',
      target_user_id: (ride as any).rider_id ?? gate.user.id,
      note: reason,
      details: {
        ride_id: rideId,
        previous_status: (ride as any).status,
        expected_version: expectedVersion,
        result: transitioned ?? null,
      },
    } as any);
  } catch (e) {
    ctx.warn('admin.ride_cancel.audit_insert_failed', { error: String((e as any)?.message ?? e) });
  }

  return json({ ok: true }, 200, ctx.headers);
}
