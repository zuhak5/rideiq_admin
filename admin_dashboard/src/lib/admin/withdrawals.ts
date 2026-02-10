import { unstable_noStore as noStore } from 'next/cache';
import type { SupabaseClient } from '@supabase/supabase-js';
import { invokeEdgeFunction } from '@/lib/supabase/edge';

export type WithdrawalStatus = 'requested' | 'approved' | 'rejected' | 'paid' | 'cancelled';
export type WithdrawPayoutKind = 'qicard' | 'asiapay' | 'zaincash';

export type WithdrawalRow = {
  id: string;
  user_id: string;
  amount_iqd: number;
  payout_kind: WithdrawPayoutKind;
  destination: any;
  status: WithdrawalStatus;
  note: string | null;
  payout_reference: string | null;
  created_at: string;
  updated_at: string;
  approved_at: string | null;
  paid_at: string | null;
  cancelled_at: string | null;
  rejected_at: string | null;
  user?: { id: string; display_name: string | null; phone: string | null } | null;
  latest_payout_job?: any | null;
};

export type WalletHoldRow = {
  id: string;
  withdraw_request_id: string | null;
  kind: string;
  status: string;
  amount_iqd: number;
  created_at: string;
  updated_at: string;
  released_at: string | null;
  captured_at: string | null;
};

export type PayoutJobRow = any;
export type PayoutJobAttemptRow = any;

export async function listWithdrawals(
  supabase: SupabaseClient,
  args: { q?: string; status?: string; payout_kind?: string; limit?: number; offset?: number } = {},
): Promise<{ withdrawals: WithdrawalRow[]; page: { limit: number; offset: number; returned: number; total: number | null } }> {
  noStore();

  const res = await invokeEdgeFunction<{
    ok: boolean;
    withdrawals: WithdrawalRow[];
    page: { limit: number; offset: number; returned: number; total: number | null };
  }>(supabase, 'admin-api', {
    path: 'admin-withdrawals-list',
    method: 'POST',
    body: {
      q: args.q ?? '',
      status: args.status ?? '',
      payout_kind: args.payout_kind ?? '',
      limit: args.limit ?? 25,
      offset: args.offset ?? 0,
    },
  });

  return { withdrawals: res.withdrawals ?? [], page: res.page };
}

export async function getWithdrawalDetail(
  supabase: SupabaseClient,
  requestId: string,
): Promise<{ withdraw: WithdrawalRow; user: any | null; holds: WalletHoldRow[]; jobs: PayoutJobRow[]; attempts: PayoutJobAttemptRow[] }> {
  noStore();

  const res = await invokeEdgeFunction<{
    ok: boolean;
    withdraw: WithdrawalRow;
    user: any | null;
    holds: WalletHoldRow[];
    jobs: PayoutJobRow[];
    attempts: PayoutJobAttemptRow[];
  }>(supabase, 'admin-api', {
    path: 'admin-withdrawal-detail',
    method: 'GET',
    query: { request_id: requestId },
  });

  return {
    withdraw: res.withdraw,
    user: res.user ?? null,
    holds: res.holds ?? [],
    jobs: res.jobs ?? [],
    attempts: res.attempts ?? [],
  };
}

export async function approveWithdrawal(supabase: SupabaseClient, args: { request_id: string; note?: string }): Promise<void> {
  await invokeEdgeFunction<{ ok: boolean }>(supabase, 'admin-api', {
    path: 'admin-withdraw-approve',
    method: 'POST',
    body: { request_id: args.request_id, note: args.note ?? '' },
  });
}

export async function rejectWithdrawal(supabase: SupabaseClient, args: { request_id: string; note?: string }): Promise<void> {
  await invokeEdgeFunction<{ ok: boolean }>(supabase, 'admin-api', {
    path: 'admin-withdraw-reject',
    method: 'POST',
    body: { request_id: args.request_id, note: args.note ?? '' },
  });
}

export async function markWithdrawalPaid(
  supabase: SupabaseClient,
  args: { request_id: string; payout_reference?: string; note?: string },
): Promise<void> {
  await invokeEdgeFunction<{ ok: boolean }>(supabase, 'admin-api', {
    path: 'admin-withdraw-mark-paid',
    method: 'POST',
    body: { request_id: args.request_id, payout_reference: args.payout_reference ?? '', note: args.note ?? '' },
  });
}
