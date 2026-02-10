import { errorJson, json } from '../../_shared/json.ts';
import { createServiceClient } from '../../_shared/supabase.ts';
import { requirePermission } from '../../_shared/admin.ts';
import { enforceAdminRateLimit } from '../../_shared/adminRateLimit.ts';
import { adminWithdrawalDetailQuerySchema } from '../../_shared/schemas.ts';
import { requireMethod, validateQuery } from '../../_shared/validate.ts';

export async function handle(req: Request, ctx: any): Promise<Response> {
  const methodRes = requireMethod(req, ctx, 'GET');
  if (methodRes) return methodRes;

  const gate = await requirePermission(req, ctx, 'withdrawals.read');
  if ('res' in gate) return gate.res;
  ctx.setUserId(gate.user.id);

  const rlRes = await enforceAdminRateLimit(ctx, {
    action: 'withdrawal_detail',
    adminId: gate.user.id,
    windowSeconds: 60,
    limit: 240,
    failOpen: true,
  });
  if (rlRes) return rlRes;

  const parsed = validateQuery(req, ctx, adminWithdrawalDetailQuerySchema);
  if (!parsed.ok) return parsed.res;

  const requestId = parsed.data.request_id;
  ctx.setCorrelationId(requestId);

  const svc = createServiceClient();

  const { data: withdraw, error: wErr } = await svc
    .from('wallet_withdraw_requests')
    .select('*')
    .eq('id', requestId)
    .maybeSingle();

  if (wErr) {
    ctx.error('admin.withdrawal_detail.withdraw_query_failed', { error: wErr.message });
    return errorJson('Query failed', 500, 'QUERY_FAILED', undefined, ctx.headers);
  }

  if (!withdraw) {
    return errorJson('Not found', 404, 'NOT_FOUND', undefined, ctx.headers);
  }

  const userId = (withdraw as any).user_id as string | null;
  const holdsQ = svc
    .from('wallet_holds')
    .select('*')
    .eq('withdraw_request_id', requestId)
    .order('created_at', { ascending: false });

  const jobsQ = svc
    .from('payout_provider_jobs')
    .select('*')
    .eq('withdraw_request_id', requestId)
    .order('created_at', { ascending: false });

  const attemptsQ = svc
    .from('payout_provider_job_attempts')
    .select('*')
    .eq('withdraw_request_id', requestId)
    .order('created_at', { ascending: false });

  const userQ = userId
    ? svc.from('profiles').select('id,display_name,phone,locale').eq('id', userId).maybeSingle()
    : Promise.resolve({ data: null, error: null } as any);

  const [{ data: holds, error: hErr }, { data: jobs, error: jErr }, { data: attempts, error: aErr }, { data: user, error: uErr }] =
    await Promise.all([holdsQ, jobsQ, attemptsQ, userQ]);

  if (hErr) ctx.warn('admin.withdrawal_detail.holds_query_failed', { error: hErr.message });
  if (jErr) ctx.warn('admin.withdrawal_detail.jobs_query_failed', { error: jErr.message });
  if (aErr) ctx.warn('admin.withdrawal_detail.attempts_query_failed', { error: aErr.message });
  if (uErr) ctx.warn('admin.withdrawal_detail.user_query_failed', { error: uErr.message });

  return json(
    {
      ok: true,
      withdraw,
      user: user ?? null,
      holds: holds ?? [],
      jobs: jobs ?? [],
      attempts: attempts ?? [],
    },
    200,
    ctx.headers,
  );
}
