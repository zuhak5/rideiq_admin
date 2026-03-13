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
  isSupabaseCaptchaFailure,
  isSupabaseOtpRateLimit,
} from "../_shared/authPublicFlow.ts";
import { maskPhoneForLogs } from "../_shared/privacy.ts";

type AuthBeginResponse = {
  normalizedPhone: string;
  nextStep: "password" | "otp_signup";
};

const phoneBeginLimit = 5;
const ipBeginLimit = 12;
const installationBeginLimit = 8;
const beginWindowSeconds = 15 * 60;

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

export async function handleAuthBegin(req: Request): Promise<Response> {
  return await withRequestContext("auth-begin", req, async (ctx) => {
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

    let payload: { phone?: unknown; captchaToken?: unknown };
    try {
      payload = (await req.json()) as {
        phone?: unknown;
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
        key: `auth_begin:${normalizedPhone}`,
        limit: phoneBeginLimit,
      },
      {
        scope: "ip",
        key: `auth_begin_ip:${clientIp}`,
        limit: ipBeginLimit,
      },
      {
        scope: "installation",
        key: `auth_begin_installation:${installationId}`,
        limit: installationBeginLimit,
      },
    ] as const;

    for (const rateLimit of limits) {
      const result = await consumeRateLimit({
        key: rateLimit.key,
        windowSeconds: beginWindowSeconds,
        limit: rateLimit.limit,
        failOpen: false,
      });
      if (result.allowed) {
        continue;
      }

      if (result.degraded) {
        ctx.error("auth_begin.rate_limit_unavailable", {
          scope: rateLimit.scope,
        });
        return errorJson(
          "Phone sign-in is temporarily unavailable.",
          503,
          "RATE_LIMIT_UNAVAILABLE",
        );
      }

      await logAppEvent({
        event_type: "auth_begin_rate_limited",
        actor_type: "system",
        payload: {
          phone: maskedPhone,
          scope: rateLimit.scope,
        },
      });
      return errorJson(
        "Too many authentication attempts. Try again later.",
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
      ctx.error("auth_begin.route_lookup_failed", {
        error: error.message,
      });
      return errorJson(
        "Failed to resolve phone status.",
        500,
        "LOOKUP_FAILED",
      );
    }

    const nextStep: AuthBeginResponse["nextStep"] = data === "password"
      ? "password"
      : "otp_signup";
    if (nextStep === "password") {
      await logAppEvent({
        event_type: "auth_begin",
        actor_type: "system",
        payload: {
          phone: maskedPhone,
          next_step: nextStep,
        },
      });
      return json(
        {
          normalizedPhone,
          nextStep,
        } satisfies AuthBeginResponse,
      );
    }

    try {
      const otpResponse = await requestSupabaseAuthOtp({
        phone: normalizedPhone,
        purpose: "signup",
        captchaToken,
      });

      await logAppEvent({
        event_type: "auth_begin",
        actor_type: "system",
        payload: {
          phone: maskedPhone,
          next_step: nextStep,
          otp_requested: otpResponse.ok,
          otp_status_code: otpResponse.status,
          otp_code: otpResponse.code ?? null,
        },
      });

      if (otpResponse.ok) {
        return json(
          {
            normalizedPhone,
            nextStep,
          } satisfies AuthBeginResponse,
        );
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
      ctx.error("auth_begin.otp_forward_failed", {
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
  Deno.serve(handleAuthBegin);
}
