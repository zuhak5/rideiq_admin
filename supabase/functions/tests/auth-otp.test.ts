import { assertEquals } from "jsr:@std/assert";

import { requestSupabaseAuthOtp } from "../_shared/authOtp.ts";

Deno.test({
  name:
    "requestSupabaseAuthOtp uses create_user=true for signup and forwards captcha",
  permissions: { env: true },
  fn: async () => {
    const originalFetch = globalThis.fetch;
    const envBackup = new Map<string, string | undefined>();
    const envKeys = ["SUPABASE_URL", "SUPABASE_ANON_KEY"];
    for (const key of envKeys) {
      envBackup.set(key, Deno.env.get(key));
    }

    let requestBody: Record<string, unknown> | null = null;

    try {
      Deno.env.set("SUPABASE_URL", "https://example.supabase.co");
      Deno.env.set("SUPABASE_ANON_KEY", "sb_publishable_test");

      globalThis.fetch = ((_, init?: RequestInit) => {
        requestBody = JSON.parse(String(init?.body ?? "{}")) as Record<
          string,
          unknown
        >;
        return Promise.resolve(
          new Response("{}", {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
        );
      }) as typeof fetch;

      const result = await requestSupabaseAuthOtp({
        phone: "+9647701234567",
        purpose: "signup",
        captchaToken: "turnstile-token",
      });

      assertEquals(result.ok, true);
      assertEquals(requestBody?.["phone"], "+9647701234567");
      assertEquals(requestBody?.["create_user"], true);
      const security = requestBody?.["gotrue_meta_security"] as
        | Record<string, unknown>
        | undefined;
      assertEquals(
        security?.["captcha_token"],
        "turnstile-token",
      );
    } finally {
      globalThis.fetch = originalFetch;
      for (const [key, value] of envBackup.entries()) {
        if (value == null) {
          Deno.env.delete(key);
        } else {
          Deno.env.set(key, value);
        }
      }
    }
  },
});

Deno.test({
  name: "requestSupabaseAuthOtp surfaces auth error code and message",
  permissions: { env: true },
  fn: async () => {
    const originalFetch = globalThis.fetch;
    const envBackup = new Map<string, string | undefined>();
    const envKeys = ["SUPABASE_URL", "SUPABASE_ANON_KEY"];
    for (const key of envKeys) {
      envBackup.set(key, Deno.env.get(key));
    }

    try {
      Deno.env.set("SUPABASE_URL", "https://example.supabase.co");
      Deno.env.set("SUPABASE_ANON_KEY", "sb_publishable_test");

      globalThis.fetch = (() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              code: "over_sms_send_rate_limit",
              error_description: "Too many OTP requests",
            }),
            {
              status: 429,
              headers: { "content-type": "application/json" },
            },
          ),
        )) as typeof fetch;

      const result = await requestSupabaseAuthOtp({
        phone: "+9647701234567",
        purpose: "recovery",
      });

      assertEquals(result.ok, false);
      assertEquals(result.status, 429);
      assertEquals(result.code, "over_sms_send_rate_limit");
      assertEquals(result.message, "Too many OTP requests");
    } finally {
      globalThis.fetch = originalFetch;
      for (const [key, value] of envBackup.entries()) {
        if (value == null) {
          Deno.env.delete(key);
        } else {
          Deno.env.set(key, value);
        }
      }
    }
  },
});
