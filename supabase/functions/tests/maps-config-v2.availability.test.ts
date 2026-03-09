import { assertEquals } from "jsr:@std/assert";

import {
  buildEnabledCapabilityMap,
  isProviderEligibleForRenderRequest,
} from "../_shared/geo/providerEligibility.ts";
import type { ProviderCode } from "../_shared/geo/types.ts";

Deno.test("legacy render requests remain eligible without geo server keys", () => {
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
