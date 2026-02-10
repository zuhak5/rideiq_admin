import { errorJson, json } from '../../_shared/json.ts';
import { createServiceClient, createUserClient } from '../../_shared/supabase.ts';
import { requirePermission } from '../../_shared/admin.ts';
import { enforceAdminRateLimit } from '../../_shared/adminRateLimit.ts';
import { withdrawMarkPaidBodySchema } from '../../_shared/schemas.ts';
import { requireMethod, validateJsonBody } from '../../_shared/validate.ts';

export async function handle(req: Request, ctx: any): Promise<Response> {
  const methodRes = requireMethod(req, ctx, 'POST');
  if (methodRes) return methodRes;

  const gate = await requirePermission(req, ctx, 'withdrawals.mark_paid');
  if ('res' in gate) return gate.res;
  ctx.setUserId(gate.user.id);

  const rlRes = await enforceAdminRateLimit(ctx, {
    action: 'withdraw_mark_paid',
    adminId: gate.user.id,
    windowSeconds: 60,
    limit: 60,
    failOpen: false,
  });
  if (rlRes) return rlRes;

  const parsed = await validateJsonBody(req, ctx, withdrawMarkPaidBodySchema);
  if (!parsed.ok) return parsed.res;

  const requestId = parsed.data.request_id;
  const payoutReference = parsed.data.payout_reference ?? null;
  const note = parsed.data.note ?? null;

  ctx.setCorrelationId(requestId);

  const userClient = createUserClient(req);

  const { error: rpcErr } = await userClient.rpc('admin_withdraw_mark_paid', {
    p_request_id: requestId,
    p_payout_reference: payoutReference,
    p_note: note,
  });

  if (rpcErr) {
    const msg = rpcErr.message ?? 'mark_paid_failed';
    const code = msg.includes('not_admin') || msg.includes('forbidden') ? 403 : msg.includes('not_found') ? 404 : 400;
    ctx.warn('admin.withdraw.mark_paid.rpc_failed', { error: msg, request_id: requestId });
    return errorJson(msg, code, 'MARK_PAID_FAILED', undefined, ctx.headers);
  }

  const svc = createServiceClient();

  try {
    const { data: w } = await svc
      .from('wallet_withdraw_requests')
      .select('id,user_id,amount_iqd,payout_kind,status,payout_reference')
      .eq('id', requestId)
      .maybeSingle();

    await svc.from('admin_audit_log').insert({
      actor_id: gate.user.id,
      action: 'withdraw_mark_paid',
      target_user_id: (w as any)?.user_id ?? gate.user.id,
      note,
      details: {
        request_id: requestId,
        amount_iqd: (w as any)?.amount_iqd ?? null,
        payout_kind: (w as any)?.payout_kind ?? null,
        payout_reference: payoutReference ?? (w as any)?.payout_reference ?? null,
      },
    } as any);
  } catch (e) {
    ctx.warn('admin.withdraw.mark_paid.audit_insert_failed', { error: String((e as any)?.message ?? e) });
  }

  return json({ ok: true }, 200, ctx.headers);
}
