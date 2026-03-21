import { createServiceClient } from '../../_shared/supabase.ts';
import { requirePermission } from '../../_shared/admin.ts';
import { json, errorJson } from '../../_shared/json.ts';
import { requireMethod, validateJsonBody } from '../../_shared/validate.ts';
import { adminNotificationCampaignScheduleBodySchema } from '../../_shared/schemas.ts';
import { insertAdminNotificationAudit } from '../../_shared/notifications.ts';

export async function handle(req: Request, ctx: any): Promise<Response> {
  const methodErr = requireMethod(req, ctx, 'POST');
  if (methodErr) return methodErr;

  const guard = await requirePermission(req, ctx, 'notifications.manage');
  if ('res' in guard) return guard.res;
  ctx.setUserId(guard.user.id);

  const body = await validateJsonBody(req, ctx, adminNotificationCampaignScheduleBodySchema);
  if (!body.ok) return body.res;

  const supabase = createServiceClient();
  const campaignId = body.data.id;
  const scheduledAt = new Date(body.data.scheduled_at);
  if (Number.isNaN(scheduledAt.getTime())) {
    return errorJson('scheduled_at must be a valid ISO timestamp', 400, 'VALIDATION_ERROR', undefined, ctx.headers);
  }

  const { data: existing, error: existingError } = await supabase
    .from('notification_campaigns')
    .select('id,status')
    .eq('id', campaignId)
    .maybeSingle();
  if (existingError) {
    return errorJson('Query failed', 500, 'QUERY_FAILED', { error: existingError.message }, ctx.headers);
  }
  if (!existing) {
    return errorJson('Not found', 404, 'NOT_FOUND', undefined, ctx.headers);
  }
  if (!['draft', 'scheduled'].includes(String((existing as any).status))) {
    return errorJson('Campaign can no longer be scheduled', 409, 'INVALID_STATE', undefined, ctx.headers);
  }

  const { error } = await supabase
    .from('notification_campaigns')
    .update({
      status: 'scheduled',
      scheduled_at: scheduledAt.toISOString(),
      cancelled_at: null,
      completed_at: null,
      last_error: null,
    })
    .eq('id', campaignId);
  if (error) {
    return errorJson('Update failed', 500, 'UPDATE_FAILED', { error: error.message }, ctx.headers);
  }

  await insertAdminNotificationAudit(
    supabase,
    guard.user.id,
    'notification_campaign_schedule',
    null,
    { campaign_id: campaignId, scheduled_at: scheduledAt.toISOString(), previous_status: (existing as any).status },
  );

  return json({ ok: true, scheduled_at: scheduledAt.toISOString() }, 200, ctx.headers);
}
