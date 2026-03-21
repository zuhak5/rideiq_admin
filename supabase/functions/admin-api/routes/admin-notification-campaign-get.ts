import { createServiceClient } from '../../_shared/supabase.ts';
import { requirePermission } from '../../_shared/admin.ts';
import { json, errorJson } from '../../_shared/json.ts';
import { requireMethod, validateQuery } from '../../_shared/validate.ts';
import { adminNotificationCampaignGetQuerySchema } from '../../_shared/schemas.ts';

export async function handle(req: Request, ctx: any): Promise<Response> {
  const methodErr = requireMethod(req, ctx, 'GET');
  if (methodErr) return methodErr;

  const guard = await requirePermission(req, ctx, 'notifications.read');
  if ('res' in guard) return guard.res;
  ctx.setUserId(guard.user.id);

  const query = validateQuery(req, ctx, adminNotificationCampaignGetQuerySchema);
  if (!query.ok) return query.res;

  const supabase = createServiceClient();
  const campaignId = query.data.id;

  const { data: campaign, error: campaignError } = await supabase
    .from('notification_campaigns')
    .select('*')
    .eq('id', campaignId)
    .maybeSingle();
  if (campaignError) {
    ctx?.error?.('admin.notifications.get.campaign_query_failed', { error: campaignError.message });
    return errorJson('Query failed', 500, 'QUERY_FAILED', undefined, ctx.headers);
  }
  if (!campaign) {
    return errorJson('Not found', 404, 'NOT_FOUND', undefined, ctx.headers);
  }

  const { data: recipients, error: recipientsError } = await supabase
    .from('notification_campaign_recipients')
    .select('id,user_id,user_notification_id,push_status,push_reason,created_at,push_sent_at,push_failed_at')
    .eq('campaign_id', campaignId)
    .order('created_at', { ascending: false })
    .limit(100);
  if (recipientsError) {
    ctx?.error?.('admin.notifications.get.recipients_query_failed', { error: recipientsError.message });
    return errorJson('Query failed', 500, 'QUERY_FAILED', undefined, ctx.headers);
  }

  const userIds = Array.from(new Set((recipients ?? []).map((row: any) => String(row.user_id))));
  const notificationIds = Array.from(
    new Set(
      (recipients ?? [])
        .map((row: any) => String(row.user_notification_id ?? '').trim())
        .filter((value: string) => value.length > 0),
    ),
  );

  const [profilesRes, notificationsRes] = await Promise.all([
    userIds.length > 0
      ? supabase
          .from('profiles')
          .select('id,display_name,phone,active_role,locale')
          .in('id', userIds)
      : Promise.resolve({ data: [], error: null } as any),
    notificationIds.length > 0
      ? supabase
          .from('user_notifications')
          .select('id,read_at')
          .in('id', notificationIds)
      : Promise.resolve({ data: [], error: null } as any),
  ]);

  if (profilesRes.error || notificationsRes.error) {
    ctx?.error?.('admin.notifications.get.join_query_failed', {
      profiles_error: profilesRes.error?.message,
      notifications_error: notificationsRes.error?.message,
    });
    return errorJson('Query failed', 500, 'QUERY_FAILED', undefined, ctx.headers);
  }

  const profilesById = new Map((profilesRes.data ?? []).map((row: any) => [String(row.id), row]));
  const notificationsById = new Map((notificationsRes.data ?? []).map((row: any) => [String(row.id), row]));

  return json(
    {
      campaign,
      recipients: (recipients ?? []).map((row: any) => ({
        ...row,
        profile: profilesById.get(String(row.user_id)) ?? null,
        notification: row.user_notification_id ? notificationsById.get(String(row.user_notification_id)) ?? null : null,
      })),
    },
    200,
    ctx.headers,
  );
}
