import { errorJson, json } from '../../_shared/json.ts';
import { requirePermission } from '../../_shared/admin.ts';
import { createServiceClient } from '../../_shared/supabase.ts';
import { envTrim } from '../../_shared/config.ts';
import { getAppEnv } from '../../_shared/env.ts';
import { enforceAdminRateLimit } from '../../_shared/adminRateLimit.ts';
import { alertingStatusQuerySchema } from '../../_shared/schemas.ts';
import { requireMethod, validateQuery } from '../../_shared/validate.ts';

type CountableError = { message?: string } | string | null | undefined;

function errMsg(err: CountableError): string {
  if (!err) return 'unknown error';
  if (typeof err === 'string') return err;
  const m = (err as any)?.message;
  return typeof m === 'string' && m.trim() ? m : 'unknown error';
}

export async function handle(req: Request, ctx: any): Promise<Response> {
  const methodRes = requireMethod(req, ctx, 'GET');
  if (methodRes) return methodRes;

  const admin = await requirePermission(req, ctx, 'ops.view');
  if ('res' in admin) return admin.res;
  ctx.setUserId(admin.user.id);

  const rlRes = await enforceAdminRateLimit(ctx, {
    action: 'alerting_status',
    adminId: admin.user.id,
    windowSeconds: 60,
    limit: 120,
    failOpen: true,
  });
  if (rlRes) return rlRes;

  const parsed = validateQuery(req, ctx, alertingStatusQuerySchema);
  if (!parsed.ok) return parsed.res;

  const limit = parsed.data.limit;

  const svc = createServiceClient();

  const [eventsRes, activeRes] = await Promise.all([
    svc
      .from('ops_alert_events')
      .select(
        'id,occurred_at,event_type,message,value,notify_status,notified_at,notified_attempts,notified_error,ops_alert_rules(id,name,kind,severity)',
      )
      .order('occurred_at', { ascending: false })
      .limit(limit),
    svc
      .from('ops_alert_state')
      .select(
        'rule_id,is_active,active_since,last_message,last_value,escalated_at,ops_alert_rules(id,name,kind,severity,config)',
      )
      .eq('is_active', true)
      .order('active_since', { ascending: true })
      .limit(200),
  ]);

  if (eventsRes.error) {
    return errorJson(eventsRes.error.message, 500, 'DB_ERROR', undefined, ctx.headers);
  }
  if (activeRes.error) {
    ctx.warn('admin.alerting.active_read_failed', { error: errMsg(activeRes.error) });
  }

  const channels = {
    slack_ticket: !!envTrim('OPS_SLACK_WEBHOOK_TICKET'),
    slack_page: !!envTrim('OPS_SLACK_WEBHOOK_PAGE'),
    webhook: !!envTrim('OPS_WEBHOOK_URL'),
    email: !!(envTrim('OPS_RESEND_API_KEY') && envTrim('OPS_EMAIL_FROM') && envTrim('OPS_EMAIL_TO')),
  };

  return json(
    {
      ok: true,
      env: getAppEnv(),
      channels,
      active: activeRes.data ?? [],
      recent_events: eventsRes.data ?? [],
    },
    200,
    ctx.headers,
  );
}
