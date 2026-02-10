import { createServiceClient } from '../_shared/supabase.ts';
import { errorJson, json } from '../_shared/json.ts';
import { shaHex, timingSafeEqual } from '../_shared/crypto.ts';
import { withRequestContext } from '../_shared/requestContext.ts';
import { emitMetricBestEffort } from '../_shared/metrics.ts';
import { isProduction } from '../_shared/env.ts';
import { enqueueWebhookJob, runWebhookJobs } from '../_shared/webhookJobs.ts';
import { tryWaitUntil } from '../_shared/background.ts';
import { storeProviderEvent } from '../_shared/providerEvents.ts';
import { requireFreshWebhookTimestamp } from '../_shared/webhookReplay.ts';

function isUuid(v: unknown): v is string {
  return typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
}

Deno.serve(async (req) => {
  // verify_jwt=false in config.toml (webhook endpoint)

  return await withRequestContext('asiapay-withdraw-webhook', req, async (ctx) => {
    try {
      if (req.method !== 'POST') {
        emitMetricBestEffort(ctx, { event_type: 'metric.webhook.ignored', payload: { provider_code: 'asiapay', kind: 'withdraw', reason: 'method' } });
        return errorJson('Method not allowed', 405, 'METHOD_NOT_ALLOWED', undefined, ctx.headers);
      }

      // Optional timestamp-based replay guard (best-effort; only enforced if header is present).
      const tsGuard = requireFreshWebhookTimestamp(req, ctx.headers);
      if (tsGuard) {
        emitMetricBestEffort(ctx, { event_type: 'metric.webhook.ignored', payload: { provider_code: 'asiapay', kind: 'withdraw', reason: 'stale_timestamp' } });
        return tsGuard;
      }

      const service = createServiceClient();

      const bodyText = await req.text();
      const params = new URLSearchParams(bodyText);

      const src = params.get('src') ?? params.get('Src') ?? '';
      const prc = params.get('prc') ?? params.get('Prc') ?? '';
      const successCode = params.get('successcode') ?? params.get('SuccessCode') ?? params.get('successCode') ?? '';
      const ref =
        params.get('Ref') ??
        params.get('ref') ??
        params.get('orderRef') ??
        params.get('OrderRef') ??
        params.get('merchantRef') ??
        params.get('MerchantRef') ??
        '';

      const payRef = params.get('PayRef') ?? params.get('payRef') ?? '';
      const curr = params.get('Cur') ?? params.get('cur') ?? '';
      const amt = params.get('Amt') ?? params.get('amt') ?? '';
      const payerAuth = params.get('PayerAuth') ?? params.get('payerauth') ?? '';
      const secureHash = (params.get('secureHash') ?? params.get('SecureHash') ?? '').trim();
      const secureHashType = (params.get('secureHashType') ?? params.get('SecureHashType') ?? 'sha1').toLowerCase();

      if (!isUuid(ref)) {
        emitMetricBestEffort(ctx, { event_type: 'metric.webhook.ignored', payload: { provider_code: 'asiapay', kind: 'withdraw', reason: 'invalid_ref' } });
        return json({ ok: true, ignored: true, reason: 'invalid_ref' }, 200, ctx.headers);
      }

      ctx.setCorrelationId(ref);

      // Verify SecureHash if secret configured
      const secret = String(
        Deno.env.get('ASIAPAY_PAYOUT_SECURE_HASH_SECRET') ?? Deno.env.get('ASIAPAY_SECURE_HASH_SECRET') ?? '',
      ).trim();
      const allowInsecure = String(Deno.env.get('ASIAPAY_ALLOW_INSECURE_WEBHOOKS') ?? '').toLowerCase() === 'true';

      if (allowInsecure && isProduction()) {
        emitMetricBestEffort(ctx, { event_type: 'metric.webhook.internal_error', level: 'error', payload: { provider_code: 'asiapay', kind: 'withdraw', reason: 'insecure_disabled_prod' } });
        return errorJson('Insecure webhook mode is disabled in production', 500, 'INSECURE_WEBHOOKS_DISABLED', undefined, ctx.headers);
      }

      if (!secret && !allowInsecure) {
        emitMetricBestEffort(ctx, { event_type: 'metric.webhook.internal_error', level: 'error', payload: { provider_code: 'asiapay', kind: 'withdraw', reason: 'missing_secret' } });
        return errorJson('ASIAPAY_PAYOUT_SECURE_HASH_SECRET (or ASIAPAY_SECURE_HASH_SECRET) not configured', 500, 'CONFIG_ERROR', undefined, ctx.headers);
      }

      if (secret) {
        if (!secureHash) {
          emitMetricBestEffort(ctx, { event_type: 'metric.webhook.auth_fail', level: 'warn', payload: { provider_code: 'asiapay', kind: 'withdraw', reason: 'missing_signature' } });
          return errorJson('Missing secureHash', 401, 'MISSING_SIGNATURE', undefined, ctx.headers);
        }

        const algo = secureHashType === 'sha256' ? ('SHA-256' as const) : ('SHA-1' as const);

        // Verify data string = Src|Prc|SuccessCode|MerchantRef|PayRef|Curr|Amt|payerAuth|Secret
        const dataStr = `${src}|${prc}|${successCode}|${ref}|${payRef}|${curr}|${amt}|${payerAuth}|${secret}`;
        const expected = await shaHex(algo, dataStr);

        if (!timingSafeEqual(secureHash.toLowerCase(), expected.toLowerCase())) {
          emitMetricBestEffort(ctx, { event_type: 'metric.webhook.auth_fail', level: 'warn', payload: { provider_code: 'asiapay', kind: 'withdraw', reason: 'invalid_signature' } });
          return errorJson('Invalid secureHash', 401, 'INVALID_SIGNATURE', undefined, ctx.headers);
        }
      } else {
        ctx.warn('webhook.insecure_mode_enabled', { env: isProduction() ? 'production' : 'non-production' });
      }

      const providerEventId = `payout:${ref}:${payRef || prc || ''}:${successCode || 'unknown'}`;
      const payload = Object.fromEntries(params.entries());

      // Durable inbox (idempotent).
      const stored = await storeProviderEvent(service, 'asiapay', providerEventId, payload);
      if (!stored.inserted) {
        emitMetricBestEffort(ctx, { event_type: 'metric.webhook.duplicate', level: 'warn', payload: { provider_code: 'asiapay', kind: 'withdraw' } });
      }

      // Queue async processing (retries/backoff handled by the worker).
      const { queued } = await enqueueWebhookJob(service, {
        providerCode: 'asiapay',
        providerEventId: providerEventId,
        providerEventPk: stored.id,
        jobKind: 'withdraw_webhook',
        correlationId: ref,
      });

      // Optional best-effort immediate processing.
      const scheduled = tryWaitUntil(runWebhookJobs(service, { limit: 1, hardMax: 1 }));
      if (!scheduled && !isProduction()) await runWebhookJobs(service, { limit: 1, hardMax: 1 });

      emitMetricBestEffort(ctx, { event_type: 'metric.webhook.accepted', payload: { provider_code: 'asiapay', kind: 'withdraw', queued } });

      return json({ ok: true, accepted: true, queued, duplicate: !stored.inserted, withdraw_request_id: ref }, 200, ctx.headers);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      emitMetricBestEffort(ctx, { event_type: 'metric.webhook.internal_error', level: 'error', payload: { provider_code: 'asiapay', kind: 'withdraw', error: msg } });
      return errorJson(msg, 500, 'INTERNAL_ERROR', undefined, ctx.headers);
    }
  });
});
