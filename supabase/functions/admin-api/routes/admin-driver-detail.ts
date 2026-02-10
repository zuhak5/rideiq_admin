import { errorJson, json } from '../../_shared/json.ts';
import { createServiceClient } from '../../_shared/supabase.ts';
import { requirePermission } from '../../_shared/admin.ts';
import { enforceAdminRateLimit } from '../../_shared/adminRateLimit.ts';
import { adminDriverDetailQuerySchema } from '../../_shared/schemas.ts';
import { requireMethod, validateQuery } from '../../_shared/validate.ts';

export async function handle(req: Request, ctx: any): Promise<Response> {
  const methodRes = requireMethod(req, ctx, 'GET');
  if (methodRes) return methodRes;

  const gate = await requirePermission(req, ctx, 'drivers.read');
  if ('res' in gate) return gate.res;
  ctx.setUserId(gate.user.id);

  const rlRes = await enforceAdminRateLimit(ctx, {
    action: 'driver_detail',
    adminId: gate.user.id,
    windowSeconds: 60,
    limit: 120,
    failOpen: true,
  });
  if (rlRes) return rlRes;

  const parsed = validateQuery(req, ctx, adminDriverDetailQuerySchema);
  if (!parsed.ok) return parsed.res;

  const driverId = parsed.data.driver_id;
  ctx.setCorrelationId(driverId);

  const svc = createServiceClient();

  const { data: driver, error } = await svc
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
        'cash_reserved_amount_iqd',
        'require_pickup_pin',
        'created_at',
        'updated_at',
        'profile:profiles!drivers_id_fkey(id,display_name,phone,locale)',
        'vehicles:driver_vehicles(id,vehicle_type,make,model,color,plate_number,is_active,created_at)',
      ].join(','),
    )
    .eq('id', driverId)
    .maybeSingle();

  if (error) {
    ctx.error('admin.driver_detail.driver_query_failed', { error: error.message });
    return errorJson('Query failed', 500, 'QUERY_FAILED', undefined, ctx.headers);
  }
  if (!driver) {
    return errorJson('Not found', 404, 'NOT_FOUND', undefined, ctx.headers);
  }

  const { data: lastLoc, error: locErr } = await svc
    .from('driver_locations')
    .select('driver_id,lat,lng,heading,speed_mps,accuracy_m,updated_at,vehicle_type')
    .eq('driver_id', driverId)
    .maybeSingle();
  if (locErr) {
    ctx.warn('admin.driver_detail.location_query_failed', { error: locErr.message });
  }

  const { data: statusEvents, error: seErr } = await svc
    .from('driver_status_events')
    .select('id,created_at,actor_id,actor_type,from_status,to_status,reason')
    .eq('driver_id', driverId)
    .order('created_at', { ascending: false })
    .limit(100);
  if (seErr) {
    ctx.warn('admin.driver_detail.status_events_query_failed', { error: seErr.message });
  }

  const { data: activeRides, error: arErr } = await svc
    .from('rides')
    .select('id,status,created_at,request:ride_requests!rides_request_id_fkey(pickup_address,dropoff_address)')
    .eq('driver_id', driverId)
    .in('status', ['assigned', 'arrived', 'in_progress'])
    .order('created_at', { ascending: false })
    .limit(10);
  if (arErr) {
    ctx.warn('admin.driver_detail.active_rides_query_failed', { error: arErr.message });
  }

  return json(
    {
      ok: true,
      driver,
      last_location: lastLoc ?? null,
      status_events: statusEvents ?? [],
      active_rides: activeRides ?? [],
    },
    200,
    ctx.headers,
  );
}
