import { supabase } from './supabaseClient';
import type { Database } from './database.types';

export type MerchantOrderDeliveryStatus = Database['public']['Enums']['merchant_order_delivery_status'];

export type MerchantOrderDelivery = {
  id: string;
  order_id: string;
  merchant_id: string;
  customer_id: string;
  driver_id: string | null;
  status: MerchantOrderDeliveryStatus;
  payment_method_snapshot: Database['public']['Enums']['merchant_order_payment_method'] | null;
  cod_expected_amount_iqd: number;
  cod_collected_amount_iqd: number | null;
  cod_change_given_iqd: number;
  cod_collected_at: string | null;
  pickup_snapshot: any;
  dropoff_snapshot: any;
  fee_iqd: number;
  assigned_at: string | null;
  picked_up_at: string | null;
  delivered_at: string | null;
  cancelled_at: string | null;
  created_at: string;
  updated_at: string;
};

export type MerchantOrderDeliveryEvent = {
  id: string;
  delivery_id: string;
  actor_id: string | null;
  actor_role: Database['public']['Enums']['delivery_actor_role'] | null;
  from_status: MerchantOrderDeliveryStatus | null;
  to_status: MerchantOrderDeliveryStatus;
  note: string | null;
  created_at: string;
};

export async function getDeliveryForOrder(orderId: string): Promise<MerchantOrderDelivery | null> {
  const { data, error } = await supabase
    .from('merchant_order_deliveries' as any)
    .select('*')
    .eq('order_id', orderId)
    .maybeSingle();
  if (error) throw error;
  return (data ?? null) as any;
}

export async function listDeliveryEvents(deliveryId: string, limit = 100): Promise<MerchantOrderDeliveryEvent[]> {
  const { data, error } = await supabase
    .from('merchant_order_delivery_events' as any)
    .select('*')
    .eq('delivery_id', deliveryId)
    .order('created_at', { ascending: true })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as any;
}

export async function requestOrderDelivery(orderId: string): Promise<string> {
  const { data, error } = await supabase.rpc('merchant_order_request_delivery' as any, { p_order_id: orderId });
  if (error) throw error;
  return data as any;
}

export async function claimOrderDelivery(deliveryId: string): Promise<MerchantOrderDelivery> {
  const { data, error } = await supabase.rpc('driver_claim_order_delivery' as any, { p_delivery_id: deliveryId });
  if (error) throw error;
  return data as any;
}

export async function setDeliveryStatus(
  deliveryId: string,
  status: MerchantOrderDeliveryStatus,
  opts?: { cod_collected_amount_iqd?: number; cod_change_given_iqd?: number },
) {
  const payload: Record<string, any> = { status };
  if (typeof opts?.cod_collected_amount_iqd === 'number') payload.cod_collected_amount_iqd = opts.cod_collected_amount_iqd;
  if (typeof opts?.cod_change_given_iqd === 'number') payload.cod_change_given_iqd = opts.cod_change_given_iqd;

  const { error } = await supabase
    .from('merchant_order_deliveries' as any)
    .update(payload)
    .eq('id', deliveryId);
  if (error) throw error;
}

export async function listAvailableDeliveries(limit = 50): Promise<MerchantOrderDelivery[]> {
  const { data, error } = await supabase
    .from('merchant_order_deliveries' as any)
    .select('*')
    .eq('status', 'requested')
    .is('driver_id', null)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as any;
}

export async function listMyDeliveries(driverId: string, limit = 50): Promise<MerchantOrderDelivery[]> {
  const { data, error } = await supabase
    .from('merchant_order_deliveries' as any)
    .select('*')
    .eq('driver_id', driverId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as any;
}
