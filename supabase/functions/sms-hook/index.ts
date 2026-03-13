import { errorJson, json } from "../_shared/json.ts";
import {
  envTrim,
  SUPABASE_SERVICE_ROLE_KEY,
  SUPABASE_URL,
} from "../_shared/config.ts";
import {
  normalizeIraqPhoneE164,
  PhoneNormalizationError,
} from "../_shared/phone.ts";
import {
  buildOtpMessage,
  OTP_PROVIDER_ORDER,
  resolveProviderTimeoutMs,
  sendViaBulkSMSIraq,
  sendViaOTPIQ,
  type SmsProvider,
  type SmsSendResult,
} from "../_shared/smsProviders.ts";
import { maskPhoneForLogs } from "../_shared/privacy.ts";

type SendSmsHookEvent = {
  user?: { id?: string; phone?: string };
  sms?: { otp?: string };
};

type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  resetAt: string;
  degraded: boolean;
};

type ProviderHealthStatus = {
  available: boolean;
  disabled_until: string | null;
  consecutive_failures: number;
  last_http_status: number | null;
  last_error_code: string | null;
};

type ProviderAttemptRecord = {
  provider: SmsProvider;
  ok: boolean;
  http_status: number | null;
  provider_error_code: string | null;
  retryable: boolean;
  message_id: string | null;
  error: string | null;
  raw: unknown;
};

const DEFAULT_SMS_HOOK_TOTAL_TIMEOUT_MS = 3_600;
const DEFAULT_WEBHOOK_TOLERANCE_SECONDS = 300;
const DEFAULT_RPC_TIMEOUT_MS = 1_000;
const DEFAULT_RATE_LIMIT_WINDOW_SECONDS = 15 * 60;
const DEFAULT_RATE_LIMIT_LIMIT = 5;
const DEFAULT_PROVIDER_BASE_COOLDOWN_SECONDS = 30;
const MIN_SMS_ATTEMPT_TIMEOUT_MS = 250;
const SMS_TIMEOUT_SAFETY_MARGIN_MS = 150;

function parsePositiveIntEnv(key: string, fallback: number): number {
  const value = Number.parseInt(envTrim(key), 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function decodeWebhookSecret(secret: string): string {
  const s = secret.trim();
  const withoutVersion = s.startsWith("v1,") ? s.slice("v1,".length) : s;
  return withoutVersion.startsWith("whsec_")
    ? withoutVersion.slice("whsec_".length)
    : withoutVersion;
}

type WebhookHeaders = {
  id: string;
  timestamp: string;
  signature: string;
};

function readWebhookHeaders(req: Request): WebhookHeaders {
  return {
    id: req.headers.get("webhook-id")?.trim() ?? "",
    timestamp: req.headers.get("webhook-timestamp")?.trim() ?? "",
    signature: req.headers.get("webhook-signature")?.trim() ?? "",
  };
}

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) {
    return false;
  }
  let result = 0;
  for (let i = 0; i < a.length; i += 1) {
    result |= a[i] ^ b[i];
  }
  return result === 0;
}

async function verifyWebhookSignature(
  bodyText: string,
  headers: WebhookHeaders,
  encodedSecret: string,
): Promise<boolean> {
  if (!headers.id || !headers.timestamp || !headers.signature) {
    return false;
  }

  const timestamp = Number.parseInt(headers.timestamp, 10);
  if (!Number.isFinite(timestamp)) {
    return false;
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  if (
    Math.abs(nowSeconds - timestamp) > DEFAULT_WEBHOOK_TOLERANCE_SECONDS
  ) {
    return false;
  }

  const keyBytes = Uint8Array.from(
    atob(encodedSecret),
    (char) => char.charCodeAt(0),
  );
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );

  const signedContent = `${headers.id}.${headers.timestamp}.${bodyText}`;
  const signatureBuffer = await crypto.subtle.sign(
    "HMAC",
    cryptoKey,
    new TextEncoder().encode(signedContent),
  );
  const expectedSignature = Uint8Array.from(new Uint8Array(signatureBuffer));

  const candidates = headers.signature
    .split(" ")
    .map((value) => value.trim())
    .filter((value) => value.startsWith("v1,"))
    .map((value) => value.slice(3))
    .filter((value) => value.length > 0);

  for (const candidate of candidates) {
    const decodedCandidate = Uint8Array.from(
      atob(candidate),
      (char) => char.charCodeAt(0),
    );
    if (timingSafeEqual(expectedSignature, decodedCandidate)) {
      return true;
    }
  }

  return false;
}

function hasServiceCredentials(): boolean {
  return SUPABASE_URL.length > 0 && SUPABASE_SERVICE_ROLE_KEY.length > 0;
}

function serviceHeaders(extra: Record<string, string> = {}): Headers {
  return new Headers({
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    "content-type": "application/json",
    ...extra,
  });
}

async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit & { timeoutMs?: number } = {},
) {
  const { timeoutMs = 10_000, ...rest } = init;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...rest, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function safeJson(text: string): Promise<unknown> {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function serviceFetch(
  path: string,
  init: RequestInit = {},
  timeoutMs = parsePositiveIntEnv(
    "SMS_HOOK_RPC_TIMEOUT_MS",
    DEFAULT_RPC_TIMEOUT_MS,
  ),
): Promise<Response | null> {
  if (!hasServiceCredentials()) {
    return null;
  }

  const url = new URL(path, SUPABASE_URL);
  try {
    return await fetchWithTimeout(url, {
      ...init,
      headers: serviceHeaders(
        init.headers instanceof Headers
          ? Object.fromEntries(init.headers.entries())
          : (init.headers as Record<string, string> | undefined) ?? {},
      ),
      timeoutMs,
    });
  } catch {
    return null;
  }
}

async function consumeRateLimit(params: {
  key: string;
  windowSeconds: number;
  limit: number;
}): Promise<RateLimitResult> {
  const fallbackResetAt = new Date(Date.now() + params.windowSeconds * 1000)
    .toISOString();
  const response = await serviceFetch("/rest/v1/rpc/rate_limit_consume", {
    method: "POST",
    body: JSON.stringify({
      p_key: params.key,
      p_window_seconds: params.windowSeconds,
      p_limit: params.limit,
    }),
  });

  if (!response?.ok) {
    return {
      allowed: false,
      remaining: 0,
      resetAt: fallbackResetAt,
      degraded: true,
    };
  }

  const data = await response.json();
  const row = Array.isArray(data) ? data[0] : data;
  return {
    allowed: !!row?.allowed,
    remaining: Number(row?.remaining ?? 0),
    resetAt: String(row?.reset_at ?? fallbackResetAt),
    degraded: false,
  };
}

async function serviceRpc<T>(
  name: string,
  body: Record<string, unknown>,
): Promise<{ data: T | null; ok: boolean }> {
  const response = await serviceFetch(`/rest/v1/rpc/${name}`, {
    method: "POST",
    body: JSON.stringify(body),
  });
  if (!response?.ok) {
    return { data: null, ok: false };
  }
  const raw = await response.json();
  return { data: (Array.isArray(raw) ? raw[0] : raw) as T, ok: true };
}

async function claimWebhook(params: {
  webhookId: string;
  userId: string | null;
  phoneE164: string;
  processingTtlSeconds: number;
}) {
  const result = await serviceRpc<string>("auth_sms_hook_claim_v1", {
    p_webhook_id: params.webhookId,
    p_user_id: params.userId,
    p_phone_e164: params.phoneE164,
    p_processing_ttl_seconds: params.processingTtlSeconds,
  });
  return result.ok ? result.data : null;
}

async function completeWebhook(params: {
  webhookId: string;
  status: "sent" | "failed";
  providerUsed?: string | null;
  error?: string | null;
  finalHttpStatus?: number | null;
  finalErrorCode?: string | null;
  providerAttempts: ProviderAttemptRecord[];
}) {
  await serviceFetch("/rest/v1/rpc/auth_sms_hook_complete_v1", {
    method: "POST",
    body: JSON.stringify({
      p_webhook_id: params.webhookId,
      p_status: params.status,
      p_provider_used: params.providerUsed ?? null,
      p_error: params.error ?? null,
      p_final_http_status: params.finalHttpStatus ?? null,
      p_final_error_code: params.finalErrorCode ?? null,
      p_provider_attempts: params.providerAttempts,
      p_attempt_count: params.providerAttempts.length,
    }),
  });
}

async function providerHealthStatus(provider: SmsProvider) {
  const result = await serviceRpc<ProviderHealthStatus>(
    "auth_sms_provider_health_status_v1",
    { p_provider_code: provider },
  );
  return result.ok ? result.data : null;
}

async function providerHealthOnFailure(params: {
  provider: SmsProvider;
  httpStatus?: number;
  errorCode?: string | null;
}) {
  const baseCooldownSeconds = parsePositiveIntEnv(
    "SMS_PROVIDER_BASE_COOLDOWN_SECONDS",
    DEFAULT_PROVIDER_BASE_COOLDOWN_SECONDS,
  );
  const response = await serviceFetch(
    "/rest/v1/rpc/auth_sms_provider_health_on_failure_v1",
    {
      method: "POST",
      body: JSON.stringify({
        p_provider_code: params.provider,
        p_http_status: params.httpStatus ?? null,
        p_error_code: params.errorCode ?? null,
        p_base_cooldown_seconds: baseCooldownSeconds,
      }),
    },
  );
  return response?.ok ?? false;
}

async function providerHealthOnSuccess(provider: SmsProvider) {
  const response = await serviceFetch(
    "/rest/v1/rpc/auth_sms_provider_health_on_success_v1",
    {
      method: "POST",
      body: JSON.stringify({
        p_provider_code: provider,
      }),
    },
  );
  return response?.ok ?? false;
}

function logAppEventBestEffort(event: {
  event_type: string;
  actor_id?: string | null;
  actor_type?: string | null;
  payload?: Record<string, unknown>;
}) {
  if (!hasServiceCredentials()) {
    return;
  }

  fetch(new URL("/rest/v1/app_events", SUPABASE_URL), {
    method: "POST",
    headers: serviceHeaders(),
    body: JSON.stringify({
      event_type: event.event_type,
      level: "info",
      actor_id: event.actor_id ?? null,
      actor_type: event.actor_type ?? null,
      payload: event.payload ?? {},
    }),
  }).catch(() => {});
}

function nextAttemptTimeoutMs(
  deadlineMs: number,
  providerTimeoutMs: number,
): number {
  const remainingMs = deadlineMs - Date.now() - SMS_TIMEOUT_SAFETY_MARGIN_MS;
  if (remainingMs <= 0) {
    return 0;
  }
  return Math.min(providerTimeoutMs, remainingMs);
}

function sanitizeRaw(raw: unknown): unknown {
  if (raw == null) {
    return null;
  }
  if (typeof raw === "string") {
    return raw.length <= 600 ? raw : `${raw.slice(0, 600)}...`;
  }
  try {
    const serialized = JSON.stringify(raw);
    if (serialized.length <= 1200) {
      return raw;
    }
    return {
      truncated: true,
      preview: `${serialized.slice(0, 1200)}...`,
    };
  } catch {
    return "[unserializable]";
  }
}

function toAttemptRecord(result: SmsSendResult): ProviderAttemptRecord {
  return {
    provider: result.provider,
    ok: result.ok,
    http_status: result.httpStatus ?? null,
    provider_error_code: result.providerErrorCode ?? null,
    retryable: result.retryable,
    message_id: result.messageId ?? null,
    error: result.error ?? null,
    raw: sanitizeRaw(result.raw),
  };
}

async function sendWithProvider(params: {
  provider: SmsProvider;
  phone: string;
  otp: string;
  timeoutMs: number;
}) {
  switch (params.provider) {
    case "otpiq":
      return await sendViaOTPIQ({
        phone: params.phone,
        otp: params.otp,
        timeoutMs: params.timeoutMs,
      });
    case "bulksmsiraq":
      return await sendViaBulkSMSIraq({
        phone: params.phone,
        message: buildOtpMessage({ otp: params.otp }),
        timeoutMs: params.timeoutMs,
      });
  }
}

export async function handleSmsHook(req: Request): Promise<Response> {
  if (req.method !== "POST") {
    return errorJson("Method not allowed", 405);
  }

  if (!hasServiceCredentials()) {
    return errorJson(
      "SMS hook is not configured securely.",
      503,
      "SERVICE_ROLE_MISSING",
    );
  }

  const bodyText = await req.text();
  const hookSecret = envTrim("AUTH_HOOK_SECRET") ||
    envTrim("AUTH_HOOK_SEND_SMS_SECRET");
  if (!hookSecret) {
    return errorJson(
      "SMS hook is not configured securely.",
      503,
      "HOOK_SECRET_MISSING",
    );
  }

  const headers = readWebhookHeaders(req);
  const verified = await verifyWebhookSignature(
    bodyText,
    headers,
    decodeWebhookSecret(hookSecret),
  );
  if (!verified) {
    return errorJson("Invalid webhook signature", 401, "WEBHOOK_SIGNATURE");
  }

  let payload: SendSmsHookEvent;
  try {
    payload = JSON.parse(bodyText) as SendSmsHookEvent;
  } catch {
    return errorJson("Invalid JSON payload", 400, "BAD_JSON");
  }

  const userId = payload?.user?.id ?? null;
  const rawPhone = payload?.user?.phone ?? "";
  const otp = payload?.sms?.otp ?? "";
  if (!rawPhone || !otp) {
    return errorJson("Missing phone or otp", 400, "MISSING_FIELDS");
  }

  let phoneE164: string;
  try {
    phoneE164 = normalizeIraqPhoneE164(rawPhone);
  } catch (error) {
    const message = error instanceof PhoneNormalizationError
      ? error.message
      : "Invalid phone";
    return errorJson(message, 400, "INVALID_PHONE");
  }

  const processingTtlSeconds = Math.max(
    15,
    Math.ceil(
      parsePositiveIntEnv(
        "SMS_HOOK_TOTAL_TIMEOUT_MS",
        DEFAULT_SMS_HOOK_TOTAL_TIMEOUT_MS,
      ) / 1000,
    ) + 5,
  );
  const claimAction = await claimWebhook({
    webhookId: headers.id,
    userId,
    phoneE164,
    processingTtlSeconds,
  });
  if (!claimAction) {
    return errorJson(
      "SMS delivery is temporarily unavailable.",
      503,
      "SMS_STATE_UNAVAILABLE",
    );
  }
  if (claimAction === "skip_sent") {
    return json({ ok: true, deduped: true });
  }
  if (claimAction === "skip_processing") {
    return json({ ok: true, deduped: true, processing: true });
  }

  const maskedPhone = maskPhoneForLogs(phoneE164);
  const rateLimit = await consumeRateLimit({
    key: `auth_sms:${phoneE164}`,
    windowSeconds: parsePositiveIntEnv(
      "SMS_HOOK_RATE_LIMIT_WINDOW_SECONDS",
      DEFAULT_RATE_LIMIT_WINDOW_SECONDS,
    ),
    limit: parsePositiveIntEnv(
      "SMS_HOOK_RATE_LIMIT_LIMIT",
      DEFAULT_RATE_LIMIT_LIMIT,
    ),
  });
  if (!rateLimit.allowed) {
    await completeWebhook({
      webhookId: headers.id,
      status: "failed",
      error: rateLimit.degraded ? "RATE_LIMIT_UNAVAILABLE" : "RATE_LIMIT",
      finalErrorCode: rateLimit.degraded
        ? "rate_limit_unavailable"
        : "rate_limit",
      providerAttempts: [],
    });
    return rateLimit.degraded
      ? errorJson(
        "OTP delivery is temporarily unavailable.",
        503,
        "RATE_LIMIT_UNAVAILABLE",
      )
      : errorJson(
        "Too many OTP requests. Try again later.",
        429,
        "RATE_LIMIT",
      );
  }

  const totalTimeoutMs = parsePositiveIntEnv(
    "SMS_HOOK_TOTAL_TIMEOUT_MS",
    DEFAULT_SMS_HOOK_TOTAL_TIMEOUT_MS,
  );
  const providerTimeoutMs = resolveProviderTimeoutMs();
  const deadlineMs = Date.now() + totalTimeoutMs;
  const attempts: ProviderAttemptRecord[] = [];
  let finalResult: SmsSendResult | null = null;

  for (const provider of OTP_PROVIDER_ORDER) {
    const health = await providerHealthStatus(provider);
    if (!health) {
      await completeWebhook({
        webhookId: headers.id,
        status: "failed",
        error: "PROVIDER_HEALTH_UNAVAILABLE",
        finalErrorCode: "provider_health_unavailable",
        providerAttempts: attempts,
      });
      return errorJson(
        "OTP delivery is temporarily unavailable.",
        503,
        "PROVIDER_HEALTH_UNAVAILABLE",
      );
    }

    if (!health.available) {
      attempts.push({
        provider,
        ok: false,
        http_status: health.last_http_status,
        provider_error_code: health.last_error_code,
        retryable: true,
        message_id: null,
        error: "provider_disabled",
        raw: {
          disabled_until: health.disabled_until,
          consecutive_failures: health.consecutive_failures,
        },
      });
      continue;
    }

    const timeoutMs = nextAttemptTimeoutMs(deadlineMs, providerTimeoutMs);
    if (timeoutMs < MIN_SMS_ATTEMPT_TIMEOUT_MS) {
      break;
    }

    finalResult = await sendWithProvider({
      provider,
      phone: phoneE164,
      otp,
      timeoutMs,
    });
    attempts.push(toAttemptRecord(finalResult));

    if (finalResult.ok) {
      await providerHealthOnSuccess(provider);
      await completeWebhook({
        webhookId: headers.id,
        status: "sent",
        providerUsed: provider,
        finalHttpStatus: finalResult.httpStatus ?? null,
        providerAttempts: attempts,
      });
      logAppEventBestEffort({
        event_type: "auth_send_sms_hook",
        actor_id: userId,
        actor_type: "system",
        payload: {
          phone: maskedPhone,
          provider,
          ok: true,
          attempts: attempts.map((attempt) => ({
            provider: attempt.provider,
            ok: attempt.ok,
            http_status: attempt.http_status,
            provider_error_code: attempt.provider_error_code,
          })),
        },
      });
      return json({ ok: true, provider });
    }

    const healthRecorded = await providerHealthOnFailure({
      provider,
      httpStatus: finalResult.httpStatus,
      errorCode: finalResult.providerErrorCode ?? null,
    });
    if (!healthRecorded) {
      await completeWebhook({
        webhookId: headers.id,
        status: "failed",
        error: "PROVIDER_HEALTH_WRITE_FAILED",
        finalHttpStatus: finalResult.httpStatus ?? null,
        finalErrorCode: finalResult.providerErrorCode ??
          "provider_health_write_failed",
        providerAttempts: attempts,
      });
      return errorJson(
        "OTP delivery is temporarily unavailable.",
        503,
        "PROVIDER_HEALTH_WRITE_FAILED",
      );
    }
  }

  const errorCode = finalResult?.providerErrorCode ?? "sms_send_failed";
  const errorStatus = finalResult?.httpStatus ?? 502;
  await completeWebhook({
    webhookId: headers.id,
    status: "failed",
    providerUsed: finalResult?.provider ?? null,
    error: finalResult?.error ?? "SMS_SEND_FAILED",
    finalHttpStatus: finalResult?.httpStatus ?? null,
    finalErrorCode: errorCode,
    providerAttempts: attempts,
  });
  logAppEventBestEffort({
    event_type: "auth_send_sms_hook",
    actor_id: userId,
    actor_type: "system",
    payload: {
      phone: maskedPhone,
      provider: finalResult?.provider ?? null,
      ok: false,
      error_code: errorCode,
      error_status: errorStatus,
      attempts: attempts.map((attempt) => ({
        provider: attempt.provider,
        ok: attempt.ok,
        http_status: attempt.http_status,
        provider_error_code: attempt.provider_error_code,
      })),
    },
  });
  return errorJson("Failed to send OTP", 502, "SMS_SEND_FAILED");
}

if (import.meta.main) {
  Deno.serve(handleSmsHook);
}
