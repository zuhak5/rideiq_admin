import { assertEquals } from "jsr:@std/assert";

import {
  OTP_PROVIDER_ORDER,
  sendViaBulkSMSIraq,
  sendViaOTPIQ,
} from "../_shared/smsProviders.ts";

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

Deno.test("OTP provider order is OTPIQ then BulkSMSIraq", () => {
  assertEquals(OTP_PROVIDER_ORDER, ["otpiq", "bulksmsiraq"]);
});

Deno.test({
  name: "sendViaOTPIQ maps success payload into structured result",
  permissions: { env: true },
  fn: async () => {
    const originalFetch = globalThis.fetch;
    let requestBody: Record<string, unknown> | null = null;

    try {
      globalThis.fetch = ((_, init?: RequestInit) => {
        requestBody = JSON.parse(String(init?.body ?? "{}")) as Record<
          string,
          unknown
        >;
        return Promise.resolve(
          new Response(
            JSON.stringify({
              message: "SMS task created successfully",
              smsId: "otp-123",
            }),
            {
              status: 200,
              headers: { "content-type": "application/json" },
            },
          ),
        );
      }) as typeof fetch;

      await withEnv(
        {
          OTPIQ_API_KEY: "test-key",
          OTPIQ_PROVIDER: "sms",
        },
        async () => {
          const result = await sendViaOTPIQ({
            phone: "+9647701234567",
            otp: "123456",
          });

          assertEquals(result.ok, true);
          assertEquals(result.provider, "otpiq");
          assertEquals(result.messageId, "otp-123");
          assertEquals(result.retryable, false);
          assertEquals(requestBody?.["phoneNumber"], "9647701234567");
          assertEquals(requestBody?.["verificationCode"], "123456");
          assertEquals(requestBody?.["smsType"], "verification");
          assertEquals(requestBody?.["provider"], "whatsapp-telegram-sms");
        },
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  },
});

Deno.test({
  name: "sendViaOTPIQ treats accepted 2xx responses without smsId as success",
  permissions: { env: true },
  fn: async () => {
    const originalFetch = globalThis.fetch;
    let requestBody: Record<string, unknown> | null = null;

    try {
      globalThis.fetch = ((_, init?: RequestInit) => {
        requestBody = JSON.parse(String(init?.body ?? "{}")) as Record<
          string,
          unknown
        >;
        return Promise.resolve(
          new Response(
            JSON.stringify({
              status: "accepted",
              message: "Verification code sent successfully",
            }),
            {
              status: 200,
              headers: { "content-type": "application/json" },
            },
          ),
        );
      }) as typeof fetch;

      await withEnv(
        {
          OTPIQ_API_KEY: "test-key",
          OTPIQ_PROVIDER: "sms",
        },
        async () => {
          const result = await sendViaOTPIQ({
            phone: "+9647701234567",
            otp: "123456",
          });

          assertEquals(result.ok, true);
          assertEquals(result.provider, "otpiq");
          assertEquals(result.messageId, undefined);
          assertEquals(requestBody?.["smsType"], "verification");
          assertEquals(requestBody?.["provider"], "whatsapp-telegram-sms");
        },
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  },
});

Deno.test({
  name:
    "sendViaOTPIQ ignores env overrides and forces the configured multi-channel provider",
  permissions: { env: true },
  fn: async () => {
    const originalFetch = globalThis.fetch;
    let requestBody: Record<string, unknown> | null = null;

    try {
      globalThis.fetch = ((_, init?: RequestInit) => {
        requestBody = JSON.parse(String(init?.body ?? "{}")) as Record<
          string,
          unknown
        >;
        return Promise.resolve(
          new Response(
            JSON.stringify({
              message: "SMS task created successfully",
              smsId: "otp-456",
            }),
            {
              status: 200,
              headers: { "content-type": "application/json" },
            },
          ),
        );
      }) as typeof fetch;

      await withEnv(
        {
          OTPIQ_API_KEY: "test-key",
          OTPIQ_PROVIDER: "sms",
        },
        async () => {
          const result = await sendViaOTPIQ({
            phone: "+9647701234567",
            otp: "123456",
          });

          assertEquals(result.ok, true);
          assertEquals(result.provider, "otpiq");
          assertEquals(requestBody?.["provider"], "whatsapp-telegram-sms");
        },
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  },
});

Deno.test({
  name: "sendViaOTPIQ classifies trial-mode failures as non-retryable",
  permissions: { env: true },
  fn: async () => {
    const originalFetch = globalThis.fetch;

    try {
      globalThis.fetch = (() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              message: "Trial mode can only send to the owner number.",
            }),
            {
              status: 403,
              headers: { "content-type": "application/json" },
            },
          ),
        )) as typeof fetch;

      await withEnv(
        {
          OTPIQ_API_KEY: "test-key",
          OTPIQ_PROVIDER: "sms",
        },
        async () => {
          const result = await sendViaOTPIQ({
            phone: "+9647701234567",
            otp: "123456",
          });

          assertEquals(result.ok, false);
          assertEquals(result.provider, "otpiq");
          assertEquals(result.providerErrorCode, "trial_mode_restriction");
          assertEquals(result.retryable, false);
        },
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  },
});

Deno.test({
  name: "sendViaBulkSMSIraq maps quota failures into structured codes",
  permissions: { env: true },
  fn: async () => {
    const originalFetch = globalThis.fetch;
    let requestBody: Record<string, unknown> | null = null;

    try {
      globalThis.fetch = ((_, init?: RequestInit) => {
        requestBody = JSON.parse(String(init?.body ?? "{}")) as Record<
          string,
          unknown
        >;
        return Promise.resolve(
          new Response(
            JSON.stringify({
              errors: [
                {
                  code: "1906",
                  message:
                    "Hourly Limit Exceeded please contact admin to whitelist required numbers",
                },
              ],
            }),
            {
              status: 403,
              headers: { "content-type": "application/json" },
            },
          ),
        );
      }) as typeof fetch;

      await withEnv(
        {
          BULKSMSIRAQ_API_KEY: "test-key",
          BULKSMSIRAQ_SENDER_ID: "RideIQ",
        },
        async () => {
          const result = await sendViaBulkSMSIraq({
            phone: "+9647701234567",
            message: "RideIQ verification code: 123456",
          });

          assertEquals(result.ok, false);
          assertEquals(result.provider, "bulksmsiraq");
          assertEquals(result.providerErrorCode, "1906");
          assertEquals(result.retryable, false);
          assertEquals(requestBody?.["recipient"], "9647701234567");
          assertEquals(requestBody?.["type"], "plain");
        },
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  },
});
