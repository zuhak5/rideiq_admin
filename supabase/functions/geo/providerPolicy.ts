import { errorJson } from "../_shared/json.ts";
import type { Capability, ProviderCode } from "../_shared/geo/types.ts";
import type { GeoProviderSelectionState } from "../_shared/geo/providerEligibility.ts";

type Action = "route" | "geocode" | "reverse" | "matrix";

export function buildNoProviderErrorResponse(params: {
  action: Action;
  capability: Capability;
  renderer: ProviderCode | null;
  requestId: string;
  selectionState: GeoProviderSelectionState;
}) {
  return errorJson(
    "No provider available for this capability",
    503,
    "no_provider",
    {
      action: params.action,
      capability: params.capability,
      renderer: params.renderer,
      request_id: params.requestId,
      exclude: params.selectionState.exclude,
      compliance_excluded: params.selectionState.complianceExcluded,
      missing_server_keys: params.selectionState.missingServerKeys.length
        ? params.selectionState.missingServerKeys
        : undefined,
    },
  );
}
