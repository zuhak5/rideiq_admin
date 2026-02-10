import Link from 'next/link';
import { getAdminContext } from '@/lib/auth/guards';
import { getOrderDetail } from '@/lib/admin/orders';
import { setOrderStatusAction } from './actions';

const STATUSES = ['placed', 'accepted', 'preparing', 'out_for_delivery', 'fulfilled', 'cancelled'] as const;

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const ctx = await getAdminContext();
  if (!ctx.guard.can('orders.read')) {
    return (
      <div className="p-4">
        <div className="rounded-md border bg-white p-4 text-sm">You do not have permission to view order details.</div>
      </div>
    );
  }

  const res = await getOrderDetail(ctx.supabase, id);
  const o: any = (res as any).order;
  const m: any = (res as any).merchant;
  const customer: any = (res as any).customer;
  const items: any[] = (res as any).items ?? [];
  const events: any[] = (res as any).status_events ?? [];
  const delivery: any = (res as any).delivery ?? null;

  const canManage = ctx.guard.can('orders.manage');

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Order</h1>
        <Link href="/orders" className="rounded-md border bg-white px-2 py-1 text-sm hover:bg-neutral-50">
          Back
        </Link>
      </div>

      <div className="rounded-lg border bg-white p-4 grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-1 md:col-span-2">
          <div className="text-xs text-neutral-500">Order ID</div>
          <div className="font-mono text-sm break-all">{o?.id ?? id}</div>
        </div>

        <div className="space-y-1">
          <div className="text-xs text-neutral-500">Status</div>
          <div className="text-sm">{o?.status ?? '—'}</div>
          <div className="text-xs text-neutral-500">
            Changed: {o?.status_changed_at ? new Date(o.status_changed_at).toLocaleString() : '—'}
          </div>
        </div>

        <div className="space-y-1">
          <div className="text-xs text-neutral-500">Total</div>
          <div className="text-sm">{o?.total_iqd ? Number(o.total_iqd).toLocaleString() + ' IQD' : '—'}</div>
          <div className="text-xs text-neutral-500">Fee: {o?.fee_iqd ? Number(o.fee_iqd).toLocaleString() + ' IQD' : '—'}</div>
        </div>

        <div className="space-y-1">
          <div className="text-xs text-neutral-500">Merchant</div>
          <div className="text-sm">{m?.business_name ?? '—'}</div>
          <div className="text-xs text-neutral-400 font-mono break-all">{o?.merchant_id ?? '—'}</div>
        </div>

        <div className="space-y-1">
          <div className="text-xs text-neutral-500">Customer</div>
          <div className="text-sm">{customer?.display_name ?? '—'}</div>
          <div className="text-xs text-neutral-500">{customer?.phone ?? '—'}</div>
          <div className="text-xs text-neutral-400 font-mono break-all">{o?.customer_id ?? '—'}</div>
        </div>

        <div className="space-y-1">
          <div className="text-xs text-neutral-500">Payment</div>
          <div className="text-sm">{o?.payment_status ?? '—'}</div>
          <div className="text-xs text-neutral-500">{o?.payment_method ?? '—'}</div>
          {o?.payment_reference ? <div className="text-xs text-neutral-400 break-all">{o.payment_reference}</div> : null}
        </div>

        <div className="space-y-1">
          <div className="text-xs text-neutral-500">Created</div>
          <div className="text-sm">{o?.created_at ? new Date(o.created_at).toLocaleString() : '—'}</div>
        </div>

        <div className="space-y-1 md:col-span-2">
          <div className="text-xs text-neutral-500">Delivery address</div>
          <pre className="text-xs bg-neutral-50 border rounded-md p-2 overflow-x-auto">
            {JSON.stringify(o?.delivery_address ?? null, null, 2)}
          </pre>
        </div>
      </div>

      <div className="rounded-lg border bg-white p-4 space-y-3">
        <h2 className="font-semibold">Actions</h2>
        <form action={setOrderStatusAction} className="grid grid-cols-1 lg:grid-cols-3 gap-2 items-end">
          <input type="hidden" name="order_id" value={o?.id ?? id} />
          <div className="space-y-1">
            <div className="text-xs text-neutral-500">New status</div>
            <select
              name="to_status"
              defaultValue={o?.status ?? 'placed'}
              className="w-full rounded-md border px-2 py-1 text-sm"
              disabled={!canManage}
            >
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1 lg:col-span-2">
            <div className="text-xs text-neutral-500">Note (optional)</div>
            <input
              name="note"
              placeholder="Reason / context"
              className="w-full rounded-md border px-2 py-1 text-sm"
              defaultValue=""
              disabled={!canManage}
            />
          </div>
          <div>
            <button
              className={`rounded-md border px-3 py-2 text-sm bg-white hover:bg-neutral-50 ${!canManage ? 'opacity-50 pointer-events-none' : ''}`}
            >
              Update status
            </button>
            {!canManage && <div className="text-xs text-neutral-500 mt-1">Missing orders.manage</div>}
          </div>
        </form>
      </div>

      <div className="rounded-lg border bg-white p-4 space-y-2">
        <h2 className="font-semibold">Items</h2>
        <div className="rounded-md border overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-neutral-50">
              <tr className="text-left">
                <th className="p-2">Name</th>
                <th className="p-2">Qty</th>
                <th className="p-2">Unit</th>
                <th className="p-2">Subtotal</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it) => (
                <tr key={it.id} className="border-t">
                  <td className="p-2">{it.name ?? '—'}</td>
                  <td className="p-2">{it.qty ?? '—'}</td>
                  <td className="p-2">{it.unit_price_iqd ? Number(it.unit_price_iqd).toLocaleString() + ' IQD' : '—'}</td>
                  <td className="p-2">{it.subtotal_iqd ? Number(it.subtotal_iqd).toLocaleString() + ' IQD' : '—'}</td>
                </tr>
              ))}
              {items.length === 0 && (
                <tr>
                  <td className="p-4 text-neutral-500" colSpan={4}>
                    No items.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="rounded-lg border bg-white p-4 space-y-2">
        <h2 className="font-semibold">Delivery</h2>
        {delivery ? (
          <pre className="text-xs bg-neutral-50 border rounded-md p-2 overflow-x-auto">{JSON.stringify(delivery, null, 2)}</pre>
        ) : (
          <div className="text-sm text-neutral-500">No delivery record.</div>
        )}
      </div>

      <div className="rounded-lg border bg-white p-4 space-y-2">
        <h2 className="font-semibold">Status events</h2>
        <div className="rounded-md border overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-neutral-50">
              <tr className="text-left">
                <th className="p-2">When</th>
                <th className="p-2">From</th>
                <th className="p-2">To</th>
                <th className="p-2">Actor</th>
                <th className="p-2">Note</th>
              </tr>
            </thead>
            <tbody>
              {events.map((e) => (
                <tr key={e.id} className="border-t">
                  <td className="p-2">{e.created_at ? new Date(e.created_at).toLocaleString() : '—'}</td>
                  <td className="p-2">{e.from_status}</td>
                  <td className="p-2">{e.to_status}</td>
                  <td className="p-2 font-mono text-xs">{e.actor_id ?? '—'}</td>
                  <td className="p-2">{e.note ?? '—'}</td>
                </tr>
              ))}
              {events.length === 0 && (
                <tr>
                  <td className="p-4 text-neutral-500" colSpan={5}>
                    No events.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
