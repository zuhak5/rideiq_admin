import { redirect } from 'next/navigation';
import { getAdminContext } from '@/lib/auth/guards';
import { listOrders } from '@/lib/admin/orders';

const STATUSES = ['', 'placed', 'accepted', 'preparing', 'out_for_delivery', 'fulfilled', 'cancelled'] as const;

export default async function OrdersPage({
  searchParams,
}: {
  searchParams?: { q?: string; status?: string; merchant_id?: string; offset?: string };
}) {
  const ctx = await getAdminContext();
  if (!ctx.can('orders.read')) {
    redirect('/forbidden?permission=orders.read');
  }

  const q = (searchParams?.q ?? '').trim();
  const status = (searchParams?.status ?? '').trim();
  const merchant_id = (searchParams?.merchant_id ?? '').trim();
  const offset = Math.max(0, Number(searchParams?.offset ?? 0) || 0);

  const res = await listOrders(ctx.supabase, { q, status, merchant_id: merchant_id || undefined, offset, limit: 25 });

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-xl font-semibold">Orders</h1>
        <form className="flex flex-wrap items-center gap-2" action="/orders" method="get">
          <input
            name="q"
            defaultValue={q}
            placeholder="Search order, merchant, customer"
            className="rounded-md border px-3 py-2 text-sm bg-white"
          />
          <select name="status" defaultValue={status} className="rounded-md border px-3 py-2 text-sm bg-white">
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s ? s : 'all statuses'}
              </option>
            ))}
          </select>
          <input
            name="merchant_id"
            defaultValue={merchant_id}
            placeholder="Merchant UUID (optional)"
            className="rounded-md border px-3 py-2 text-sm bg-white"
          />
          <button className="rounded-md bg-neutral-900 text-white px-3 py-2 text-sm hover:bg-neutral-800">Search</button>
        </form>
      </div>

      <div className="rounded-xl border bg-white overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-neutral-50 border-b">
            <tr>
              <th className="text-left px-4 py-2 font-medium">Order</th>
              <th className="text-left px-4 py-2 font-medium">Status</th>
              <th className="text-left px-4 py-2 font-medium">Merchant</th>
              <th className="text-left px-4 py-2 font-medium">Customer</th>
              <th className="text-left px-4 py-2 font-medium">Total</th>
              <th className="text-left px-4 py-2 font-medium">Payment</th>
              <th className="text-left px-4 py-2 font-medium">Delivery</th>
              <th className="text-left px-4 py-2 font-medium">Created</th>
            </tr>
          </thead>
          <tbody>
            {res.orders.map((o) => (
              <tr key={o.order_id} className="border-b last:border-b-0">
                <td className="px-4 py-2">
                  <a className="underline hover:no-underline font-mono" href={`/orders/${o.order_id}`}>
                    {o.order_id.slice(0, 8)}…
                  </a>
                  <div className="text-xs text-neutral-400 font-mono break-all">{o.order_id}</div>
                </td>
                <td className="px-4 py-2">
                  <div>{o.status}</div>
                  {o.status_changed_at ? (
                    <div className="text-xs text-neutral-500">changed {new Date(o.status_changed_at).toLocaleString()}</div>
                  ) : null}
                </td>
                <td className="px-4 py-2">
                  <div>{o.merchant_name ?? '—'}</div>
                  <div className="text-xs text-neutral-400 font-mono break-all">{o.merchant_id}</div>
                </td>
                <td className="px-4 py-2">
                  <div>{o.customer_name ?? '—'}</div>
                  {o.customer_phone ? <div className="text-xs text-neutral-500">{o.customer_phone}</div> : null}
                  {o.customer_id ? <div className="text-xs text-neutral-400 font-mono break-all">{o.customer_id}</div> : null}
                </td>
                <td className="px-4 py-2">{o.total_iqd ? Number(o.total_iqd).toLocaleString() + ' IQD' : '—'}</td>
                <td className="px-4 py-2">
                  <div>{o.payment_status ?? '—'}</div>
                  <div className="text-xs text-neutral-500">{o.payment_method ?? '—'}</div>
                </td>
                <td className="px-4 py-2">{o.delivery_status ?? '—'}</td>
                <td className="px-4 py-2">{o.created_at ? new Date(o.created_at).toLocaleString() : '—'}</td>
              </tr>
            ))}
            {res.orders.length === 0 && (
              <tr>
                <td className="px-4 py-6 text-sm text-neutral-500" colSpan={8}>
                  No orders.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between text-xs text-neutral-500">
        <div>
          Showing {res.page.returned} orders (offset {res.page.offset})
        </div>
        <div className="flex gap-2">
          <a
            className="rounded-md border bg-white px-2 py-1 hover:bg-neutral-50"
            href={`/orders?q=${encodeURIComponent(q)}&status=${encodeURIComponent(status)}&merchant_id=${encodeURIComponent(merchant_id)}&offset=${Math.max(0, offset - 25)}`}
          >
            Prev
          </a>
          <a
            className="rounded-md border bg-white px-2 py-1 hover:bg-neutral-50"
            href={`/orders?q=${encodeURIComponent(q)}&status=${encodeURIComponent(status)}&merchant_id=${encodeURIComponent(merchant_id)}&offset=${offset + 25}`}
          >
            Next
          </a>
        </div>
      </div>
    </div>
  );
}
