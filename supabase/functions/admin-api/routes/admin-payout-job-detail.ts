import { errorJson, json } from '../../_shared/json.ts';
import { createServiceClient } from '../../_shared/supabase.ts';
import { requirePermission } from '../../_shared/admin.ts';
import { enforceAdminRateLimit } from '../../_shared/adminRateLimit.ts';
import { adminPayoutJobDetailQuerySchema } from '../../_shared/schemas.ts';
import { requireMethod, validateQuery } from '../../_shared/validate.ts';

export async function handle(req: Request, ctx: any): Promise<Response> {
  const methodRes = requireMethod(req, ctx, 'GET');
  if (methodRes) return methodRes;

  const gate = await requirePermission(req, ctx, 'payouts.read');
  if ('res' in gate) return gate.res;
  ctx.setUserId(gate.user.id);

  const rlRes = await enforceAdminRateLimit(ctx, {
    action: 'payout_job_detail',
    adminId: gate.user.id,
    windowSeconds: 60,
    limit: 240,
    failOpen: true,
  });
  if (rlRes) return rlRes;

  const parsed = validateQuery(req, ctx, adminPayoutJobDetailQuerySchema);
  if (!parsed.ok) return parsed.res;

  const jobId = parsed.data.job_id;
  ctx.setCorrelationId(jobId);

  const svc = createServiceClient();

  const { data: job, error: jErr } = await svc
    .from('payout_provider_jobs')
    .select('*')
    .eq('id', jobId)
    .maybeSingle();
  if (jErr) {
    ctx.error('admin.payout_job_detail.job_query_failed', { error: jErr.message });
    return errorJson('Query failed', 500, 'QUERY_FAILED', undefined, ctx.headers);
  }
  if (!job) {
    return errorJson('Not found', 404, 'NOT_FOUND', undefined, ctx.headers);
  }

  const withdrawId = (job as any).withdraw_request_id as string | null;

  const [withdrawRes, userRes, attemptsRes] = await Promise.all([
    withdrawId
      ? svc.from('wallet_withdraw_requests').select('*').eq('id', withdrawId).maybeSingle()
      : Promise.resolve({ data: null, error: null } as any),
    withdrawId
      ? svc
          .from('profiles')
          .select('id,display_name,phone')
          .eq('id', (job as any).created_by ?? (withdrawId as any))
          .maybeSingle()
      : Promise.resolve({ data: null, error: null } as any),
    svc
      .from('payout_provider_job_attempts')
      .select('*')
      .eq('job_id', jobId)
      .order('created_at', { ascending: false })
      .limit(50),
  ]);

  if (withdrawRes.error) {
    ctx.warn('admin.payout_job_detail.withdraw_query_failed', { error: withdrawRes.error.message });
  }
  if (userRes.error) {
    ctx.warn('admin.payout_job_detail.user_query_failed', { error: userRes.error.message });
  }
  if (attemptsRes.error) {
    ctx.warn('admin.payout_job_detail.attempts_query_failed', { error: attemptsRes.error.message });
  }

  return json(
    {
      ok: true,
      job,
      withdraw: withdrawRes.data ?? null,
      user: userRes.data ?? null,
      attempts: attemptsRes.data ?? [],
    },
    200,
    ctx.headers,
  );
}
