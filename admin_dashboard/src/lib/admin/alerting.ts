import { unstable_noStore as noStore } from 'next/cache';
import type { SupabaseClient } from '@supabase/supabase-js';
import { invokeEdgeFunction } from '@/lib/supabase/edge';

export type AlertRule = {
  id: string;
  name: string;
  kind: string;
  severity: 'page' | 'ticket';
  config?: Record<string, unknown>;
};

export type AlertingActive = {
  rule_id: string;
  is_active: boolean;
  active_since: string | null;
  last_message: string | null;
  last_value: Record<string, unknown> | null;
  escalated_at: string | null;
  ops_alert_rules?: AlertRule;
};

export type AlertingEvent = {
  id: string;
  occurred_at: string;
  event_type: 'triggered' | 'resolved' | 'note';
  message: string | null;
  value: Record<string, unknown>;
  notify_status: string | null;
  notified_at: string | null;
  notified_attempts: number;
  notified_error: string | null;
  ops_alert_rules?: AlertRule;
};

export type AlertingStatus = {
  ok: true;
  env: string;
  channels: {
    slack_ticket: boolean;
    slack_page: boolean;
    webhook: boolean;
    email: boolean;
  };
  active: AlertingActive[];
  recent_events: AlertingEvent[];
};

export async function getAlertingStatus(
  supabase: SupabaseClient,
  args?: { limit?: number },
): Promise<AlertingStatus> {
  noStore();

  const limit = args?.limit ?? 100;
  const data = await invokeEdgeFunction<AlertingStatus>(supabase, 'admin-api', {
    path: 'admin-alerting-status',
    method: 'GET',
    query: { limit },
  });

  return data;
}
