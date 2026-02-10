import { errorJson, json } from '../_shared/json.ts';
import { requireCronSecret } from '../_shared/cronAuth.ts';
import { logAppEvent } from '../_shared/log.ts';
import { withRequestContext } from '../_shared/requestContext.ts';
import { createServiceClient } from '../_shared/supabase.ts';
import { computeBackoffSeconds, normalizePhone, sendContactMessage } from '../_shared/contactProviders.ts';

type OutboxRow = {
  id: string;
  user_id: string;
  contact_id: string;
  sos_event_id: string;
  ride_id: string | null;
  channel: string;
  to_phone: string;
  payload: any;
  attempts: number;
};

function asStr(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

function buildMessage(row: OutboxRow) {
  const p = row.payload ?? {};
  const shareUrl = asStr(p.share_url);
  const expiresAt = asStr(p.expires_at);

  // Keep messages short: SMS friendly.
  const headerEn = 'RideIQ Safety Alert';
  const headerAr = 'تنبيه أمان RideIQ';

  const bodyEn = [
    'Your contact shared a private live trip link.',
    shareUrl ? `Open: ${shareUrl}` : 'Open the RideIQ app to view the shared trip link.',
    expiresAt ? `Expires: ${expiresAt}` : null,
    'If you believe this is an emergency, contact local services.',
  ]
    .filter(Boolean)
    .join('\n');

  const bodyAr = [
    'قام جهة اتصال بمشاركة رابط تتبّع مباشر وخاص للرحلة.',
    shareUrl ? `افتح: ${shareUrl}` : 'افتح تطبيق RideIQ لعرض رابط التتبّع.',
    expiresAt ? `ينتهي: ${expiresAt}` : null,
    'إذا كانت هناك حالة طارئة، اتصل بخدمات الطوارئ المحلية.',
  ]
    .filter(Boolean)
    .join('\n');

  return `${headerEn}\n${bodyEn}\n\n${headerAr}\n${bodyAr}`;
}

function normalizeChannel(v?: string): 'sms' | 'webhook' {
  const s = String(v ?? '').toLowerCase().trim();
  return s === 'webhook' ? 'webhook' : 'sms';
}

Deno.serve((req) =>
  withRequestContext('trusted-contacts-dispatch', req, async () => {

    const authErr = requireCronSecret(req);
    if (authErr) return authErr;

    try {
      const url = new URL(req.url);
      const limit = Math.max(1, Math.min(200, Number(url.searchParams.get('limit') ?? '50')));

      const service = createServiceClient();

      const { data: rows, error: claimErr } = await service.rpc('trusted_contact_outbox_claim', { p_limit: limit });
      if (claimErr) return errorJson(claimErr.message, 500, 'DB_ERROR');

      const items = (rows ?? []) as OutboxRow[];
      if (!items.length) {
        return json({ ok: true, processed: 0 });
      }

      let sent = 0;
      let failed = 0;
      let retried = 0;
      let skipped = 0;

      for (const it of items) {
        const message = buildMessage(it);
        const to = normalizePhone(it.to_phone);
        const channel = normalizeChannel(it.channel);

        try {
          const res = await sendContactMessage({
            channel,
            to,
            message,
            meta: {
              outbox_id: it.id,
              user_id: it.user_id,
              contact_id: it.contact_id,
              sos_event_id: it.sos_event_id,
              ride_id: it.ride_id,
              type: it.payload?.type ?? 'sos_share',
            },
          });

          if (res.ok) {
            await service.rpc('trusted_contact_outbox_mark_v2', {
              p_outbox_id: it.id,
              p_result: 'sent',
              p_error: null,
              p_retry_in_seconds: null,
              p_http_status: res.status,
              p_provider_message_id: res.providerMessageId ?? null,
              p_response: res.responseText ?? null,
            });
            sent++;

            await logAppEvent({
              event_type: 'trusted_contact_notified',
              actor_type: 'system',
              actor_id: null,
              ride_id: it.ride_id ?? null,
              payload: {
                outbox_id: it.id,
                contact_id: it.contact_id,
                channel: it.channel,
                to_phone_last4: String(it.to_phone ?? '').slice(-4),
                sos_event_id: it.sos_event_id,
                provider_message_id: res.providerMessageId ?? null,
                provider_status: res.status,
              },
            });

            continue;
          }

          const retrySeconds = computeBackoffSeconds(Math.max(0, it.attempts));
          const errMsg = `provider_http_${res.status}: ${(res.responseText ?? '').slice(0, 300)}`;

          if (res.status === 0 && (res.responseText ?? '').includes('not configured')) {
            // configuration issue: skip to prevent infinite retries
            await service.rpc('trusted_contact_outbox_mark_v2', {
              p_outbox_id: it.id,
              p_result: 'skipped',
              p_error: errMsg,
              p_retry_in_seconds: null,
              p_http_status: null,
              p_provider_message_id: null,
              p_response: res.responseText ?? null,
            });
            skipped++;
            continue;
          }

          if (res.retryable) {
            await service.rpc('trusted_contact_outbox_mark_v2', {
              p_outbox_id: it.id,
              p_result: 'retry',
              p_error: errMsg,
              p_retry_in_seconds: retrySeconds,
              p_http_status: res.status,
              p_provider_message_id: res.providerMessageId ?? null,
              p_response: res.responseText ?? null,
            });
            retried++;
          } else {
            await service.rpc('trusted_contact_outbox_mark_v2', {
              p_outbox_id: it.id,
              p_result: 'failed',
              p_error: errMsg,
              p_retry_in_seconds: null,
              p_http_status: res.status,
              p_provider_message_id: res.providerMessageId ?? null,
              p_response: res.responseText ?? null,
            });
            failed++;
          }
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          const retrySeconds = computeBackoffSeconds(Math.max(0, it.attempts));
          await service.rpc('trusted_contact_outbox_mark_v2', {
            p_outbox_id: it.id,
            p_result: 'retry',
            p_error: msg,
            p_retry_in_seconds: retrySeconds,
            p_http_status: null,
            p_provider_message_id: null,
            p_response: null,
          });
          retried++;
        }
      }

      return json({ ok: true, processed: items.length, sent, failed, retried, skipped });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return errorJson(msg, 500, 'INTERNAL');
    }
  }),
);
