import { createUserClient, requireUser } from '../_shared/supabase.ts';
import { errorJson, json } from '../_shared/json.ts';
import { buildRateLimitHeaders, consumeRateLimit, getClientIp } from '../_shared/rateLimit.ts';
import { logAppEvent } from '../_shared/log.ts';
import { withRequestContext } from '../_shared/requestContext.ts';
import { emitMetricBestEffort, metricTimer } from '../_shared/metrics.ts';

type Body = {
  ride_id: string;
  to_status: 'arrived' | 'in_progress' | 'completed' | 'canceled';
  expected_version?: number;
  cash_collected_amount_iqd?: number;
  cash_change_given_iqd?: number;
};

function clampInt(v: unknown, min: number, max: number, fallback: number | null) {
  if (v === null || v === undefined) return fallback;
  const n = typeof v === 'number' && Number.isFinite(v) ? Math.floor(v) : Number.NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

Deno.serve((req) =>
  withRequestContext('ride-transition', req, async (ctx) => {
    let stopTimer: ReturnType<typeof metricTimer> | null = null;
    try {
      if (req.method !== 'POST') {
        emitMetricBestEffort(ctx, { event_type: 'metric.trip.transition', level: 'warn', payload: { ok: false, reason: 'method' } });
        return errorJson('Method not allowed', 405, 'METHOD_NOT_ALLOWED', undefined, ctx.headers);
      }

      const { user, error: authError } = await requireUser(req, ctx);
      if (!user) {
        emitMetricBestEffort(ctx, { event_type: 'metric.trip.transition', level: 'warn', payload: { ok: false, reason: 'unauthorized' } });
        return errorJson(String(authError ?? 'Unauthorized'), 401, 'UNAUTHORIZED', undefined, ctx.headers);
      }

      const ip = getClientIp(req);
      const rl = await consumeRateLimit({
        key: `transition:${user.id}:${ip ?? 'noip'}`,
        windowSeconds: 60,
        limit: 60,
      });
      if (!rl.allowed) {
        emitMetricBestEffort(ctx, { event_type: 'metric.trip.transition', level: 'warn', payload: { ok: false, reason: 'rate_limited' } });
        return json(
          { error: 'Rate limit exceeded', code: 'RATE_LIMITED', reset_at: rl.resetAt, remaining: rl.remaining },
          429,
          {
            ...ctx.headers,
            ...buildRateLimitHeaders({ limit: 60, remaining: rl.remaining, resetAt: rl.resetAt }),
            'Retry-After': String(Math.max(1, Math.ceil((new Date(rl.resetAt).getTime() - Date.now()) / 1000))),
          },
        );
      }

      const body = (await req.json().catch(() => ({}))) as Partial<Body>;
      if (!body?.ride_id || !body?.to_status) {
        emitMetricBestEffort(ctx, { event_type: 'metric.trip.transition', level: 'warn', payload: { ok: false, reason: 'validation' } });
        return errorJson('ride_id and to_status are required', 400, 'VALIDATION_ERROR', undefined, ctx.headers);
      }

      ctx.setCorrelationId(body.ride_id);
      stopTimer = metricTimer(ctx, 'metric.trip.transition_latency', {
        ride_id: body.ride_id,
        payload: { to_status: body.to_status },
      });

      const supabase = createUserClient(req);

      const expected_version = clampInt(body.expected_version, 0, 2_000_000_000, null);
      const cash_collected_amount_iqd = clampInt(body.cash_collected_amount_iqd, 0, 2_000_000_000, null);
      const cash_change_given_iqd = clampInt(body.cash_change_given_iqd, 0, 2_000_000_000, null);

      const { data: updated, error: upErr } = await supabase.rpc('transition_ride_user_v1', {
        p_ride_id: body.ride_id,
        p_to_status: body.to_status,
        p_expected_version: expected_version,
        p_cash_collected_amount_iqd: cash_collected_amount_iqd,
        p_cash_change_given_iqd: cash_change_given_iqd,
      });

      if (upErr || !updated) {
        const msg = upErr?.message ?? 'Transition failed';
        const mapped =
          msg.includes('ride_not_found') ? { status: 404, code: 'NOT_FOUND', reason: 'ride_not_found' }
          : msg.includes('forbidden') ? { status: 403, code: 'FORBIDDEN', reason: 'forbidden' }
          : msg.includes('unauthorized') ? { status: 401, code: 'UNAUTHORIZED', reason: 'unauthorized' }
          : msg.includes('version_mismatch') ? { status: 409, code: 'VERSION_MISMATCH', reason: 'version_mismatch' }
          : msg.includes('invalid_transition') ? { status: 409, code: 'INVALID_TRANSITION', reason: 'invalid_transition' }
          : msg.includes('pickup_pin_required') ? { status: 409, code: 'PICKUP_PIN_REQUIRED', reason: 'pickup_pin_required' }
          : msg.includes('cash_expected_missing') ? { status: 409, code: 'CASH_EXPECTED_MISSING', reason: 'cash_expected_missing' }
          : msg.includes('cash_required') ? { status: 400, code: 'CASH_REQUIRED', reason: 'cash_required' }
          : msg.includes('cash_underpaid') ? { status: 400, code: 'CASH_UNDERPAID', reason: 'cash_underpaid' }
          : msg.includes('cash_invalid') ? { status: 400, code: 'CASH_INVALID', reason: 'cash_invalid' }
          : { status: 400, code: 'TRANSITION_FAILED', reason: 'transition_failed' };

        emitMetricBestEffort(ctx, { event_type: 'metric.trip.transition', level: 'warn', payload: { ok: false, ...mapped, message: msg } });
        await stopTimer?.('ok', { ok: false, ...mapped });

        await logAppEvent({
          event_type: 'ride.transition_failed',
          level: 'warn',
          actor_id: user.id,
          actor_type: null,
          ride_id: body.ride_id,
          payload: { to_status: body.to_status, error: msg, code: mapped.code },
        });

        return errorJson(msg, mapped.status, mapped.code, undefined, {
          ...ctx.headers,
          ...buildRateLimitHeaders({ limit: 60, remaining: rl.remaining, resetAt: rl.resetAt }),
        });
      }

      emitMetricBestEffort(ctx, {
        event_type: 'metric.trip.transition',
        payload: { ok: true, to_status: body.to_status, ride_id: body.ride_id },
      });
      await stopTimer?.('ok', { ok: true, to_status: body.to_status });

      await logAppEvent({
        event_type: 'ride.transition',
        level: 'info',
        actor_id: user.id,
        actor_type: null,
        ride_id: body.ride_id,
        payload: { to_status: body.to_status },
      });

      return json(
        { ok: true, ride: updated, rate_limit: { remaining: rl.remaining, reset_at: rl.resetAt } },
        200,
        { ...ctx.headers, ...buildRateLimitHeaders({ limit: 60, remaining: rl.remaining, resetAt: rl.resetAt }) },
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      emitMetricBestEffort(ctx, { event_type: 'metric.trip.transition', level: 'error', payload: { ok: false, reason: 'exception', message: msg } });
      await stopTimer?.('ok', { ok: false, reason: 'exception' });
      return errorJson(msg, 500, 'INTERNAL_ERROR', undefined, ctx.headers);
    }
  }),
);
