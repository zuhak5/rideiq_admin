import { assertEquals, assertMatch } from "jsr:@std/assert";

Deno.test({
  name: "auth-captcha returns browser challenge HTML with default app redirect",
  fn: async () => {
    const { handleAuthCaptcha } = await import("../auth-captcha/index.ts");
    const response = await handleAuthCaptcha(
      new Request(
        "https://example.supabase.co/functions/v1/auth-captcha?state=test-state&site_key=test-site-key",
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
  },
});

Deno.test("auth-captcha rejects missing state", async () => {
  const { handleAuthCaptcha } = await import("../auth-captcha/index.ts");
  const response = await handleAuthCaptcha(
    new Request(
      "https://example.supabase.co/functions/v1/auth-captcha?site_key=test-site-key",
    ),
  );
  const body = await response.json();

  assertEquals(response.status, 400);
  assertEquals(body["code"], "STATE_REQUIRED");
});
