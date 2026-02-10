import { requirePermission } from '../_shared/admin.ts';
import { json } from '../_shared/json.ts';
import type { RequestContext } from '../_shared/requestContext.ts';
import { safeRpc, safeSelectSingle, safeSelectView } from '../_shared/safeDb.ts';
import { createServiceClient } from '../_shared/supabase.ts';

// Main handler kept intentionally small and readable.
export async function handleOpsDashboard(req: Request, ctx: RequestContext): Promise<Response> {
  const admin = await requirePermission(req, ctx, 'ops.view');
  if ('res' in admin) return admin.res;

  const service = createServiceClient();

  const [
    webhook,
    payments,
    dispatch,
    safety,
    maps,
    jobs,
    jobWorker,
    db,
    alertState,
    alertEvents,
  ] = await Promise.all([
    safeSelectView(service, 'ops_webhook_metrics_15m', ctx, 'ops.dashboard'),
    safeSelectView(service, 'ops_payment_metrics_15m', ctx, 'ops.dashboard'),
    safeSelectSingle(service, 'ops_dispatch_metrics_15m', ctx, 'ops.dashboard'),
    safeSelectSingle(service, 'ops_safety_metrics_15m', ctx, 'ops.dashboard'),
    safeSelectSingle(service, 'ops_maps_metrics_15m', ctx, 'ops.dashboard'),
    safeSelectSingle(service, 'ops_job_queue_summary', ctx, 'ops.dashboard'),
    safeSelectSingle(service, 'ops_job_worker_metrics_15m', ctx, 'ops.dashboard'),
    safeRpc(service, 'ops_db_conn_stats', ctx, 'ops.dashboard'),
    service
      .from('ops_alert_state')
      .select('is_active, active_since, last_message, last_triggered_at, last_resolved_at, last_value, rule:ops_alert_rules(name, kind, severity)')
      .order('updated_at', { ascending: false })
      .then(({ data, error }: any) => {
        if (error) {
          ctx.warn('ops.dashboard.alert_state_failed', { error: error.message });
          return [];
        }
        return Array.isArray(data) ? data : [];
      }),
    service
      .from('ops_alert_events')
      .select('occurred_at, event_type, message, value, rule:ops_alert_rules(name, severity)')
      .order('occurred_at', { ascending: false })
      .limit(50)
      .then(({ data, error }: any) => {
        if (error) {
          ctx.warn('ops.dashboard.alert_events_failed', { error: error.message });
          return [];
        }
        return Array.isArray(data) ? data : [];
      }),
  ]);

  // Guard: if migrations are not applied yet, surface an actionable response.
  if (!webhook.length && !payments.length && !dispatch && !safety && !maps && !jobs) {
    ctx.warn('ops.dashboard.empty', { hint: 'migrations_not_applied_or_no_data' });
  }

  return json(
    {
      ok: true,
      window_minutes: 15,
      generated_at: new Date().toISOString(),
      dashboards: {
        webhook,
        payments,
        dispatch,
        safety,
        maps,
        jobs,
        job_worker: jobWorker,
        db,
      },
      alerts: {
        state: alertState,
        recent_events: alertEvents,
      },
    },
    200,
    ctx.headers,
  );
}
