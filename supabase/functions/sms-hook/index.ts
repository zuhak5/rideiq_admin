import { errorJson, json } from '../_shared/json.ts';
import { withRequestContext } from '../_shared/requestContext.ts';
import { createServiceClient } from '../_shared/supabase.ts';
import { envTrim } from '../_shared/config.ts';
import { normalizeIraqPhoneE164, PhoneNormalizationError } from '../_shared/phone.ts';
import { sendOtpWithFallback } from '../_shared/smsProviders.ts';
import { consumeRateLimit } from '../_shared/rateLimit.ts';
import { logAppEvent } from '../_shared/log.ts';

import { Webhook } from 'npm:standardwebhooks@1.0.0';

type SendSmsHookEvent = {
  user?: { id?: string; phone?: string };
  sms?: { otp?: string };
};

function decodeWebhookSecret(secret: string): string {
  const s = secret.trim();

  // Supabase dashboard/Auth Hooks secrets are typically formatted like: "v1,whsec_<base64_secret>"
  // standardwebhooks expects the raw base64 secret (no version prefix and no "whsec_" prefix).
  const withoutVersion = s.startsWith('v1,') ? s.slice('v1,'.length) : s;
  return withoutVersion.startsWith('whsec_')
    ? withoutVersion.slice('whsec_'.length)
    : withoutVersion;
}


function pickHeaders(req: Request): Record<string, string> {
  return {
    'webhook-id': req.headers.get('webhook-id') ?? '',
    'webhook-timestamp': req.headers.get('webhook-timestamp') ?? '',
    'webhook-signature': req.headers.get('webhook-signature') ?? '',
  };
}

async function alreadyProcessed(service: ReturnType<typeof createServiceClient>, webhookId: string): Promise<boolean> {
  const { data, error } = await service
    .from('auth_sms_hook_events')
    .select('webhook_id')
    .eq('webhook_id', webhookId)
    .maybeSingle();
  if (error) return false;
  return !!data;
}

async function markProcessed(service: ReturnType<typeof createServiceClient>, row: {
  webhook_id: string;
  user_id?: string | null;
  phone_e164?: string | null;
  otp_hash?: string | null;
  provider_used?: string | null;
  status: 'sent' | 'failed';
  error?: string | null;
}) {
  // We store only a hash of the OTP for audit/debug without leaking OTP in logs/DB.
  const { error } = await service.from('auth_sms_hook_events').insert(row);
  if (error) {
    console.warn('[sms-hook] failed to insert auth_sms_hook_events row', error);
  }
}

async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

Deno.serve((req) => withRequestContext('sms-hook', req, async (ctx) => {
  if (req.method !== 'POST') return errorJson('Method not allowed', 405);

  const bodyText = await req.text();

  // Verify signature if configured
  // Prefer AUTH_HOOK_SECRET, but allow the more explicit legacy/alt name too.
  const hookSecret = envTrim('AUTH_HOOK_SECRET') || envTrim('AUTH_HOOK_SEND_SMS_SECRET');
  if (hookSecret) {
    try {
      const wh = new Webhook(decodeWebhookSecret(hookSecret));
      wh.verify(bodyText, pickHeaders(req));
    } catch (e) {
      return errorJson(`Invalid webhook signature`, 401, 'WEBHOOK_SIGNATURE');
    }
  } else {
    console.warn(
      '[sms-hook] AUTH_HOOK_SECRET (or AUTH_HOOK_SEND_SMS_SECRET) is not set; signature verification is disabled.'
    );
  }

  let payload: SendSmsHookEvent;
  try {
    payload = JSON.parse(bodyText);
  } catch {
    return errorJson('Invalid JSON payload', 400, 'BAD_JSON');
  }

  const userId = payload?.user?.id ?? null;
  const rawPhone = payload?.user?.phone ?? '';
  const otp = payload?.sms?.otp ?? '';

  if (!rawPhone || !otp) return errorJson('Missing phone or otp', 400, 'MISSING_FIELDS');

  let phoneE164: string;
  try {
    phoneE164 = normalizeIraqPhoneE164(rawPhone);
  } catch (e) {
    const msg = e instanceof PhoneNormalizationError ? e.message : 'Invalid phone';
    return errorJson(msg, 400, 'INVALID_PHONE');
  }

  const webhookId = req.headers.get('webhook-id') ?? '';
  const service = createServiceClient();

  // Idempotency: Standard Webhooks includes webhook-id; treat it as a unique event id.
  if (webhookId) {
    const processed = await alreadyProcessed(service, webhookId);
    if (processed) {
      return json({ ok: true, deduped: true });
    }
  }

  // Rate limit by phone (fail-open handled in consumeRateLimit)
  const rl = await consumeRateLimit({
    key: `auth_sms:${phoneE164}`,
    windowSeconds: 15 * 60,
    limit: 5,
  });
  if (!rl.allowed) {
    if (webhookId) {
      await markProcessed(service, {
        webhook_id: webhookId,
        user_id: userId,
        phone_e164: phoneE164,
        otp_hash: await sha256Hex(`${phoneE164}:${otp}`),
        provider_used: null,
        status: 'failed',
        error: 'RATE_LIMIT',
      });
    }
    return errorJson('Too many OTP requests. Try again later.', 429, 'RATE_LIMIT');
  }

  const sendRes = await sendOtpWithFallback({ phone: phoneE164, otp });

  await logAppEvent({
    event_type: 'auth_send_sms_hook',
    actor_id: userId ?? undefined,
    actor_type: 'system',
    payload: {
      phone: phoneE164,
      provider: sendRes.provider,
      ok: sendRes.ok,
      error: sendRes.ok ? null : sendRes.error,
    },
  });

  if (webhookId) {
    await markProcessed(service, {
      webhook_id: webhookId,
      user_id: userId,
      phone_e164: phoneE164,
      otp_hash: await sha256Hex(`${phoneE164}:${otp}`),
      provider_used: sendRes.provider,
      status: sendRes.ok ? 'sent' : 'failed',
      error: sendRes.ok ? null : (sendRes.error ?? 'SEND_FAILED'),
    });
  }

  if (!sendRes.ok) {
    // Non-2xx => Supabase may retry webhook delivery.
    return errorJson('Failed to send OTP', 502, 'SMS_SEND_FAILED');
  }

  return json({ ok: true, provider: sendRes.provider });
}));
