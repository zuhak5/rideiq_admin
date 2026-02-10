import { errorJson, json } from '../../_shared/json.ts';
import { requirePermission } from '../../_shared/admin.ts';
import { createServiceClient } from '../../_shared/supabase.ts';
import { enforceAdminRateLimit } from '../../_shared/adminRateLimit.ts';
import { requireMethod } from '../../_shared/validate.ts';
import type { RequestContext } from '../../_shared/requestContext.ts';

type CountableError = { message?: string } | string | null | undefined;

function errMsg(err: CountableError): string {
  if (!err) return 'unknown error';
  if (typeof err === 'string') return err;
  if (typeof err === 'object') {
    const m = (err as any)?.message;
    if (typeof m === 'string' && m.trim()) return m;
  }
  return 'unknown error';
}

async function safeCount(
  ctx: RequestContext,
  label: string,
  builder: () => Promise<{ count: number | null; error: any }>,
): Promise<number> {
  try {
    const { count, error } = await builder();
    if (error) {
      ctx.warn('admin.summary.count_failed', { label, error: errMsg(error) });
      return 0;
    }
    return Number(count ?? 0) || 0;
  } catch (e) {
    ctx.warn('admin.summary.count_failed', { label, error: errMsg(String((e as any)?.message ?? e)) });
    return 0;
  }
}

export async function handle(req: Request, ctx: any): Promise<Response> {
  const methodRes = requireMethod(req, ctx, 'POST');
  if (methodRes) return methodRes;

  const admin = await requirePermission(req, ctx, 'dashboard.view');
  if ('res' in admin) return admin.res;
  ctx.setUserId(admin.user.id);

  const rlRes = await enforceAdminRateLimit(ctx, {
    action: 'dashboard_summary',
    adminId: admin.user.id,
    windowSeconds: 60,
    limit: 120,
    failOpen: true,
  });
  if (rlRes) return rlRes;


  const svc = createServiceClient();
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const [
    usersTotal,
    adminsTotal,
    ridesActive,
    rides24h,
    fraudOpen,
    fraudActionsActive,
    activeAlerts,
    payoutQueued,
    payoutFailed,
  ] = await Promise.all([
    safeCount(ctx, 'profiles_total', () =>
      svc.from('profiles').select('id', { count: 'exact', head: true }) as any,
    ),
    safeCount(ctx, 'admin_users_total', () =>
      svc.from('admin_users').select('user_id', { count: 'exact', head: true }) as any,
    ),
    safeCount(ctx, 'rides_active', () =>
      svc
        .from('rides')
        .select('id', { count: 'exact', head: true })
        .in('status', ['assigned', 'arrived', 'in_progress']) as any,
    ),
    safeCount(ctx, 'rides_24h', () =>
      svc
        .from('rides')
        .select('id', { count: 'exact', head: true })
        .gte('created_at', since24h) as any,
    ),
    safeCount(ctx, 'fraud_cases_open', () =>
      svc
        .from('fraud_cases')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'open') as any,
    ),
    safeCount(ctx, 'fraud_actions_active', () =>
      svc
        .from('fraud_enforcement_actions')
        .select('id', { count: 'exact', head: true })
        .is('expired_at', null)
        .is('resolved_at', null) as any,
    ),
    safeCount(ctx, 'ops_alerts_active', () =>
      svc
        .from('ops_alert_state')
        .select('rule_id', { count: 'exact', head: true })
        .eq('is_active', true) as any,
    ),
    safeCount(ctx, 'payout_jobs_queued', () =>
      svc
        .from('payout_provider_jobs')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'queued')
        .is('canceled_at', null) as any,
    ),
    safeCount(ctx, 'payout_jobs_failed', () =>
      svc
        .from('payout_provider_jobs')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'failed')
        .is('canceled_at', null) as any,
    ),
  ]);

  return json(
    {
      ok: true,
      generated_at: new Date().toISOString(),
      counts: {
        users_total: usersTotal,
        admins_total: adminsTotal,
        rides_active: ridesActive,
        rides_last_24h: rides24h,
        fraud_cases_open: fraudOpen,
        fraud_actions_active: fraudActionsActive,
        ops_alerts_active: activeAlerts,
        payout_jobs_queued: payoutQueued,
        payout_jobs_failed: payoutFailed,
      },
    },
    200,
    ctx.headers,
  );
}
