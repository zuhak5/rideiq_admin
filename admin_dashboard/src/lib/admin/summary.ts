import { unstable_noStore as noStore } from 'next/cache';
import type { SupabaseClient } from '@supabase/supabase-js';
import { invokeEdgeFunction } from '@/lib/supabase/edge';

export type AdminDashboardSummary = {
  ok: boolean;
  generated_at: string;
  counts: {
    users_total: number;
    admins_total: number;
    rides_active: number;
    rides_last_24h: number;
    fraud_cases_open: number;
    fraud_actions_active: number;
    ops_alerts_active: number;
    payout_jobs_queued: number;
    payout_jobs_failed: number;
  };
};

export async function getAdminDashboardSummary(
  supabase: SupabaseClient,
): Promise<AdminDashboardSummary> {
  noStore();

  const data = await invokeEdgeFunction<AdminDashboardSummary>(supabase, 'admin-api', {
    path: 'admin-dashboard-summary',
    method: 'POST',
  });
  return data;
}
