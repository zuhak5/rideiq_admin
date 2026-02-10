import type { RequestContext } from './requestContext.ts';
import { logAppEvent } from './log.ts';
import { tryWaitUntil } from './background.ts';

export type MetricLevel = 'info' | 'warn' | 'error';

export type MetricEvent = {
  event_type: string;
  level?: MetricLevel;
  ride_id?: string | null;
  payment_intent_id?: string | null;
  payload?: Record<string, unknown>;
};

/**
 * Emit a metric event into app_events.
 *
 * Notes:
 * - This is best-effort: failures are swallowed inside logAppEvent().
 * - Use tryWaitUntil() for webhook handlers if you want to avoid blocking the ACK.
 */
export async function emitMetric(ctx: RequestContext, e: MetricEvent) {
  const payload: Record<string, unknown> = {
    ...(e.payload ?? {}),
    component: ctx.component,
    trace_id: ctx.trace_id,
    correlation_id: ctx.correlation_id ?? null,
  };

  await logAppEvent({
    event_type: e.event_type,
    level: (e.level ?? 'info') as any,
    actor_id: ctx.actor_id ?? null,
    actor_type: null,
    request_id: ctx.request_id,
    ride_id: e.ride_id ?? null,
    payment_intent_id: e.payment_intent_id ?? null,
    payload,
  });
}

export function metricTimer(
  ctx: RequestContext,
  event_type: string,
  base?: Omit<MetricEvent, 'event_type'>,
): (outcome: 'ok' | 'error', extra?: Record<string, unknown>) => Promise<number> {
  const startedAt = Date.now();

  return async (outcome, extra = {}) => {
    const durationMs = Date.now() - startedAt;
    await emitMetric(ctx, {
      event_type,
      level: outcome === 'error' ? 'error' : (base?.level ?? 'info'),
      ride_id: base?.ride_id,
      payment_intent_id: base?.payment_intent_id,
      payload: {
        ...(base?.payload ?? {}),
        ...extra,
        outcome,
        duration_ms: durationMs,
      },
    });
    return durationMs;
  };
}

/**
 * Emit a metric without blocking the caller when EdgeRuntime.waitUntil is available.
 *
 * This is an optimization only (NOT durability). Metrics are best-effort.
 */
export function emitMetricBestEffort(ctx: RequestContext, e: MetricEvent) {
  const p = emitMetric(ctx, e);
  if (!tryWaitUntil(p)) {
    // Never throw to the caller.
    p.catch(() => {});
  }
}
