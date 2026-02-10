import { errorJson, json } from '../../_shared/json.ts';
import { requirePermission } from '../../_shared/admin.ts';
import { createServiceClient } from '../../_shared/supabase.ts';
import { enforceAdminRateLimit } from '../../_shared/adminRateLimit.ts';
import { sloSummaryBodySchema } from '../../_shared/schemas.ts';
import { requireMethod, validateJsonBody } from '../../_shared/validate.ts';
import type { RequestContext } from '../../_shared/requestContext.ts';

type CountableError = { message?: string } | string | null | undefined;

function errMsg(err: CountableError): string {
  if (!err) return 'unknown error';
  if (typeof err === 'string') return err;
  const m = (err as any)?.message;
  return typeof m === 'string' && m.trim() ? m : 'unknown error';
}

async function safeRpc<T>(
  ctx: RequestContext,
  label: string,
  builder: () => Promise<{ data: T | null; error: any }>,
): Promise<T | null> {
  try {
    const { data, error } = await builder();
    if (error) {
      ctx.warn('admin.slo.rpc_failed', { label, error: errMsg(error) });
      return null;
    }
    return data;
  } catch (e) {
    ctx.warn('admin.slo.rpc_failed', { label, error: errMsg(String((e as any)?.message ?? e)) });
    return null;
  }
}

export async function handle(req: Request, ctx: any): Promise<Response> {
  const methodRes = requireMethod(req, ctx, 'POST');
  if (methodRes) return methodRes;
  const admin = await requirePermission(req, ctx, 'observability.view');
  if ('res' in admin) return admin.res;
  ctx.setUserId(admin.user.id);

  const rlRes = await enforceAdminRateLimit(ctx, {
    action: 'slo_summary',
    adminId: admin.user.id,
    windowSeconds: 60,
    limit: 120,
    failOpen: true,
  });
  if (rlRes) return rlRes;

  const parsed = await validateJsonBody(req, ctx, sloSummaryBodySchema);
  if (!parsed.ok) return parsed.res;

  const windowMinutes = parsed.data.window_minutes;
  const limit = parsed.data.limit;

  const svc = createServiceClient();
  const since = new Date(Date.now() - windowMinutes * 60 * 1000).toISOString();

  const rows = await safeRpc<any[]>(ctx, 'ops_metric_latency_summary_v1', () =>
    svc.rpc('ops_metric_latency_summary_v1', { p_since: since, p_limit: limit }) as any
  );

  if (!rows) {
    return errorJson('Failed to load SLO summary', 500, 'DB_ERROR', undefined, ctx.headers);
  }

  const totals = rows.reduce(
    (acc, r) => {
      const t = Number((r as any).total ?? 0) || 0;
      const e = Number((r as any).errors ?? 0) || 0;
      acc.total += t;
      acc.errors += e;
      return acc;
    },
    { total: 0, errors: 0 },
  );

  return json(
    {
      ok: true,
      window_minutes: windowMinutes,
      since,
      totals: {
        total: totals.total,
        errors: totals.errors,
        error_rate: totals.total > 0 ? totals.errors / totals.total : 0,
      },
      rows,
    },
    200,
    ctx.headers,
  );
}
