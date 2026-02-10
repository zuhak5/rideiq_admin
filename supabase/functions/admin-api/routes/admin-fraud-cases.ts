import { errorJson, json } from '../../_shared/json.ts';
import { createServiceClient } from '../../_shared/supabase.ts';
import { requirePermission } from '../../_shared/admin.ts';
import { enforceAdminRateLimit } from '../../_shared/adminRateLimit.ts';
import { fraudCasesListQuerySchema, fraudCaseCloseBodySchema } from '../../_shared/schemas.ts';
import { requireMethod, validateJsonBody, validateQuery } from '../../_shared/validate.ts';

type Op = 'list' | 'close';

function isUuid(v: unknown): v is string {
  return (
    typeof v === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v)
  );
}

export async function handle(req: Request, ctx: any): Promise<Response> {
  const opFromQuery = new URL(req.url).searchParams.get('op');
  const op: Op = opFromQuery === 'close' ? 'close' : 'list';

  // Restrict methods by operation to match Next admin client behavior.
  if (op === 'list') {
    const methodRes = requireMethod(req, ctx, 'GET');
    if (methodRes) return methodRes;
  } else {
    const methodRes = requireMethod(req, ctx, 'POST');
    if (methodRes) return methodRes;
  }

  // RBAC enforcement (deny-by-default).
  const requiredPermission = op === 'close' ? 'fraud.manage' : 'fraud.view';
  const gate = await requirePermission(req, ctx, requiredPermission);
  if ('res' in gate) return gate.res;
  ctx.setUserId(gate.user.id);

  const rlRes = await enforceAdminRateLimit(ctx, {
    action: op === 'close' ? 'fraud_case_close' : 'fraud_cases_list',
    adminId: gate.user.id,
    windowSeconds: 60,
    limit: op === 'close' ? 10 : 120,
    failOpen: op !== 'close',
  });
  if (rlRes) return rlRes;

  const svc = createServiceClient();

  if (op === 'list') {
    const parsed = validateQuery(req, ctx, fraudCasesListQuerySchema);
    if (!parsed.ok) return parsed.res;

    const status = parsed.data.status;
    const limit = parsed.data.limit;

    const { data, error } = await svc
      .from('fraud_cases')
      .select(
        'id,created_at,updated_at,status,subject_kind,subject_key,risk_score,signals,resolution_reason,closed_at,closed_by',
      )
      .eq('status', status)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) {
      ctx.error('admin.fraud_cases.list_failed', { error: error.message });
      return errorJson('Query failed', 500, 'QUERY_FAILED', undefined, ctx.headers);
    }

    return json({ ok: true, cases: data ?? [] }, 200, ctx.headers);
  }

  // op === 'close'
  const parsed = await validateJsonBody(req, ctx, fraudCaseCloseBodySchema);
  if (!parsed.ok) return parsed.res;
  const caseId = (parsed.data.case_id ?? parsed.data.caseId ?? '').trim();
  const resolutionReason = (parsed.data.resolution_reason ?? parsed.data.resolutionReason ?? '').trim();
  if (!caseId || !isUuid(caseId)) return errorJson('Invalid case_id', 400, 'BAD_REQUEST', undefined, ctx.headers);
  if (!resolutionReason) {
    return errorJson('resolution_reason is required', 400, 'BAD_REQUEST', undefined, ctx.headers);
  }

  const { error } = await svc.rpc('fraud_close_case', {
    p_case_id: caseId,
    p_closed_by: gate.user.id,
    p_notes: resolutionReason,
  });

  if (error) {
    ctx.error('admin.fraud_cases.close_failed', { error: error.message });
    return errorJson('Close failed', 500, 'CLOSE_FAILED', undefined, ctx.headers);
  }

  return json({ ok: true }, 200, ctx.headers);
}
