import { errorJson, json } from '../../_shared/json.ts';
import { createServiceClient, createUserClient } from '../../_shared/supabase.ts';
import { requirePermission } from '../../_shared/admin.ts';
import { enforceAdminRateLimit } from '../../_shared/adminRateLimit.ts';
import { withdrawDecisionBodySchema } from '../../_shared/schemas.ts';
import { requireMethod, validateJsonBody } from '../../_shared/validate.ts';

export async function handle(req: Request, ctx: any): Promise<Response> {
  const methodRes = requireMethod(req, ctx, 'POST');
  if (methodRes) return methodRes;

  const gate = await requirePermission(req, ctx, 'withdrawals.reject');
  if ('res' in gate) return gate.res;
  ctx.setUserId(gate.user.id);

  const rlRes = await enforceAdminRateLimit(ctx, {
    action: 'withdraw_reject',
    adminId: gate.user.id,
    windowSeconds: 60,
    limit: 60,
    failOpen: false,
  });
  if (rlRes) return rlRes;

  const parsed = await validateJsonBody(req, ctx, withdrawDecisionBodySchema);
  if (!parsed.ok) return parsed.res;

  const requestId = parsed.data.request_id;
  const note = parsed.data.note ?? null;

  ctx.setCorrelationId(requestId);

  const userClient = createUserClient(req);
  const { error: rpcErr } = await userClient.rpc('admin_withdraw_reject', {
    p_request_id: requestId,
    p_note: note,
  });

  if (rpcErr) {
    const msg = rpcErr.message ?? 'reject_failed';
    const code = msg.includes('not_admin') || msg.includes('forbidden') ? 403 : msg.includes('not_found') ? 404 : 400;
    ctx.warn('admin.withdraw.reject.rpc_failed', { error: msg, request_id: requestId });
    return errorJson(msg, code, 'REJECT_FAILED', undefined, ctx.headers);
  }

  const svc = createServiceClient();

  try {
    const { data: w } = await svc
      .from('wallet_withdraw_requests')
      .select('id,user_id,amount_iqd,payout_kind,status')
      .eq('id', requestId)
      .maybeSingle();

    await svc.from('admin_audit_log').insert({
      actor_id: gate.user.id,
      action: 'withdraw_reject',
      target_user_id: (w as any)?.user_id ?? gate.user.id,
      note,
      details: { request_id: requestId, amount_iqd: (w as any)?.amount_iqd ?? null, payout_kind: (w as any)?.payout_kind ?? null },
    } as any);
  } catch (e) {
    ctx.warn('admin.withdraw.reject.audit_insert_failed', { error: String((e as any)?.message ?? e) });
  }

  return json({ ok: true }, 200, ctx.headers);
}
