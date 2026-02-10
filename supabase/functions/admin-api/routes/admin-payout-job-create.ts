import { errorJson, json } from '../../_shared/json.ts';
import { createServiceClient } from '../../_shared/supabase.ts';
import { requirePermission } from '../../_shared/admin.ts';
import { enforceAdminRateLimit } from '../../_shared/adminRateLimit.ts';
import { payoutJobCreateBodySchema } from '../../_shared/schemas.ts';
import { requireMethod, validateJsonBody } from '../../_shared/validate.ts';

export async function handle(req: Request, ctx: any): Promise<Response> {
  const methodRes = requireMethod(req, ctx, 'POST');
  if (methodRes) return methodRes;

  const gate = await requirePermission(req, ctx, 'payouts.run');
  if ('res' in gate) return gate.res;
  ctx.setUserId(gate.user.id);

  const rlRes = await enforceAdminRateLimit(ctx, {
    action: 'payout_job_create',
    adminId: gate.user.id,
    windowSeconds: 60,
    limit: 60,
    failOpen: false,
  });
  if (rlRes) return rlRes;

  const parsed = await validateJsonBody(req, ctx, payoutJobCreateBodySchema);
  if (!parsed.ok) return parsed.res;

  const withdrawRequestId = parsed.data.withdraw_request_id;
  const idemKey = parsed.data.idempotency_key;

  ctx.setCorrelationId(withdrawRequestId);

  const svc = createServiceClient();

  const { data: w, error: wErr } = await svc
    .from('wallet_withdraw_requests')
    .select('id,user_id,amount_iqd,payout_kind,status,destination')
    .eq('id', withdrawRequestId)
    .maybeSingle();

  if (wErr) {
    ctx.error('admin.payout_job.create.withdraw_query_failed', { error: wErr.message });
    return errorJson('Query failed', 500, 'QUERY_FAILED', undefined, ctx.headers);
  }
  if (!w) {
    return errorJson('Not found', 404, 'NOT_FOUND', undefined, ctx.headers);
  }
  if ((w as any).status !== 'approved') {
    return errorJson('Withdrawal must be approved first', 409, 'INVALID_STATE', { status: (w as any).status }, ctx.headers);
  }

  // Idempotency guard (best-effort). Table is global (no mapping), so we treat
  // duplicates as "already processed" and return latest job for this request.
  const { error: idemErr } = await svc.from('payout_idempotency').insert({ key: idemKey });
  if (idemErr) {
    // 23505: unique_violation
    if (String((idemErr as any).code ?? '').includes('23505') || (idemErr.message ?? '').includes('duplicate')) {
      const { data: existing } = await svc
        .from('payout_provider_jobs')
        .select('*')
        .eq('withdraw_request_id', withdrawRequestId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      return json({ ok: true, deduped: true, job: existing ?? null }, 200, ctx.headers);
    }

    ctx.error('admin.payout_job.create.idempotency_insert_failed', { error: idemErr.message });
    return errorJson('Idempotency insert failed', 500, 'IDEMPOTENCY_FAILED', undefined, ctx.headers);
  }

  const { data: job, error: jErr } = await svc
    .from('payout_provider_jobs')
    .insert({
      withdraw_request_id: withdrawRequestId,
      payout_kind: (w as any).payout_kind,
      amount_iqd: (w as any).amount_iqd,
      status: 'queued',
      created_by: gate.user.id,
      request_payload: {
        created_via: 'admin-api',
        idempotency_key: idemKey,
      },
      provider_idempotency_key: idemKey,
      next_attempt_at: new Date().toISOString(),
    })
    .select('*')
    .single();

  if (jErr) {
    ctx.error('admin.payout_job.create.insert_failed', { error: jErr.message });
    return errorJson('Insert failed', 500, 'INSERT_FAILED', undefined, ctx.headers);
  }

  try {
    await svc.from('admin_audit_log').insert({
      actor_id: gate.user.id,
      action: 'payout_job_create',
      target_user_id: (w as any).user_id,
      note: null,
      details: { withdraw_request_id: withdrawRequestId, job_id: (job as any).id, idempotency_key: idemKey },
    } as any);
  } catch (e) {
    ctx.warn('admin.payout_job.create.audit_insert_failed', { error: String((e as any)?.message ?? e) });
  }

  return json({ ok: true, job }, 200, ctx.headers);
}
