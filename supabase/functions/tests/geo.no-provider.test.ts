import { assertEquals } from "jsr:@std/assert";

import { buildGeoProviderSelectionState } from "../_shared/geo/providerEligibility.ts";
import { buildNoProviderErrorResponse } from "../geo/providerPolicy.ts";

Deno.test("geo no_provider response exposes missing keys, compliance exclusions, and request id", async () => {
  const selectionState = buildGeoProviderSelectionState({
    renderer: "here",
    hasGeoServerKey: (provider) => provider !== "here",
  });

  assertEquals(selectionState.exclude, ["google", "mapbox", "here"]);
  assertEquals(selectionState.complianceExcluded, ["google", "mapbox"]);
  assertEquals(selectionState.missingServerKeys, ["here"]);

  const response = buildNoProviderErrorResponse({
    action: "geocode",
    capability: "geocode",
    renderer: "here",
    requestId: "req-123",
    selectionState,
  });
  const body = await response.json();

  assertEquals(response.status, 503);
  assertEquals(body.code, "no_provider");
  assertEquals(body.renderer, "here");
  assertEquals(body.request_id, "req-123");
  assertEquals(body.exclude, ["google", "mapbox", "here"]);
  assertEquals(body.compliance_excluded, ["google", "mapbox"]);
  assertEquals(body.missing_server_keys, ["here"]);
});
