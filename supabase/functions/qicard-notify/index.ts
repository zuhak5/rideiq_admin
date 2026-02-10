import { createServiceClient } from '../_shared/supabase.ts';
import { errorJson, json } from '../_shared/json.ts';
import { hmacSha256Bytes, shaHex, timingSafeEqual } from '../_shared/crypto.ts';
import { findProvider, getPaymentsPublicConfig } from '../_shared/paymentsConfig.ts';
import { isProduction } from '../_shared/env.ts';
import { withRequestContext } from '../_shared/requestContext.ts';
import { emitMetricBestEffort } from '../_shared/metrics.ts';
import { enqueueWebhookJob, runWebhookJobs } from '../_shared/webhookJobs.ts';
import { tryWaitUntil } from '../_shared/background.ts';
import { storeProviderEvent } from '../_shared/providerEvents.ts';
import { requireFreshWebhookTimestamp } from '../_shared/webhookReplay.ts';

function isUuid(v: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
}

function toHex(bytes: Uint8Array) {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function normalizeSig(s: string) {
  return (s ?? '').trim().replace(/^sha256=/i, '');
}

function pickFirst<T>(...vals: Array<T | null | undefined>): T | null {
  for (const v of vals) if (v != null && v !== '') return v as T;
  return null;
}

Deno.serve(async (req) => {

  return await withRequestContext('qicard-notify', req, async (ctx) => {
    try {
      if (req.method !== 'POST') {
        emitMetricBestEffort(ctx, { event_type: 'metric.webhook.ignored', payload: { provider_code: 'qicard', reason: 'method' } });
        return json({ ok: true, ignored: true }, 200, ctx.headers);
      }

      // Optional timestamp-based replay guard (best-effort; only enforced if header is present).
      const tsGuard = requireFreshWebhookTimestamp(req, ctx.headers);
      if (tsGuard) {
        emitMetricBestEffort(ctx, { event_type: 'metric.webhook.ignored', payload: { provider_code: 'qicard', reason: 'stale_timestamp' } });
        return tsGuard;
      }

      const service = createServiceClient();

      const raw = await req.text();
      let payload: any = null;
      try {
        payload = JSON.parse(raw);
      } catch {
        // try form-urlencoded
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
        // Log parse failures for forensics, but respond with 400 so the provider can retry if misconfigured.
        try {
          await service.from('provider_events').insert({
            provider_code: 'qicard',
            provider_event_id: `parse_error:${Date.now()}`,
            payload: { raw },
          });
        } catch {}
        emitMetricBestEffort(ctx, { event_type: 'metric.webhook.ignored', payload: { provider_code: 'qicard', reason: 'bad_payload' } });
        return errorJson('Invalid payload', 400, 'BAD_PAYLOAD', undefined, ctx.headers);
      }

      const paymentsCfg = getPaymentsPublicConfig();
      const provider = findProvider(paymentsCfg, 'qicard');
      if (!provider) {
        emitMetricBestEffort(ctx, { event_type: 'metric.webhook.ignored', payload: { provider_code: 'qicard', reason: 'provider_not_found' } });
        return json({ ok: true, ignored: true, reason: 'provider_not_found' }, 200, ctx.headers);
      }
      if (!provider.enabled) {
        emitMetricBestEffort(ctx, { event_type: 'metric.webhook.ignored', payload: { provider_code: 'qicard', reason: 'provider_disabled' } });
        return json({ ok: true, ignored: true, reason: 'provider_disabled' }, 200, ctx.headers);
      }
      if (provider.kind !== 'qicard') {
        emitMetricBestEffort(ctx, { event_type: 'metric.webhook.ignored', payload: { provider_code: 'qicard', reason: 'provider_kind_mismatch' } });
        return json({ ok: true, ignored: true, reason: 'provider_kind_mismatch' }, 200, ctx.headers);
      }

      const webhookSecret = String(Deno.env.get('QICARD_WEBHOOK_SECRET') ?? '').trim();
      const allowInsecure = String(Deno.env.get('QICARD_ALLOW_INSECURE_WEBHOOKS') ?? '').toLowerCase() === 'true';

      if (allowInsecure && isProduction()) {
        emitMetricBestEffort(ctx, { event_type: 'metric.webhook.internal_error', level: 'error', payload: { provider_code: 'qicard', reason: 'insecure_disabled_prod' } });
        return errorJson('Insecure webhook mode is disabled in production', 500, 'INSECURE_WEBHOOKS_DISABLED', undefined, ctx.headers);
      }

      if (!webhookSecret && !allowInsecure) {
        // Fail closed: do not run a webhook endpoint without a configured secret.
        emitMetricBestEffort(ctx, { event_type: 'metric.webhook.internal_error', level: 'error', payload: { provider_code: 'qicard', reason: 'missing_secret' } });
        return errorJson('QICARD_WEBHOOK_SECRET not configured', 500, 'CONFIG_ERROR', undefined, ctx.headers);
      }

      // Verify signature when configured.
      if (webhookSecret) {
        const headerSig = normalizeSig(
          req.headers.get('x-signature') ??
            req.headers.get('x-webhook-signature') ??
            req.headers.get('x-qicard-signature') ??
            '',
        );

        if (!headerSig) {
          emitMetricBestEffort(ctx, { event_type: 'metric.webhook.auth_fail', level: 'warn', payload: { provider_code: 'qicard', reason: 'missing_signature' } });
          return errorJson('Missing signature', 401, 'MISSING_SIGNATURE', undefined, ctx.headers);
        }

        const mac = await hmacSha256Bytes(webhookSecret, raw);
        const hex = toHex(mac);
        const b64 = btoa(String.fromCharCode(...mac));
        if (!timingSafeEqual(headerSig.toLowerCase(), hex.toLowerCase()) && !timingSafeEqual(headerSig, b64)) {
          emitMetricBestEffort(ctx, { event_type: 'metric.webhook.auth_fail', level: 'warn', payload: { provider_code: 'qicard', reason: 'invalid_signature' } });
          return errorJson('Invalid signature', 401, 'INVALID_SIGNATURE', undefined, ctx.headers);
        }
      } else {
        ctx.warn('webhook.insecure_mode_enabled', { env: isProduction() ? 'production' : 'non-production' });
      }

      const intentId = String(
        pickFirst(
          payload.reference,
          payload.orderId,
          payload.order_id,
          payload.merchantReference,
          payload.merchant_reference,
          payload?.metadata?.intent_id,
          payload?.metadata?.intentId,
        ) ?? '',
      );

      if (intentId && isUuid(intentId)) {
        ctx.setCorrelationId(intentId);
      }

      const eventId = String(
        pickFirst(payload.eventId, payload.event_id, payload.id, payload.paymentId, payload.transactionId) ?? '',
      ).trim();

      // Stable provider event id.
      const stableEventId = eventId || (await shaHex('SHA-256', raw));
      const providerEventId = `topup:${stableEventId}`;

      // Durable inbox (idempotent). Insert after verification.
      const stored = await storeProviderEvent(service, 'qicard', providerEventId, payload);
      const providerEventPk = stored.id;
      if (!stored.inserted) {
        emitMetricBestEffort(ctx, { event_type: 'metric.webhook.duplicate', level: 'warn', payload: { provider_code: 'qicard' } });
      }

      // Queue async processing (fast 2xx response; worker does retries/backoff).
      if (intentId && isUuid(intentId)) {
        const { queued } = await enqueueWebhookJob(service, {
          providerCode: 'qicard',
          providerEventId,
          providerEventPk,
          jobKind: 'topup_webhook',
          correlationId: intentId,
        });

        // Optional: attempt immediate background processing (still safe/locked in DB).
        const scheduled = tryWaitUntil(runWebhookJobs(service, { limit: 1, hardMax: 1 }));
        if (!scheduled && !isProduction()) await runWebhookJobs(service, { limit: 1, hardMax: 1 });

        emitMetricBestEffort(ctx, { event_type: 'metric.webhook.accepted', payload: { provider_code: 'qicard', queued } });
        return json({ ok: true, accepted: true, queued, duplicate: !stored.inserted }, 200, ctx.headers);
      }

      emitMetricBestEffort(ctx, { event_type: 'metric.webhook.ignored', payload: { provider_code: 'qicard', reason: 'missing_intent_id' } });
      return json({ ok: true, accepted: true, queued: false, reason: 'missing_intent_id' }, 200, ctx.headers);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      emitMetricBestEffort(ctx, { event_type: 'metric.webhook.internal_error', level: 'error', payload: { provider_code: 'qicard', error: msg } });
      return errorJson(msg, 500, 'UNHANDLED_ERROR', undefined, ctx.headers);
    }
  });
});
