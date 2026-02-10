import { unstable_noStore as noStore } from 'next/cache';
import type { SupabaseClient } from '@supabase/supabase-js';
import { invokeEdgeFunction } from '@/lib/supabase/edge';

export type PaymentListItem = {
  id: string;
  ride_id: string;
  provider: string;
  status: string;
  amount_iqd: number | null;
  currency: string | null;
  method: string | null;
  provider_ref: string | null;
  provider_charge_id: string | null;
  provider_refund_id: string | null;
  refund_amount_iqd: number | null;
  refunded_at: string | null;
  failure_code: string | null;
  failure_message: string | null;
  created_at: string;
  updated_at: string;
  ride: {
    id: string;
    status: string;
    created_at: string;
    rider: { id: string; display_name: string | null; phone: string | null } | null;
  } | null;
};

export type PaymentDetailResponse = {
  payment: any;
  ride: any;
  receipt: any;
  payment_intent: any;
};

export async function listPayments(
  supabase: SupabaseClient,
  args: { q?: string; status?: string; provider?: string; limit?: number; offset?: number } = {},
): Promise<{ payments: PaymentListItem[]; page: { limit: number; offset: number; returned: number; total: number | null } }> {
  noStore();
  const data = await invokeEdgeFunction<{
    ok: boolean;
    payments: PaymentListItem[];
    page: { limit: number; offset: number; returned: number; total: number | null };
  }>(supabase, 'admin-api', {
    path: 'admin-payments-list',
    method: 'POST',
    body: {
      q: args.q ?? '',
      status: args.status ?? '',
      provider: args.provider ?? '',
      limit: args.limit ?? 25,
      offset: args.offset ?? 0,
    },
  });
  return { payments: data.payments ?? [], page: data.page };
}

export async function getPaymentDetail(
  supabase: SupabaseClient,
  paymentId: string,
): Promise<PaymentDetailResponse> {
  noStore();
  const data = await invokeEdgeFunction<{ ok: boolean; payment: any; ride: any; receipt: any; payment_intent: any }>(
    supabase,
    'admin-api',
    {
      path: 'admin-payment-detail',
      method: 'GET',
      query: { payment_id: paymentId },
    },
  );
  return { payment: data.payment, ride: data.ride, receipt: data.receipt, payment_intent: data.payment_intent };
}

export async function refundPayment(
  supabase: SupabaseClient,
  args: {
    paymentId: string;
    refundAmountIqd?: number | null;
    reason: string;
    idempotencyKey: string;
  },
): Promise<any> {
  const data = await invokeEdgeFunction<{ ok: boolean; result: any }>(supabase, 'admin-api', {
    path: 'admin-payment-refund',
    method: 'POST',
    body: {
      payment_id: args.paymentId,
      refund_amount_iqd: args.refundAmountIqd ?? null,
      reason: args.reason,
      idempotency_key: args.idempotencyKey,
    },
  });
  return data.result;
}
