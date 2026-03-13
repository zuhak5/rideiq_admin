import { assertEquals } from "jsr:@std/assert";

import {
  buildEnabledCapabilityMap,
  isProviderEligibleForRenderRequest,
  resolveRenderRequestRequiredCapabilities,
} from "../_shared/geo/providerEligibility.ts";
import type { ProviderCode } from "../_shared/geo/types.ts";

Deno.test("browser render requests keep omitted required capabilities empty", () => {
  const required = resolveRenderRequestRequiredCapabilities({
    capability: "render",
    requiredCapabilities: [],
    origin: "https://rideiqadmin.vercel.app",
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
  });

  assertEquals(required, []);
});

Deno.test("native render requests default to geo-safe capabilities when omitted", () => {
  const required = resolveRenderRequestRequiredCapabilities({
    capability: "render",
    requiredCapabilities: [],
    origin: null,
    userAgent: "Dart/3.10 (dart:io)",
  });

  assertEquals(required, ["geocode", "directions"]);
});

Deno.test("native Dart render requests stay geo-safe with a synthetic origin header", () => {
  const required = resolveRenderRequestRequiredCapabilities({
    capability: "render",
    requiredCapabilities: [],
    origin: "http://localhost:5173",
    userAgent: "Dart/3.10 (dart:io)",
  });

  assertEquals(required, ["geocode", "directions"]);
});

Deno.test("legacy browser render requests remain eligible without geo server keys", () => {
  const enabledCapabilities = buildEnabledCapabilityMap([
    { provider_code: "google", capability: "render", enabled: true },
  ]);

  const eligible = isProviderEligibleForRenderRequest({
    provider: "google",
    supportedProviders: new Set<ProviderCode>(["google", "mapbox", "here"]),
    requiredCapabilities: [],
    enabledCapabilities,
    hasRenderKey: (provider) => provider === "google",
    hasGeoServerKey: () => false,
  });

  assertEquals(eligible, true);
});

Deno.test("render requests with required geo capabilities skip providers without matching geo keys", () => {
  const enabledCapabilities = buildEnabledCapabilityMap([
    { provider_code: "google", capability: "render", enabled: true },
    { provider_code: "google", capability: "geocode", enabled: true },
    { provider_code: "google", capability: "directions", enabled: true },
    { provider_code: "here", capability: "render", enabled: true },
    { provider_code: "here", capability: "geocode", enabled: true },
    { provider_code: "here", capability: "directions", enabled: true },
  ]);

  const googleEligible = isProviderEligibleForRenderRequest({
    provider: "google",
    supportedProviders: new Set<ProviderCode>(["google", "mapbox", "here"]),
    requiredCapabilities: ["geocode", "directions"],
    enabledCapabilities,
    hasRenderKey: (provider) => provider === "google" || provider === "here",
    hasGeoServerKey: (provider) => provider === "here",
  });
  const hereEligible = isProviderEligibleForRenderRequest({
    provider: "here",
    supportedProviders: new Set<ProviderCode>(["google", "mapbox", "here"]),
    requiredCapabilities: ["geocode", "directions"],
    enabledCapabilities,
    hasRenderKey: (provider) => provider === "google" || provider === "here",
    hasGeoServerKey: (provider) => provider === "here",
  });

  assertEquals(googleEligible, false);
  assertEquals(hereEligible, true);
});

Deno.test("fallback eligibility requires render plus every requested geo capability", () => {
  const enabledCapabilities = buildEnabledCapabilityMap([
    { provider_code: "google", capability: "render", enabled: true },
    { provider_code: "google", capability: "geocode", enabled: true },
    { provider_code: "google", capability: "directions", enabled: true },
    { provider_code: "mapbox", capability: "render", enabled: true },
    { provider_code: "mapbox", capability: "geocode", enabled: true },
    { provider_code: "here", capability: "render", enabled: true },
    { provider_code: "here", capability: "geocode", enabled: true },
    { provider_code: "here", capability: "directions", enabled: true },
  ]);

  const fallbackOrder = (["google", "mapbox", "here"] as ProviderCode[]).filter(
    (provider) =>
      isProviderEligibleForRenderRequest({
        provider,
        supportedProviders: new Set<ProviderCode>(["google", "mapbox", "here"]),
        requiredCapabilities: ["geocode", "directions"],
        enabledCapabilities,
        hasRenderKey: () => true,
        hasGeoServerKey: () => true,
      }),
  );

  assertEquals(fallbackOrder, ["google", "here"]);
});
