import { createServiceClient } from '../_shared/supabase.ts';
import { errorJson } from '../_shared/json.ts';
import { shaHex, timingSafeEqual } from '../_shared/crypto.ts';
import { findProvider, getPaymentsPublicConfig } from '../_shared/paymentsConfig.ts';
import { isProduction } from '../_shared/env.ts';
import { enqueueWebhookJob, runWebhookJobs } from '../_shared/webhookJobs.ts';
import { tryWaitUntil } from '../_shared/background.ts';
import { storeProviderEvent } from '../_shared/providerEvents.ts';
import { requireFreshWebhookTimestamp } from '../_shared/webhookReplay.ts';
import { withRequestContext } from '../_shared/requestContext.ts';
import { emitMetricBestEffort } from '../_shared/metrics.ts';

function isUuid(v: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
}

function okText() {
  return new Response('OK', {
    status: 200,
    headers: {
      'Content-Type': 'text/plain',
      'Cache-Control': 'no-store',
    },
  });
}

/**
 * PayDollar/AsiaPay datafeed webhook.
 *
 * Best practice:
 * - verify integrity (SecureHash)
 * - persist to an inbox table for idempotency
 * - enqueue async processing and return 2xx quickly
 */
Deno.serve((req) =>
  withRequestContext('asiapay-notify', req, async (ctx) => {

    try {
      if (req.method !== 'POST') {
        emitMetricBestEffort(ctx, { event_type: 'metric.webhook.ignored', payload: { provider_code: 'asiapay', reason: 'method' } });
        return errorJson('Method not allowed', 405, 'METHOD_NOT_ALLOWED', undefined, ctx.headers);
      }

      // Optional timestamp-based replay guard (best-effort; only enforced if header is present).
      const tsGuard = requireFreshWebhookTimestamp(req, ctx.headers);
      if (tsGuard) {
        emitMetricBestEffort(ctx, { event_type: 'metric.webhook.ignored', payload: { provider_code: 'asiapay', reason: 'stale_timestamp' } });
        return tsGuard;
      }

      // PayDollar datafeed is typically application/x-www-form-urlencoded.
      const bodyText = await req.text();
      const params = new URLSearchParams(bodyText);

      const src = params.get('src') ?? params.get('Src') ?? '';
      const prc = params.get('prc') ?? params.get('Prc') ?? '';
      const successCode = params.get('successcode') ?? params.get('SuccessCode') ?? params.get('successCode') ?? '';

      // Merchant reference / order reference.
      const ref =
        params.get('Ref') ??
        params.get('ref') ??
        params.get('orderRef') ??
        params.get('OrderRef') ??
        params.get('MerchantRef') ??
        '';

      const payRef = params.get('PayRef') ?? params.get('payRef') ?? params.get('payref') ?? '';
      const curr = params.get('Curr') ?? params.get('curr') ?? params.get('currCode') ?? params.get('CurrCode') ?? '';
      const amt = params.get('Amt') ?? params.get('amt') ?? params.get('amount') ?? params.get('Amount') ?? '';
      const payerAuth = params.get('payerAuth') ?? params.get('PayerAuth') ?? params.get('payerauth') ?? '';
      const secureHash = (params.get('secureHash') ?? params.get('SecureHash') ?? '').trim();
      const secureHashType = (params.get('secureHashType') ?? params.get('SecureHashType') ?? 'sha1').toLowerCase();

      // If the provider is disabled/misconfigured, respond OK (avoid retries) without accepting work.
      const paymentsCfg = getPaymentsPublicConfig();
      const provider = findProvider(paymentsCfg, 'asiapay');
      if (!provider || !provider.enabled || provider.kind !== 'asiapay') {
        emitMetricBestEffort(ctx, { event_type: 'metric.webhook.ignored', payload: { provider_code: 'asiapay', reason: 'provider_disabled_or_misconfigured' } });
        return okText();
      }

      // We expect ref to be our topup_intents.id (uuid). If missing/invalid, ack and ignore.
      if (!ref || !isUuid(ref)) {
        emitMetricBestEffort(ctx, { event_type: 'metric.webhook.ignored', payload: { provider_code: 'asiapay', reason: 'invalid_ref' } });
        return okText();
      }

      ctx.setCorrelationId(ref);

      // Verify SecureHash.
      const secret = String(Deno.env.get('ASIAPAY_SECURE_HASH_SECRET') ?? '').trim();
      const allowInsecure = String(Deno.env.get('ASIAPAY_ALLOW_INSECURE_WEBHOOKS') ?? '').toLowerCase() === 'true';

      if (allowInsecure && isProduction()) {
        emitMetricBestEffort(ctx, { event_type: 'metric.webhook.internal_error', level: 'error', payload: { provider_code: 'asiapay', reason: 'insecure_disabled_prod' } });
        return errorJson('Insecure webhook mode is disabled in production', 500, 'INSECURE_WEBHOOKS_DISABLED', undefined, ctx.headers);
      }

      if (!secret && !allowInsecure) {
        emitMetricBestEffort(ctx, { event_type: 'metric.webhook.internal_error', level: 'error', payload: { provider_code: 'asiapay', reason: 'missing_secret' } });
        return errorJson('ASIAPAY_SECURE_HASH_SECRET is not configured', 500, 'CONFIG_ERROR', undefined, ctx.headers);
      }

      if (secret) {
        if (!secureHash) {
          emitMetricBestEffort(ctx, { event_type: 'metric.webhook.auth_fail', level: 'warn', payload: { provider_code: 'asiapay', reason: 'missing_signature' } });
          return errorJson('Missing secureHash', 401, 'MISSING_SIGNATURE', undefined, ctx.headers);
        }

        const algo = secureHashType === 'sha256' ? ('SHA-256' as const) : ('SHA-1' as const);
        // Verify data string = Src|Prc|SuccessCode|MerchantRef|PayRef|Curr|Amt|payerAuth|Secret
        const verifyStr = `${src}|${prc}|${successCode}|${ref}|${payRef}|${curr}|${amt}|${payerAuth}|${secret}`;
        const expected = await shaHex(algo, verifyStr);
        if (!timingSafeEqual(expected.toLowerCase(), secureHash.toLowerCase())) {
          emitMetricBestEffort(ctx, { event_type: 'metric.webhook.auth_fail', level: 'warn', payload: { provider_code: 'asiapay', reason: 'invalid_signature' } });
          return errorJson('Invalid secureHash', 401, 'INVALID_SIGNATURE', undefined, ctx.headers);
        }
      }

      const service = createServiceClient();

      // Stable provider event id.
      const stableBodyHash = await shaHex('SHA-256', bodyText);
      const providerEventId = `datafeed:${ref}:${payRef || prc || ''}:${successCode || 'unknown'}:${stableBodyHash.slice(0, 12)}`;
      const payload = Object.fromEntries(params.entries());

      // Durable inbox (idempotent).
      const stored = await storeProviderEvent(service, 'asiapay', providerEventId, payload);
      if (!stored.inserted) {
        emitMetricBestEffort(ctx, { event_type: 'metric.webhook.duplicate', level: 'warn', payload: { provider_code: 'asiapay' } });
      }

      // Queue async processing.
      await enqueueWebhookJob(service, {
        providerCode: 'asiapay',
        providerEventId,
        providerEventPk: stored.id,
        jobKind: 'topup_webhook',
        correlationId: ref,
      });

      // Optional best-effort immediate processing.
      const scheduled = tryWaitUntil(runWebhookJobs(service, { limit: 1, hardMax: 1 }));
      if (!scheduled && !isProduction()) await runWebhookJobs(service, { limit: 1, hardMax: 1 });

      emitMetricBestEffort(ctx, { event_type: 'metric.webhook.accepted', payload: { provider_code: 'asiapay' } });
      return okText();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      emitMetricBestEffort(ctx, { event_type: 'metric.webhook.internal_error', level: 'error', payload: { provider_code: 'asiapay', error: msg } });
      return errorJson(msg, 500, 'INTERNAL_ERROR', undefined, ctx.headers);
    }
  })
);
