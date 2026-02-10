import { createServiceClient } from '../_shared/supabase.ts';
import { errorJson, json } from '../_shared/json.ts';
import { getZaincashV2Config } from '../_shared/zaincashV2.ts';
import { shaHex, verifyJwtHS256 } from '../_shared/crypto.ts';
import { withRequestContext } from '../_shared/requestContext.ts';
import { emitMetricBestEffort } from '../_shared/metrics.ts';
import { enqueueWebhookJob, runWebhookJobs } from '../_shared/webhookJobs.ts';
import { tryWaitUntil } from '../_shared/background.ts';
import { storeProviderEvent } from '../_shared/providerEvents.ts';
import { isProduction } from '../_shared/env.ts';
import { requireFreshWebhookTimestamp } from '../_shared/webhookReplay.ts';

function isUuid(v: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
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

  return await withRequestContext('zaincash-withdraw-webhook', req, async (ctx) => {
    try {
      if (req.method !== 'POST') {
        emitMetricBestEffort(ctx, { event_type: 'metric.webhook.ignored', payload: { provider_code: 'zaincash', kind: 'withdraw', reason: 'method' } });
        return json({ ok: true, ignored: true }, 200, ctx.headers);
      }

      // Optional timestamp-based replay guard (best-effort; only enforced if header is present).
      const tsGuard = requireFreshWebhookTimestamp(req, ctx.headers);
      if (tsGuard) {
        emitMetricBestEffort(ctx, { event_type: 'metric.webhook.ignored', payload: { provider_code: 'zaincash', kind: 'withdraw', reason: 'stale_timestamp' } });
        return tsGuard;
      }

      const body = await req.json().catch(() => null);
      const token = String(pickFirst((body as any)?.webhook_token, (body as any)?.webhookToken, (body as any)?.token) ?? '').trim();

      if (!token) {
        emitMetricBestEffort(ctx, { event_type: 'metric.webhook.ignored', payload: { provider_code: 'zaincash', kind: 'withdraw', reason: 'missing_webhook_token' } });
        return json({ ok: true, ignored: true, reason: 'missing_webhook_token' }, 200, ctx.headers);
      }

      const cfg = getZaincashV2Config();

      // Webhook token is a JWT signed with ApiKey (HS256).
      const claims = await verifyJwtHS256(token, cfg.apiKey);
      if (!claims) {
        emitMetricBestEffort(ctx, { event_type: 'metric.webhook.auth_fail', level: 'warn', payload: { provider_code: 'zaincash', kind: 'withdraw', reason: 'invalid_token' } });
        return errorJson('Invalid webhook token', 401, 'INVALID_TOKEN', undefined, ctx.headers);
      }

      const eventId = String(pickFirst((claims as any)?.eventId, (claims as any)?.event_id, (claims as any)?.jti, (claims as any)?.id) ?? '').trim();

      // We expect externalReferenceId to be wallet_withdraw_requests.id (UUID)
      const withdrawId = String(
        pickFirst(
          (claims as any)?.externalReferenceId,
          (claims as any)?.external_reference_id,
          (claims as any)?.merchantReference,
          (claims as any)?.orderId,
          (claims as any)?.order_id,
        ) ?? '',
      ).trim();

      if (withdrawId && isUuid(withdrawId)) {
        ctx.setCorrelationId(withdrawId);
      }

      const service = createServiceClient();

      const stableEventId = eventId || (await shaHex('SHA-256', token));
      const providerEventId = `payout:${stableEventId}`;

      // Durable inbox (idempotent). Store only after token verification.
      const stored = await storeProviderEvent(service, 'zaincash', providerEventId, { claims, raw: body });

      if (!withdrawId || !isUuid(withdrawId)) {
        emitMetricBestEffort(ctx, { event_type: 'metric.webhook.ignored', payload: { provider_code: 'zaincash', kind: 'withdraw', reason: 'missing_or_invalid_externalReferenceId' } });
        return json({ ok: true, ignored: true, reason: 'missing_or_invalid_externalReferenceId', event_id: stableEventId || null }, 200, ctx.headers);
      }

      if (!stored.inserted) {
        emitMetricBestEffort(ctx, { event_type: 'metric.webhook.duplicate', level: 'warn', payload: { provider_code: 'zaincash', kind: 'withdraw' } });
      }

      // Queue async processing (retries/backoff handled by the worker).
      const { queued } = await enqueueWebhookJob(service, {
        providerCode: 'zaincash',
        providerEventId: providerEventId,
        providerEventPk: stored.id,
        jobKind: 'withdraw_webhook',
        correlationId: withdrawId,
      });

      // Optional best-effort immediate processing.
      const scheduled = tryWaitUntil(runWebhookJobs(service, { limit: 1, hardMax: 1 }));
      if (!scheduled && !isProduction()) await runWebhookJobs(service, { limit: 1, hardMax: 1 });

      emitMetricBestEffort(ctx, { event_type: 'metric.webhook.accepted', payload: { provider_code: 'zaincash', kind: 'withdraw', queued } });

      return json(
        { ok: true, accepted: true, queued, duplicate: !stored.inserted, withdraw_request_id: withdrawId, event_id: stableEventId || null },
        200,
        ctx.headers,
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      emitMetricBestEffort(ctx, { event_type: 'metric.webhook.internal_error', level: 'error', payload: { provider_code: 'zaincash', kind: 'withdraw', error: msg } });
      return errorJson(msg, 500, 'INTERNAL_ERROR', undefined, ctx.headers);
    }
  });
});
