import { assertEquals } from "jsr:@std/assert";

import { resolveOriginAllowlist } from "../_shared/cors.ts";

Deno.test("resolveOriginAllowlist drops default dev origins when explicit origins are configured", () => {
  const allowlist = resolveOriginAllowlist({
    corsAllowOrigins: "https://app.rideiq.com",
    includeDefaultOrigins: false,
  });

  assertEquals(allowlist.includes("https://app.rideiq.com"), true);
  assertEquals(allowlist.includes("http://localhost:5173"), false);
  assertEquals(allowlist.includes("https://rideiqadmin.vercel.app"), false);
});

Deno.test("resolveOriginAllowlist includes APP_ORIGIN and APP_BASE_URL in the effective allowlist", () => {
  const allowlist = resolveOriginAllowlist({
    corsAllowOrigins: "https://admin.rideiq.com",
    appOrigin: "https://app.rideiq.com/login",
    appBaseUrl: "https://api.rideiq.com/v1",
    includeDefaultOrigins: false,
  });

  assertEquals(allowlist, [
    "https://admin.rideiq.com",
    "https://app.rideiq.com",
    "https://api.rideiq.com",
  ]);
});

Deno.test("resolveOriginAllowlist can opt into default origins alongside explicit ones", () => {
  const allowlist = resolveOriginAllowlist({
    corsAllowOrigins: "https://app.rideiq.com",
    includeDefaultOrigins: true,
  });

  assertEquals(allowlist.includes("https://app.rideiq.com"), true);
  assertEquals(allowlist.includes("http://localhost:3000"), true);
});
