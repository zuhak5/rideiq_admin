import { unstable_noStore as noStore } from 'next/cache';
import type { SupabaseClient } from '@supabase/supabase-js';

export type OpsDashboardResponse = {
  ok: boolean;
  window_minutes: number;
  generated_at: string;
  dashboards: Record<string, unknown>;
  alerts: {
    state: unknown[];
    recent_events: unknown[];
  };
};

export async function getOpsDashboard(supabase: SupabaseClient): Promise<OpsDashboardResponse> {
  noStore();

  const { data, error } = await supabase.functions.invoke<OpsDashboardResponse>('ops-dashboard');

  if (error) {
    throw new Error(`ops-dashboard failed: ${error.message}`);
  }
  if (!data) {
    throw new Error('ops-dashboard returned empty response');
  }

  return data;
}
