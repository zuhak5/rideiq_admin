import { assertEquals } from "jsr:@std/assert";

import {
  isAllowedMapsUsageOrigin,
  isTelemetryOriginSatisfied,
} from "../maps-usage/policy.ts";

Deno.test("isAllowedMapsUsageOrigin allows server-side callers without an Origin header", () => {
  assertEquals(
    isAllowedMapsUsageOrigin(null, ["https://app.rideiq.com"]),
    true,
  );
});

Deno.test("isTelemetryOriginSatisfied rejects anonymous telemetry tokens when Origin is missing", () => {
  assertEquals(
    isTelemetryOriginSatisfied({
      requestOrigin: null,
      tokenOrigin: "https://app.rideiq.com",
      hasAuthenticatedUser: false,
    }),
    false,
  );
});

Deno.test("isTelemetryOriginSatisfied accepts matching browser origins", () => {
  assertEquals(
    isTelemetryOriginSatisfied({
      requestOrigin: "https://app.rideiq.com",
      tokenOrigin: "https://app.rideiq.com",
      hasAuthenticatedUser: false,
    }),
    true,
  );
});

Deno.test("isTelemetryOriginSatisfied allows authenticated callers without an Origin header", () => {
  assertEquals(
    isTelemetryOriginSatisfied({
      requestOrigin: null,
      tokenOrigin: "https://app.rideiq.com",
      hasAuthenticatedUser: true,
    }),
    true,
  );
});
