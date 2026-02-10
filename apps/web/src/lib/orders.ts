import { supabase } from './supabaseClient';
import type { Database, Json } from './database.types';

export type CustomerAddress = {
  id: string;
  user_id: string;
  label: string | null;
  recipient_name: string | null;
  phone: string | null;
  city: string;
  area: string | null;
  address_line1: string;
  address_line2: string | null;
  notes: string | null;
  is_default: boolean;
  created_at: string;
  updated_at: string;
};

export type MerchantOrderStatus = Database['public']['Enums']['merchant_order_status'];

export type MerchantOrder = {
  id: string;
  merchant_id: string;
  customer_id: string;
  status: MerchantOrderStatus;
  subtotal_iqd: number;
  discount_iqd: number;
  delivery_fee_iqd: number;
  total_iqd: number;
  address_id: string | null;
  address_snapshot: any;
  customer_note: string | null;
  merchant_note: string | null;
  status_changed_at: string;
  created_at: string;
  updated_at: string;
};

export type MerchantOrderItem = {
  id: string;
  order_id: string;
  product_id: string | null;
  name_snapshot: string;
  unit_price_iqd: number;
  qty: number;
  line_total_iqd: number;
  meta: any;
  created_at: string;
};

export type MerchantOrderStatusEvent = {
  id: string;
  order_id: string;
  actor_id: string | null;
  from_status: MerchantOrderStatus | null;
  to_status: MerchantOrderStatus;
  note: string | null;
  created_at: string;
};

export async function listCustomerOrders(opts: { limit?: number; status?: MerchantOrderStatus | null } = {}) {
  const limit = opts.limit ?? 50;
  let q = supabase
    .from('merchant_orders')
    .select('id,merchant_id,customer_id,status,total_iqd,created_at,updated_at,discount_iqd,subtotal_iqd,delivery_fee_iqd')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (opts.status) q = q.eq('status', opts.status);

  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as MerchantOrder[];
}

export async function listMerchantOrders(
  merchantId: string,
  opts: { limit?: number; status?: MerchantOrderStatus | null } = {},
) {
  const limit = opts.limit ?? 50;
  let q = supabase
    .from('merchant_orders')
    .select('id,merchant_id,customer_id,status,total_iqd,created_at,updated_at,discount_iqd,subtotal_iqd,delivery_fee_iqd,customer_note,merchant_note')
    .eq('merchant_id', merchantId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (opts.status) q = q.eq('status', opts.status);

  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as MerchantOrder[];
}

export async function getOrderWithItems(orderId: string) {
  const { data: order, error: orderErr } = await supabase
    .from('merchant_orders')
    .select('*, merchant:merchants(id,business_name,business_type), customer:public_profiles(id,display_name)')
    .eq('id', orderId)
    .maybeSingle();
  if (orderErr) throw orderErr;
  if (!order) return null;

  const { data: items, error: itemsErr } = await supabase
    .from('merchant_order_items')
    .select('*')
    .eq('order_id', orderId)
    .order('created_at', { ascending: true });
  if (itemsErr) throw itemsErr;

  return { order, items: items ?? [] } as any;
}

export async function listOrderStatusEvents(orderId: string, limit = 100) {
  const { data, error } = await supabase
    .from('merchant_order_status_events')
    .select('*')
    .eq('order_id', orderId)
    .order('created_at', { ascending: true })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as MerchantOrderStatusEvent[];
}

export async function createOrder(input: {
  merchantId: string;
  addressId: string | null;
  customerNote?: string | null;
  items: Array<{ product_id: string; qty: number }>;
}): Promise<string> {
  const { data, error } = await supabase.rpc('merchant_order_create' as any, {
    p_merchant_id: input.merchantId,
    p_address_id: input.addressId,
    p_customer_note: input.customerNote ?? null,
    p_items: input.items as unknown as Json,
  });
  if (error) throw error;
  return data as string;
}

export async function setOrderStatus(input: { orderId: string; status: MerchantOrderStatus; merchantNote?: string | null }) {
  const { error } = await supabase.rpc('merchant_order_set_status' as any, {
    p_order_id: input.orderId,
    p_status: input.status,
    p_merchant_note: input.merchantNote ?? null,
  });
  if (error) throw error;
}

export async function listMyAddresses() {
  const { data, error } = await supabase
    .from('customer_addresses')
    .select('*')
    .order('is_default', { ascending: false })
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as CustomerAddress[];
}

export async function upsertAddress(input: Partial<CustomerAddress> & Pick<CustomerAddress, 'city' | 'address_line1'>) {
  // user_id comes from auth and is enforced by RLS; client should not set it.
  const patch: any = {
    label: input.label ?? null,
    recipient_name: input.recipient_name ?? null,
    phone: input.phone ?? null,
    city: input.city,
    area: input.area ?? null,
    address_line1: input.address_line1,
    address_line2: input.address_line2 ?? null,
    notes: input.notes ?? null,
    is_default: Boolean(input.is_default),
  };

  const { data: sess } = await supabase.auth.getSession();
  const uid = sess.session?.user.id;
  if (!uid) throw new Error('Not authenticated');

  if (input.id) {
    const { data, error } = await supabase
      .from('customer_addresses')
      .update(patch)
      .eq('id', input.id)
      .select('*')
      .single();
    if (error) throw error;
    return data as CustomerAddress;
  }

  const { data, error } = await supabase
    .from('customer_addresses')
    .insert({ ...patch, user_id: uid })
    .select('*')
    .single();
  if (error) throw error;
  return data as CustomerAddress;
}

export async function deleteAddress(addressId: string) {
  const { error } = await supabase.from('customer_addresses').delete().eq('id', addressId);
  if (error) throw error;
}


export async function merchantOrderGetOrCreateChatThread(orderId: string): Promise<string> {
  const { data, error } = await supabase.rpc('merchant_order_get_or_create_chat_thread', { p_order_id: orderId });
  if (error) throw error;
  return data as unknown as string;
}
