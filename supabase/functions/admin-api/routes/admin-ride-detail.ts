import { errorJson, json } from '../../_shared/json.ts';
import { createServiceClient } from '../../_shared/supabase.ts';
import { requirePermission } from '../../_shared/admin.ts';
import { enforceAdminRateLimit } from '../../_shared/adminRateLimit.ts';
import { adminRideDetailQuerySchema } from '../../_shared/schemas.ts';
import { requireMethod, validateQuery } from '../../_shared/validate.ts';

export async function handle(req: Request, ctx: any): Promise<Response> {
  const methodRes = requireMethod(req, ctx, 'GET');
  if (methodRes) return methodRes;

  const gate = await requirePermission(req, ctx, 'rides.read');
  if ('res' in gate) return gate.res;
  ctx.setUserId(gate.user.id);

  const rlRes = await enforceAdminRateLimit(ctx, {
    action: 'ride_detail',
    adminId: gate.user.id,
    windowSeconds: 60,
    limit: 120,
    failOpen: true,
  });
  if (rlRes) return rlRes;

  const parsed = validateQuery(req, ctx, adminRideDetailQuerySchema);
  if (!parsed.ok) return parsed.res;

  const rideId = parsed.data.ride_id;
  ctx.setCorrelationId(rideId);

  const svc = createServiceClient();

  const { data: ride, error } = await svc
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
        'canceled_at',
        'fare_amount_iqd',
        'currency',
        'payment_method',
        'payment_status',
        'rider:profiles!rides_rider_id_fkey(id,display_name,phone)',
        'driver:drivers!rides_driver_id_fkey(id,status,profile:profiles!drivers_id_fkey(id,display_name,phone),cash_enabled,cash_exposure_limit_iqd)',
        'request:ride_requests!rides_request_id_fkey(id,status,pickup_lat,pickup_lng,dropoff_lat,dropoff_lng,pickup_address,dropoff_address,product_code,scheduled_at,created_at)',
        'payment:payments!payments_ride_id_fkey(id,provider,status,amount_iqd,currency,method,provider_ref,provider_charge_id,provider_refund_id,refund_amount_iqd,refunded_at,failure_code,failure_message,created_at,updated_at)',
      ].join(','),
    )
    .eq('id', rideId)
    .maybeSingle();

  if (error) {
    ctx.error('admin.ride_detail.ride_query_failed', { error: error.message });
    return errorJson('Query failed', 500, 'QUERY_FAILED', undefined, ctx.headers);
  }

  if (!ride) {
    return errorJson('Not found', 404, 'NOT_FOUND', undefined, ctx.headers);
  }

  const { data: rideEvents, error: evErr } = await svc
    .from('ride_events')
    .select('id,created_at,actor_id,actor_type,event_type,payload')
    .eq('ride_id', rideId)
    .order('created_at', { ascending: false })
    .limit(100);

  if (evErr) {
    ctx.warn('admin.ride_detail.events_query_failed', { error: evErr.message });
  }

  const { data: appEvents, error: appErr } = await svc
    .from('app_events')
    .select('id,created_at,level,event_type,actor_id,actor_type,request_id,payload')
    .eq('ride_id', rideId)
    .order('created_at', { ascending: false })
    .limit(50);

  if (appErr) {
    ctx.warn('admin.ride_detail.app_events_query_failed', { error: appErr.message });
  }

  return json(
    {
      ok: true,
      ride,
      ride_events: rideEvents ?? [],
      app_events: appEvents ?? [],
    },
    200,
    ctx.headers,
  );
}
