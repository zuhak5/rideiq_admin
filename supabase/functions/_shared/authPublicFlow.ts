export type OtpPurpose = "signup" | "recovery";

export function isOtpPurpose(value: unknown): value is OtpPurpose {
  return value === "signup" || value === "recovery";
}

export function isSupabaseOtpRateLimit(
  code?: string,
  message?: string,
): boolean {
  const normalizedCode = (code ?? "").toLowerCase();
  const normalizedMessage = (message ?? "").toLowerCase();
  return normalizedCode === "over_request_rate_limit" ||
    normalizedCode === "over_sms_send_rate_limit" ||
    normalizedMessage.includes("rate limit") ||
    normalizedMessage.includes("too many");
}

export function isSupabaseCaptchaFailure(
  code?: string,
  message?: string,
): boolean {
  const normalizedCode = (code ?? "").toLowerCase();
  const normalizedMessage = (message ?? "").toLowerCase();
  return normalizedCode === "captcha_failed" ||
    normalizedMessage.includes("captcha") ||
    normalizedMessage.includes("turnstile");
}
