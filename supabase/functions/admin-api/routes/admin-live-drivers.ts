import { createServiceClient } from '../../_shared/supabase.ts';
import { requirePermission } from '../../_shared/admin.ts';
import { json, errorJson } from '../../_shared/json.ts';
import { requireMethod, validateJsonBody } from '../../_shared/validate.ts';
import { adminLiveDriversBodySchema } from '../../_shared/schemas.ts';

export async function handle(req: Request, ctx: any): Promise<Response> {
  const methodErr = requireMethod(req, ctx, 'POST');
  if (methodErr) return methodErr;

  const guard = await requirePermission(req, ctx, 'maps.view');
  if ('res' in guard) return guard.res;

  const body = await validateJsonBody(req, ctx, adminLiveDriversBodySchema);
  if (!body.ok) return body.res;

  const b = body.data;
  const svc = createServiceClient();

  const since = new Date(Date.now() - b.max_age_seconds * 1000).toISOString();

  let query = svc
    .from('driver_locations')
    .select('driver_id, lat, lng, heading, speed_mps, accuracy_m, updated_at, vehicle_type')
    .gte('updated_at', since)
    .order('updated_at', { ascending: false })
    .limit(b.limit);

  if (b.min_lat !== undefined) query = query.gte('lat', b.min_lat);
  if (b.max_lat !== undefined) query = query.lte('lat', b.max_lat);
  if (b.min_lng !== undefined) query = query.gte('lng', b.min_lng);
  if (b.max_lng !== undefined) query = query.lte('lng', b.max_lng);

  const { data, error } = await query;

  if (error) {
    ctx?.error?.('admin_live_drivers.db_error', { error: error.message });
    return errorJson('DB error', 500, 'DB_ERROR', { error: error.message }, ctx.headers);
  }

  return json({ ok: true, drivers: data ?? [], since }, 200, ctx.headers);
}
