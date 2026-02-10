import React from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getMyProfileBasics } from '../lib/profile';
import { getMyMerchant } from '../lib/merchant';
import { listCustomerOrders, listMerchantOrders, type MerchantOrderStatus } from '../lib/orders';
import { formatIQD } from '../lib/money';
import { errorText } from '../lib/errors';
import { supabase } from '../lib/supabaseClient';
import ConciergeChat from '../components/ConciergeChat';

function StatusPill({ status }: { status: string }) {
  const map: Record<string, string> = {
    placed: 'Placed',
    accepted: 'Accepted',
    preparing: 'Preparing',
    out_for_delivery: 'Out for delivery',
    fulfilled: 'Fulfilled',
    cancelled: 'Cancelled',
  };
  return (
    <span className="inline-flex items-center rounded-full border border-gray-200 px-2 py-0.5 text-xs">
      {map[status] ?? status}
    </span>
  );
}

const STATUS_OPTIONS: Array<{ value: MerchantOrderStatus | 'all'; label: string }> = [
  { value: 'all', label: 'All statuses' },
  { value: 'placed', label: 'Placed' },
  { value: 'accepted', label: 'Accepted' },
  { value: 'preparing', label: 'Preparing' },
  { value: 'out_for_delivery', label: 'Out for delivery' },
  { value: 'fulfilled', label: 'Fulfilled' },
  { value: 'cancelled', label: 'Cancelled' },
];

export default function OrdersPage() {
  const qc = useQueryClient();
  const [tab, setTab] = React.useState<'my' | 'merchant'>('my');
  const [customerStatus, setCustomerStatus] = React.useState<MerchantOrderStatus | 'all'>('all');
  const [merchantStatus, setMerchantStatus] = React.useState<MerchantOrderStatus | 'all'>('all');
  const [search, setSearch] = React.useState('');

  const profileQ = useQuery({ queryKey: ['my-profile-basics'], queryFn: getMyProfileBasics });

  const myMerchantQ = useQuery({
    queryKey: ['my-merchant'],
    queryFn: getMyMerchant,
    enabled: profileQ.data?.active_role === 'merchant',
  });

  const isMerchant = profileQ.data?.active_role === 'merchant' && Boolean(myMerchantQ.data?.id);

  React.useEffect(() => {
    if (isMerchant) setTab('merchant');
  }, [isMerchant]);

  const customerOrdersQ = useQuery({
    queryKey: ['merchant_orders', 'customer', customerStatus],
    queryFn: () => listCustomerOrders({ limit: 200, status: customerStatus === 'all' ? null : customerStatus }),
  });

  const merchantOrdersQ = useQuery({
    queryKey: ['merchant_orders', 'merchant', myMerchantQ.data?.id ?? '', merchantStatus],
    queryFn: () => listMerchantOrders(myMerchantQ.data!.id, { limit: 200, status: merchantStatus === 'all' ? null : merchantStatus }),
    enabled: Boolean(myMerchantQ.data?.id),
  });

  // Realtime invalidation: keep the list fresh for both customer and merchant views.
  React.useEffect(() => {
    const uid = profileQ.data?.id;
    const merchantId = myMerchantQ.data?.id;
    if (!uid) return;

    const channels: any[] = [];

    const chCustomer = supabase
      .channel(`orders:customer:${uid}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'merchant_orders', filter: `customer_id=eq.${uid}` }, () => {
        void qc.invalidateQueries({ queryKey: ['merchant_orders', 'customer'] });
      })
      .subscribe();
    channels.push(chCustomer);

    if (merchantId) {
      const chMerchant = supabase
        .channel(`orders:merchant:${merchantId}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'merchant_orders', filter: `merchant_id=eq.${merchantId}` }, () => {
          void qc.invalidateQueries({ queryKey: ['merchant_orders', 'merchant', merchantId] });
        })
        .subscribe();
      channels.push(chMerchant);
    }

    return () => {
      channels.forEach((ch) => void supabase.removeChannel(ch));
    };
  }, [profileQ.data?.id, myMerchantQ.data?.id, qc]);

  const searchNorm = search.trim().toLowerCase();
  const customerRows = (customerOrdersQ.data ?? []).filter((o) => !searchNorm || String(o.id).toLowerCase().startsWith(searchNorm));
  const merchantRows = (merchantOrdersQ.data ?? []).filter((o) => !searchNorm || String(o.id).toLowerCase().startsWith(searchNorm));

  return (
    <div className="p-4 md:p-6 space-y-4">
      <ConciergeChat />
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="text-xl font-semibold">Orders</div>
          <div className="text-xs text-gray-500">Track and manage commerce orders.</div>
        </div>
        {isMerchant ? (
          <div className="inline-flex rounded-2xl border border-gray-200 p-1 bg-white">
            <button
              className={`px-3 py-2 text-sm rounded-xl ${tab === 'merchant' ? 'bg-black text-white' : ''}`}
              onClick={() => setTab('merchant')}
            >
              Merchant
            </button>
            <button
              className={`px-3 py-2 text-sm rounded-xl ${tab === 'my' ? 'bg-black text-white' : ''}`}
              onClick={() => setTab('my')}
            >
              My orders
            </button>
          </div>
        ) : null}
      </div>

      {tab === 'my' ? (
        <div className="card p-5">
          <div className="flex flex-wrap items-center gap-2 mb-3">
            <select className="input" value={customerStatus} onChange={(e) => setCustomerStatus(e.target.value as any)}>
              {STATUS_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <input
              className="input flex-1 min-w-[220px]"
              placeholder="Search by order id prefix…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <div className="text-xs text-gray-500">Tip: paste first 8 chars</div>
          </div>

          {customerOrdersQ.isLoading ? <div className="text-sm text-gray-500">Loading…</div> : null}
          {customerOrdersQ.error ? <div className="text-sm text-red-700">{errorText(customerOrdersQ.error)}</div> : null}
          {customerRows.length === 0 && !customerOrdersQ.isLoading ? <div className="text-sm text-gray-600">No orders found.</div> : null}

          <div className="divide-y">
            {customerRows.map((o) => (
              <Link key={o.id} to={`/orders/${o.id}`} className="block py-3 hover:bg-gray-50 rounded-xl px-2">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="font-medium">Order #{o.id.slice(0, 8)}</div>
                    <div className="text-xs text-gray-500">{new Date(o.created_at).toLocaleString()}</div>
                  </div>
                  <div className="text-right">
                    <StatusPill status={o.status} />
                    <div className="font-semibold mt-1">{formatIQD(o.total_iqd)}</div>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </div>
      ) : (
        <div className="card p-5">
          <div className="flex flex-wrap items-center gap-2 mb-3">
            <select className="input" value={merchantStatus} onChange={(e) => setMerchantStatus(e.target.value as any)}>
              {STATUS_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <input
              className="input flex-1 min-w-[220px]"
              placeholder="Search by order id prefix…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <div className="text-xs text-gray-500">Tip: paste first 8 chars</div>
          </div>

          {myMerchantQ.isLoading ? <div className="text-sm text-gray-500">Loading merchant…</div> : null}
          {myMerchantQ.error ? <div className="text-sm text-red-700">{errorText(myMerchantQ.error)}</div> : null}
          {merchantOrdersQ.isLoading ? <div className="text-sm text-gray-500">Loading orders…</div> : null}
          {merchantOrdersQ.error ? <div className="text-sm text-red-700">{errorText(merchantOrdersQ.error)}</div> : null}
          {merchantRows.length === 0 && !merchantOrdersQ.isLoading ? <div className="text-sm text-gray-600">No orders found.</div> : null}

          <div className="divide-y">
            {merchantRows.map((o) => (
              <Link key={o.id} to={`/orders/${o.id}`} className="block py-3 hover:bg-gray-50 rounded-xl px-2">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="font-medium">Order #{o.id.slice(0, 8)}</div>
                    <div className="text-xs text-gray-500">{new Date(o.created_at).toLocaleString()}</div>
                  </div>
                  <div className="text-right">
                    <StatusPill status={o.status} />
                    <div className="font-semibold mt-1">{formatIQD(o.total_iqd)}</div>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
