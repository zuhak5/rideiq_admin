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

async function buildSignedHookRequest(
  url: string,
  bodyText: string,
  secret: string,
) {
  const webhookId = "hook-123";
  const timestamp = `${Math.floor(Date.now() / 1000)}`;
  const signedContent = `${webhookId}.${timestamp}.${bodyText}`;
  const keyBytes = new TextEncoder().encode(secret);
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signatureBuffer = await crypto.subtle.sign(
    "HMAC",
    cryptoKey,
    new TextEncoder().encode(signedContent),
  );
  const signature = btoa(
    String.fromCharCode(...new Uint8Array(signatureBuffer)),
  );

  return new Request(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "webhook-id": webhookId,
      "webhook-timestamp": timestamp,
      "webhook-signature": `v1,${signature}`,
    },
    body: bodyText,
  });
}

Deno.test({
  name:
    "sms-hook stops after OTPIQ success and does not fall through to BulkSMSIraq",
  permissions: { env: true },
  fn: async () => {
    const originalFetch = globalThis.fetch;
    let otpiqCalls = 0;
    let bulkSmsCalls = 0;
    let otpiqRequestBody: Record<string, unknown> | null = null;

    try {
      globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(
          typeof input === "string"
            ? input
            : input instanceof URL
            ? input.toString()
            : input.url,
        );

        if (url.pathname.endsWith("/rest/v1/rpc/auth_sms_hook_claim_v1")) {
          return Promise.resolve(buildJsonResponse("claimed"));
        }
        if (url.pathname.endsWith("/rest/v1/rpc/rate_limit_consume")) {
          return Promise.resolve(
            buildJsonResponse({
              allowed: true,
              remaining: 4,
              reset_at: new Date(Date.now() + 60_000).toISOString(),
            }),
          );
        }
        if (
          url.pathname.endsWith(
            "/rest/v1/rpc/auth_sms_provider_health_status_v1",
          )
        ) {
          return Promise.resolve(
            buildJsonResponse({
              available: true,
              disabled_until: null,
              consecutive_failures: 0,
              last_http_status: null,
              last_error_code: null,
            }),
          );
        }
        if (
          url.pathname.endsWith(
            "/rest/v1/rpc/auth_sms_provider_health_on_success_v1",
          )
        ) {
          return Promise.resolve(buildJsonResponse({ ok: true }));
        }
        if (url.pathname.endsWith("/rest/v1/rpc/auth_sms_hook_complete_v1")) {
          return Promise.resolve(buildJsonResponse({ ok: true }));
        }
        if (url.pathname.endsWith("/rest/v1/app_events")) {
          return Promise.resolve(buildJsonResponse({ ok: true }, 201));
        }
        if (url.href === "https://api.otpiq.com/api/sms") {
          otpiqCalls += 1;
          otpiqRequestBody = JSON.parse(String(init?.body ?? "{}")) as Record<
            string,
            unknown
          >;
          return Promise.resolve(
            buildJsonResponse({
              message: "SMS task created successfully",
              smsId: "otp-123",
            }),
          );
        }
        if (url.href === "https://gateway.standingtech.com/api/v4/sms/send") {
          bulkSmsCalls += 1;
          return Promise.resolve(
            buildJsonResponse({
              status: "success",
              message_id: "bulk-123",
            }),
          );
        }

        return Promise.resolve(buildJsonResponse({}, 404));
      }) as typeof fetch;

      await withEnv(
        {
          SUPABASE_URL: "https://example.supabase.co",
          SUPABASE_SERVICE_ROLE_KEY: "sb_secret_test",
          AUTH_HOOK_SECRET: "v1,whsec_c21zLWhvb2stdGVzdC1zZWNyZXQ=",
          OTPIQ_API_KEY: "test-key",
          BULKSMSIRAQ_API_KEY: "bulk-key",
          BULKSMSIRAQ_SENDER_ID: "RideIQ",
        },
        async () => {
          const { handleSmsHook } = await import("../sms-hook/index.ts");
          const bodyText = JSON.stringify({
            user: { id: "user-1", phone: "+9647701234567" },
            sms: { otp: "123456" },
          });
          const request = await buildSignedHookRequest(
            "https://example.supabase.co/functions/v1/sms-hook",
            bodyText,
            "sms-hook-test-secret",
          );
          const response = await handleSmsHook(request);
          const body = await response.json();

          assertEquals(response.status, 200);
          assertEquals(body["ok"], true);
          assertEquals(body["provider"], "otpiq");
          assertEquals(otpiqCalls, 1);
          assertEquals(bulkSmsCalls, 0);
          assertEquals(otpiqRequestBody?.["smsType"], "verification");
          assertEquals(
            otpiqRequestBody?.["provider"],
            "whatsapp-telegram-sms",
          );
        },
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  },
});

Deno.test({
  name:
    "sms-hook treats accepted OTPIQ 2xx responses as final success and skips BulkSMSIraq fallback",
  permissions: { env: true },
  fn: async () => {
    const originalFetch = globalThis.fetch;
    let otpiqCalls = 0;
    let bulkSmsCalls = 0;

    try {
      globalThis.fetch = ((input: RequestInfo | URL) => {
        const url = new URL(
          typeof input === "string"
            ? input
            : input instanceof URL
            ? input.toString()
            : input.url,
        );

        if (url.pathname.endsWith("/rest/v1/rpc/auth_sms_hook_claim_v1")) {
          return Promise.resolve(buildJsonResponse("claimed"));
        }
        if (url.pathname.endsWith("/rest/v1/rpc/rate_limit_consume")) {
          return Promise.resolve(
            buildJsonResponse({
              allowed: true,
              remaining: 4,
              reset_at: new Date(Date.now() + 60_000).toISOString(),
            }),
          );
        }
        if (
          url.pathname.endsWith(
            "/rest/v1/rpc/auth_sms_provider_health_status_v1",
          )
        ) {
          return Promise.resolve(
            buildJsonResponse({
              available: true,
              disabled_until: null,
              consecutive_failures: 0,
              last_http_status: null,
              last_error_code: null,
            }),
          );
        }
        if (
          url.pathname.endsWith(
            "/rest/v1/rpc/auth_sms_provider_health_on_success_v1",
          )
        ) {
          return Promise.resolve(buildJsonResponse({ ok: true }));
        }
        if (url.pathname.endsWith("/rest/v1/rpc/auth_sms_hook_complete_v1")) {
          return Promise.resolve(buildJsonResponse({ ok: true }));
        }
        if (url.pathname.endsWith("/rest/v1/app_events")) {
          return Promise.resolve(buildJsonResponse({ ok: true }, 201));
        }
        if (url.href === "https://api.otpiq.com/api/sms") {
          otpiqCalls += 1;
          return Promise.resolve(
            buildJsonResponse({
              status: "accepted",
              message: "Verification code sent successfully",
            }),
          );
        }
        if (url.href === "https://gateway.standingtech.com/api/v4/sms/send") {
          bulkSmsCalls += 1;
          return Promise.resolve(
            buildJsonResponse({
              status: "success",
              message_id: "bulk-123",
            }),
          );
        }

        return Promise.resolve(buildJsonResponse({}, 404));
      }) as typeof fetch;

      await withEnv(
        {
          SUPABASE_URL: "https://example.supabase.co",
          SUPABASE_SERVICE_ROLE_KEY: "sb_secret_test",
          AUTH_HOOK_SECRET: "v1,whsec_c21zLWhvb2stdGVzdC1zZWNyZXQ=",
          OTPIQ_API_KEY: "test-key",
          BULKSMSIRAQ_API_KEY: "bulk-key",
          BULKSMSIRAQ_SENDER_ID: "RideIQ",
        },
        async () => {
          const { handleSmsHook } = await import("../sms-hook/index.ts");
          const bodyText = JSON.stringify({
            user: { id: "user-1", phone: "+9647701234567" },
            sms: { otp: "123456" },
          });
          const request = await buildSignedHookRequest(
            "https://example.supabase.co/functions/v1/sms-hook",
            bodyText,
            "sms-hook-test-secret",
          );
          const response = await handleSmsHook(request);
          const body = await response.json();

          assertEquals(response.status, 200);
          assertEquals(body["ok"], true);
          assertEquals(body["provider"], "otpiq");
          assertEquals(otpiqCalls, 1);
          assertEquals(bulkSmsCalls, 0);
        },
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  },
});
