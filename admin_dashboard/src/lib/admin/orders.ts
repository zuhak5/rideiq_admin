import { unstable_noStore as noStore } from 'next/cache';
import type { SupabaseClient } from '@supabase/supabase-js';
import { invokeEdgeFunction } from '@/lib/supabase/edge';

export type OrderListRow = {
  order_id: string;
  merchant_id: string;
  merchant_name: string | null;
  customer_id: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  status: string;
  total_iqd: number | string | null;
  payment_method: string | null;
  payment_status: string | null;
  delivery_status: string | null;
  created_at: string;
  status_changed_at: string | null;
};

export type OrderDetail = {
  ok: boolean;
  order: any;
  merchant: any;
  customer: any;
  items: any[];
  status_events: any[];
  delivery: any | null;
};

export async function listOrders(
  supabase: SupabaseClient,
  args: { q?: string; status?: string; merchant_id?: string; limit?: number; offset?: number } = {},
): Promise<{ orders: OrderListRow[]; page: { limit: number; offset: number; returned: number } }> {
  noStore();
  const data = await invokeEdgeFunction<{
    ok: boolean;
    orders: OrderListRow[];
    page: { limit: number; offset: number; returned: number };
  }>(supabase, 'admin-api', {
    path: 'admin-orders-list',
    method: 'POST',
    body: {
      q: args.q ?? '',
      status: args.status ?? null,
      merchant_id: args.merchant_id ?? null,
      limit: args.limit ?? 25,
      offset: args.offset ?? 0,
    },
  });

  return { orders: data.orders ?? [], page: data.page };
}

export async function getOrderDetail(supabase: SupabaseClient, order_id: string): Promise<OrderDetail> {
  noStore();
  const data = await invokeEdgeFunction<OrderDetail>(supabase, 'admin-api', {
    path: 'admin-order-get',
    method: 'GET',
    query: { order_id },
  });
  return data;
}

export async function setOrderStatus(
  supabase: SupabaseClient,
  body: { order_id: string; to_status: string; note?: string | null },
): Promise<{ order: any }> {
  const data = await invokeEdgeFunction<{ ok: boolean; order: any }>(supabase, 'admin-api', {
    path: 'admin-order-set-status',
    method: 'POST',
    body,
  });
  return { order: data.order };
}
