import { envTrim } from "./config.ts";
import { normalizeIraqPhoneNoPlus } from "./phone.ts";

export type SmsProvider = "otpiq" | "bulksmsiraq";

export type SmsSendResult = {
  provider: SmsProvider;
  ok: boolean;
  httpStatus?: number;
  providerErrorCode?: string;
  retryable: boolean;
  messageId?: string;
  raw?: unknown;
  error?: string;
};

export const OTP_PROVIDER_ORDER = ["otpiq", "bulksmsiraq"] as const;

const DEFAULT_SMS_PROVIDER_TIMEOUT_MS = 1_200;
const OTPIQ_AUTH_PROVIDER = "whatsapp-telegram-sms";

function parsePositiveInt(raw: string, fallback: number): number {
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export function resolveProviderTimeoutMs(override?: number): number {
  if (override != null && Number.isFinite(override) && override > 0) {
    return Math.floor(override);
  }
  return parsePositiveInt(
    envTrim("SMS_PROVIDER_TIMEOUT_MS"),
    DEFAULT_SMS_PROVIDER_TIMEOUT_MS,
  );
}

function requiredEnv(key: string): string {
  const value = envTrim(key);
  if (!value) {
    throw new Error(`Missing required env var: ${key}`);
  }
  return value;
}

function extractErrorText(raw: unknown): string {
  if (typeof raw === "string") {
    return raw;
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return "";
  }

  const record = raw as Record<string, unknown>;
  const fields = [
    "message",
    "error",
    "error_description",
    "details",
    "detail",
    "msg",
  ];
  for (const field of fields) {
    const value = record[field];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }

  const errors = record["errors"];
  if (Array.isArray(errors) && errors.length > 0) {
    const first = errors[0];
    if (first && typeof first === "object" && !Array.isArray(first)) {
      return extractErrorText(first);
    }
    if (typeof first === "string" && first.trim().length > 0) {
      return first.trim();
    }
  }

  return "";
}

function extractProviderErrorCode(raw: unknown): string | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return undefined;
  }

  const record = raw as Record<string, unknown>;
  const fields = ["code", "error_code", "status_code", "status"];
  for (const field of fields) {
    const value = record[field];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
    if (typeof value === "number") {
      return `${value}`;
    }
  }

  const errors = record["errors"];
  if (Array.isArray(errors) && errors.length > 0) {
    const first = errors[0];
    if (first && typeof first === "object" && !Array.isArray(first)) {
      return extractProviderErrorCode(first);
    }
  }

  return undefined;
}

function messageIdFromBody(raw: unknown, keys: string[]): string | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return undefined;
  }
  const record = raw as Record<string, unknown>;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return undefined;
}

function deepStringField(raw: unknown, keys: string[]): string | undefined {
  if (raw == null) {
    return undefined;
  }
  if (Array.isArray(raw)) {
    for (const item of raw) {
      const nested = deepStringField(item, keys);
      if (nested) {
        return nested;
      }
    }
    return undefined;
  }
  if (typeof raw !== "object") {
    return undefined;
  }

  const record = raw as Record<string, unknown>;
  const direct = messageIdFromBody(record, keys);
  if (direct) {
    return direct;
  }

  for (const value of Object.values(record)) {
    const nested = deepStringField(value, keys);
    if (nested) {
      return nested;
    }
  }
  return undefined;
}

function deepBooleanField(raw: unknown, keys: string[]): boolean | undefined {
  if (raw == null) {
    return undefined;
  }
  if (Array.isArray(raw)) {
    for (const item of raw) {
      const nested = deepBooleanField(item, keys);
      if (nested != null) {
        return nested;
      }
    }
    return undefined;
  }
  if (typeof raw !== "object") {
    return undefined;
  }

  const record = raw as Record<string, unknown>;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "boolean") {
      return value;
    }
  }
  for (const value of Object.values(record)) {
    const nested = deepBooleanField(value, keys);
    if (nested != null) {
      return nested;
    }
  }
  return undefined;
}

function looksLikeOtpiqAcceptedResponse(
  raw: unknown,
  httpStatus: number,
): { accepted: boolean; messageId?: string } {
  const messageId = deepStringField(raw, [
    "smsId",
    "sms_id",
    "message_id",
    "messageId",
    "request_id",
    "requestId",
    "task_id",
    "taskId",
    "id",
  ]);
  if (messageId) {
    return { accepted: true, messageId };
  }

  if (httpStatus === 204) {
    return { accepted: true };
  }

  if (deepBooleanField(raw, ["success", "ok", "accepted"]) === true) {
    return { accepted: true };
  }

  const status = deepStringField(raw, ["status", "state", "result"])
    ?.trim()
    .toLowerCase();
  if (
    status && [
      "success",
      "ok",
      "accepted",
      "queued",
      "sent",
      "created",
      "processed",
    ].includes(status)
  ) {
    return { accepted: true };
  }

  const message = extractErrorText(raw).trim().toLowerCase();
  if (
    message &&
    (
      message.includes("created successfully") ||
      message.includes("sent successfully") ||
      message.includes("queued successfully") ||
      message.includes("accepted successfully") ||
      message.includes("verification code sent") ||
      message.includes("otp sent") ||
      message.includes("sms task created successfully")
    ) &&
    !(
      message.includes("error") ||
      message.includes("failed") ||
      message.includes("invalid") ||
      message.includes("not allowed") ||
      message.includes("insufficient") ||
      message.includes("trial mode") ||
      message.includes("whitelist") ||
      message.includes("unauthorized") ||
      message.includes("forbidden")
    )
  ) {
    return { accepted: true };
  }

  return { accepted: false };
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

function retryableForHttpStatus(status?: number): boolean {
  if (status == null) {
    return true;
  }
  if (status === 408 || status === 409 || status === 425 || status === 429) {
    return true;
  }
  return status >= 500;
}

function classifyOtpiqFailure(params: {
  httpStatus?: number;
  raw?: unknown;
  error?: string;
}): Pick<SmsSendResult, "providerErrorCode" | "retryable" | "error"> {
  const text = [
    params.error ?? "",
    extractErrorText(params.raw),
  ].join(" ").trim().toLowerCase();
  const providerErrorCode = extractProviderErrorCode(params.raw);

  if (text.includes("trial mode") || text.includes("owner")) {
    return {
      providerErrorCode: providerErrorCode ?? "trial_mode_restriction",
      retryable: false,
      error: params.error ?? "OTPIQ trial-mode restriction",
    };
  }
  if (text.includes("insufficient balance") || text.includes("balance")) {
    return {
      providerErrorCode: providerErrorCode ?? "insufficient_balance",
      retryable: false,
      error: params.error ?? "OTPIQ balance exhausted",
    };
  }
  if (text.includes("whitelist")) {
    return {
      providerErrorCode: providerErrorCode ?? "recipient_not_whitelisted",
      retryable: false,
      error: params.error ?? "OTPIQ recipient not whitelisted",
    };
  }
  if (params.httpStatus === 401 || params.httpStatus === 403) {
    return {
      providerErrorCode: providerErrorCode ?? "auth_rejected",
      retryable: false,
      error: params.error ?? `HTTP ${params.httpStatus}`,
    };
  }
  if (params.httpStatus === 404) {
    return {
      providerErrorCode: providerErrorCode ?? "endpoint_not_found",
      retryable: false,
      error: params.error ?? "OTPIQ endpoint not found",
    };
  }
  return {
    providerErrorCode,
    retryable: retryableForHttpStatus(params.httpStatus),
    error: (params.error ?? extractErrorText(params.raw)) ||
      "OTPIQ request failed",
  };
}

function classifyBulkSmsFailure(params: {
  httpStatus?: number;
  raw?: unknown;
  error?: string;
}): Pick<SmsSendResult, "providerErrorCode" | "retryable" | "error"> {
  const text = [
    params.error ?? "",
    extractErrorText(params.raw),
  ].join(" ").trim().toLowerCase();
  const providerErrorCode = extractProviderErrorCode(params.raw);

  if (text.includes("hourly limit exceeded")) {
    return {
      providerErrorCode: providerErrorCode ?? "hourly_limit_exceeded",
      retryable: false,
      error: params.error ?? "BulkSMSIraq hourly limit exceeded",
    };
  }
  if (text.includes("insufficient balance") || text.includes("balance")) {
    return {
      providerErrorCode: providerErrorCode ?? "insufficient_balance",
      retryable: false,
      error: params.error ?? "BulkSMSIraq balance exhausted",
    };
  }
  if (params.httpStatus === 401 || params.httpStatus === 403) {
    return {
      providerErrorCode: providerErrorCode ?? "auth_rejected",
      retryable: false,
      error: params.error ?? `HTTP ${params.httpStatus}`,
    };
  }
  if (params.httpStatus === 404) {
    return {
      providerErrorCode: providerErrorCode ?? "endpoint_not_found",
      retryable: false,
      error: params.error ?? "BulkSMSIraq endpoint not found",
    };
  }
  return {
    providerErrorCode,
    retryable: retryableForHttpStatus(params.httpStatus),
    error: (params.error ?? extractErrorText(params.raw)) ||
      "BulkSMSIraq request failed",
  };
}

export function buildOtpMessage(params: { otp: string; appName?: string }) {
  const appName = (params.appName ?? envTrim("OTP_APP_NAME")) || "RideIQ";
  return `${appName} verification code: ${params.otp}`;
}

export async function sendViaOTPIQ(params: {
  phone: string;
  otp: string;
  senderId?: string;
  timeoutMs?: number;
}): Promise<SmsSendResult> {
  try {
    const apiKey = requiredEnv("OTPIQ_API_KEY");
    const phoneNoPlus = normalizeIraqPhoneNoPlus(params.phone);
    const senderId = params.senderId ?? envTrim("OTPIQ_SENDER_ID");
    const res = await fetchWithTimeout("https://api.otpiq.com/api/sms", {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify({
        phoneNumber: phoneNoPlus,
        smsType: "verification",
        verificationCode: params.otp,
        // Auth OTP delivery uses OTPIQ's verification mode with the project's
        // configured multi-channel route.
        provider: OTPIQ_AUTH_PROVIDER,
        ...(senderId.length > 0 ? { senderId } : {}),
      }),
      timeoutMs: resolveProviderTimeoutMs(params.timeoutMs),
    });

    const raw = await safeJson(await res.text());
    if (!res.ok) {
      const classified = classifyOtpiqFailure({
        httpStatus: res.status,
        raw,
        error: `HTTP ${res.status}`,
      });
      return {
        provider: "otpiq",
        ok: false,
        httpStatus: res.status,
        raw,
        ...classified,
      };
    }

    const accepted = looksLikeOtpiqAcceptedResponse(raw, res.status);
    if (!accepted.accepted) {
      const classified = classifyOtpiqFailure({
        httpStatus: res.status,
        raw,
        error: "Unexpected OTPIQ response",
      });
      return {
        provider: "otpiq",
        ok: false,
        httpStatus: res.status,
        raw,
        ...classified,
      };
    }

    return {
      provider: "otpiq",
      ok: true,
      httpStatus: res.status,
      retryable: false,
      messageId: accepted.messageId,
      raw,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const classified = classifyOtpiqFailure({ error: message });
    return {
      provider: "otpiq",
      ok: false,
      raw: message,
      ...classified,
    };
  }
}

export async function sendViaBulkSMSIraq(params: {
  phone: string;
  message: string;
  timeoutMs?: number;
}): Promise<SmsSendResult> {
  try {
    const apiKey = requiredEnv("BULKSMSIRAQ_API_KEY");
    const senderId = requiredEnv("BULKSMSIRAQ_SENDER_ID");
    const recipient = normalizeIraqPhoneNoPlus(params.phone);
    const res = await fetchWithTimeout(
      "https://gateway.standingtech.com/api/v4/sms/send",
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${apiKey}`,
          "content-type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify({
          recipient,
          sender_id: senderId,
          type: "plain",
          message: params.message,
        }),
        timeoutMs: resolveProviderTimeoutMs(params.timeoutMs),
      },
    );

    const raw = await safeJson(await res.text());
    if (!res.ok) {
      const classified = classifyBulkSmsFailure({
        httpStatus: res.status,
        raw,
        error: `HTTP ${res.status}`,
      });
      return {
        provider: "bulksmsiraq",
        ok: false,
        httpStatus: res.status,
        raw,
        ...classified,
      };
    }

    const status = !raw || typeof raw !== "object" || Array.isArray(raw)
      ? ""
      : `${(raw as Record<string, unknown>)["status"] ?? ""}`.trim()
        .toLowerCase();
    const messageId = messageIdFromBody(raw, ["message_id", "messageId", "id"]);
    if (status != "success" && !messageId) {
      const classified = classifyBulkSmsFailure({
        httpStatus: res.status,
        raw,
        error: "BulkSMSIraq returned a non-success payload",
      });
      return {
        provider: "bulksmsiraq",
        ok: false,
        httpStatus: res.status,
        raw,
        ...classified,
      };
    }

    return {
      provider: "bulksmsiraq",
      ok: true,
      httpStatus: res.status,
      retryable: false,
      messageId,
      raw,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const classified = classifyBulkSmsFailure({ error: message });
    return {
      provider: "bulksmsiraq",
      ok: false,
      raw: message,
      ...classified,
    };
  }
}
