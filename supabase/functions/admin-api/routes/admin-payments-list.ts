import { errorJson, json } from '../../_shared/json.ts';
import { createServiceClient } from '../../_shared/supabase.ts';
import { requirePermission } from '../../_shared/admin.ts';
import { enforceAdminRateLimit } from '../../_shared/adminRateLimit.ts';
import { paymentsListBodySchema } from '../../_shared/schemas.ts';
import { requireMethod, validateJsonBody } from '../../_shared/validate.ts';

function isUuid(v: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
}

export async function handle(req: Request, ctx: any): Promise<Response> {
  const methodRes = requireMethod(req, ctx, 'POST');
  if (methodRes) return methodRes;

  const gate = await requirePermission(req, ctx, 'payments.read');
  if ('res' in gate) return gate.res;
  ctx.setUserId(gate.user.id);

  const rlRes = await enforceAdminRateLimit(ctx, {
    action: 'payments_list',
    adminId: gate.user.id,
    windowSeconds: 60,
    limit: 120,
    failOpen: true,
  });
  if (rlRes) return rlRes;

  const parsed = await validateJsonBody(req, ctx, paymentsListBodySchema);
  if (!parsed.ok) return parsed.res;

  const q = parsed.data.q ?? '';
  const status = parsed.data.status ?? '';
  const provider = parsed.data.provider ?? '';
  const limit = parsed.data.limit;
  const offset = parsed.data.offset;

  const svc = createServiceClient();

  let query = svc
    .from('payments')
    .select(
      'id,ride_id,provider,status,amount_iqd,currency,method,provider_ref,provider_charge_id,provider_refund_id,refund_amount_iqd,refunded_at,failure_code,failure_message,created_at,updated_at',
      { count: 'exact' },
    )
    .order('created_at', { ascending: false });

  if (status) query = query.eq('status', status);
  if (provider) query = query.eq('provider', provider);

  if (q) {
    if (isUuid(q)) {
      query = query.or(`id.eq.${q},ride_id.eq.${q}`);
    } else {
      // Provider reference partial search (sanitized to avoid PostgREST OR filter injection)
      const needle = q.replace(/[^0-9a-zA-Z:_-]/g, '').slice(0, 80);
      if (needle) {
        query = query.or(`provider_ref.ilike.%${needle}%,provider_charge_id.ilike.%${needle}%`);
      }
    }
  }

  const { data: payments, error, count } = await query.range(offset, offset + limit - 1);
  if (error) {
    ctx.error('admin.payments_list.query_failed', { error: error.message });
    return errorJson('Query failed', 500, 'QUERY_FAILED', undefined, ctx.headers);
  }

  const rows = (payments ?? []) as any[];
  const rideIds = Array.from(new Set(rows.map((p) => p.ride_id).filter(Boolean)));

  // Attach minimal ride + rider info for usability.
  const ridesById = new Map<string, any>();
  const profilesById = new Map<string, any>();

  if (rideIds.length > 0) {
    const { data: rides, error: ridesErr } = await svc
      .from('rides')
      .select('id,status,created_at,rider_id,driver_id,request_id,payment_method')
      .in('id', rideIds);

    if (ridesErr) {
      ctx.warn('admin.payments_list.rides_query_failed', { error: ridesErr.message });
    } else {
      for (const r of rides ?? []) ridesById.set((r as any).id, r);

      const riderIds = Array.from(
        new Set((rides ?? []).map((r: any) => r?.rider_id).filter((x: any) => typeof x === 'string' && isUuid(x))),
      );

      if (riderIds.length > 0) {
        const { data: profiles, error: profErr } = await svc
          .from('profiles')
          .select('id,display_name,phone')
          .in('id', riderIds);
        if (profErr) {
          ctx.warn('admin.payments_list.profiles_query_failed', { error: profErr.message });
        } else {
          for (const p of profiles ?? []) profilesById.set((p as any).id, p);
        }
      }
    }
  }

  const out = rows.map((p) => {
    const ride = ridesById.get(p.ride_id);
    const rider = ride?.rider_id ? profilesById.get(ride.rider_id) : null;
    return {
      ...p,
      ride: ride
        ? {
            id: ride.id,
            status: ride.status,
            created_at: ride.created_at,
            rider: rider
              ? { id: rider.id, display_name: rider.display_name, phone: rider.phone }
              : ride.rider_id
                ? { id: ride.rider_id, display_name: null, phone: null }
                : null,
          }
        : null,
    };
  });

  return json(
    {
      ok: true,
      payments: out,
      page: {
        limit,
        offset,
        returned: out.length,
        total: typeof count === 'number' ? count : null,
      },
    },
    200,
    ctx.headers,
  );
}
