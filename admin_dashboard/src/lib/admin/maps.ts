import type { SupabaseClient } from '@supabase/supabase-js';
import { invokeEdgeFunction } from '@/lib/supabase/edge';

export type LiveDriverPoint = {
  driver_id: string;
  lat: number;
  lng: number;
  heading: number | null;
  speed_mps: number | null;
  accuracy_m: number | null;
  updated_at: string;
  vehicle_type: string | null;
};

export async function fetchLiveDrivers(
  supabase: SupabaseClient,
  args: {
    min_lat?: number;
    min_lng?: number;
    max_lat?: number;
    max_lng?: number;
    max_age_seconds?: number;
    limit?: number;
  } = {},
): Promise<{ drivers: LiveDriverPoint[]; since: string }> {
  const data = await invokeEdgeFunction<{ ok: boolean; drivers: LiveDriverPoint[]; since: string }>(
    supabase,
    'admin-api',
    {
      path: 'admin-live-drivers',
      method: 'POST',
      body: {
        ...args,
        max_age_seconds: args.max_age_seconds ?? 300,
        limit: args.limit ?? 1000,
      },
    },
  );
  return { drivers: data.drivers ?? [], since: data.since };
}
