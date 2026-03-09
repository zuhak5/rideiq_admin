import type { SupabaseClient } from "npm:@supabase/supabase-js@2.92.0";
import { sha256Hex } from "./hash.ts";
import { Capability, ProviderCode } from "./types.ts";
import { createServiceClient } from "../supabase.ts";
import { getGeoServerKey, providerHasGeoServerKey } from "./providerKeys.ts";

export function createServiceClientForGeo(): SupabaseClient {
  return createServiceClient();
}

export async function pickProvider(
  supabase: SupabaseClient,
  capability: Capability,
  exclude: ProviderCode[],
): Promise<ProviderCode | null> {
  const { data, error } = await supabase.rpc("maps_pick_provider_v4", {
    p_capability: capability,
    p_exclude: exclude,
  });
  if (error) throw error;
  if (!data) return null;
  return data as ProviderCode;
}

export async function getProviderDefaults(
  supabase: SupabaseClient,
  provider: ProviderCode,
): Promise<
  | {
    language: string;
    region: string;
    enabled: boolean;
    cache_enabled: boolean;
    cache_ttl_seconds: number | null;
  }
  | null
> {
  const { data, error } = await supabase
    .from("maps_providers")
    .select("language, region, enabled, cache_enabled, cache_ttl_seconds")
    .eq("provider_code", provider)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return {
    language: (data as any).language ?? "ar",
    region: (data as any).region ?? "IQ",
    enabled: Boolean((data as any).enabled),
    cache_enabled: Boolean((data as any).cache_enabled),
    cache_ttl_seconds: typeof (data as any).cache_ttl_seconds === "number" &&
        Number.isFinite((data as any).cache_ttl_seconds)
      ? Math.trunc((data as any).cache_ttl_seconds)
      : null,
  };
}

export function providerHasServerKey(provider: ProviderCode): boolean {
  return providerHasGeoServerKey(provider);
}

export function getServerKey(provider: ProviderCode): string {
  return getGeoServerKey(provider);
}

export async function makeCacheKey(
  parts: Record<string, unknown>,
): Promise<string> {
  const json = JSON.stringify(parts, Object.keys(parts).sort());
  return sha256Hex(json);
}
