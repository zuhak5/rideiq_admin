import { assertEquals } from "jsr:@std/assert";

import {
  canServeMapsConfigRequest,
  getMapsConfigRequestDenialCode,
  isAllowedMapsConfigOrigin,
  isNativeMapsConfigRequest,
} from "../maps-config-v2/policy.ts";

Deno.test("isAllowedMapsConfigOrigin rejects callers without an Origin header", () => {
  assertEquals(
    isAllowedMapsConfigOrigin(null, ["https://app.rideiq.com"]),
    false,
  );
});

Deno.test("isNativeMapsConfigRequest allows explicit mobile callers without an Origin header", () => {
  assertEquals(
    isNativeMapsConfigRequest({
      origin: null,
      userAgent: "curl/8.0.0",
      clientPlatform: "mobile",
    }),
    true,
  );
});

Deno.test("isNativeMapsConfigRequest allows Dart callers without an Origin header", () => {
  assertEquals(
    isNativeMapsConfigRequest({
      origin: null,
      userAgent: "Dart/3.10 (dart:io)",
      clientPlatform: null,
    }),
    true,
  );
});

Deno.test("isNativeMapsConfigRequest allows Dart callers with a synthetic localhost Origin header", () => {
  assertEquals(
    isNativeMapsConfigRequest({
      origin: "http://localhost:5173",
      userAgent: "Dart/3.10 (dart:io)",
      clientPlatform: null,
    }),
    true,
  );
});

Deno.test("canServeMapsConfigRequest allows allowed browser origins", () => {
  assertEquals(
    canServeMapsConfigRequest({
      origin: "https://app.rideiq.com",
      allowedOrigins: ["https://app.rideiq.com"],
      userAgent: "Mozilla/5.0",
      clientPlatform: null,
    }),
    true,
  );
});

Deno.test("getMapsConfigRequestDenialCode returns origin_not_allowed for disallowed browser origins", () => {
  assertEquals(
    getMapsConfigRequestDenialCode({
      origin: "https://rideiqadmin.vercel.app",
      allowedOrigins: ["https://app.rideiq.com"],
      userAgent: "Mozilla/5.0",
      clientPlatform: null,
    }),
    "origin_not_allowed",
  );
});

Deno.test("getMapsConfigRequestDenialCode returns missing_origin for unknown non-browser callers", () => {
  assertEquals(
    getMapsConfigRequestDenialCode({
      origin: null,
      allowedOrigins: ["https://app.rideiq.com"],
      userAgent: "curl/8.0.0",
      clientPlatform: null,
    }),
    "missing_origin",
  );
});
