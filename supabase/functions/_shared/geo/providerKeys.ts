import { envTrim } from "../config.ts";
import type { ProviderCode } from "./types.ts";

function envFirstNonEmpty(...names: string[]): string {
  for (const name of names) {
    const value = envTrim(name);
    if (value) return value;
  }
  return "";
}

export function providerHasClientRenderKey(provider: ProviderCode): boolean {
  switch (provider) {
    case "google":
      return envFirstNonEmpty("MAPS_CLIENT_KEY", "GOOGLE_MAPS_CLIENT_KEY")
        .length > 0;
    case "mapbox":
      return envFirstNonEmpty("MAPBOX_PUBLIC_TOKEN").length > 0;
    case "here":
      return envFirstNonEmpty("HERE_API_KEY").length > 0;
    default:
      return false;
  }
}

export function providerHasGeoServerKey(provider: ProviderCode): boolean {
  switch (provider) {
    case "google":
      return envFirstNonEmpty("MAPS_SERVER_KEY", "GOOGLE_MAPS_SERVER_KEY")
        .length > 0;
    case "mapbox":
      return envFirstNonEmpty("MAPBOX_SECRET_TOKEN", "MAPBOX_PUBLIC_TOKEN")
        .length > 0;
    case "here":
      return envFirstNonEmpty("HERE_API_KEY").length > 0;
    default:
      return false;
  }
}

export function getGeoServerKey(provider: ProviderCode): string {
  switch (provider) {
    case "google":
      return envFirstNonEmpty("MAPS_SERVER_KEY", "GOOGLE_MAPS_SERVER_KEY");
    case "mapbox":
      return envFirstNonEmpty("MAPBOX_SECRET_TOKEN", "MAPBOX_PUBLIC_TOKEN");
    case "here":
      return envFirstNonEmpty("HERE_API_KEY");
  }
}
