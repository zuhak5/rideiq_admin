import { errorJson, json } from '../_shared/json.ts';
import { logAppEvent } from '../_shared/log.ts';
import { buildRateLimitHeaders, consumeRateLimit, getClientIp } from '../_shared/rateLimit.ts';
import { withRequestContext } from '../_shared/requestContext.ts';
import { createUserClient, requireUser } from '../_shared/supabase.ts';
import { emitMetricBestEffort, metricTimer } from '../_shared/metrics.ts';

type Body = {
  event_id?: string;
  response?: 'ok' | 'false_alarm' | 'need_help';
  note?: string;
};

Deno.serve((req) => withRequestContext('ridecheck-respond', req, async (ctx) => {

  const stopTimer = metricTimer(ctx, 'metric.safety.ridecheck_response_latency', { payload: {} });

  try {
    if (req.method !== 'POST') {
      emitMetricBestEffort(ctx, { event_type: 'metric.safety.ridecheck_response', level: 'warn', payload: { ok: false, reason: 'method' } });
      await stopTimer('ok', { ok: false, reason: 'method' });
      return errorJson('Method not allowed', 405, 'METHOD_NOT_ALLOWED', undefined, ctx.headers);
    }

    const { user, error: authError } = await requireUser(req, ctx);
    if (!user) {
      emitMetricBestEffort(ctx, { event_type: 'metric.safety.ridecheck_response', level: 'warn', payload: { ok: false, reason: 'unauthorized' } });
      await stopTimer('ok', { ok: false, reason: 'unauthorized' });
      return errorJson(String(authError ?? 'Unauthorized'), 401, 'UNAUTHORIZED', undefined, ctx.headers);
    }

    const ip = getClientIp(req);
    const rl = await consumeRateLimit({
      key: `ridecheck_respond:${user.id}:${ip ?? 'noip'}`,
      windowSeconds: 60,
      limit: 60,
    });
    if (!rl.allowed) {
      emitMetricBestEffort(ctx, { event_type: 'metric.safety.ridecheck_response', level: 'warn', payload: { ok: false, reason: 'rate_limited' } });
      await stopTimer('ok', { ok: false, reason: 'rate_limited' });
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

    const body = (await req.json().catch(() => ({}))) as Body;
    const eventId = String(body.event_id ?? '').trim();
    const response = body.response;
    const note = typeof body.note === 'string' ? body.note.trim().slice(0, 500) : null;

    if (!eventId) {
      emitMetricBestEffort(ctx, { event_type: 'metric.safety.ridecheck_response', level: 'warn', payload: { ok: false, reason: 'validation' } });
      await stopTimer('ok', { ok: false, reason: 'validation' });
      return errorJson('event_id is required', 400, 'VALIDATION_ERROR', undefined, ctx.headers);
    }
    if (!response || !['ok', 'false_alarm', 'need_help'].includes(response)) {
      emitMetricBestEffort(ctx, { event_type: 'metric.safety.ridecheck_response', level: 'warn', payload: { ok: false, reason: 'validation' } });
      await stopTimer('ok', { ok: false, reason: 'validation' });
      return errorJson('response must be one of ok|false_alarm|need_help', 400, 'VALIDATION_ERROR', undefined, ctx.headers);
    }

    // Least-privilege: use the caller JWT and a DB-side SECURITY DEFINER wrapper.
    const supabase = createUserClient(req);
    const { data: rows, error: rpcErr } = await supabase.rpc('ridecheck_respond_user', {
      p_event_id: eventId,
      p_response: response,
      p_note: note,
    });

    if (rpcErr) {
      const code = String((rpcErr as any).code ?? '');
      const message = rpcErr.message;
      if (code === '28000') {
        emitMetricBestEffort(ctx, { event_type: 'metric.safety.ridecheck_response', level: 'warn', payload: { ok: false, reason: 'unauthorized' } });
        await stopTimer('ok', { ok: false, reason: 'unauthorized' });
        return errorJson(message, 401, 'UNAUTHORIZED', undefined, ctx.headers);
      }
      if (code === '42501') {
        emitMetricBestEffort(ctx, { event_type: 'metric.safety.ridecheck_response', level: 'warn', payload: { ok: false, reason: 'forbidden' } });
        await stopTimer('ok', { ok: false, reason: 'forbidden' });
        return errorJson(message, 403, 'FORBIDDEN', undefined, ctx.headers);
      }
      if (code === 'P0002') {
        emitMetricBestEffort(ctx, { event_type: 'metric.safety.ridecheck_response', level: 'warn', payload: { ok: false, reason: 'not_found' } });
        await stopTimer('ok', { ok: false, reason: 'not_found' });
        return errorJson(message, 404, 'NOT_FOUND', undefined, ctx.headers);
      }
      emitMetricBestEffort(ctx, { event_type: 'metric.safety.ridecheck_response', level: 'error', payload: { ok: false, reason: 'db_error' } });
      await stopTimer('error', { ok: false, reason: 'db_error', error: message });
      return errorJson(message, 500, 'DB_ERROR', undefined, ctx.headers);
    }

    const row = Array.isArray(rows) ? rows[0] : (rows as any);
    const rideId = String(row?.ride_id ?? '');
    const kind = row?.kind;
    const status = row?.status;
    const alreadyClosed = Boolean(row?.already_closed);
    const role = row?.role as 'driver' | 'rider' | undefined;

    if (!rideId) {
      emitMetricBestEffort(ctx, { event_type: 'metric.safety.ridecheck_response', level: 'error', payload: { ok: false, reason: 'rpc_invalid' } });
      await stopTimer('error', { ok: false, reason: 'rpc_invalid' });
      return errorJson('RideCheck response failed', 500, 'INTERNAL', undefined, ctx.headers);
    }

    ctx.setCorrelationId(rideId);

    if (alreadyClosed) {
      emitMetricBestEffort(ctx, { event_type: 'metric.safety.ridecheck_response', payload: { ok: true, already_closed: true, response } });
      await stopTimer('ok', { ok: true, already_closed: true });
      return json({ ok: true, already_closed: true, status, ride_id: rideId }, 200, ctx.headers);
    }

    await logAppEvent({
      event_type: 'ridecheck_response',
      actor_id: user.id,
      actor_type: role,
      ride_id: rideId,
      payload: { event_id: eventId, kind, response, requestId: ctx.requestId },
    });

    emitMetricBestEffort(ctx, { event_type: 'metric.safety.ridecheck_response', payload: { ok: true, response, status, role } });
    if (response === 'need_help') {
      emitMetricBestEffort(ctx, { event_type: 'metric.safety.ridecheck_escalated', level: 'warn', payload: { ride_id: rideId, event_id: eventId } });
    }
    await stopTimer('ok', { ok: true, response, status, role });

    return json({
      ok: true,
      ride_id: rideId,
      event_id: eventId,
      kind,
      status,
      response,
      rate_limit: { remaining: rl.remaining, reset_at: rl.resetAt },
    }, 200, { ...ctx.headers, ...buildRateLimitHeaders({ limit: 60, remaining: rl.remaining, resetAt: rl.resetAt }) });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    emitMetricBestEffort(ctx, { event_type: 'metric.safety.ridecheck_response', level: 'error', payload: { ok: false, reason: 'internal', error: msg } });
    await stopTimer('error', { ok: false, reason: 'internal', error: msg });
    return errorJson(msg, 500, 'INTERNAL', undefined, ctx.headers);
  }
}));
