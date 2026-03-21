import { createServiceClient } from '../../_shared/supabase.ts';
import { requirePermission } from '../../_shared/admin.ts';
import { json, errorJson } from '../../_shared/json.ts';
import { requireMethod, validateJsonBody } from '../../_shared/validate.ts';
import { adminNotificationCampaignPreviewBodySchema } from '../../_shared/schemas.ts';
import { previewCampaignAudience } from '../../_shared/notifications.ts';

export async function handle(req: Request, ctx: any): Promise<Response> {
  const methodErr = requireMethod(req, ctx, 'POST');
  if (methodErr) return methodErr;

  const guard = await requirePermission(req, ctx, 'notifications.manage');
  if ('res' in guard) return guard.res;
  ctx.setUserId(guard.user.id);

  const body = await validateJsonBody(req, ctx, adminNotificationCampaignPreviewBodySchema);
  if (!body.ok) return body.res;

  try {
    const supabase = createServiceClient();
    const preview = await previewCampaignAudience(supabase, body.data.audience_filter);
    return json(
      {
        count: preview.count,
        sample: preview.sample,
      },
      200,
      ctx.headers,
    );
  } catch (error) {
    ctx?.error?.('admin.notifications.preview.failed', { error: String((error as any)?.message ?? error) });
    return errorJson('Preview failed', 500, 'PREVIEW_FAILED', undefined, ctx.headers);
  }
}
