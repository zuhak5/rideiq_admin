import { unstable_noStore as noStore } from 'next/cache';
import type { SupabaseClient } from '@supabase/supabase-js';
import { invokeEdgeFunction } from '@/lib/supabase/edge';

export type MerchantListRow = {
  merchant_id: string;
  business_name: string;
  business_type: string | null;
  status: string;
  owner_profile_id: string;
  owner_display_name: string | null;
  owner_phone: string | null;
  orders_count: number | string;
  last_order_at: string | null;
  created_at: string;
};

export type MerchantAuditRow = {
  id: number | string;
  created_at: string;
  merchant_id: string;
  from_status: string;
  to_status: string;
  note: string | null;
  actor_id: string | null;
};

export type MerchantDetail = {
  merchant: any;
  owner: { id: string; display_name: string | null; phone: string | null } | null;
  stats: { orders_count: number | string; last_order_at: string | null };
  audits: MerchantAuditRow[];
  recent_orders: any[];
};

export async function listMerchants(
  supabase: SupabaseClient,
  args: { q?: string; status?: string; limit?: number; offset?: number } = {},
): Promise<{ merchants: MerchantListRow[]; page: { limit: number; offset: number; returned: number } }> {
  noStore();
  const data = await invokeEdgeFunction<{
    ok: boolean;
    merchants: MerchantListRow[];
    page: { limit: number; offset: number; returned: number };
  }>(supabase, 'admin-api', {
    path: 'admin-merchants-list',
    method: 'POST',
    body: {
      q: args.q ?? '',
      status: args.status ?? null,
      limit: args.limit ?? 25,
      offset: args.offset ?? 0,
    },
  });

  return { merchants: data.merchants ?? [], page: data.page };
}

export async function getMerchantDetail(supabase: SupabaseClient, merchant_id: string): Promise<MerchantDetail> {
  noStore();
  const data = await invokeEdgeFunction<MerchantDetail>(supabase, 'admin-api', {
    path: 'admin-merchant-get',
    method: 'GET',
    query: { merchant_id },
  });
  return data;
}

export async function setMerchantStatus(
  supabase: SupabaseClient,
  body: { merchant_id: string; to_status: string; note?: string | null },
): Promise<{ merchant: any }> {
  const data = await invokeEdgeFunction<{ ok: boolean; merchant: any }>(supabase, 'admin-api', {
    path: 'admin-merchant-set-status',
    method: 'POST',
    body,
  });
  return { merchant: data.merchant };
}
