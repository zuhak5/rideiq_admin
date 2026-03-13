import { errorJson } from "../_shared/json.ts";

export function handleLegacyMapsConfig(_req: Request): Response {
  return errorJson(
    "This maps config endpoint has been replaced. Use maps-config-v2 instead.",
    410,
    "MAPS_CONFIG_LEGACY_DISABLED",
  );
}

if (import.meta.main) {
  Deno.serve(handleLegacyMapsConfig);
}
