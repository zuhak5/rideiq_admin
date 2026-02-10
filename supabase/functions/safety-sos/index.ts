import { errorJson, json } from '../_shared/json.ts';
import { shaHex } from '../_shared/crypto.ts';
import { logAppEvent } from '../_shared/log.ts';
import { buildRateLimitHeaders, consumeRateLimit, getClientIp } from '../_shared/rateLimit.ts';
import { withRequestContext } from '../_shared/requestContext.ts';
import { createServiceClient, requireUser } from '../_shared/supabase.ts';
import { emitMetricBestEffort, metricTimer } from '../_shared/metrics.ts';

type Payload = {
  ride_id?: string;
  lat?: number;
  lng?: number;
};

function clampInt(v: unknown, min: number, max: number, fallback: number) {
  const n = typeof v === 'number' && Number.isFinite(v) ? Math.floor(v) : fallback;
  return Math.max(min, Math.min(max, n));
}

function bytesToHex(bytes: Uint8Array) {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function randomTokenHex(bytes = 32) {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return bytesToHex(arr);
}

async function createTripShareToken(
  service: ReturnType<typeof createServiceClient>,
  rideId: string,
  createdBy: string,
  ttlMinutes: number,
) {
  const token = randomTokenHex(32);
  const token_hash = await shaHex('SHA-256', token);
  const expires_at = new Date(Date.now() + ttlMinutes * 60 * 1000).toISOString();

  const { error } = await service.from('trip_share_tokens').insert({
    ride_id: rideId,
    created_by: createdBy,
    expires_at,
    token_hash,
  });
  if (error) throw error;
  return { token, token_hash, expires_at } as const;
}

Deno.serve((req) => withRequestContext('safety-sos', req, async (ctx) => {

  const stopTimer = metricTimer(ctx, 'metric.safety.sos_latency', { payload: {} });

  try {
    if (req.method !== 'POST') {
      emitMetricBestEffort(ctx, { event_type: 'metric.safety.sos', level: 'warn', payload: { ok: false, reason: 'method' } });
      await stopTimer('ok', { ok: false, reason: 'method' });
      return errorJson('Method not allowed', 405, 'METHOD_NOT_ALLOWED', undefined, ctx.headers);
    }

    const { user, error: authError } = await requireUser(req, ctx);
    if (!user) {
      emitMetricBestEffort(ctx, { event_type: 'metric.safety.sos', level: 'warn', payload: { ok: false, reason: 'unauthorized' } });
      await stopTimer('ok', { ok: false, reason: 'unauthorized' });
      return errorJson(String(authError ?? 'Unauthorized'), 401, 'UNAUTHORIZED', undefined, ctx.headers);
    }

    const ip = getClientIp(req);
    const rl = await consumeRateLimit({
      key: `sos:${user.id}:${ip ?? 'noip'}`,
      windowSeconds: 60,
      limit: 6,
    });
    if (!rl.allowed) {
      emitMetricBestEffort(ctx, { event_type: 'metric.safety.sos', level: 'warn', payload: { ok: false, reason: 'rate_limited' } });
      await stopTimer('ok', { ok: false, reason: 'rate_limited' });
      return json(
        { error: 'Rate limit exceeded', code: 'RATE_LIMITED', reset_at: rl.resetAt, remaining: rl.remaining },
        429,
        {
          ...ctx.headers,
          ...buildRateLimitHeaders({ limit: 6, remaining: rl.remaining, resetAt: rl.resetAt }),
          'Retry-After': String(Math.max(1, Math.ceil((new Date(rl.resetAt).getTime() - Date.now()) / 1000))),
        },
      );
    }

    const body = (await req.json().catch(() => ({}))) as Payload;
    const rideId = String(body.ride_id ?? '').trim();
    if (!rideId) {
      emitMetricBestEffort(ctx, { event_type: 'metric.safety.sos', level: 'warn', payload: { ok: false, reason: 'validation' } });
      await stopTimer('ok', { ok: false, reason: 'validation' });
      return errorJson('Missing ride_id', 400, 'VALIDATION_ERROR', undefined, ctx.headers);
    }

    ctx.setCorrelationId(rideId);

    const lat = typeof body.lat === 'number' ? body.lat : null;
    const lng = typeof body.lng === 'number' ? body.lng : null;

    const service = createServiceClient();

    const { data: ride, error: rideErr } = await service
      .from('rides')
      .select('id,rider_id,driver_id,status')
      .eq('id', rideId)
      .maybeSingle();
    if (rideErr) {
      emitMetricBestEffort(ctx, { event_type: 'metric.safety.sos', level: 'error', payload: { ok: false, reason: 'db_error' } });
      await stopTimer('error', { ok: false, reason: 'db_error', error: rideErr.message });
      return errorJson(rideErr.message, 500, 'DB_ERROR', undefined, ctx.headers);
    }
    if (!ride) {
      emitMetricBestEffort(ctx, { event_type: 'metric.safety.sos', level: 'warn', payload: { ok: false, reason: 'not_found' } });
      await stopTimer('ok', { ok: false, reason: 'not_found' });
      return errorJson('Ride not found', 404, 'NOT_FOUND', undefined, ctx.headers);
    }
    if (ride.rider_id !== user.id && ride.driver_id !== user.id) {
      emitMetricBestEffort(ctx, { event_type: 'metric.safety.sos', level: 'warn', payload: { ok: false, reason: 'forbidden' } });
      await stopTimer('ok', { ok: false, reason: 'forbidden' });
      return errorJson('Forbidden', 403, 'FORBIDDEN', undefined, ctx.headers);
    }

    const { data: settings } = await service
      .from('user_safety_settings')
      .select('auto_notify_on_sos,default_share_ttl_minutes')
      .eq('user_id', user.id)
      .maybeSingle();

    const ttl = clampInt(settings?.default_share_ttl_minutes, 5, 1440, 120);
    const autoNotify = Boolean(settings?.auto_notify_on_sos ?? true);

    const { token, token_hash, expires_at } = await createTripShareToken(service, rideId, user.id, ttl);

    const { data: sos, error: sosErr } = await service
      .from('sos_events')
      .insert({ user_id: user.id, ride_id: rideId, lat, lng, metadata: { ip, ua: req.headers.get('user-agent') ?? null } })
      .select('id')
      .single();
    if (sosErr) {
      emitMetricBestEffort(ctx, { event_type: 'metric.safety.sos', level: 'error', payload: { ok: false, reason: 'db_error' } });
      await stopTimer('error', { ok: false, reason: 'db_error', error: sosErr.message });
      return errorJson(sosErr.message, 500, 'DB_ERROR', undefined, ctx.headers);
    }

    await service.from('ride_incidents').insert({
      ride_id: rideId,
      reporter_id: user.id,
      category: 'sos',
      severity: 'critical',
      description: `SOS triggered by ${user.id} (ride ${rideId}).`,
      status: 'open',
    });

    const { data: contacts } = await service
      .from('trusted_contacts')
      .select('id,name,phone,relationship,is_active')
      .eq('user_id', user.id)
      .eq('is_active', true)
      .order('created_at', { ascending: true })
      .limit(5);

    await service.from('user_notifications').insert({
      user_id: user.id,
      kind: 'trip_share',
      title: 'Emergency SOS — share link ready',
      body: 'Share this private tracking link with trusted contacts.',
      data: { ride_id: rideId, token, expires_at, reason: 'sos', sos_id: sos?.id },
    });

    const baseUrl = (Deno.env.get('APP_BASE_URL') ?? '').replace(/\/$/, '');
    const share_url = baseUrl ? `${baseUrl}/share/${token}` : null;

    if (autoNotify && (contacts ?? []).length) {
      // Audit trail.
      await service.from('trusted_contact_events').insert(
        (contacts ?? []).map((c: any) => ({
          user_id: user.id,
          contact_id: c.id,
          ride_id: rideId,
          event_type: 'sos_share_ready',
          status: 'queued',
          payload: { token_hash, expires_at, sos_event_id: sos?.id },
        })),
      );

      // Outbox for provider-agnostic dispatch (SMS/webhook/etc.).
      // Contacts without a phone are skipped.
      const outboxRows = (contacts ?? [])
        .filter((c: any) => String(c.phone ?? '').trim())
        .map((c: any) => ({
          user_id: user.id,
          contact_id: c.id,
          sos_event_id: sos?.id,
          ride_id: rideId,
          channel: 'sms',
          to_phone: String(c.phone).trim(),
          payload: {
            type: 'sos_share',
            token,
            share_url,
            expires_at,
            contact_name: c.name ?? null,
            relationship: c.relationship ?? null,
            ride_id: rideId,
            sos_event_id: sos?.id,
          },
        }));

      if (outboxRows.length) {
        // Avoid duplicates if the endpoint is called twice for the same SOS.
        await service
          .from('trusted_contact_outbox')
          .upsert(outboxRows as any, { onConflict: 'contact_id,sos_event_id', ignoreDuplicates: true });
      }
    } else {
      await service.from('trusted_contact_events').insert({
        user_id: user.id,
        ride_id: rideId,
        event_type: 'sos_triggered',
        status: 'ok',
        payload: { token_hash, expires_at, sos_event_id: sos?.id, contacts: (contacts ?? []).length },
      });
    }

    // Best-effort notify admins (prefer membership table; keep legacy flag fallback).
    const adminIdsSet = new Set<string>();
    const { data: admins } = await service.from('admin_users').select('user_id').limit(100);
    (admins ?? []).forEach((a: any) => {
      if (a?.user_id) adminIdsSet.add(String(a.user_id));
    });
    const { data: legacy } = await service.from('profiles').select('id').eq('is_admin', true).limit(100);
    (legacy ?? []).forEach((a: any) => {
      if (a?.id) adminIdsSet.add(String(a.id));
    });
    const adminIds = Array.from(adminIdsSet).filter(Boolean);
    if (adminIds.length) {
      await service.from('user_notifications').insert(
        adminIds.map((uid: string) => ({
          user_id: uid,
          kind: 'sos',
          title: 'SOS Alert',
          body: `SOS triggered on ride ${rideId}`,
          data: { ride_id: rideId, sos_id: sos?.id, lat, lng, user_id: user.id },
        })),
      );
    }

    await logAppEvent({
      event_type: 'sos_triggered',
      actor_id: user.id,
      actor_type: ride.driver_id === user.id ? 'driver' : 'rider',
      ride_id: rideId,
      payload: { lat, lng, sos_event_id: sos?.id },
    });

    emitMetricBestEffort(ctx, { event_type: 'metric.safety.sos', payload: { ok: true, ride_id: rideId, sos_event_id: sos?.id ?? null } });
    emitMetricBestEffort(ctx, { event_type: 'metric.safety.incident_created', level: 'warn', payload: { ride_id: rideId, category: 'sos', sos_event_id: sos?.id ?? null } });
    await stopTimer('ok', { ok: true, ride_id: rideId, sos_event_id: sos?.id ?? null });

    return json({
      ok: true,
      sos_event_id: sos?.id,
      share: { token, expires_at },
      trusted_contacts: contacts ?? [],
      rate_limit: { remaining: rl.remaining, reset_at: rl.resetAt },
    }, 200, { ...ctx.headers, ...buildRateLimitHeaders({ limit: 6, remaining: rl.remaining, resetAt: rl.resetAt }) });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    emitMetricBestEffort(ctx, { event_type: 'metric.safety.sos', level: 'error', payload: { ok: false, reason: 'internal', error: msg } });
    await stopTimer('error', { ok: false, reason: 'internal', error: msg });
    return errorJson(msg, 500, 'INTERNAL', undefined, ctx.headers);
  }
}));
