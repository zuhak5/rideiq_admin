import { errorJson, json } from '../../_shared/json.ts';
import { createServiceClient } from '../../_shared/supabase.ts';
import { requirePermission } from '../../_shared/admin.ts';
import { enforceAdminRateLimit } from '../../_shared/adminRateLimit.ts';
import { adminListBodySchema } from '../../_shared/schemas.ts';
import { requireMethod, validateJsonBody } from '../../_shared/validate.ts';

function isUuid(v: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
}

export async function handle(req: Request, ctx: any): Promise<Response> {
  const methodRes = requireMethod(req, ctx, 'POST');
  if (methodRes) return methodRes;

  const gate = await requirePermission(req, ctx, 'drivers.read');
  if ('res' in gate) return gate.res;
  ctx.setUserId(gate.user.id);

  const rlRes = await enforceAdminRateLimit(ctx, {
    action: 'drivers_list',
    adminId: gate.user.id,
    windowSeconds: 60,
    limit: 120,
    failOpen: true,
  });
  if (rlRes) return rlRes;
  const parsed = await validateJsonBody(req, ctx, adminListBodySchema);
  if (!parsed.ok) return parsed.res;

  const q = String(parsed.data.q ?? '').trim();
  const status = String(parsed.data.status ?? '').trim();
  const limit = parsed.data.limit;
  const offset = parsed.data.offset;

  const svc = createServiceClient();

  let query = svc
    .from('drivers')
    .select(
      [
        'id',
        'status',
        'vehicle_type',
        'rating_avg',
        'rating_count',
        'trips_count',
        'cash_enabled',
        'cash_exposure_limit_iqd',
        'created_at',
        'updated_at',
        'profile:profiles!drivers_id_fkey(id,display_name,phone,locale)',
      ].join(','),
      { count: 'exact' },
    );

  if (status) {
    query = query.eq('status', status);
  }

  if (q && isUuid(q)) {
    query = query.eq('id', q);
  }

  const { data, error, count } = await query
    .order('updated_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) {
    ctx.error('admin.drivers_list.query_failed', { error: error.message });
    return errorJson('Query failed', 500, 'QUERY_FAILED', undefined, ctx.headers);
  }

  const drivers = (data ?? []).map((d: any) => ({
    id: d.id,
    status: d.status,
    vehicle_type: d.vehicle_type,
    rating_avg: d.rating_avg,
    rating_count: d.rating_count,
    trips_count: d.trips_count,
    cash_enabled: d.cash_enabled,
    cash_exposure_limit_iqd: d.cash_exposure_limit_iqd,
    created_at: d.created_at,
    updated_at: d.updated_at,
    profile: d.profile
      ? {
          id: d.profile.id,
          display_name: d.profile.display_name,
          phone: d.profile.phone,
          locale: d.profile.locale,
        }
      : null,
  }));

  return json(
    {
      ok: true,
      drivers,
      page: {
        limit,
        offset,
        returned: drivers.length,
        total: count ?? null,
      },
    },
    200,
    ctx.headers,
  );
}
