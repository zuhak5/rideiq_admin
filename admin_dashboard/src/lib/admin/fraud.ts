import { unstable_noStore as noStore } from 'next/cache';
import type { SupabaseClient } from '@supabase/supabase-js';
import { invokeEdgeFunction } from '@/lib/supabase/edge';
import {
  listFraudActionsResponseSchema,
  listFraudCasesResponseSchema,
} from '@/lib/admin/edgeSchemas';

export type FraudCase = {
  id: string;
  created_at: string;
  updated_at: string;
  status: string;
  subject_kind: string;
  subject_key: string;
  risk_score: number | null;
  signals: unknown;
  resolution_reason: string | null;
  closed_at: string | null;
  closed_by: string | null;
};

export type FraudAction = {
  id: string;
  created_at: string;
  updated_at: string;
  action_type: string;
  subject_kind: string;
  subject_key: string;
  reason: string | null;
  severity: string | null;
  expires_at: string | null;
  expired_at: string | null;
  resolved_at: string | null;
  resolved_by: string | null;
  resolution_reason: string | null;
  metadata: unknown;
};

export async function listFraudCases(
  supabase: SupabaseClient,
  args: { status?: 'open' | 'closed'; limit?: number } = {},
): Promise<FraudCase[]> {
  noStore();
  const data = await invokeEdgeFunction<{ ok: boolean; cases: FraudCase[] }>(supabase, 'admin-api', {
    path: 'admin-fraud-cases',
    method: 'GET',
    query: { op: 'list', status: args.status ?? 'open', limit: args.limit ?? 50 },
    schema: listFraudCasesResponseSchema,
  });
  return data.cases ?? [];
}

export async function closeFraudCase(
  supabase: SupabaseClient,
  args: { caseId: string; closedBy: string; resolutionReason?: string },
): Promise<void> {
  await invokeEdgeFunction<{ ok: boolean }>(supabase, 'admin-api', {
    path: 'admin-fraud-cases',
    method: 'POST',
    query: { op: 'close' },
    body: {
      case_id: args.caseId,
      closed_by: args.closedBy,
      resolution_reason: args.resolutionReason ?? 'admin_closed',
    },
  });
}

export async function listFraudActions(
  supabase: SupabaseClient,
  args: { status?: 'active' | 'expired' | 'resolved'; limit?: number } = {},
): Promise<FraudAction[]> {
  noStore();
  const data = await invokeEdgeFunction<{ ok: boolean; actions: FraudAction[] }>(supabase, 'admin-api', {
    path: 'admin-fraud-actions',
    method: 'GET',
    query: { op: 'list', status: args.status ?? 'active', limit: args.limit ?? 50 },
    schema: listFraudActionsResponseSchema,
  });
  return data.actions ?? [];
}

export async function resolveFraudAction(
  supabase: SupabaseClient,
  args: { actionId: string; resolutionReason?: string },
): Promise<void> {
  await invokeEdgeFunction<{ ok: boolean }>(supabase, 'admin-api', {
    path: 'admin-fraud-actions',
    method: 'POST',
    query: { op: 'resolve' },
    body: {
      action_id: args.actionId,
      resolution_reason: args.resolutionReason ?? 'admin_resolved',
    },
  });
}
