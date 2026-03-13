import { envTrim } from "./config.ts";

export type AuthOtpPurpose = "signup" | "recovery";

export type AuthOtpRequestResult = {
  ok: boolean;
  status: number;
  body: unknown;
  code?: string;
  message?: string;
  headers: Headers;
};

const DEFAULT_AUTH_OTP_TIMEOUT_MS = 4_500;

async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit & { timeoutMs?: number } = {},
) {
  const { timeoutMs = DEFAULT_AUTH_OTP_TIMEOUT_MS, ...rest } = init;
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

function readStringField(body: unknown, keys: string[]): string | undefined {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return undefined;
  }

  const record = body as Record<string, unknown>;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }

  return undefined;
}

export async function requestSupabaseAuthOtp(params: {
  phone: string;
  purpose: AuthOtpPurpose;
  captchaToken?: string;
  timeoutMs?: number;
}): Promise<AuthOtpRequestResult> {
  const supabaseUrl = envTrim("SUPABASE_URL");
  const supabasePublishableKey = envTrim("SUPABASE_ANON_KEY") ||
    envTrim("SUPABASE_PUBLISHABLE_KEY");

  if (!supabaseUrl || !supabasePublishableKey) {
    throw new Error("Missing Supabase public configuration");
  }

  const response = await fetchWithTimeout(
    new URL("/auth/v1/otp", supabaseUrl),
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        apikey: supabasePublishableKey,
        authorization: `Bearer ${supabasePublishableKey}`,
      },
      body: JSON.stringify({
        phone: params.phone,
        create_user: params.purpose === "signup",
        ...(params.captchaToken
          ? {
            gotrue_meta_security: {
              captcha_token: params.captchaToken,
            },
          }
          : {}),
      }),
      timeoutMs: params.timeoutMs,
    },
  );

  const rawBody = await response.text();
  const body = rawBody ? await safeJson(rawBody) : {};
  return {
    ok: response.ok,
    status: response.status,
    body,
    code: readStringField(body, ["code", "error_code"]),
    message: readStringField(body, [
      "error_description",
      "msg",
      "message",
      "error",
    ]),
    headers: response.headers,
  };
}
