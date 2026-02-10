import { unstable_noStore as noStore } from 'next/cache';
import type { SupabaseClient } from '@supabase/supabase-js';
import { invokeEdgeFunction } from '@/lib/supabase/edge';

export type SloLatencyRow = {
  component: string;
  event_type: string;
  total: number;
  errors: number;
  p50_ms: number | null;
  p95_ms: number | null;
  p99_ms: number | null;
  avg_ms: number | null;
  max_ms: number | null;
};

export type SloSummary = {
  ok: true;
  window_minutes: number;
  since: string;
  totals: { total: number; errors: number; error_rate: number };
  rows: SloLatencyRow[];
};

export async function getSloSummary(
  supabase: SupabaseClient,
  args?: { windowMinutes?: number; limit?: number },
): Promise<SloSummary> {
  noStore();

  const data = await invokeEdgeFunction<SloSummary>(supabase, 'admin-api', {
    path: 'admin-slo-summary',
    method: 'POST',
    body: {
      window_minutes: args?.windowMinutes ?? 60,
      limit: args?.limit ?? 50,
        },
  });

  return data;
}
