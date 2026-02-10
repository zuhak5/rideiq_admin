import { errorJson, json } from '../_shared/json.ts';
import { hmacSha256Bytes } from '../_shared/crypto.ts';
import { logAppEvent } from '../_shared/log.ts';
import { consumeRateLimit, getClientIp } from '../_shared/rateLimit.ts';
import { withRequestContext } from '../_shared/requestContext.ts';
import { createUserClient, requireUser } from '../_shared/supabase.ts';

type Body = {
  ride_id?: string;
  pin?: string;
};

function normalizeRpcErrorMessage(msg: string): string {
  return msg.replace(/^RPC error:\s*/i, '').trim();
}

async function computePin(secret: string, rideId: string, riderId: string, driverId: string): Promise<string> {
  const msg = `ride_pin:${rideId}:${riderId}:${driverId}`;
  const bytes = await hmacSha256Bytes(secret, msg);
  const n = ((bytes[0] << 24) | (bytes[1] << 16) | (bytes[2] << 8) | bytes[3]) >>> 0;
  return (n % 10000).toString().padStart(4, '0');
}

async function fallbackVerifyWithEdgeSecret(opts: {
  supabase: ReturnType<typeof createUserClient>;
  rideId: string;
  pin: string;
}) {
  const secret = (Deno.env.get('PIN_SECRET') ?? '').trim();
  if (!secret || secret.length < 16) {
    return { error: 'Missing PIN secret', status: 500, code: 'MISSING_SECRET' } as const;
  }

  const { data: ride, error: rideErr } = await opts.supabase
    .from('rides')
    .select('id,rider_id,driver_id,pickup_pin_required,pickup_pin_verified_at')
    .eq('id', opts.rideId)
    .maybeSingle();

  if (rideErr) {
    return { error: rideErr.message ?? 'DB error', status: 500, code: 'DB_ERROR' } as const;
  }
  if (!ride) {
    return { error: 'Ride not found', status: 404, code: 'NOT_FOUND' } as const;
  }

  const expected = await computePin(secret, ride.id, (ride as any).rider_id, (ride as any).driver_id);

  if (opts.pin !== expected) {
    const { data, error } = await opts.supabase.rpc('ride_pickup_pin_record_failure', { p_ride_id: opts.rideId });
    if (error) {
      const msg = normalizeRpcErrorMessage(error.message ?? 'Unknown error');
      return { error: msg, status: 409, code: 'PIN_VERIFY_FAILED' } as const;
    }
    return { data: (data ?? {}) as Record<string, unknown> } as const;
  }

  const { data, error } = await opts.supabase.rpc('ride_pickup_pin_mark_verified', { p_ride_id: opts.rideId });
  if (error) {
    const msg = normalizeRpcErrorMessage(error.message ?? 'Unknown error');
    return { error: msg, status: 409, code: 'PIN_VERIFY_FAILED' } as const;
  }

  return { data: (data ?? {}) as Record<string, unknown> } as const;
}

Deno.serve((req) =>
  withRequestContext('ride-verify-pin', req, async (ctx) => {
    try {
      if (req.method !== 'POST') return errorJson('Method not allowed', 405);

      const { user, error: authError } = await requireUser(req, ctx);
      if (!user) return errorJson(String(authError ?? 'Unauthorized'), 401, 'UNAUTHORIZED', undefined, ctx.headers);

      const ip = getClientIp(req);
      const rl = await consumeRateLimit({
        key: `verify_pin:${user.id}:${ip ?? 'noip'}`,
        windowSeconds: 60,
        limit: 30,
      });
      if (!rl.allowed) {
        return json(
          { error: 'Rate limit exceeded', code: 'RATE_LIMITED', reset_at: rl.resetAt, remaining: rl.remaining },
          429,
          { ...ctx.headers, 'Retry-After': String(Math.max(1, Math.ceil((new Date(rl.resetAt).getTime() - Date.now()) / 1000))) },
        );
      }

      const body = (await req.json().catch(() => ({}))) as Body;
      const rideId = String(body.ride_id ?? '').trim();
      const pin = String(body.pin ?? '').trim();
      if (!rideId) return errorJson('ride_id is required', 400, 'VALIDATION_ERROR', undefined, ctx.headers);
      if (!pin || pin.length < 4) return errorJson('pin is required', 400, 'VALIDATION_ERROR', undefined, ctx.headers);

      ctx.setCorrelationId(rideId);

      // Call as the authenticated user so auth.uid() is available to the DB layer.
      const supabase = createUserClient(req);

      // Preferred path: verify inside the DB using Vault secret (atomic + minimal trust in Edge layer).
      const { data, error } = await supabase.rpc('ride_verify_pickup_pin', {
        p_ride_id: rideId,
        p_pin: pin,
      });

      let result: Record<string, unknown> | null = null;

      if (error) {
        const msg = normalizeRpcErrorMessage(error.message ?? 'Unknown error');

        // Compatibility fallback for deployments that still keep PIN_SECRET only in Edge env.
        if (msg === 'missing_pin_secret') {
          const fb = await fallbackVerifyWithEdgeSecret({ supabase, rideId, pin });
          if ('error' in fb) {
            const fbError = typeof fb.error === 'string' ? fb.error : 'PIN verification failed';
            const fbCode = fb.code ?? 'PIN_VERIFY_FAILED';
            return errorJson(fbError, fb.status, fbCode, undefined, ctx.headers);
          }
          result = fb.data;
        } else {
          const status = msg === 'unauthorized' ? 401 : msg === 'forbidden' ? 403 : msg === 'ride_not_found' ? 404 : 409;
          const code = msg === 'ride_not_found'
            ? 'NOT_FOUND'
            : msg === 'forbidden'
              ? 'FORBIDDEN'
              : msg === 'unauthorized'
                ? 'UNAUTHORIZED'
                : 'PIN_VERIFY_FAILED';
          return errorJson(msg, status, code, undefined, ctx.headers);
        }
      } else {
        result = (data ?? {}) as Record<string, unknown>;
      }

      if (!result) return errorJson('PIN verification failed', 500, 'INTERNAL', undefined, ctx.headers);

      // Normalize success/error responses for the client.
      const ok = result.ok === true;
      const verified = result.verified === true;

      if (ok && verified) {
        await logAppEvent({
          event_type: 'pickup_pin_verified',
          actor_id: user.id,
          actor_type: 'driver',
          ride_id: rideId,
          payload: { requestId: ctx.requestId },
        });
      } else if (!ok) {
        const code = String(result.code ?? 'PIN_VERIFY_FAILED');
        await logAppEvent({
          event_type: code === 'INVALID_PIN' ? 'pickup_pin_invalid' : 'pickup_pin_verify_failed',
          actor_id: user.id,
          actor_type: 'driver',
          ride_id: rideId,
          payload: { requestId: ctx.requestId, code, ...result },
        });
      }

      if (ok) {
        return json({ ...result, rate_limit: { remaining: rl.remaining, reset_at: rl.resetAt } }, 200, ctx.headers);
      }

      const code = String(result.code ?? 'PIN_VERIFY_FAILED');
      const httpStatus = code === 'PIN_LOCKED' ? 423 : code === 'INVALID_PIN' ? 400 : 409;

      return json(
        {
          error:
            code === 'PIN_LOCKED'
              ? 'Too many failed attempts. PIN entry locked.'
              : code === 'INVALID_PIN'
                ? 'Invalid PIN'
                : 'PIN verification failed',
          code,
          ...result,
          rate_limit: { remaining: rl.remaining, reset_at: rl.resetAt },
        },
        httpStatus,
        ctx.headers,
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return errorJson(msg, 500, 'INTERNAL', undefined, ctx.headers);
    }
  }),
);
