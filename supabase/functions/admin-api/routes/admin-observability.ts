import { errorJson, json } from '../../_shared/json.ts';
import { requirePermission } from '../../_shared/admin.ts';
import { createServiceClient } from '../../_shared/supabase.ts';
import { enforceAdminRateLimit } from '../../_shared/adminRateLimit.ts';
import { observabilityBodySchema } from '../../_shared/schemas.ts';
import { requireMethod, validateJsonBody } from '../../_shared/validate.ts';
import type { RequestContext } from '../../_shared/requestContext.ts';

type CountableError = { message?: string } | string | null | undefined;
type Level = 'info' | 'warn' | 'error';

function errMsg(err: CountableError): string {
  if (!err) return 'unknown error';
  if (typeof err === 'string') return err;
  const m = (err as any)?.message;
  return typeof m === 'string' && m.trim() ? m : 'unknown error';
}


async function safeCount(
  ctx: RequestContext,
  label: string,
  builder: () => Promise<{ count: number | null; error: any }>,
): Promise<number> {
  try {
    const { count, error } = await builder();
    if (error) {
      ctx.warn('admin.observability.count_failed', { label, error: errMsg(error) });
      return 0;
    }
    return Number(count ?? 0) || 0;
  } catch (e) {
    ctx.warn('admin.observability.count_failed', { label, error: errMsg(String((e as any)?.message ?? e)) });
    return 0;
  }
}

function topEventTypes(sample: Array<{ event_type: string; level: Level }>) {
  const map = new Map<string, { total: number; info: number; warn: number; error: number }>();
  for (const e of sample) {
    const cur = map.get(e.event_type) ?? { total: 0, info: 0, warn: 0, error: 0 };
    cur.total += 1;
    cur[e.level] += 1;
    map.set(e.event_type, cur);
  }
  return Array.from(map.entries())
    .map(([event_type, c]) => ({ event_type, ...c }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 20);
}

type Alert = {
  id: string;
  severity: 'info' | 'warning' | 'critical';
  active: boolean;
  title: string;
  message: string;
  runbook: string;
};

function buildAlerts(args: {
  total15m: number;
  error15m: number;
  webhookInternalErrors15m: number;
  webhookAuthFails15m: number;
  mapsMisconfigured15m: number;
  topSample: Array<{ event_type: string; total: number }>;
}): Alert[] {
  const errorRate = args.total15m > 0 ? args.error15m / args.total15m : 0;
  const errorSpike = args.error15m >= 10 || (args.error15m >= 3 && errorRate >= 0.05);
  const top = args.topSample.slice(0, 3).map((x) => `${x.event_type} (${x.total})`).join(', ');

  return [
    {
      id: 'error_spike_15m',
      severity: errorSpike ? 'critical' : 'info',
      active: errorSpike,
      title: 'Error spike (15m)',
      message: errorSpike
        ? `High error volume: ${args.error15m} errors / ${args.total15m} events (${Math.round(errorRate * 100)}%).`
        : `No spike (last 15m: ${args.error15m} errors / ${args.total15m} events).`,
      runbook: '/runbooks/errors',
    },
    {
      id: 'webhook_internal_errors_15m',
      severity: args.webhookInternalErrors15m > 0 ? 'critical' : 'info',
      active: args.webhookInternalErrors15m > 0,
      title: 'Webhook internal errors (15m)',
      message: args.webhookInternalErrors15m > 0
        ? `Webhook internal errors detected: ${args.webhookInternalErrors15m} in last 15m.`
        : 'No webhook internal errors detected in last 15m.',
      runbook: '/runbooks/webhooks',
    },
    {
      id: 'webhook_auth_fail_15m',
      severity: args.webhookAuthFails15m >= 10 ? 'warning' : 'info',
      active: args.webhookAuthFails15m >= 10,
      title: 'Webhook auth failures (15m)',
      message: args.webhookAuthFails15m >= 10
        ? `High webhook auth failure volume: ${args.webhookAuthFails15m} in last 15m.`
        : `Auth failures within expected range (last 15m: ${args.webhookAuthFails15m}).`,
      runbook: '/runbooks/webhooks',
    },
    {
      id: 'maps_misconfigured_15m',
      severity: args.mapsMisconfigured15m > 0 ? 'warning' : 'info',
      active: args.mapsMisconfigured15m > 0,
      title: 'Maps misconfigured (15m)',
      message: args.mapsMisconfigured15m > 0
        ? `Maps configuration errors detected: ${args.mapsMisconfigured15m} in last 15m.`
        : 'No maps misconfiguration events detected in last 15m.',
      runbook: '/runbooks/maps',
    },
    {
      id: 'top_event_types_sample',
      severity: 'info',
      active: false,
      title: 'Noisiest event types (sample)',
      message: top ? `Top event types in sample: ${top}` : 'No events in sample window.',
      runbook: '/observability',
    },
  ];
}

export async function handle(req: Request, ctx: any): Promise<Response> {
  const methodRes = requireMethod(req, ctx, 'POST');
  if (methodRes) return methodRes;

  const admin = await requirePermission(req, ctx, 'observability.view');
  if ('res' in admin) return admin.res;
  ctx.setUserId(admin.user.id);

  const rlRes = await enforceAdminRateLimit(ctx, {
    action: 'observability',
    adminId: admin.user.id,
    windowSeconds: 60,
    limit: 60,
    failOpen: true,
  });
  if (rlRes) return rlRes;
  const parsed = await validateJsonBody(req, ctx, observabilityBodySchema);
  if (!parsed.ok) return parsed.res;

  const windowMinutes = parsed.data.window_minutes;
  const recentLimit = parsed.data.recent_limit;
  const sampleLimit = parsed.data.sample_limit;

  const svc = createServiceClient();
  const since = new Date(Date.now() - windowMinutes * 60 * 1000).toISOString();
  const since15m = new Date(Date.now() - 15 * 60 * 1000).toISOString();

  const [
    totalWindow,
    infoWindow,
    warnWindow,
    errorWindow,
    total15m,
    error15m,
    webhookInternalErrors15m,
    webhookAuthFails15m,
    mapsMisconfigured15m,
  ] = await Promise.all([
    safeCount(ctx, 'events_total_window', () =>
      svc.from('app_events').select('id', { count: 'exact', head: true }).gte('created_at', since) as any,
    ),
    safeCount(ctx, 'events_info_window', () =>
      svc.from('app_events').select('id', { count: 'exact', head: true }).gte('created_at', since).eq('level', 'info') as any,
    ),
    safeCount(ctx, 'events_warn_window', () =>
      svc.from('app_events').select('id', { count: 'exact', head: true }).gte('created_at', since).eq('level', 'warn') as any,
    ),
    safeCount(ctx, 'events_error_window', () =>
      svc.from('app_events').select('id', { count: 'exact', head: true }).gte('created_at', since).eq('level', 'error') as any,
    ),
    safeCount(ctx, 'events_total_15m', () =>
      svc.from('app_events').select('id', { count: 'exact', head: true }).gte('created_at', since15m) as any,
    ),
    safeCount(ctx, 'events_error_15m', () =>
      svc.from('app_events').select('id', { count: 'exact', head: true }).gte('created_at', since15m).eq('level', 'error') as any,
    ),
    safeCount(ctx, 'webhook_internal_errors_15m', () =>
      svc.from('app_events').select('id', { count: 'exact', head: true }).gte('created_at', since15m).eq('event_type', 'metric.webhook.internal_error') as any,
    ),
    safeCount(ctx, 'webhook_auth_fail_15m', () =>
      svc.from('app_events').select('id', { count: 'exact', head: true }).gte('created_at', since15m).eq('event_type', 'metric.webhook.auth_fail') as any,
    ),
    safeCount(ctx, 'maps_misconfigured_15m', () =>
      svc.from('app_events').select('id', { count: 'exact', head: true }).gte('created_at', since15m).eq('event_type', 'metric.maps.misconfigured') as any,
    ),
  ]);

  const { data: sample, error: sampleError } = await svc
    .from('app_events')
    .select('event_type,level')
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(sampleLimit);
  if (sampleError) ctx.warn('admin.observability.sample_failed', { error: errMsg(sampleError) });

  const top = topEventTypes((sample ?? []) as any);

  const { data: recentEvents, error: recentError } = await svc
    .from('app_events')
    .select('id,created_at,event_type,level,actor_id,request_id,ride_id,payment_intent_id,payload')
    .gte('created_at', since)
    .in('level', ['warn', 'error'])
    .order('created_at', { ascending: false })
    .limit(recentLimit);
  if (recentError) ctx.warn('admin.observability.recent_failed', { error: errMsg(recentError) });

  const alerts = buildAlerts({
    total15m,
    error15m,
    webhookInternalErrors15m,
    webhookAuthFails15m,
    mapsMisconfigured15m,
    topSample: top.map((x) => ({ event_type: x.event_type, total: x.total })),
  });

  return json(
    {
      ok: true,
      generated_at: new Date().toISOString(),
      window_minutes: windowMinutes,
      counts: {
        window: { total: totalWindow, info: infoWindow, warn: warnWindow, error: errorWindow },
        last_15m: { total: total15m, error: error15m },
      },
      derived: {
        webhook_internal_errors_15m: webhookInternalErrors15m,
        webhook_auth_fail_15m: webhookAuthFails15m,
        maps_misconfigured_15m: mapsMisconfigured15m,
      },
      top_event_types: top,
      recent_events: recentEvents ?? [],
      alerts,
    },
    200,
    ctx.headers,
  );
}
