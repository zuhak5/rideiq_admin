import {
  ALL_PROVIDER_CODES,
  type Capability,
  isProviderCode,
  type ProviderCode,
} from "./types.ts";

export type RequiredGeoCapability = Exclude<Capability, "render">;
export type RenderRequestCapability = "render" | Capability;

const REQUIRED_GEO_CAPABILITIES = [
  "directions",
  "geocode",
  "distance_matrix",
] as const;

export function normalizeRequiredCapabilities(
  input: unknown,
): RequiredGeoCapability[] {
  if (!Array.isArray(input)) return [];

  const required = new Set<RequiredGeoCapability>();
  for (const value of input) {
    const normalized = typeof value === "string"
      ? value.trim().toLowerCase()
      : "";
    if ((REQUIRED_GEO_CAPABILITIES as readonly string[]).includes(normalized)) {
      required.add(normalized as RequiredGeoCapability);
    }
  }
  return [...required];
}

export function resolveRenderRequestRequiredCapabilities(params: {
  capability: RenderRequestCapability;
  requiredCapabilities: readonly RequiredGeoCapability[];
  origin: string | null;
  userAgent?: string | null;
}): RequiredGeoCapability[] {
  if (params.capability !== "render") {
    return [...params.requiredCapabilities];
  }
  if (params.requiredCapabilities.length > 0) {
    return [...params.requiredCapabilities];
  }
  if (params.origin && !isNativeDartCaller(params.userAgent)) {
    return [];
  }

  // Native Flutter callers use Dart's HTTP stack. Some app builds still attach
  // a synthetic local Origin header, so the user agent is the reliable signal
  // for keeping them on the geo-capable renderer contract.
  return ["geocode", "directions"];
}

function isNativeDartCaller(userAgent: string | null | undefined): boolean {
  const normalized = typeof userAgent === "string"
    ? userAgent.trim().toLowerCase()
    : "";
  return normalized.startsWith("dart/");
}

export function buildEnabledCapabilityMap(
  rows: Array<{
    provider_code: unknown;
    capability: unknown;
    enabled: unknown;
  }>,
): Map<ProviderCode, Set<RenderRequestCapability>> {
  const enabledCapabilities = new Map<
    ProviderCode,
    Set<RenderRequestCapability>
  >();

  for (const row of rows) {
    if (!row?.enabled) continue;
    const provider = typeof row.provider_code === "string"
      ? row.provider_code.trim().toLowerCase()
      : "";
    const capability = typeof row.capability === "string"
      ? row.capability.trim().toLowerCase()
      : "";
    if (!isProviderCode(provider)) continue;
    if (
      !["render", "directions", "geocode", "distance_matrix"].includes(
        capability,
      )
    ) continue;

    const providerSet = enabledCapabilities.get(provider) ??
      new Set<RenderRequestCapability>();
    providerSet.add(capability as RenderRequestCapability);
    enabledCapabilities.set(provider, providerSet);
  }

  return enabledCapabilities;
}

export function providerHasEnabledCapabilities(
  provider: ProviderCode,
  requiredCapabilities: readonly RenderRequestCapability[],
  enabledCapabilities: Map<ProviderCode, Set<RenderRequestCapability>>,
): boolean {
  if (!requiredCapabilities.length) return true;
  const providerCapabilities = enabledCapabilities.get(provider);
  if (!providerCapabilities) return false;
  return requiredCapabilities.every((capability) =>
    providerCapabilities.has(capability)
  );
}

export function isProviderEligibleForRenderRequest(params: {
  provider: ProviderCode;
  supportedProviders: ReadonlySet<ProviderCode>;
  requiredCapabilities: readonly RequiredGeoCapability[];
  enabledCapabilities: Map<ProviderCode, Set<RenderRequestCapability>>;
  hasRenderKey: (provider: ProviderCode) => boolean;
  hasGeoServerKey: (provider: ProviderCode) => boolean;
}): boolean {
  if (!params.supportedProviders.has(params.provider)) return false;
  if (!params.hasRenderKey(params.provider)) return false;
  if (!params.requiredCapabilities.length) return true;
  if (!params.hasGeoServerKey(params.provider)) return false;

  return providerHasEnabledCapabilities(
    params.provider,
    ["render", ...params.requiredCapabilities],
    params.enabledCapabilities,
  );
}

export function googleAllowedForRenderer(
  renderer: ProviderCode | null,
): boolean {
  return renderer === "google";
}

export function mapboxAllowedForRenderer(
  renderer: ProviderCode | null,
): boolean {
  return renderer === "mapbox";
}

export type GeoProviderSelectionState = {
  exclude: ProviderCode[];
  complianceExcluded: ProviderCode[];
  missingServerKeys: ProviderCode[];
};

export function buildGeoProviderSelectionState(params: {
  renderer: ProviderCode | null;
  initialExclude?: ProviderCode[];
  providers?: readonly ProviderCode[];
  hasGeoServerKey: (provider: ProviderCode) => boolean;
}): GeoProviderSelectionState {
  const exclude = [...new Set(params.initialExclude ?? [])];
  const complianceExcluded: ProviderCode[] = [];
  const missingServerKeys: ProviderCode[] = [];

  if (!googleAllowedForRenderer(params.renderer)) {
    complianceExcluded.push("google");
    if (!exclude.includes("google")) exclude.push("google");
  }
  if (!mapboxAllowedForRenderer(params.renderer)) {
    complianceExcluded.push("mapbox");
    if (!exclude.includes("mapbox")) exclude.push("mapbox");
  }

  for (const provider of params.providers ?? ALL_PROVIDER_CODES) {
    if (!params.hasGeoServerKey(provider) && !exclude.includes(provider)) {
      exclude.push(provider);
      missingServerKeys.push(provider);
    }
  }

  return {
    exclude,
    complianceExcluded,
    missingServerKeys,
  };
}
