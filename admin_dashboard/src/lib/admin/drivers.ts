import { unstable_noStore as noStore } from 'next/cache';
import type { SupabaseClient } from '@supabase/supabase-js';
import { invokeEdgeFunction } from '@/lib/supabase/edge';

export type DriverListItem = {
  id: string;
  status: string;
  vehicle_type: string | null;
  rating_avg: number | null;
  rating_count: number | null;
  trips_count: number | null;
  cash_enabled: boolean | null;
  cash_exposure_limit_iqd: number | null;
  created_at: string;
  updated_at: string;
  profile: { id: string; display_name: string | null; phone: string | null; locale: string | null } | null;
};

export type DriverDetail = any;

export async function listDrivers(
  supabase: SupabaseClient,
  args: { q?: string; status?: string; limit?: number; offset?: number } = {},
): Promise<{ drivers: DriverListItem[]; page: { limit: number; offset: number; returned: number; total: number | null } }> {
  noStore();
  const data = await invokeEdgeFunction<{
    ok: boolean;
    drivers: DriverListItem[];
    page: { limit: number; offset: number; returned: number; total: number | null };
  }>(supabase, 'admin-api', {
    path: 'admin-drivers-list',
    method: 'POST',
    body: {
      q: args.q ?? '',
      status: args.status ?? '',
      limit: args.limit ?? 25,
      offset: args.offset ?? 0,
    },
  });
  return { drivers: data.drivers ?? [], page: data.page };
}

export async function getDriverDetail(
  supabase: SupabaseClient,
  driverId: string,
): Promise<{ driver: DriverDetail; last_location: any | null; status_events: any[]; active_rides: any[] }> {
  noStore();
  const data = await invokeEdgeFunction<{
    ok: boolean;
    driver: DriverDetail;
    last_location: any | null;
    status_events: any[];
    active_rides: any[];
  }>(supabase, 'admin-api', {
    path: 'admin-driver-detail',
    method: 'GET',
    query: { driver_id: driverId },
  });

  return {
    driver: data.driver,
    last_location: data.last_location ?? null,
    status_events: data.status_events ?? [],
    active_rides: data.active_rides ?? [],
  };
}

export async function transitionDriver(
  supabase: SupabaseClient,
  args: { driverId: string; toStatus: string; reason: string },
): Promise<void> {
  await invokeEdgeFunction<{ ok: boolean }>(supabase, 'admin-api', {
    path: 'admin-driver-transition',
    method: 'POST',
    body: {
      driver_id: args.driverId,
      to_status: args.toStatus,
      reason: args.reason,
    },
  });
}
