import { errorJson, json } from '../../_shared/json.ts';
import { createServiceClient } from '../../_shared/supabase.ts';
import { requirePermission } from '../../_shared/admin.ts';
import { enforceAdminRateLimit } from '../../_shared/adminRateLimit.ts';
import { driverTransitionBodySchema } from '../../_shared/schemas.ts';
import { requireMethod, validateJsonBody } from '../../_shared/validate.ts';

function permissionForTransition(toStatus: string): string {
  // Conservative split: suspension changes are separated from other driver edits.
  if (toStatus === 'suspended') return 'drivers.suspend';
  if (toStatus === 'available' || toStatus === 'offline') return 'drivers.suspend';
  return 'drivers.manage';
}

export async function handle(req: Request, ctx: any): Promise<Response> {
  const methodRes = requireMethod(req, ctx, 'POST');
  if (methodRes) return methodRes;

  const parsed = await validateJsonBody(req, ctx, driverTransitionBodySchema);
  if (!parsed.ok) return parsed.res;

  const driverId = parsed.data.driver_id;
  const toStatus = parsed.data.to_status;
  const reason = parsed.data.reason;

  ctx.setCorrelationId(driverId);

  const perm = permissionForTransition(toStatus);
  const gate = await requirePermission(req, ctx, perm);
  if ('res' in gate) return gate.res;

  ctx.setUserId(gate.user.id);

  const rlRes = await enforceAdminRateLimit(ctx, {
    action: 'driver_transition',
    adminId: gate.user.id,
    windowSeconds: 60,
    limit: 30,
    failOpen: false,
  });
  if (rlRes) return rlRes;

  const svc = createServiceClient();

  const { data: before, error: bErr } = await svc
    .from('drivers')
    .select('id,status')
    .eq('id', driverId)
    .maybeSingle();
  if (bErr) {
    ctx.error('admin.driver_transition.driver_query_failed', { error: bErr.message });
    return errorJson('Query failed', 500, 'QUERY_FAILED', undefined, ctx.headers);
  }
  if (!before) {
    return errorJson('Not found', 404, 'NOT_FOUND', undefined, ctx.headers);
  }

  const { data: transitioned, error: trErr } = await svc.rpc('transition_driver', {
    p_driver_id: driverId,
    p_to_status: toStatus,
    p_actor_id: gate.user.id,
    p_reason: reason,
  });

  if (trErr) {
    const msg = trErr.message ?? 'transition_failed';
    ctx.warn('admin.driver_transition.transition_failed', { error: msg, driver_id: driverId, to_status: toStatus });
    return errorJson(msg, 400, 'TRANSITION_FAILED', undefined, ctx.headers);
  }

  try {
    await svc.from('admin_audit_log').insert({
      actor_id: gate.user.id,
      action: 'driver_transition',
      target_user_id: gate.user.id,
      note: reason,
      details: { driver_id: driverId, from_status: (before as any)?.status ?? null, to_status: toStatus, result: transitioned },
    } as any);
  } catch (e) {
    ctx.warn('admin.driver_transition.audit_insert_failed', { error: String((e as any)?.message ?? e) });
  }

  return json({ ok: true, result: transitioned ?? null }, 200, ctx.headers);
}
