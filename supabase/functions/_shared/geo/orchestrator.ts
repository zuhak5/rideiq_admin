import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.92.0';
import { sha256Hex } from './hash.ts';
import { Capability, ProviderCode } from './types.ts';
import { createServiceClient } from '../supabase.ts';

export function createServiceClientForGeo(): SupabaseClient {
  return createServiceClient();
}

export async function pickProvider(
  supabase: SupabaseClient,
  capability: Capability,
  exclude: ProviderCode[],
): Promise<ProviderCode | null> {
  const { data, error } = await supabase.rpc('maps_pick_provider_v4', {
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
    .from('maps_providers')
    .select('language, region, enabled, cache_enabled, cache_ttl_seconds')
    .eq('provider_code', provider)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return {
    language: (data as any).language ?? 'ar',
    region: (data as any).region ?? 'IQ',
    enabled: Boolean((data as any).enabled),
    cache_enabled: Boolean((data as any).cache_enabled),
    cache_ttl_seconds:
      typeof (data as any).cache_ttl_seconds === 'number' && Number.isFinite((data as any).cache_ttl_seconds)
        ? Math.trunc((data as any).cache_ttl_seconds)
        : null,
  };
}

function envFirstNonEmpty(...names: string[]): string {
  for (const name of names) {
    const value = (Deno.env.get(name) ?? '').trim();
    if (value) return value;
  }
  return '';
}

export function providerHasServerKey(provider: ProviderCode): boolean {
  switch (provider) {
    case 'google':
      return envFirstNonEmpty('MAPS_SERVER_KEY', 'GOOGLE_MAPS_SERVER_KEY').length > 0;
    case 'mapbox':
      return envFirstNonEmpty('MAPBOX_SECRET_TOKEN', 'MAPBOX_PUBLIC_TOKEN').length > 0;
    case 'here':
      return envFirstNonEmpty('HERE_API_KEY').length > 0;
    case 'thunderforest':
      return envFirstNonEmpty('THUNDERFOREST_API_KEY').length > 0;
    case 'ors':
      return envFirstNonEmpty('ORS_API_KEY', 'OPENROUTESERVICE_API_KEY').length > 0;
    default:
      return false;
  }
}

export function getServerKey(provider: ProviderCode): string {
  switch (provider) {
    case 'google':
      return envFirstNonEmpty('MAPS_SERVER_KEY', 'GOOGLE_MAPS_SERVER_KEY');
    case 'mapbox':
      return envFirstNonEmpty('MAPBOX_SECRET_TOKEN', 'MAPBOX_PUBLIC_TOKEN');
    case 'here':
      return envFirstNonEmpty('HERE_API_KEY');
    case 'thunderforest':
      return envFirstNonEmpty('THUNDERFOREST_API_KEY');
    case 'ors':
      return envFirstNonEmpty('ORS_API_KEY', 'OPENROUTESERVICE_API_KEY');
  }
}

export async function makeCacheKey(parts: Record<string, unknown>): Promise<string> {
  const json = JSON.stringify(parts, Object.keys(parts).sort());
  return sha256Hex(json);
}
