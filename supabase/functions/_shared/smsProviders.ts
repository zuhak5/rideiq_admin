import { envTrim } from './config.ts';
import { normalizeIraqPhoneNoPlus, toIraqLocal07 } from './phone.ts';

export type SmsSendResult = {
  ok: boolean;
  provider: 'iraqisms' | 'otpiq' | 'bulksmsiraq';
  messageId?: string;
  raw?: unknown;
  error?: string;
};

function requiredEnv(key: string): string {
  const v = envTrim(key);
  if (!v) throw new Error(`Missing required env var: ${key}`);
  return v;
}

async function fetchWithTimeout(input: RequestInfo | URL, init: RequestInit & { timeoutMs?: number } = {}) {
  const { timeoutMs = 10_000, ...rest } = init;
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...rest, signal: controller.signal });
  } finally {
    clearTimeout(id);
  }
}

async function safeJson(text: string): Promise<unknown> {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export async function sendViaIraqISMS(params: { phone: string; message: string; timeoutMs?: number }): Promise<SmsSendResult> {
  try {
    const apiKey = requiredEnv('IRAQISMS_API_KEY');
    const phoneNoPlus = normalizeIraqPhoneNoPlus(params.phone); // 9647...

    const url = new URL('https://iraqisms.com/api/v1/sms/send/get');
    const sendBy = envTrim('IRAQISMS_SEND_BY') || '1';
    // Docs show these fields as required: "message", "mobile number". We use "mobile_number".
    url.searchParams.set('mobile_number', phoneNoPlus);
    url.searchParams.set('message', params.message);
    url.searchParams.set('send_by', sendBy);

    const res = await fetchWithTimeout(url, {
      method: 'GET',
      headers: {
        apikey: apiKey,
        accept: 'application/json',
      },
      timeoutMs: params.timeoutMs ?? 10_000,
    });

    const data = await safeJson(await res.text());
    if (!res.ok) return { ok: false, provider: 'iraqisms', raw: data, error: `HTTP ${res.status}` };

    const success = typeof data === 'object' && data !== null && (data as any).success === true;
    return { ok: success, provider: 'iraqisms', raw: data, messageId: (data as any)?.smsId ?? undefined, error: success ? undefined : 'Provider returned success=false' };
  } catch (e) {
    return { ok: false, provider: 'iraqisms', error: e instanceof Error ? e.message : String(e) };
  }
}

export async function sendViaOTPIQ(params: { phone: string; otp: string; provider?: string; senderId?: string; timeoutMs?: number }): Promise<SmsSendResult> {
  try {
    const apiKey = requiredEnv('OTPIQ_API_KEY');
    const phoneNoPlus = normalizeIraqPhoneNoPlus(params.phone); // required by OTPIQ

    const res = await fetchWithTimeout('https://api.otpiq.com/api/sms', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify({
        phoneNumber: phoneNoPlus,
        smsType: 'verification',
        verificationCode: params.otp,
        provider: params.provider ?? 'sms',
        ...(params.senderId ? { senderId: params.senderId } : {}),
      }),
      timeoutMs: params.timeoutMs ?? 10_000,
    });

    const data = await safeJson(await res.text());
    if (!res.ok) return { ok: false, provider: 'otpiq', raw: data, error: `HTTP ${res.status}` };

    // Docs show: { message: "SMS task created successfully", smsId: "..." }
    const ok = typeof data === 'object' && data !== null && typeof (data as any).smsId === 'string';
    return { ok, provider: 'otpiq', raw: data, messageId: (data as any)?.smsId ?? undefined, error: ok ? undefined : 'Unexpected response' };
  } catch (e) {
    return { ok: false, provider: 'otpiq', error: e instanceof Error ? e.message : String(e) };
  }
}

export async function sendViaBulkSMSIraq(params: { phone: string; message: string; timeoutMs?: number }): Promise<SmsSendResult> {
  try {
    const apiKey = requiredEnv('BULKSMSIRAQ_API_KEY');
    const senderId = requiredEnv('BULKSMSIRAQ_SENDER_ID');
    const recipient = toIraqLocal07(params.phone);

    const res = await fetchWithTimeout('https://gateway.standingtech.com/api/v4/sms/send', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify({
        recipient,
        sender_id: senderId,
        type: 'text',
        message: params.message,
      }),
      timeoutMs: params.timeoutMs ?? 10_000,
    });

    const data = await safeJson(await res.text());
    if (!res.ok) return { ok: false, provider: 'bulksmsiraq', raw: data, error: `HTTP ${res.status}` };

    const ok = typeof data === 'object' && data !== null && (data as any).status === 'success';
    return { ok, provider: 'bulksmsiraq', raw: data, messageId: (data as any)?.message_id ?? undefined, error: ok ? undefined : 'Provider returned status!=success' };
  } catch (e) {
    return { ok: false, provider: 'bulksmsiraq', error: e instanceof Error ? e.message : String(e) };
  }
}

export async function sendOtpWithFallback(params: { phone: string; otp: string; appName?: string }) {
  // JS/TS forbids mixing `??` with `||`/`&&` without parentheses.
  // We intentionally use `||` so empty strings fall back to the default.
  const appName = (params.appName ?? envTrim('OTP_APP_NAME')) || 'RideIQ';
  const message = `${appName} verification code: ${params.otp}`;

  const primary = await sendViaIraqISMS({ phone: params.phone, message });
  if (primary.ok) return primary;

  const fallback = await sendViaOTPIQ({
    phone: params.phone,
    otp: params.otp,
    provider: envTrim('OTPIQ_PROVIDER') || 'sms',
    senderId: envTrim('OTPIQ_SENDER_ID') || undefined,
  });
  if (fallback.ok) return fallback;

  const last = await sendViaBulkSMSIraq({ phone: params.phone, message });
  return last.ok
    ? last
    : { ok: false, provider: 'bulksmsiraq', raw: { primary, fallback, last }, error: 'All providers failed' };
}
