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

  const gate = await requirePermission(req, ctx, 'rides.read');
  if ('res' in gate) return gate.res;
  ctx.setUserId(gate.user.id);

  const rlRes = await enforceAdminRateLimit(ctx, {
    action: 'rides_list',
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
    .from('rides')
    .select(
      [
        'id',
        'status',
        'version',
        'created_at',
        'updated_at',
        'started_at',
        'completed_at',
        'fare_amount_iqd',
        'currency',
        'payment_method',
        'payment_status',
        'request:ride_requests!rides_request_id_fkey(id,status,pickup_address,dropoff_address,created_at)',
        'rider:profiles!rides_rider_id_fkey(id,display_name,phone)',
        'driver:drivers!rides_driver_id_fkey(id,status,profile:profiles!drivers_id_fkey(id,display_name,phone))',
      ].join(','),
      { count: 'exact' },
    );

  if (status) {
    query = query.eq('status', status);
  }

  if (q && isUuid(q)) {
    // Search by ride_id or request_id.
    query = query.or(`id.eq.${q},request_id.eq.${q}`);
  }

  const { data, error, count } = await query
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) {
    ctx.error('admin.rides_list.query_failed', { error: error.message });
    return errorJson('Query failed', 500, 'QUERY_FAILED', undefined, ctx.headers);
  }

  const rides = (data ?? []).map((r: any) => ({
    id: r.id,
    status: r.status,
    version: r.version,
    created_at: r.created_at,
    updated_at: r.updated_at,
    started_at: r.started_at,
    completed_at: r.completed_at,
    fare_amount_iqd: r.fare_amount_iqd,
    currency: r.currency,
    payment_method: r.payment_method,
    payment_status: r.payment_status,
    request: r.request
      ? {
          id: r.request.id,
          status: r.request.status,
          pickup_address: r.request.pickup_address,
          dropoff_address: r.request.dropoff_address,
          created_at: r.request.created_at,
        }
      : null,
    rider: r.rider
      ? {
          id: r.rider.id,
          display_name: r.rider.display_name,
          phone: r.rider.phone,
        }
      : null,
    driver: r.driver
      ? {
          id: r.driver.id,
          status: r.driver.status,
          profile: r.driver.profile
            ? {
                id: r.driver.profile.id,
                display_name: r.driver.profile.display_name,
                phone: r.driver.profile.phone,
              }
            : null,
        }
      : null,
  }));

  return json(
    {
      ok: true,
      rides,
      page: {
        limit,
        offset,
        returned: rides.length,
        total: count ?? null,
      },
    },
    200,
    ctx.headers,
  );
}
