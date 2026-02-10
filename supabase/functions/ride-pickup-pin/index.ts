import { errorJson, json } from '../_shared/json.ts';
import { hmacSha256Bytes } from '../_shared/crypto.ts';
import { logAppEvent } from '../_shared/log.ts';
import { consumeRateLimit, getClientIp } from '../_shared/rateLimit.ts';
import { withRequestContext } from '../_shared/requestContext.ts';
import { createServiceClient, requireUser } from '../_shared/supabase.ts';

type Body = {
  ride_id?: string;
};

async function computePin(secret: string, rideId: string, riderId: string, driverId: string): Promise<string> {
  const msg = `ride_pin:${rideId}:${riderId}:${driverId}`;
  const bytes = await hmacSha256Bytes(secret, msg);
  const n = ((bytes[0] << 24) | (bytes[1] << 16) | (bytes[2] << 8) | bytes[3]) >>> 0;
  const pin = (n % 10000).toString().padStart(4, '0');
  return pin;
}

Deno.serve((req) => withRequestContext('ride-pickup-pin', req, async (ctx) => {

  try {
    if (req.method !== 'POST') return errorJson('Method not allowed', 405);

    const { user, error: authError } = await requireUser(req);
    if (!user) return errorJson(String(authError ?? 'Unauthorized'), 401, 'UNAUTHORIZED');

    const ip = getClientIp(req);
    const rl = await consumeRateLimit({
      key: `pickup_pin:${user.id}:${ip ?? 'noip'}`,
      windowSeconds: 60,
      limit: 30,
    });
    if (!rl.allowed) {
      return json(
        { error: 'Rate limit exceeded', code: 'RATE_LIMITED', reset_at: rl.resetAt, remaining: rl.remaining },
        429,
        { 'Retry-After': String(Math.max(1, Math.ceil((new Date(rl.resetAt).getTime() - Date.now()) / 1000))) },
      );
    }

    const body = (await req.json().catch(() => ({}))) as Body;
    const rideId = String(body.ride_id ?? '').trim();
    if (!rideId) return errorJson('ride_id is required', 400, 'VALIDATION_ERROR');

    const service = createServiceClient();

    const { data: ride, error: rideErr } = await service
      .from('rides')
      .select('id,rider_id,driver_id,status,pickup_pin_required,pickup_pin_verified_at')
      .eq('id', rideId)
      .maybeSingle();

    if (rideErr) return errorJson(rideErr.message, 500, 'DB_ERROR');
    if (!ride) return errorJson('Ride not found', 404, 'NOT_FOUND');

    if (ride.rider_id !== user.id) return errorJson('Forbidden', 403, 'FORBIDDEN');

    const required = Boolean((ride as any).pickup_pin_required ?? false);
    const verifiedAt = (ride as any).pickup_pin_verified_at as string | null;

    if (!required) {
      await logAppEvent({
        event_type: 'pickup_pin_not_required',
        actor_id: user.id,
        actor_type: 'rider',
        ride_id: rideId,
        payload: { requestId: ctx.requestId },
      });
      return json({ required: false, verified: false, rate_limit: { remaining: rl.remaining, reset_at: rl.resetAt } });
    }

    if (verifiedAt) {
      return json({
        required: true,
        verified: true,
        verified_at: verifiedAt,
        message: 'PIN already verified.',
        rate_limit: { remaining: rl.remaining, reset_at: rl.resetAt },
      });
    }

    const secret = Deno.env.get('PIN_SECRET') ?? '';
    if (!secret || secret.length < 16) {
      return errorJson('Missing PIN_SECRET function secret', 500, 'MISSING_SECRET');
    }

    const pin = await computePin(secret, ride.id, ride.rider_id, ride.driver_id);

    await logAppEvent({
      event_type: 'pickup_pin_requested',
      actor_id: user.id,
      actor_type: 'rider',
      ride_id: rideId,
      payload: { requestId: ctx.requestId },
    });

    return json({
      required: true,
      verified: false,
      pin,
      message: 'Share this PIN with your driver in person only.',
      rate_limit: { remaining: rl.remaining, reset_at: rl.resetAt },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return errorJson(msg, 500, 'INTERNAL');
  }
}));
