import { assertEquals } from "jsr:@std/assert";

function withEnv(
  vars: Record<string, string>,
  run: () => Promise<void>,
) {
  const backup = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(vars)) {
    backup.set(key, Deno.env.get(key));
    Deno.env.set(key, value);
  }

  return run().finally(() => {
    for (const [key, value] of backup.entries()) {
      if (value == null) {
        Deno.env.delete(key);
      } else {
        Deno.env.set(key, value);
      }
    }
  });
}

function buildJsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function buildAuthRequest(
  url: string,
  body: Record<string, unknown>,
): Request {
  return new Request(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-client-installation-id": "test-installation-id",
    },
    body: JSON.stringify(body),
  });
}

Deno.test({
  name:
    "auth-begin returns password without requesting OTP for completed accounts",
  permissions: { env: true },
  fn: async () => {
    const originalFetch = globalThis.fetch;
    let otpRequests = 0;

    try {
      globalThis.fetch = ((input: RequestInfo | URL) => {
        const url = new URL(
          typeof input === "string"
            ? input
            : input instanceof URL
            ? input.toString()
            : input.url,
        );
        if (url.pathname.endsWith("/rest/v1/rpc/rate_limit_consume")) {
          return Promise.resolve(
            buildJsonResponse({
              allowed: true,
              remaining: 4,
              reset_at: new Date(Date.now() + 60_000).toISOString(),
            }),
          );
        }
        if (url.pathname.endsWith("/rest/v1/rpc/get_phone_auth_route")) {
          return Promise.resolve(buildJsonResponse("password"));
        }
        if (url.pathname.endsWith("/auth/v1/otp")) {
          otpRequests += 1;
          return Promise.resolve(buildJsonResponse({}, 200));
        }
        return Promise.resolve(buildJsonResponse({}, 404));
      }) as typeof fetch;

      await withEnv(
        {
          SUPABASE_URL: "https://example.supabase.co",
          SUPABASE_ANON_KEY: "sb_publishable_test",
          SUPABASE_SERVICE_ROLE_KEY: "sb_secret_test",
        },
        async () => {
          const { handleAuthBegin } = await import("../auth-begin/index.ts");
          const response = await handleAuthBegin(
            buildAuthRequest(
              "https://example.supabase.co/functions/v1/auth-begin",
              {
                phone: "7701234567",
                captchaToken: "captcha-token",
              },
            ),
          );
          const body = await response.json();

          assertEquals(response.status, 200);
          assertEquals(body["nextStep"], "password");
          assertEquals(body["normalizedPhone"], "+9647701234567");
          assertEquals(otpRequests, 0);
        },
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  },
});

Deno.test({
  name: "auth-begin requests OTP for otp_signup and forwards captcha token",
  permissions: { env: true },
  fn: async () => {
    const originalFetch = globalThis.fetch;
    let otpBody: Record<string, unknown> | null = null;

    try {
      globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(
          typeof input === "string"
            ? input
            : input instanceof URL
            ? input.toString()
            : input.url,
        );
        if (url.pathname.endsWith("/rest/v1/rpc/rate_limit_consume")) {
          return Promise.resolve(
            buildJsonResponse({
              allowed: true,
              remaining: 4,
              reset_at: new Date(Date.now() + 60_000).toISOString(),
            }),
          );
        }
        if (url.pathname.endsWith("/rest/v1/rpc/get_phone_auth_route")) {
          return Promise.resolve(buildJsonResponse("otp_signup"));
        }
        if (url.pathname.endsWith("/auth/v1/otp")) {
          otpBody = JSON.parse(String(init?.body ?? "{}")) as Record<
            string,
            unknown
          >;
          return Promise.resolve(buildJsonResponse({}, 200));
        }
        return Promise.resolve(buildJsonResponse({}, 404));
      }) as typeof fetch;

      await withEnv(
        {
          SUPABASE_URL: "https://example.supabase.co",
          SUPABASE_ANON_KEY: "sb_publishable_test",
          SUPABASE_SERVICE_ROLE_KEY: "sb_secret_test",
        },
        async () => {
          const { handleAuthBegin } = await import("../auth-begin/index.ts");
          const response = await handleAuthBegin(
            buildAuthRequest(
              "https://example.supabase.co/functions/v1/auth-begin",
              {
                phone: "7701234567",
                captchaToken: "captcha-token",
              },
            ),
          );
          const body = await response.json();

          assertEquals(response.status, 200);
          assertEquals(body["nextStep"], "otp_signup");
          assertEquals(body["normalizedPhone"], "+9647701234567");
          assertEquals(
            (otpBody?.["gotrue_meta_security"] as Record<string, unknown>)?.[
              "captcha_token"
            ],
            "captcha-token",
          );
          assertEquals(otpBody?.["create_user"], true);
        },
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  },
});

Deno.test({
  name: "auth-request-otp rejects missing captcha",
  permissions: { env: true },
  fn: async () => {
    await withEnv(
      {
        SUPABASE_URL: "https://example.supabase.co",
        SUPABASE_ANON_KEY: "sb_publishable_test",
        SUPABASE_SERVICE_ROLE_KEY: "sb_secret_test",
      },
      async () => {
        const { handleAuthRequestOtp } = await import(
          "../auth-request-otp/index.ts"
        );
        const response = await handleAuthRequestOtp(
          buildAuthRequest(
            "https://example.supabase.co/functions/v1/auth-request-otp",
            {
              phone: "7701234567",
              purpose: "signup",
            },
          ),
        );
        const body = await response.json();

        assertEquals(response.status, 400);
        assertEquals(body["code"], "CAPTCHA_REQUIRED");
      },
    );
  },
});

Deno.test({
  name: "auth-request-otp forwards captcha token upstream",
  permissions: { env: true },
  fn: async () => {
    const originalFetch = globalThis.fetch;
    let otpBody: Record<string, unknown> | null = null;

    try {
      globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(
          typeof input === "string"
            ? input
            : input instanceof URL
            ? input.toString()
            : input.url,
        );
        if (url.pathname.endsWith("/rest/v1/rpc/rate_limit_consume")) {
          return Promise.resolve(
            buildJsonResponse({
              allowed: true,
              remaining: 4,
              reset_at: new Date(Date.now() + 60_000).toISOString(),
            }),
          );
        }
        if (url.pathname.endsWith("/rest/v1/rpc/get_phone_auth_route")) {
          return Promise.resolve(buildJsonResponse("password"));
        }
        if (url.pathname.endsWith("/auth/v1/otp")) {
          otpBody = JSON.parse(String(init?.body ?? "{}")) as Record<
            string,
            unknown
          >;
          return Promise.resolve(buildJsonResponse({}, 200));
        }
        return Promise.resolve(buildJsonResponse({}, 404));
      }) as typeof fetch;

      await withEnv(
        {
          SUPABASE_URL: "https://example.supabase.co",
          SUPABASE_ANON_KEY: "sb_publishable_test",
          SUPABASE_SERVICE_ROLE_KEY: "sb_secret_test",
        },
        async () => {
          const { handleAuthRequestOtp } = await import(
            "../auth-request-otp/index.ts"
          );
          const response = await handleAuthRequestOtp(
            buildAuthRequest(
              "https://example.supabase.co/functions/v1/auth-request-otp",
              {
                phone: "7701234567",
                purpose: "recovery",
                captchaToken: "captcha-token",
              },
            ),
          );
          const body = await response.json();

          assertEquals(response.status, 200);
          assertEquals(body["purpose"], "recovery");
          assertEquals(otpBody?.["create_user"], false);
          assertEquals(
            (otpBody?.["gotrue_meta_security"] as Record<string, unknown>)?.[
              "captcha_token"
            ],
            "captcha-token",
          );
        },
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  },
});
