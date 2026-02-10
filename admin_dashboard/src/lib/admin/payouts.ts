import { unstable_noStore as noStore } from 'next/cache';
import type { SupabaseClient } from '@supabase/supabase-js';
import { invokeEdgeFunction } from '@/lib/supabase/edge';

export type PayoutJobStatus = 'queued' | 'sent' | 'confirmed' | 'failed' | 'canceled';
export type WithdrawPayoutKind = 'qicard' | 'asiapay' | 'zaincash';

export type PayoutJobListRow = {
  id: string;
  withdraw_request_id: string;
  payout_kind: WithdrawPayoutKind;
  amount_iqd: number;
  status: PayoutJobStatus;
  provider_ref: string | null;
  last_error: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  sent_at: string | null;
  confirmed_at: string | null;
  failed_at: string | null;
  attempt_count: number;
  max_attempts: number;
  next_attempt_at: string;
  last_attempt_at: string | null;
  locked_at: string | null;
  canceled_at: string | null;
  withdraw?: any | null;
  user?: { display_name: string | null; phone: string | null } | null;
};

export type PayoutJobDetail = any;
export type PayoutJobAttempt = any;

export async function listPayoutJobs(
  supabase: SupabaseClient,
  args: { q?: string; status?: string; payout_kind?: string; limit?: number; offset?: number } = {},
): Promise<{ jobs: PayoutJobListRow[]; page: { limit: number; offset: number; returned: number; total: number | null } }> {
  noStore();

  const res = await invokeEdgeFunction<{
    ok: boolean;
    jobs: PayoutJobListRow[];
    page: { limit: number; offset: number; returned: number; total: number | null };
  }>(supabase, 'admin-api', {
    path: 'admin-payout-jobs-list',
    method: 'POST',
    body: {
      q: args.q ?? '',
      status: args.status ?? '',
      payout_kind: args.payout_kind ?? '',
      limit: args.limit ?? 25,
      offset: args.offset ?? 0,
    },
  });

  return { jobs: res.jobs ?? [], page: res.page };
}

export async function getPayoutJobDetail(
  supabase: SupabaseClient,
  jobId: string,
): Promise<{ job: PayoutJobDetail; withdraw: any | null; user: any | null; attempts: PayoutJobAttempt[] }> {
  noStore();

  const res = await invokeEdgeFunction<{
    ok: boolean;
    job: PayoutJobDetail;
    withdraw: any | null;
    user: any | null;
    attempts: PayoutJobAttempt[];
  }>(supabase, 'admin-api', {
    path: 'admin-payout-job-detail',
    method: 'GET',
    query: { job_id: jobId },
  });

  return { job: res.job, withdraw: res.withdraw ?? null, user: res.user ?? null, attempts: res.attempts ?? [] };
}

export async function createPayoutJob(
  supabase: SupabaseClient,
  args: { withdraw_request_id: string; idempotency_key: string },
): Promise<{ job: any | null; deduped?: boolean }> {
  const res = await invokeEdgeFunction<{ ok: boolean; job: any | null; deduped?: boolean }>(supabase, 'admin-api', {
    path: 'admin-payout-job-create',
    method: 'POST',
    body: { withdraw_request_id: args.withdraw_request_id, idempotency_key: args.idempotency_key },
  });

  return { job: res.job ?? null, deduped: res.deduped };
}

export async function actionPayoutJob(
  supabase: SupabaseClient,
  args: { job_id: string; action: 'cancel' | 'retry_now' | 'force_confirm'; provider_ref?: string; note?: string },
): Promise<{ job: any }> {
  const res = await invokeEdgeFunction<{ ok: boolean; job: any }>(supabase, 'admin-api', {
    path: 'admin-payout-job-action',
    method: 'POST',
    body: {
      job_id: args.job_id,
      action: args.action,
      provider_ref: args.provider_ref ?? '',
      note: args.note ?? '',
    },
  });

  return { job: res.job };
}
