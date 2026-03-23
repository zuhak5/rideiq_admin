import { assertEquals, assertMatch } from "jsr:@std/assert";

function restoreEnv(key: string, value: string | undefined) {
  if (value === undefined) {
    Deno.env.delete(key);
    return;
  }
  Deno.env.set(key, value);
}

Deno.test({
  name: "auth-captcha returns browser challenge HTML with default app redirect",
  fn: async () => {
    const previousSiteKey = Deno.env.get("AUTH_TURNSTILE_SITE_KEY");
    const { handleAuthCaptcha } = await import("../auth-captcha/index.ts");
    try {
      Deno.env.set("AUTH_TURNSTILE_SITE_KEY", "test-site-key");
      const response = await handleAuthCaptcha(
        new Request(
          "https://example.supabase.co/functions/v1/auth-captcha?state=test-state",
        ),
      );
      const html = await response.text();

      assertEquals(response.status, 200);
      assertEquals(
        response.headers.get("content-type"),
        "text/html; charset=utf-8",
      );
      assertMatch(html, /test-site-key/);
      assertMatch(html, /rabi7:\/\/auth\/captcha/);
      assertMatch(html, /test-state/);
    } finally {
      restoreEnv("AUTH_TURNSTILE_SITE_KEY", previousSiteKey);
    }
  },
});

Deno.test("auth-captcha rejects missing state", async () => {
  const previousSiteKey = Deno.env.get("AUTH_TURNSTILE_SITE_KEY");
  const { handleAuthCaptcha } = await import("../auth-captcha/index.ts");
  try {
    Deno.env.set("AUTH_TURNSTILE_SITE_KEY", "test-site-key");
    const response = await handleAuthCaptcha(
      new Request(
        "https://example.supabase.co/functions/v1/auth-captcha",
      ),
    );
    const body = await response.json();

    assertEquals(response.status, 400);
    assertEquals(body["code"], "STATE_REQUIRED");
  } finally {
    restoreEnv("AUTH_TURNSTILE_SITE_KEY", previousSiteKey);
  }
});

Deno.test("auth-captcha still accepts site_key query param for compatibility", async () => {
  const previousSiteKey = Deno.env.get("AUTH_TURNSTILE_SITE_KEY");
  const { handleAuthCaptcha } = await import("../auth-captcha/index.ts");
  try {
    Deno.env.delete("AUTH_TURNSTILE_SITE_KEY");
    const response = await handleAuthCaptcha(
      new Request(
        "https://example.supabase.co/functions/v1/auth-captcha?state=test-state&site_key=compat-site-key",
      ),
    );
    const html = await response.text();

    assertEquals(response.status, 200);
    assertMatch(html, /compat-site-key/);
  } finally {
    restoreEnv("AUTH_TURNSTILE_SITE_KEY", previousSiteKey);
  }
});
