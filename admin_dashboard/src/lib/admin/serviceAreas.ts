import { unstable_noStore as noStore } from 'next/cache';
import type { SupabaseClient } from '@supabase/supabase-js';
import { invokeEdgeFunction } from '@/lib/supabase/edge';

export type ServiceAreaRow = {
  id: string;
  name: string;
  governorate: string | null;
  is_active: boolean;
  priority: number;
  pricing_config_id: string | null;
  min_base_fare_iqd: number | null;
  surge_multiplier: number;
  surge_reason: string | null;
  match_radius_m: number | null;
  driver_loc_stale_after_seconds: number | null;
  cash_rounding_step_iqd: number | null;
  created_at: string;
  updated_at: string;
  geom_geojson: any | null;
};

export async function listServiceAreas(
  supabase: SupabaseClient,
  args: { q?: string; limit?: number; offset?: number } = {},
): Promise<{
  areas: ServiceAreaRow[];
  geojson: any;
  page: { limit: number; offset: number; returned: number };
}> {
  noStore();
  const data = await invokeEdgeFunction<{
    ok: boolean;
    areas: ServiceAreaRow[];
    geojson: any;
    page: { limit: number; offset: number; returned: number };
  }>(supabase, 'admin-api', {
    path: 'admin-service-areas-list',
    method: 'POST',
    body: {
      q: args.q ?? '',
      limit: args.limit ?? 50,
      offset: args.offset ?? 0,
    },
  });
  return { areas: data.areas ?? [], geojson: data.geojson, page: data.page };
}

export async function upsertServiceArea(
  supabase: SupabaseClient,
  body: {
    id?: string | null;
    name: string;
    governorate: string;
    geojson: any;
    priority: number;
    is_active: boolean;
    pricing_config_id?: string | null;
    min_base_fare_iqd?: number | null;
    surge_multiplier?: number | null;
    surge_reason?: string | null;
    match_radius_m?: number | null;
    driver_loc_stale_after_seconds?: number | null;
    cash_rounding_step_iqd?: number | null;
  },
): Promise<{ id: string }> {
  const data = await invokeEdgeFunction<{ ok: boolean; id: string }>(supabase, 'admin-api', {
    path: 'admin-service-area-upsert',
    method: 'POST',
    body,
  });
  return { id: data.id };
}

export async function deleteServiceArea(
  supabase: SupabaseClient,
  id: string,
): Promise<void> {
  await invokeEdgeFunction<{ ok: boolean }>(supabase, 'admin-api', {
    path: 'admin-service-area-delete',
    method: 'POST',
    body: { id },
  });
}
