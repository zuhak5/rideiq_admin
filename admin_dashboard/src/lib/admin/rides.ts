import { unstable_noStore as noStore } from 'next/cache';
import type { SupabaseClient } from '@supabase/supabase-js';
import { invokeEdgeFunction } from '@/lib/supabase/edge';

export type RideListItem = {
  id: string;
  status: string;
  version: number;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  completed_at: string | null;
  fare_amount_iqd: number | null;
  currency: string | null;
  payment_method: string | null;
  payment_status: string | null;
  request: {
    id: string;
    status: string;
    pickup_address: string | null;
    dropoff_address: string | null;
    created_at: string;
  } | null;
  rider: { id: string; display_name: string | null; phone: string | null } | null;
  driver: {
    id: string;
    status: string;
    profile: { id: string; display_name: string | null; phone: string | null } | null;
  } | null;
};

export type RideDetail = any;

export async function listRides(
  supabase: SupabaseClient,
  args: { q?: string; status?: string; limit?: number; offset?: number } = {},
): Promise<{ rides: RideListItem[]; page: { limit: number; offset: number; returned: number; total: number | null } }> {
  noStore();
  const data = await invokeEdgeFunction<{
    ok: boolean;
    rides: RideListItem[];
    page: { limit: number; offset: number; returned: number; total: number | null };
  }>(supabase, 'admin-api', {
    path: 'admin-rides-list',
    method: 'POST',
    body: {
      q: args.q ?? '',
      status: args.status ?? '',
      limit: args.limit ?? 25,
      offset: args.offset ?? 0,
    },
  });
  return { rides: data.rides ?? [], page: data.page };
}

export async function getRideDetail(
  supabase: SupabaseClient,
  rideId: string,
): Promise<{ ride: RideDetail; ride_events: any[]; app_events: any[] }> {
  noStore();
  const data = await invokeEdgeFunction<{ ok: boolean; ride: RideDetail; ride_events: any[]; app_events: any[] }>(
    supabase,
    'admin-api',
    {
      path: 'admin-ride-detail',
      method: 'GET',
      query: { ride_id: rideId },
    },
  );
  return { ride: data.ride, ride_events: data.ride_events ?? [], app_events: data.app_events ?? [] };
}

export async function cancelRide(
  supabase: SupabaseClient,
  args: { rideId: string; expectedVersion?: number; reason: string },
): Promise<void> {
  await invokeEdgeFunction<{ ok: boolean }>(supabase, 'admin-api', {
    path: 'admin-ride-cancel',
    method: 'POST',
    body: {
      ride_id: args.rideId,
      expected_version: args.expectedVersion,
      reason: args.reason,
    },
  });
}
