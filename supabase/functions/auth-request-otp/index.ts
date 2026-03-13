import { errorJson, json } from "../_shared/json.ts";
import { withRequestContext } from "../_shared/requestContext.ts";
import { createServiceClient } from "../_shared/supabase.ts";
import {
  buildRateLimitHeaders,
  consumeRateLimit,
  getClientInstallationId,
  getClientIp,
} from "../_shared/rateLimit.ts";
import {
  normalizeIraqPhoneE164,
  PhoneNormalizationError,
} from "../_shared/phone.ts";
import { logAppEvent } from "../_shared/log.ts";
import { requestSupabaseAuthOtp } from "../_shared/authOtp.ts";
import {
  isOtpPurpose,
  isSupabaseCaptchaFailure,
  isSupabaseOtpRateLimit,
  type OtpPurpose,
} from "../_shared/authPublicFlow.ts";
import { maskPhoneForLogs } from "../_shared/privacy.ts";

type OtpRequestResponse = {
  normalizedPhone: string;
  purpose: OtpPurpose;
};

const phoneOtpLimit = 5;
const ipOtpLimit = 12;
const installationOtpLimit = 8;
const otpWindowSeconds = 15 * 60;

function pickRateLimitHeaders(
  limit: number,
  remaining: number,
  resetAt: string,
) {
  return buildRateLimitHeaders({
    limit,
    remaining,
    resetAt,
  });
}

function forwardRetryAfterHeaders(headers: Headers): Record<string, string> {
  const retryAfter = headers.get("retry-after")?.trim() ?? "";
  return retryAfter ? { "Retry-After": retryAfter } : {};
}

export async function handleAuthRequestOtp(req: Request): Promise<Response> {
  return await withRequestContext("auth-request-otp", req, async (ctx) => {
    if (req.method !== "POST") {
      return errorJson("Method not allowed", 405, "METHOD_NOT_ALLOWED");
    }

    const installationId = getClientInstallationId(req);
    if (!installationId) {
      return errorJson(
        "Missing client installation identifier.",
        400,
        "CLIENT_INSTALLATION_REQUIRED",
      );
    }

    let payload: { phone?: unknown; purpose?: unknown; captchaToken?: unknown };
    try {
      payload = (await req.json()) as {
        phone?: unknown;
        purpose?: unknown;
        captchaToken?: unknown;
      };
    } catch {
      return errorJson("Invalid JSON payload", 400, "BAD_JSON");
    }

    const captchaToken = typeof payload.captchaToken === "string"
      ? payload.captchaToken.trim()
      : "";
    if (!captchaToken) {
      return errorJson(
        "Captcha verification is required.",
        400,
        "CAPTCHA_REQUIRED",
      );
    }

    const rawPhone = typeof payload.phone === "string"
      ? payload.phone.trim()
      : "";
    if (!isOtpPurpose(payload.purpose)) {
      return errorJson("Invalid OTP purpose.", 400, "INVALID_PURPOSE");
    }
    const purpose = payload.purpose;

    let normalizedPhone: string;
    try {
      normalizedPhone = normalizeIraqPhoneE164(rawPhone);
    } catch (error) {
      const message = error instanceof PhoneNormalizationError
        ? error.message
        : "Invalid phone";
      return errorJson(message, 400, "INVALID_PHONE");
    }

    const maskedPhone = maskPhoneForLogs(normalizedPhone);
    const clientIp = getClientIp(req) ?? "unknown";

    const limits = [
      {
        scope: "phone",
        key: `auth_request_otp:${purpose}:${normalizedPhone}`,
        limit: phoneOtpLimit,
      },
      {
        scope: "ip",
        key: `auth_request_otp_ip:${purpose}:${clientIp}`,
        limit: ipOtpLimit,
      },
      {
        scope: "installation",
        key: `auth_request_otp_installation:${purpose}:${installationId}`,
        limit: installationOtpLimit,
      },
    ] as const;

    for (const rateLimit of limits) {
      const result = await consumeRateLimit({
        key: rateLimit.key,
        windowSeconds: otpWindowSeconds,
        limit: rateLimit.limit,
        failOpen: false,
      });
      if (result.allowed) {
        continue;
      }

      if (result.degraded) {
        ctx.error("auth_request_otp.rate_limit_unavailable", {
          scope: rateLimit.scope,
          purpose,
        });
        return errorJson(
          "OTP delivery is temporarily unavailable.",
          503,
          "RATE_LIMIT_UNAVAILABLE",
        );
      }

      await logAppEvent({
        event_type: "auth_request_otp_rate_limited",
        actor_type: "system",
        payload: {
          phone: maskedPhone,
          purpose,
          scope: rateLimit.scope,
        },
      });
      return errorJson(
        "Too many OTP requests. Try again later.",
        429,
        "RATE_LIMIT",
        undefined,
        pickRateLimitHeaders(
          rateLimit.limit,
          result.remaining,
          result.resetAt,
        ),
      );
    }

    const service = createServiceClient();
    const { data, error } = await service.rpc("get_phone_auth_route", {
      p_phone_e164: normalizedPhone,
    });
    if (error != null) {
      ctx.error("auth_request_otp.route_lookup_failed", {
        purpose,
        error: error.message,
      });
      return errorJson(
        "Failed to resolve phone status.",
        500,
        "LOOKUP_FAILED",
      );
    }

    const nextStep = data === "password" ? "password" : "otp_signup";
    if (purpose === "signup" && nextStep === "password") {
      return errorJson(
        "This phone already uses password sign-in.",
        409,
        "ACCOUNT_REQUIRES_PASSWORD",
      );
    }
    if (purpose === "recovery" && nextStep !== "password") {
      return errorJson(
        "Password recovery is not available for this phone.",
        409,
        "ACCOUNT_RECOVERY_NOT_AVAILABLE",
      );
    }

    try {
      const otpResponse = await requestSupabaseAuthOtp({
        phone: normalizedPhone,
        purpose,
        captchaToken,
      });

      await logAppEvent({
        event_type: "auth_request_otp",
        actor_type: "system",
        payload: {
          phone: maskedPhone,
          purpose,
          ok: otpResponse.ok,
          status_code: otpResponse.status,
          code: otpResponse.code ?? null,
        },
      });

      if (otpResponse.ok) {
        const response: OtpRequestResponse = {
          normalizedPhone,
          purpose,
        };
        return json(response);
      }

      if (isSupabaseCaptchaFailure(otpResponse.code, otpResponse.message)) {
        return errorJson(
          otpResponse.message ?? "Captcha verification failed.",
          400,
          "CAPTCHA_FAILED",
        );
      }

      if (isSupabaseOtpRateLimit(otpResponse.code, otpResponse.message)) {
        return errorJson(
          "Too many OTP requests. Try again later.",
          429,
          "OTP_RATE_LIMIT",
          undefined,
          forwardRetryAfterHeaders(otpResponse.headers),
        );
      }

      return errorJson(
        otpResponse.message ?? "Failed to request OTP.",
        otpResponse.status >= 500 ? 502 : 400,
        otpResponse.code ?? "OTP_REQUEST_FAILED",
        undefined,
        forwardRetryAfterHeaders(otpResponse.headers),
      );
    } catch (error) {
      ctx.error("auth_request_otp.forward_failed", {
        purpose,
        error: error instanceof Error ? error.message : String(error),
      });
      return errorJson(
        "OTP delivery is temporarily unavailable.",
        503,
        "OTP_REQUEST_UNAVAILABLE",
      );
    }
  });
}

if (import.meta.main) {
  Deno.serve(handleAuthRequestOtp);
}
