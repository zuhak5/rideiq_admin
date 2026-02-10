import { createServiceClient } from '../_shared/supabase.ts';
import { errorJson, json } from '../_shared/json.ts';
import { requireWebhookSecret } from '../_shared/webhookAuth.ts';
import { withRequestContext } from '../_shared/requestContext.ts';

type WebhookPayload<T> =
  | { type: 'INSERT' | 'UPDATE' | 'DELETE'; table: string; schema: string; record: T | null; old_record: T | null; meta?: Record<string, unknown> }
  | Record<string, unknown>;

type RideRecord = {
  id: string;
  rider_id: string;
  status: string;
};

function clampInt(v: unknown, min: number, max: number, fallback: number) {
  const n = typeof v === 'number' && Number.isFinite(v) ? Math.floor(v) : fallback;
  return Math.max(min, Math.min(max, n));
}

Deno.serve((req) =>
  withRequestContext('trip-share-auto', req, async (ctx) => {
    if (req.method !== 'POST') return errorJson('Method not allowed', 405, 'METHOD_NOT_ALLOWED', undefined, ctx.headers);

    // Shared-secret auth. This function is called from the DB via the outbox dispatcher.
    // We intentionally reuse DISPATCH_WEBHOOK_SECRET to avoid introducing a new Vault secret dependency.
    const auth = requireWebhookSecret(req, 'DISPATCH_WEBHOOK_SECRET', 'x-webhook-secret');
    if (auth) return auth;

    const payload = (await req.json().catch(() => ({}))) as WebhookPayload<RideRecord>;
    const record = (payload as any)?.record as RideRecord | null;
    const meta = ((payload as any)?.meta ?? {}) as Record<string, unknown>;

    if (!record?.id || !record?.rider_id) {
      return errorJson('Missing ride record', 400, 'BAD_REQUEST', undefined, ctx.headers);
    }

    // Defensive check (DB trigger already filters for in_progress).
    if (String(record.status) !== 'in_progress') {
      return json({ ok: true, ignored: true, reason: 'not_in_progress' }, 200, ctx.headers);
    }

    const ttlMinutes = clampInt((meta as any)?.ttl_minutes, 5, 1440, 120);

    // Thin wrapper: the DB RPC performs all correctness-sensitive work atomically:
    // - validates ride + settings
    // - idempotently creates/reuses an active token
    // - writes the event + user notification
    const svc = createServiceClient();
    const { data, error } = await svc.rpc('trip_share_auto_create_v1', {
      p_ride_id: record.id,
      p_rider_id: record.rider_id,
      p_ttl_minutes: ttlMinutes,
    });

    if (error) {
      ctx.error('trip_share_auto.rpc_failed', { error: error.message, ride_id: record.id });
      return errorJson('DB error', 400, 'DB_ERROR', { detail: error.message }, ctx.headers);
    }

    const res = (data ?? {}) as any;
    if (!res.ok) {
      const e = String(res.error ?? 'unknown');
      if (e === 'forbidden') return errorJson('Forbidden', 403, 'FORBIDDEN', undefined, ctx.headers);
      if (e === 'not_found') return json({ ok: true, ignored: true, reason: 'not_found' }, 200, ctx.headers);
      if (e === 'disabled') return json({ ok: true, ignored: true, reason: 'disabled' }, 200, ctx.headers);
      return errorJson('Failed', 400, 'FAILED', { detail: e }, ctx.headers);
    }

    // Return minimal status for observability.
    return json(
      {
        ok: true,
        token_created: Boolean(res.token_created ?? false),
        expires_at: res.expires_at ?? null,
        token: res.token ?? null,
      },
      200,
      ctx.headers,
    );
  }),
);
