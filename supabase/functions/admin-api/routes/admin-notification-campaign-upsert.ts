import { createServiceClient } from '../../_shared/supabase.ts';
import { requirePermission } from '../../_shared/admin.ts';
import { json, errorJson } from '../../_shared/json.ts';
import { requireMethod, validateJsonBody } from '../../_shared/validate.ts';
import { adminNotificationCampaignUpsertBodySchema } from '../../_shared/schemas.ts';
import { insertAdminNotificationAudit, normalizeAudienceFilter } from '../../_shared/notifications.ts';

export async function handle(req: Request, ctx: any): Promise<Response> {
  const methodErr = requireMethod(req, ctx, 'POST');
  if (methodErr) return methodErr;

  const guard = await requirePermission(req, ctx, 'notifications.manage');
  if ('res' in guard) return guard.res;
  ctx.setUserId(guard.user.id);

  const body = await validateJsonBody(req, ctx, adminNotificationCampaignUpsertBodySchema);
  if (!body.ok) return body.res;

  const supabase = createServiceClient();
  const payload = {
    category: body.data.category,
    title: body.data.title,
    body: body.data.body ?? null,
    route_key: body.data.route_key,
    data: body.data.data ?? {},
    audience_filter: normalizeAudienceFilter(body.data.audience_filter),
    scheduled_at: body.data.scheduled_at,
  };

  try {
    let campaignId = body.data.id ?? null;
    if (campaignId) {
      const { data: existing, error: existingError } = await supabase
        .from('notification_campaigns')
        .select('id,status')
        .eq('id', campaignId)
        .maybeSingle();
      if (existingError) {
        return errorJson('Query failed', 500, 'QUERY_FAILED', undefined, ctx.headers);
      }
      if (!existing) {
        return errorJson('Not found', 404, 'NOT_FOUND', undefined, ctx.headers);
      }
      if (!['draft', 'scheduled'].includes(String((existing as any).status))) {
        return errorJson('Campaign can no longer be edited', 409, 'INVALID_STATE', undefined, ctx.headers);
      }

      const { error } = await supabase
        .from('notification_campaigns')
        .update(payload)
        .eq('id', campaignId);
      if (error) {
        return errorJson('Update failed', 500, 'UPDATE_FAILED', { error: error.message }, ctx.headers);
      }

      await insertAdminNotificationAudit(
        supabase,
        guard.user.id,
        'notification_campaign_update',
        null,
        { campaign_id: campaignId, status: (existing as any).status },
      );
    } else {
      const { data, error } = await supabase
        .from('notification_campaigns')
        .insert({
          ...payload,
          status: 'draft',
          created_by: guard.user.id,
        })
        .select('id')
        .single();
      if (error) {
        return errorJson('Create failed', 500, 'CREATE_FAILED', { error: error.message }, ctx.headers);
      }
      campaignId = String((data as any).id);

      await insertAdminNotificationAudit(
        supabase,
        guard.user.id,
        'notification_campaign_create',
        null,
        { campaign_id: campaignId },
      );
    }

    const { data: campaign, error: reloadError } = await supabase
      .from('notification_campaigns')
      .select('*')
      .eq('id', campaignId)
      .maybeSingle();
    if (reloadError) {
      return errorJson('Query failed', 500, 'QUERY_FAILED', { error: reloadError.message }, ctx.headers);
    }

    return json({ ok: true, campaign }, 200, ctx.headers);
  } catch (error) {
    ctx?.error?.('admin.notifications.upsert.failed', { error: String((error as any)?.message ?? error) });
    return errorJson('Upsert failed', 500, 'UPSERT_FAILED', undefined, ctx.headers);
  }
}
