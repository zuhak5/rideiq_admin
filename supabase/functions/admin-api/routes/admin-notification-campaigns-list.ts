import { createServiceClient } from '../../_shared/supabase.ts';
import { requirePermission } from '../../_shared/admin.ts';
import { json, errorJson } from '../../_shared/json.ts';
import { requireMethod, validateJsonBody } from '../../_shared/validate.ts';
import { adminNotificationCampaignsListBodySchema } from '../../_shared/schemas.ts';

export async function handle(req: Request, ctx: any): Promise<Response> {
  const methodErr = requireMethod(req, ctx, 'POST');
  if (methodErr) return methodErr;

  const guard = await requirePermission(req, ctx, 'notifications.read');
  if ('res' in guard) return guard.res;
  ctx.setUserId(gateUserId(guard));

  const body = await validateJsonBody(req, ctx, adminNotificationCampaignsListBodySchema);
  if (!body.ok) return body.res;

  const supabase = createServiceClient();
  const q = String(body.data.q ?? '').trim();
  const status = String(body.data.status ?? '').trim();
  const limit = body.data.limit;
  const offset = body.data.offset;

  let query = supabase
    .from('notification_campaigns')
    .select(
      'id,status,category,title,body,route_key,scheduled_at,created_at,updated_at,created_by,estimated_recipients,inbox_created,push_sent,push_failed,read_count,last_error',
      { count: 'exact' },
    );

  if (status) {
    query = query.eq('status', status);
  }

  if (q) {
    const safeNeedle = q.replace(/[^\p{L}\p{N}\s+._:-]/gu, '').trim().slice(0, 80);
    if (safeNeedle) {
      query = query.or(`title.ilike.%${safeNeedle}%,body.ilike.%${safeNeedle}%`);
    }
  }

  const { data, error, count } = await query
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) {
    ctx?.error?.('admin.notifications.list.query_failed', { error: error.message });
    return errorJson('Query failed', 500, 'QUERY_FAILED', undefined, ctx.headers);
  }

  return json(
    {
      campaigns: data ?? [],
      page: {
        limit,
        offset,
        returned: (data ?? []).length,
        total: count ?? null,
      },
    },
    200,
    ctx.headers,
  );
}

function gateUserId(guard: { user: { id: string } }) {
  return guard.user.id;
}
