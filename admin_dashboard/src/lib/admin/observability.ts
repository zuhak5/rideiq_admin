import { unstable_noStore as noStore } from 'next/cache';
import type { SupabaseClient } from '@supabase/supabase-js';
import { invokeEdgeFunction } from '@/lib/supabase/edge';

export type ObservabilitySummary = {
  ok: true;
  generated_at: string;
  window_minutes: number;
  counts: {
    window: { total: number; info: number; warn: number; error: number };
    last_15m: { total: number; error: number };
  };
  derived: {
    webhook_internal_errors_15m: number;
    webhook_auth_fail_15m: number;
    maps_misconfigured_15m: number;
  };
  top_event_types: Array<{ event_type: string; total: number; info: number; warn: number; error: number }>;
  recent_events: Array<{
    id: string;
    created_at: string;
    event_type: string;
    level: 'info' | 'warn' | 'error';
    actor_id: string | null;
    request_id: string | null;
    ride_id: string | null;
    payment_intent_id: string | null;
    payload: Record<string, unknown>;
  }>;
  alerts: Array<{
    id: string;
    severity: 'info' | 'warning' | 'critical';
    active: boolean;
    title: string;
    message: string;
    runbook: string;
  }>;
};

export async function getObservabilitySummary(
  supabase: SupabaseClient,
  args?: { windowMinutes?: number; recentLimit?: number; sampleLimit?: number },
): Promise<ObservabilitySummary> {
  noStore();

  const data = await invokeEdgeFunction<ObservabilitySummary>(supabase, 'admin-api', {
    path: 'admin-observability',
    method: 'POST',
    body: {
      window_minutes: args?.windowMinutes ?? 60,
      recent_limit: args?.recentLimit ?? 50,
      sample_limit: args?.sampleLimit ?? 1000,
        },
  });

  return data;
}
