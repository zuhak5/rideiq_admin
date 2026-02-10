import { errorJson, json } from '../../_shared/json.ts';
import { createServiceClient } from '../../_shared/supabase.ts';
import { requirePermission } from '../../_shared/admin.ts';
import { enforceAdminRateLimit } from '../../_shared/adminRateLimit.ts';
import { fraudActionsListQuerySchema, fraudActionResolveBodySchema } from '../../_shared/schemas.ts';
import { requireMethod, validateJsonBody, validateQuery } from '../../_shared/validate.ts';

type Op = 'list' | 'resolve';

function isUuid(v: unknown): v is string {
  return (
    typeof v === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v)
  );
}

export async function handle(req: Request, ctx: any): Promise<Response> {
  const opFromQuery = new URL(req.url).searchParams.get('op');
  const op: Op = opFromQuery === 'resolve' ? 'resolve' : 'list';

  // Restrict methods by operation to match Next admin client behavior.
  if (op === 'list') {
    const methodRes = requireMethod(req, ctx, 'GET');
    if (methodRes) return methodRes;
  } else {
    const methodRes = requireMethod(req, ctx, 'POST');
    if (methodRes) return methodRes;
  }

  const requiredPermission = op === 'resolve' ? 'fraud.manage' : 'fraud.view';
  const gate = await requirePermission(req, ctx, requiredPermission);
  if ('res' in gate) return gate.res;
  ctx.setUserId(gate.user.id);

  const rlRes = await enforceAdminRateLimit(ctx, {
    action: op === 'resolve' ? 'fraud_action_resolve' : 'fraud_actions_list',
    adminId: gate.user.id,
    windowSeconds: 60,
    limit: op === 'resolve' ? 10 : 120,
    failOpen: op !== 'resolve',
  });
  if (rlRes) return rlRes;

  const svc = createServiceClient();

  if (op === 'list') {
    const parsed = validateQuery(req, ctx, fraudActionsListQuerySchema);
    if (!parsed.ok) return parsed.res;

    const status = parsed.data.status;
    const limit = parsed.data.limit;

    let q = svc
      .from('fraud_enforcement_actions')
      .select(
        'id,created_at,updated_at,action_type,subject_kind,subject_key,reason,severity,expires_at,expired_at,resolved_at,resolved_by,resolution_reason,metadata',
      )
      .order('created_at', { ascending: false })
      .limit(limit);

    if (status === 'resolved') {
      q = q.not('resolved_at', 'is', null);
    } else if (status === 'expired') {
      q = q.not('expired_at', 'is', null);
    } else {
      // active
      q = q.is('resolved_at', null);
    }

    const { data, error } = await q;

    if (error) {
      ctx.error('admin.fraud_actions.list_failed', { error: error.message });
      return errorJson('Query failed', 500, 'QUERY_FAILED', undefined, ctx.headers);
    }

    return json({ ok: true, actions: data ?? [] }, 200, ctx.headers);
  }

  // op === 'resolve'
  const parsed = await validateJsonBody(req, ctx, fraudActionResolveBodySchema);
  if (!parsed.ok) return parsed.res;

  const actionId = String(parsed.data.action_id ?? parsed.data.actionId ?? '').trim();
  const resolutionReason = String(parsed.data.resolution_reason ?? parsed.data.resolutionReason ?? '').trim();

  if (!actionId || !isUuid(actionId)) return errorJson('Invalid action_id', 400, 'BAD_REQUEST', undefined, ctx.headers);
  if (!resolutionReason) return errorJson('resolution_reason is required', 400, 'BAD_REQUEST', undefined, ctx.headers);

  const { error } = await svc.rpc('fraud_resolve_action', {
    p_action_id: actionId,
    p_resolved_by: gate.user.id,
    p_notes: resolutionReason,
  });

  if (error) {
    ctx.error('admin.fraud_actions.resolve_failed', { error: error.message });
    return errorJson('Resolve failed', 500, 'RESOLVE_FAILED', undefined, ctx.headers);
  }

  return json({ ok: true }, 200, ctx.headers);
}
