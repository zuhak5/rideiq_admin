import { errorJson, json } from '../../_shared/json.ts';
import { createServiceClient } from '../../_shared/supabase.ts';
import { requirePermission } from '../../_shared/admin.ts';
import { enforceAdminRateLimit } from '../../_shared/adminRateLimit.ts';
import { payoutJobActionBodySchema } from '../../_shared/schemas.ts';
import { requireMethod, validateJsonBody } from '../../_shared/validate.ts';

export async function handle(req: Request, ctx: any): Promise<Response> {
  const methodRes = requireMethod(req, ctx, 'POST');
  if (methodRes) return methodRes;

  // Baseline permission for "job ops".
  const gate = await requirePermission(req, ctx, 'payouts.retry');
  if ('res' in gate) return gate.res;
  ctx.setUserId(gate.user.id);

  const rlRes = await enforceAdminRateLimit(ctx, {
    action: 'payout_job_action',
    adminId: gate.user.id,
    windowSeconds: 60,
    limit: 120,
    failOpen: false,
  });
  if (rlRes) return rlRes;

  const parsed = await validateJsonBody(req, ctx, payoutJobActionBodySchema);
  if (!parsed.ok) return parsed.res;

  const jobId = parsed.data.job_id;
  const action = parsed.data.action;
  const providerRef = (parsed.data.provider_ref ?? '').trim();
  const note = (parsed.data.note ?? '').trim();

  ctx.setCorrelationId(jobId);

  // Force-confirm is high impact: require explicit permission for withdrawal settlement.
  if (action === 'force_confirm') {
    const gate2 = await requirePermission(req, ctx, 'withdrawals.mark_paid');
    if ('res' in gate2) return gate2.res;
  }

  const svc = createServiceClient();

  const { data: job, error: jErr } = await svc.from('payout_provider_jobs').select('*').eq('id', jobId).maybeSingle();
  if (jErr) {
    ctx.error('admin.payout_job.action.job_query_failed', { error: jErr.message });
    return errorJson('Query failed', 500, 'QUERY_FAILED', undefined, ctx.headers);
  }
  if (!job) {
    return errorJson('Not found', 404, 'NOT_FOUND', undefined, ctx.headers);
  }

  const withdrawId = String((job as any).withdraw_request_id ?? '').trim();
  const nowIso = new Date().toISOString();

  if (action === 'cancel') {
    if (String((job as any).status) === 'confirmed') {
      return errorJson('Cannot cancel confirmed job', 409, 'INVALID_STATE', { status: (job as any).status }, ctx.headers);
    }

    const { data: updated, error: uErr } = await svc
      .from('payout_provider_jobs')
      .update({
        status: 'canceled',
        canceled_at: nowIso,
        lock_token: null,
        locked_at: null,
        last_error: note || (job as any).last_error || null,
        updated_at: nowIso,
      })
      .eq('id', jobId)
      .select('*')
      .single();

    if (uErr) {
      ctx.error('admin.payout_job.action.cancel_failed', { error: uErr.message });
      return errorJson('Update failed', 500, 'UPDATE_FAILED', undefined, ctx.headers);
    }

    try {
      const { data: w } = await svc.from('wallet_withdraw_requests').select('user_id').eq('id', withdrawId).maybeSingle();
      await svc.from('admin_audit_log').insert({
        actor_id: gate.user.id,
        action: 'payout_job_cancel',
        target_user_id: (w as any)?.user_id ?? gate.user.id,
        note: note || null,
        details: { job_id: jobId, withdraw_request_id: withdrawId },
      } as any);
    } catch (_) {}

    return json({ ok: true, job: updated }, 200, ctx.headers);
  }

  if (action === 'retry_now') {
    if (String((job as any).status) === 'confirmed') {
      return errorJson('Cannot retry confirmed job', 409, 'INVALID_STATE', { status: (job as any).status }, ctx.headers);
    }

    const { data: updated, error: uErr } = await svc
      .from('payout_provider_jobs')
      .update({
        status: 'queued',
        next_attempt_at: nowIso,
        lock_token: null,
        locked_at: null,
        last_error: null,
        updated_at: nowIso,
      })
      .eq('id', jobId)
      .select('*')
      .single();

    if (uErr) {
      ctx.error('admin.payout_job.action.retry_failed', { error: uErr.message });
      return errorJson('Update failed', 500, 'UPDATE_FAILED', undefined, ctx.headers);
    }

    try {
      const { data: w } = await svc.from('wallet_withdraw_requests').select('user_id').eq('id', withdrawId).maybeSingle();
      await svc.from('admin_audit_log').insert({
        actor_id: gate.user.id,
        action: 'payout_job_retry',
        target_user_id: (w as any)?.user_id ?? gate.user.id,
        note: note || null,
        details: { job_id: jobId, withdraw_request_id: withdrawId },
      } as any);
    } catch (_) {}

    return json({ ok: true, job: updated }, 200, ctx.headers);
  }

  // force_confirm
  if (!['sent', 'confirmed'].includes(String((job as any).status))) {
    return errorJson(
      'force_confirm only allowed for sent/confirmed jobs',
      409,
      'INVALID_STATE',
      { status: (job as any).status },
      ctx.headers,
    );
  }

  const { data: withdraw } = await svc
    .from('wallet_withdraw_requests')
    .select('id,user_id,status')
    .eq('id', withdrawId)
    .maybeSingle();

  // Update job first for visibility.
  const { data: updated, error: uErr } = await svc
    .from('payout_provider_jobs')
    .update({
      status: 'confirmed',
      confirmed_at: nowIso,
      provider_ref: providerRef || (job as any).provider_ref || null,
      updated_at: nowIso,
      response_payload: { ...(job as any).response_payload, forced_confirm: true, note: note || null },
    })
    .eq('id', jobId)
    .select('*')
    .single();

  if (uErr) {
    ctx.error('admin.payout_job.action.force_confirm_update_failed', { error: uErr.message });
    return errorJson('Update failed', 500, 'UPDATE_FAILED', undefined, ctx.headers);
  }

  // Settle withdrawal if still approved.
  if ((withdraw as any)?.status === 'approved') {
    const { error: rpcErr } = await svc.rpc('system_withdraw_mark_paid', {
      p_request_id: withdrawId,
      p_payout_reference: providerRef || (job as any).provider_ref || null,
      p_provider_payload: { forced_confirm: true, job_id: jobId, note: note || null },
    });

    if (rpcErr) {
      // If already paid, ignore. Otherwise surface.
      const msg = rpcErr.message ?? 'system_withdraw_mark_paid_failed';
      if (!msg.includes('invalid_status_transition')) {
        ctx.error('admin.payout_job.action.force_confirm_settle_failed', { error: msg, withdraw_request_id: withdrawId });
        return errorJson(msg, 500, 'SETTLE_FAILED', undefined, ctx.headers);
      }
    }
  }

  try {
    await svc.from('admin_audit_log').insert({
      actor_id: gate.user.id,
      action: 'payout_job_force_confirm',
      target_user_id: (withdraw as any)?.user_id ?? gate.user.id,
      note: note || null,
      details: { job_id: jobId, withdraw_request_id: withdrawId, provider_ref: providerRef || null },
    } as any);
  } catch (_) {}

  return json({ ok: true, job: updated }, 200, ctx.headers);
}
