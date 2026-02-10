import { unstable_noStore as noStore } from 'next/cache';
import type { SupabaseClient } from '@supabase/supabase-js';
import { invokeEdgeFunction } from '@/lib/supabase/edge';

export type PricingConfigRow = {
  id: string;
  name: string | null;
  version: number;
  is_default: boolean;
  effective_from: string;
  effective_to: string | null;
  base_fare_iqd: number;
  per_km_iqd: number;
  per_min_iqd: number;
  minimum_fare_iqd: number;
  max_surge_multiplier: number;
  active: boolean;
  updated_at: string;
};

export async function listPricingConfigs(
  supabase: SupabaseClient,
  args: { q?: string; limit?: number; offset?: number } = {},
): Promise<{
  configs: PricingConfigRow[];
  page: { limit: number; offset: number; returned: number };
}> {
  noStore();
  const data = await invokeEdgeFunction<{
    ok: boolean;
    configs: PricingConfigRow[];
    page: { limit: number; offset: number; returned: number };
  }>(supabase, 'admin-api', {
    path: 'admin-pricing-configs-list',
    method: 'POST',
    body: {
      q: args.q ?? '',
      limit: args.limit ?? 50,
      offset: args.offset ?? 0,
    },
  });
  return { configs: data.configs ?? [], page: data.page };
}

export async function setDefaultPricingConfig(
  supabase: SupabaseClient,
  pricingConfigId: string,
): Promise<void> {
  await invokeEdgeFunction<{ ok: boolean }>(supabase, 'admin-api', {
    path: 'admin-pricing-config-set-default',
    method: 'POST',
    body: { pricing_config_id: pricingConfigId },
  });
}

export async function updatePricingCaps(
  supabase: SupabaseClient,
  args: { pricingConfigId: string; maxSurgeMultiplier: number },
): Promise<void> {
  await invokeEdgeFunction<{ ok: boolean }>(supabase, 'admin-api', {
    path: 'admin-pricing-config-update-caps',
    method: 'POST',
    body: { pricing_config_id: args.pricingConfigId, max_surge_multiplier: args.maxSurgeMultiplier },
  });
}

export async function clonePricingConfig(
  supabase: SupabaseClient,
  args: {
    sourceId: string;
    name?: string;
    effectiveFromIso?: string;
    active?: boolean;
    setDefault?: boolean;
  },
): Promise<{ id: string }> {
  const data = await invokeEdgeFunction<{ ok: boolean; id: string }>(supabase, 'admin-api', {
    path: 'admin-pricing-config-clone',
    method: 'POST',
    body: {
      pricing_config_id: args.sourceId,
      name: args.name,
      effective_from: args.effectiveFromIso,
      active: args.active,
      set_default: args.setDefault,
    },
  });
  return { id: data.id };
}
