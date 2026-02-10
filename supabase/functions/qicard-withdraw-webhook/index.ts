import { createServiceClient } from '../_shared/supabase.ts';
import { errorJson, json } from '../_shared/json.ts';
import { hmacSha256Bytes, shaHex, timingSafeEqual } from '../_shared/crypto.ts';
import { withRequestContext } from '../_shared/requestContext.ts';
import { isProduction } from '../_shared/env.ts';
import { enqueueWebhookJob, runWebhookJobs } from '../_shared/webhookJobs.ts';
import { tryWaitUntil } from '../_shared/background.ts';
import { storeProviderEvent } from '../_shared/providerEvents.ts';
import { requireFreshWebhookTimestamp } from '../_shared/webhookReplay.ts';
import { emitMetricBestEffort } from '../_shared/metrics.ts';

function isUuid(v: unknown): v is string {
  return typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
}
function toHex(bytes: Uint8Array) {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
}
function normalizeSig(s: string) {
  return (s ?? '').trim().replace(/^sha256=/i, '');
}
function pickFirst(...vals: unknown[]) {
  for (const v of vals) {
    if (v === null || v === undefined) continue;
    if (typeof v === 'string' && v.trim() === '') continue;
    return v;
  }
  return null;
}

Deno.serve(async (req) => {
  // verify_jwt=false in config.toml (webhook endpoint)

  return await withRequestContext('qicard-withdraw-webhook', req, async (ctx) => {
    try {
      if (req.method !== 'POST') {
        emitMetricBestEffort(ctx, { event_type: 'metric.webhook.ignored', payload: { provider_code: 'qicard', kind: 'withdraw', reason: 'method' } });
        return json({ ok: true, ignored: true }, 200, ctx.headers);
      }

      // Optional timestamp-based replay guard (best-effort; only enforced if header is present).
      const tsGuard = requireFreshWebhookTimestamp(req, ctx.headers);
      if (tsGuard) {
        emitMetricBestEffort(ctx, { event_type: 'metric.webhook.ignored', payload: { provider_code: 'qicard', kind: 'withdraw', reason: 'stale_timestamp' } });
        return tsGuard;
      }

      const service = createServiceClient();
      const raw = await req.text();

      // Parse JSON or form
      let payload: any = null;
      try {
        payload = JSON.parse(raw);
      } catch {
        try {
          const params = new URLSearchParams(raw);
          const obj: Record<string, any> = {};
          for (const [k, v] of params.entries()) obj[k] = v;
          payload = Object.keys(obj).length ? obj : null;
        } catch {
          payload = null;
        }
      }

      if (!payload || typeof payload !== 'object') {
        emitMetricBestEffort(ctx, { event_type: 'metric.webhook.ignored', payload: { provider_code: 'qicard', kind: 'withdraw', reason: 'bad_payload' } });
        return errorJson('Invalid payload', 400, 'BAD_PAYLOAD', undefined, ctx.headers);
      }

      // HMAC verification (same pattern as qicard-notify)
      const webhookSecret = String(
        Deno.env.get('QICARD_PAYOUT_WEBHOOK_SECRET') ?? Deno.env.get('QICARD_WEBHOOK_SECRET') ?? '',
      ).trim();
      const allowInsecure = String(Deno.env.get('QICARD_ALLOW_INSECURE_WEBHOOKS') ?? '').toLowerCase() === 'true';

      if (allowInsecure && isProduction()) {
        emitMetricBestEffort(ctx, { event_type: 'metric.webhook.internal_error', level: 'error', payload: { provider_code: 'qicard', kind: 'withdraw', reason: 'insecure_disabled_prod' } });
        return errorJson('Insecure webhook mode is disabled in production', 500, 'INSECURE_WEBHOOKS_DISABLED', undefined, ctx.headers);
      }

      if (!webhookSecret && !allowInsecure) {
        emitMetricBestEffort(ctx, { event_type: 'metric.webhook.internal_error', level: 'error', payload: { provider_code: 'qicard', kind: 'withdraw', reason: 'missing_secret' } });
        return errorJson('QICARD_PAYOUT_WEBHOOK_SECRET (or QICARD_WEBHOOK_SECRET) not configured', 500, 'CONFIG_ERROR', undefined, ctx.headers);
      }

      if (webhookSecret) {
        const headerSig = normalizeSig(
          req.headers.get('x-signature') ??
            req.headers.get('x-webhook-signature') ??
            req.headers.get('x-qicard-signature') ??
            '',
        );
        if (!headerSig) {
          emitMetricBestEffort(ctx, { event_type: 'metric.webhook.auth_fail', level: 'warn', payload: { provider_code: 'qicard', kind: 'withdraw', reason: 'missing_signature' } });
          return errorJson('Missing signature', 401, 'MISSING_SIGNATURE', undefined, ctx.headers);
        }

        const mac = await hmacSha256Bytes(webhookSecret, raw);
        const hex = toHex(mac);
        const b64 = btoa(String.fromCharCode(...mac));
        if (!timingSafeEqual(headerSig.toLowerCase(), hex.toLowerCase()) && !timingSafeEqual(headerSig, b64)) {
          emitMetricBestEffort(ctx, { event_type: 'metric.webhook.auth_fail', level: 'warn', payload: { provider_code: 'qicard', kind: 'withdraw', reason: 'invalid_signature' } });
          return errorJson('Invalid signature', 401, 'INVALID_SIGNATURE', undefined, ctx.headers);
        }
      } else {
        ctx.warn('webhook.insecure_mode_enabled', { env: isProduction() ? 'production' : 'non-production' });
      }

      const withdrawId = String(
        pickFirst(payload.withdraw_request_id, payload.withdrawal_id, payload.ref, payload.reference, payload.orderId, payload.order_id) ?? '',
      ).trim();

      if (!isUuid(withdrawId)) {
        emitMetricBestEffort(ctx, { event_type: 'metric.webhook.ignored', payload: { provider_code: 'qicard', kind: 'withdraw', reason: 'invalid_ref' } });
        return json({ ok: true, ignored: true, reason: 'missing_or_invalid_withdraw_id' }, 200, ctx.headers);
      }

      ctx.setCorrelationId(withdrawId);

      const eventId = String(pickFirst(payload.eventId, payload.event_id, payload.id, payload.uuid) ?? '').trim() ||
        (await shaHex('SHA-256', raw));
      const providerEventId = `payout:${eventId}`;

      // Durable inbox (idempotent).
      const stored = await storeProviderEvent(service, 'qicard', providerEventId, { raw: payload });

      if (!stored.inserted) {
        emitMetricBestEffort(ctx, { event_type: 'metric.webhook.duplicate', level: 'warn', payload: { provider_code: 'qicard', kind: 'withdraw' } });
      }

      // Queue async processing (retries/backoff handled by the worker).
      const { queued } = await enqueueWebhookJob(service, {
        providerCode: 'qicard',
        providerEventId: providerEventId,
        providerEventPk: stored.id,
        jobKind: 'withdraw_webhook',
        correlationId: withdrawId,
      });

      emitMetricBestEffort(ctx, {
        event_type: 'metric.webhook.accepted',
        payload: { provider_code: 'qicard', kind: 'withdraw', queued, duplicate: !stored.inserted, correlation_id: withdrawId },
      });

      // Optional best-effort immediate processing.
      // In local `supabase functions serve` EdgeRuntime.waitUntil may not exist, so fall back to a
      // single synchronous job run for developer ergonomics.
      const scheduled = tryWaitUntil(runWebhookJobs(service, { limit: 1, hardMax: 1 }));
      if (!scheduled && !isProduction()) await runWebhookJobs(service, { limit: 1, hardMax: 1 });

      return json({ ok: true, accepted: true, queued, duplicate: !stored.inserted, withdraw_request_id: withdrawId }, 200, ctx.headers);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      emitMetricBestEffort(ctx, { event_type: 'metric.webhook.internal_error', level: 'error', payload: { provider_code: 'qicard', kind: 'withdraw', error: msg } });
      return errorJson(msg, 500, 'INTERNAL_ERROR', undefined, ctx.headers);
    }
  });
});
