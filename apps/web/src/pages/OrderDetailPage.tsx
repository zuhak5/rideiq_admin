import React from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getMyProfileBasics } from '../lib/profile';
import { getMyMerchant } from '../lib/merchant';
import { getOrderWithItems, listOrderStatusEvents, merchantOrderGetOrCreateChatThread, setOrderStatus, type MerchantOrderStatus } from '../lib/orders';
import { getDeliveryForOrder, listDeliveryEvents, requestOrderDelivery, setDeliveryStatus, type MerchantOrderDeliveryStatus } from '../lib/deliveries';
import { formatIQD } from '../lib/money';
import { errorText } from '../lib/errors';
import { supabase } from '../lib/supabaseClient';
import { voiceCallCreateToProfile } from '../lib/voiceCalls';

const statusLabel: Record<MerchantOrderStatus, string> = {
  placed: 'Placed',
  accepted: 'Accepted',
  preparing: 'Preparing',
  out_for_delivery: 'Out for delivery',
  fulfilled: 'Fulfilled',
  cancelled: 'Cancelled',
};

function allowedNextForMerchant(current: MerchantOrderStatus): MerchantOrderStatus[] {
  if (current === 'placed') return ['accepted', 'cancelled'];
  if (current === 'accepted') return ['preparing', 'cancelled'];
  if (current === 'preparing') return ['out_for_delivery', 'cancelled'];
  if (current === 'out_for_delivery') return ['fulfilled', 'cancelled'];
  return [];
}

function addrLine(snapshot: any) {
  if (!snapshot) return '';
  const bits = [snapshot.city, snapshot.area, snapshot.address_line1, snapshot.address_line2].filter(Boolean);
  return bits.join(' • ');
}

export default function OrderDetailPage() {
  const { id } = useParams();
  const nav = useNavigate();
  const orderId = id ?? '';
  const qc = useQueryClient();
  const orderChatThread = useMutation({
    mutationFn: async () => {
      if (!orderId) throw new Error('Missing order id');
      return merchantOrderGetOrCreateChatThread(orderId);
    },
    onSuccess: (threadId) => {
      nav(`/merchant-chat/${threadId}`, { state: { orderId } });
    },
  });

  const [callBusyId, setCallBusyId] = React.useState<string | null>(null);
  const [callErr, setCallErr] = React.useState<string | null>(null);

  const startCallTo = React.useCallback(
    async (profileId: string) => {
      setCallBusyId(profileId);
      setCallErr(null);
      try {
        const created = await voiceCallCreateToProfile({ calleeProfileId: profileId, provider: 'auto' });
        nav(`/voice-call/${created.call.id}`);
      } catch (e: unknown) {
        setCallErr(errorText(e));
      } finally {
        setCallBusyId(null);
      }
    },
    [nav],
  );


  const profileQ = useQuery({ queryKey: ['my-profile-basics'], queryFn: getMyProfileBasics });
  const myMerchantQ = useQuery({ queryKey: ['my-merchant'], queryFn: getMyMerchant, enabled: profileQ.data?.active_role === 'merchant' });

  const orderQ = useQuery({
    queryKey: ['merchant_order', orderId],
    queryFn: () => getOrderWithItems(orderId),
    enabled: Boolean(orderId),
  });

  const eventsQ = useQuery({
    queryKey: ['merchant_order_events', orderId],
    queryFn: () => listOrderStatusEvents(orderId, 200),
    enabled: Boolean(orderId),
  });

  const deliveryQ = useQuery({
    queryKey: ['order_delivery', orderId],
    queryFn: () => getDeliveryForOrder(orderId),
    enabled: Boolean(orderId),
  });

  const deliveryEventsQ = useQuery({
    queryKey: ['order_delivery_events', (deliveryQ.data as any)?.id],
    queryFn: () => listDeliveryEvents((deliveryQ.data as any).id, 200),
    enabled: Boolean((deliveryQ.data as any)?.id),
  });

  const [nextStatus, setNextStatus] = React.useState<MerchantOrderStatus>('placed');
  const [merchantNote, setMerchantNote] = React.useState('');

  React.useEffect(() => {
    const s = (orderQ.data as any)?.order?.status as MerchantOrderStatus | undefined;
    if (s) setNextStatus(s);
    const n = (orderQ.data as any)?.order?.merchant_note as string | null | undefined;
    setMerchantNote(n ?? '');
  }, [orderQ.data]);

  // Realtime updates: keep order + timeline fresh.
  React.useEffect(() => {
    if (!orderId) return;
    const ch = supabase
      .channel(`order:${orderId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'merchant_orders', filter: `id=eq.${orderId}` }, () => {
        void qc.invalidateQueries({ queryKey: ['merchant_order', orderId] });
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'merchant_order_status_events', filter: `order_id=eq.${orderId}` }, () => {
        void qc.invalidateQueries({ queryKey: ['merchant_order_events', orderId] });
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'merchant_order_deliveries', filter: `order_id=eq.${orderId}` }, () => {
        void qc.invalidateQueries({ queryKey: ['order_delivery', orderId] });
      })
            .subscribe();

    return () => {
      void supabase.removeChannel(ch);
    };
  }, [orderId, qc]);

  const deliveryId = (deliveryQ.data as any)?.id as string | undefined;
  React.useEffect(() => {
    if (!deliveryId) return;
    const ch = supabase
      .channel(`delivery-events:${deliveryId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'merchant_order_delivery_events', filter: `delivery_id=eq.${deliveryId}` }, () => {
        void qc.invalidateQueries({ queryKey: ['order_delivery', orderId] });
        void qc.invalidateQueries({ queryKey: ['order_delivery_events', deliveryId] });
      })
      .subscribe();

    return () => {
      void supabase.removeChannel(ch);
    };
  }, [deliveryId, orderId, qc]);

  const canMerchantManage =
    profileQ.data?.active_role === 'merchant' &&
    Boolean(myMerchantQ.data?.id) &&
    (orderQ.data as any)?.order?.merchant_id === myMerchantQ.data?.id;

  const canCustomerCancel =
    profileQ.data?.active_role !== 'merchant' &&
    (orderQ.data as any)?.order?.status === 'placed';

  const statusM = useMutation({
    mutationFn: async () => {
      await setOrderStatus({ orderId, status: nextStatus, merchantNote: merchantNote || null });
      await qc.invalidateQueries({ queryKey: ['merchant_order', orderId] });
      await qc.invalidateQueries({ queryKey: ['merchant_orders'] });
      await qc.invalidateQueries({ queryKey: ['user_notifications'] });
    },
  });

  const cancelM = useMutation({
    mutationFn: async () => {
      await setOrderStatus({ orderId, status: 'cancelled' });
      await qc.invalidateQueries({ queryKey: ['merchant_order', orderId] });
      await qc.invalidateQueries({ queryKey: ['merchant_orders'] });
      await qc.invalidateQueries({ queryKey: ['user_notifications'] });
    },
  });

  const requestDeliveryM = useMutation({
    mutationFn: async () => {
      await requestOrderDelivery(orderId);
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['order_delivery', orderId] });
      await qc.invalidateQueries({ queryKey: ['user_notifications'] });
    },
  });

  const cancelDeliveryM = useMutation({
    mutationFn: async () => {
      const d = deliveryQ.data as any;
      if (!d?.id) throw new Error('delivery_missing');
      await setDeliveryStatus(d.id, 'cancelled' as MerchantOrderDeliveryStatus);
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['order_delivery', orderId] });
      await qc.invalidateQueries({ queryKey: ['user_notifications'] });
    },
  });

  const order = (orderQ.data as any)?.order;
  const items = ((orderQ.data as any)?.items ?? []) as any[];
  const events = (eventsQ.data ?? []) as any[];

  if (!orderId) return <div className="p-6">Missing order id.</div>;
  if (orderQ.isLoading) return <div className="p-6">Loading…</div>;
  if (orderQ.error) return <div className="p-6 text-red-700">{errorText(orderQ.error)}</div>;
  if (!order) return <div className="p-6">Order not found.</div>;

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="text-xl font-semibold">Order #{String(order.id).slice(0, 8)}</div>
          <div className="text-xs text-gray-500">{new Date(order.created_at).toLocaleString()}</div>
        </div>
        <div className="flex items-center gap-2">
        <button
          className="btn"
          disabled={orderChatThread.isPending}
          onClick={() => void orderChatThread.mutate()}
        >
          {orderChatThread.isPending ? 'Opening…' : 'Chat'}
        </button>
        <Link className="btn" to="/orders">
          Back to orders
        </Link>
      </div>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <div className="card p-5 space-y-3">
          <div className="font-semibold">Summary</div>
          <div className="text-sm text-gray-600">Status: <span className="font-medium">{order.status}</span></div>
          {order.merchant?.business_name ? (
            <div className="text-sm text-gray-600">Merchant: <span className="font-medium">{order.merchant.business_name}</span></div>
          ) : null}
          <div className="text-sm text-gray-600">Subtotal: <span className="font-medium">{formatIQD(order.subtotal_iqd)}</span></div>
          <div className="text-sm text-gray-600">Discount: <span className="font-medium">{formatIQD(order.discount_iqd)}</span></div>
          <div className="text-sm text-gray-600">Delivery fee: <span className="font-medium">{formatIQD(order.delivery_fee_iqd)}</span></div>
          <div className="text-sm text-gray-900">Total: <span className="font-semibold">{formatIQD(order.total_iqd)}</span></div>

          <div className="pt-2">
            <div className="font-semibold">Shipping</div>
            <div className="text-sm text-gray-600">{addrLine(order.address_snapshot) || '—'}</div>
            {order.address_snapshot?.recipient_name || order.address_snapshot?.phone ? (
              <div className="text-xs text-gray-500 mt-1">
                {[order.address_snapshot?.recipient_name, order.address_snapshot?.phone].filter(Boolean).join(' • ')}
              </div>
            ) : null}
          </div>


          <div className="pt-2">
            <div className="font-semibold">Delivery</div>
            {deliveryQ.isLoading ? <div className="text-sm text-gray-500">Loading…</div> : null}
            {deliveryQ.error ? <div className="text-sm text-red-700">{errorText(deliveryQ.error)}</div> : null}
            {(() => {
              const d = deliveryQ.data as any;
              if (!d) {
                return (
                  <div className="text-sm text-gray-600">
                    Not requested yet.
                    {canMerchantManage ? (
                      <div className="mt-2">
                        {requestDeliveryM.error ? (
                          <div className="text-sm text-red-700">{errorText(requestDeliveryM.error)}</div>
                        ) : null}
                        <button className="btn btn-primary" disabled={requestDeliveryM.isPending} onClick={() => requestDeliveryM.mutate()}>
                          {requestDeliveryM.isPending ? 'Requesting…' : 'Request delivery'}
                        </button>
                        <div className="text-xs text-gray-500 mt-1">Creates a delivery job drivers can claim (dispatch-lite).</div>
                      </div>
                    ) : null}
                  </div>
                );
              }

              const canCancel = canMerchantManage && d.status !== 'delivered' && d.status !== 'cancelled';

              return (
                <div className="mt-1 space-y-2">
                  <div className="text-sm text-gray-600">Status: <span className="font-medium">{d.status}</span></div>
                  {d.driver_id ? (
                    <div className="text-xs text-gray-500">Driver: {String(d.driver_id).slice(0, 8)}</div>
                  ) : (
                    <div className="text-xs text-gray-500">Driver: —</div>
                  )}
                  <div className="flex flex-wrap gap-2 pt-1">
                    {order.customer_id ? (
                      <button
                        className="btn btn-primary"
                        disabled={callBusyId === order.customer_id}
                        onClick={() => void startCallTo(order.customer_id)}
                      >
                        Call customer
                      </button>
                    ) : null}
                    {d.driver_id ? (
                      <button
                        className="btn btn-primary"
                        disabled={callBusyId === d.driver_id}
                        onClick={() => void startCallTo(d.driver_id)}
                      >
                        Call driver
                      </button>
                    ) : null}
                  </div>
                  {callErr ? <div className="text-sm text-red-700">{callErr}</div> : null}
                  {deliveryEventsQ.isLoading ? <div className="text-xs text-gray-500">Loading timeline…</div> : null}
                  {deliveryEventsQ.error ? <div className="text-xs text-red-700">{errorText(deliveryEventsQ.error)}</div> : null}
                  {Array.isArray(deliveryEventsQ.data) && deliveryEventsQ.data.length ? (
                    <div className="rounded-2xl border border-gray-200 p-3">
                      <div className="text-xs font-semibold mb-2">Delivery timeline</div>
                      <div className="space-y-2">
                        {deliveryEventsQ.data.map((ev: any) => (
                          <div key={ev.id} className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="text-xs font-medium">{ev.to_status}</div>
                              <div className="text-[11px] text-gray-500">{new Date(ev.created_at).toLocaleString()}</div>
                            </div>
                            <div className="text-[11px] text-gray-500">{ev.actor_role || 'system'}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  {canCancel ? (
                    <div className="pt-1">
                      {cancelDeliveryM.error ? <div className="text-sm text-red-700">{errorText(cancelDeliveryM.error)}</div> : null}
                      <button className="btn btn-danger" disabled={cancelDeliveryM.isPending} onClick={() => cancelDeliveryM.mutate()}>
                        {cancelDeliveryM.isPending ? 'Cancelling…' : 'Cancel delivery'}
                      </button>
                    </div>
                  ) : null}
                </div>
              );
            })()}
          </div>

          {order.customer_note ? (
            <div className="pt-2">
              <div className="font-semibold">Customer note</div>
              <div className="text-sm text-gray-600 whitespace-pre-wrap">{order.customer_note}</div>
            </div>
          ) : null}

          {canCustomerCancel ? (
            <div className="pt-2">
              {cancelM.error ? <div className="text-sm text-red-700">{errorText(cancelM.error)}</div> : null}
              <button className="btn btn-danger" disabled={cancelM.isPending} onClick={() => cancelM.mutate()}>
                {cancelM.isPending ? 'Cancelling…' : 'Cancel order'}
              </button>
              <div className="text-xs text-gray-500 mt-1">Cancellation is allowed only while the order is still placed.</div>
            </div>
          ) : null}
        </div>

        <div className="card p-5 space-y-3">
          <div className="font-semibold">Items</div>
          <div className="divide-y">
            {items.map((it) => (
              <div key={it.id} className="py-3 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-medium truncate">{it.name_snapshot}</div>
                  <div className="text-xs text-gray-500">
                    {it.qty} × {formatIQD(it.unit_price_iqd)}
                    {it.meta?.savings_iqd ? ` • saved ${formatIQD(it.meta.savings_iqd)}` : ''}
                  </div>
                </div>
                <div className="font-semibold">{formatIQD(it.line_total_iqd)}</div>
              </div>
            ))}
          </div>

          {canMerchantManage ? (
            <div className="mt-3 rounded-2xl border border-gray-200 bg-gray-50 p-4 space-y-3">
              <div className="font-semibold">Merchant controls</div>
              <div>
                <div className="label mb-1">Status</div>
                {(() => {
                  const current = (order.status as MerchantOrderStatus) ?? 'placed';
                  const allowed = allowedNextForMerchant(current);
                  const options: Array<{ value: MerchantOrderStatus; label: string }> = [
                    { value: current, label: `Current • ${statusLabel[current]}` },
                    ...allowed.map((s) => ({ value: s, label: statusLabel[s] })),
                  ];

                  const disabled = allowed.length === 0;
                  return (
                    <select
                      className="input"
                      value={nextStatus}
                      onChange={(e) => setNextStatus(e.target.value as any)}
                      disabled={disabled}
                    >
                      {options.map((s) => (
                        <option key={s.value} value={s.value}>
                          {s.label}
                        </option>
                      ))}
                    </select>
                  );
                })()}
              </div>
              <div>
                <div className="label mb-1">Merchant note (optional)</div>
                <textarea className="input" rows={3} value={merchantNote} onChange={(e) => setMerchantNote(e.target.value)} />
              </div>
              {statusM.error ? <div className="text-sm text-red-700">{errorText(statusM.error)}</div> : null}
              <button className="btn btn-primary" disabled={statusM.isPending} onClick={() => statusM.mutate()}>
                {statusM.isPending ? 'Updating…' : 'Update'}
              </button>
              <div className="text-xs text-gray-500">
                Status changes follow a simple state machine (placed → accepted → preparing → out for delivery → fulfilled).
              </div>
            </div>
          ) : null}

          <div className="mt-4 rounded-2xl border border-gray-200 p-4">
            <div className="font-semibold">Status timeline</div>
            {eventsQ.isLoading ? <div className="text-sm text-gray-500 mt-2">Loading…</div> : null}
            {eventsQ.error ? <div className="text-sm text-red-700 mt-2">{errorText(eventsQ.error)}</div> : null}
            {events.length === 0 && !eventsQ.isLoading ? <div className="text-sm text-gray-500 mt-2">No events yet.</div> : null}

            <div className="mt-3 space-y-2">
              {events.map((ev) => (
                <div key={ev.id} className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-medium">
                      {(ev.to_status as string) in statusLabel ? statusLabel[ev.to_status as MerchantOrderStatus] : ev.to_status}
                    </div>
                    {ev.note ? <div className="text-xs text-gray-600 mt-1 whitespace-pre-wrap">{ev.note}</div> : null}
                    <div className="text-xs text-gray-500 mt-1">{new Date(ev.created_at).toLocaleString()}</div>
                  </div>
                  <div className="text-xs text-gray-500 shrink-0">{ev.from_status ? `from ${ev.from_status}` : 'start'}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
