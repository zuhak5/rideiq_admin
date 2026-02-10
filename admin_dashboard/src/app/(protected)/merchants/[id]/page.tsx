import Link from 'next/link';
import { getAdminContext } from '@/lib/auth/guards';
import { getMerchantDetail } from '@/lib/admin/merchants';
import { setMerchantStatusAction } from './actions';

const STATUSES = ['draft', 'pending', 'approved', 'suspended'] as const;

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const ctx = await getAdminContext();
  if (!ctx.guard.can('merchants.read')) {
    return (
      <div className="p-4">
        <div className="rounded-md border bg-white p-4 text-sm">You do not have permission to view merchant details.</div>
      </div>
    );
  }

  const res = await getMerchantDetail(ctx.supabase, id);
  const m: any = (res as any).merchant;
  const owner: any = (res as any).owner;
  const stats: any = (res as any).stats ?? {};
  const audits: any[] = (res as any).audits ?? [];
  const recentOrders: any[] = (res as any).recent_orders ?? [];

  const canManage = ctx.guard.can('merchants.manage');

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Merchant</h1>
        <Link href="/merchants" className="rounded-md border bg-white px-2 py-1 text-sm hover:bg-neutral-50">
          Back
        </Link>
      </div>

      <div className="rounded-lg border bg-white p-4 grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-1 md:col-span-2">
          <div className="text-xs text-neutral-500">Merchant ID</div>
          <div className="font-mono text-sm break-all">{m?.id ?? id}</div>
        </div>

        <div className="space-y-1">
          <div className="text-xs text-neutral-500">Business</div>
          <div className="text-sm">{m?.business_name ?? '—'}</div>
          <div className="text-xs text-neutral-500">{m?.business_type ?? ''}</div>
        </div>

        <div className="space-y-1">
          <div className="text-xs text-neutral-500">Status</div>
          <div className="text-sm">{m?.status ?? '—'}</div>
        </div>

        <div className="space-y-1">
          <div className="text-xs text-neutral-500">Owner</div>
          <div className="text-sm">{owner?.display_name ?? '—'}</div>
          <div className="text-xs text-neutral-500">{owner?.phone ?? '—'}</div>
          <div className="text-xs text-neutral-400 font-mono break-all">{m?.owner_profile_id ?? '—'}</div>
        </div>

        <div className="space-y-1">
          <div className="text-xs text-neutral-500">Orders</div>
          <div className="text-sm">{Number(stats?.orders_count ?? 0).toLocaleString()}</div>
          <div className="text-xs text-neutral-500">
            Last order: {stats?.last_order_at ? new Date(stats.last_order_at).toLocaleString() : '—'}
          </div>
        </div>

        <div className="space-y-1 md:col-span-2">
          <div className="text-xs text-neutral-500">Address</div>
          <pre className="text-xs bg-neutral-50 border rounded-md p-2 overflow-x-auto">
            {JSON.stringify(
              {
                address: m?.address ?? null,
                city: m?.city ?? null,
                area: m?.area ?? null,
                location: m?.location ?? null,
              },
              null,
              2,
            )}
          </pre>
        </div>
      </div>

      <div className="rounded-lg border bg-white p-4 space-y-3">
        <h2 className="font-semibold">Actions</h2>
        <form action={setMerchantStatusAction} className="grid grid-cols-1 lg:grid-cols-3 gap-2 items-end">
          <input type="hidden" name="merchant_id" value={m?.id ?? id} />
          <div className="space-y-1">
            <div className="text-xs text-neutral-500">New status</div>
            <select
              name="to_status"
              defaultValue={m?.status ?? 'pending'}
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
            {!canManage && <div className="text-xs text-neutral-500 mt-1">Missing merchants.manage</div>}
          </div>
        </form>
      </div>

      <div className="rounded-lg border bg-white p-4 space-y-2">
        <h2 className="font-semibold">Recent orders</h2>
        <div className="rounded-md border overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-neutral-50">
              <tr className="text-left">
                <th className="p-2">Order</th>
                <th className="p-2">Status</th>
                <th className="p-2">Total</th>
                <th className="p-2">Customer</th>
                <th className="p-2">Created</th>
              </tr>
            </thead>
            <tbody>
              {recentOrders.map((o) => (
                <tr key={o.id} className="border-t">
                  <td className="p-2 font-mono">
                    <Link href={`/orders/${o.id}`} className="text-blue-700 hover:underline">
                      {String(o.id).slice(0, 8)}…
                    </Link>
                  </td>
                  <td className="p-2">{o.status}</td>
                  <td className="p-2">{o.total_iqd ? Number(o.total_iqd).toLocaleString() + ' IQD' : '—'}</td>
                  <td className="p-2">
                    {o.customer?.display_name ?? '—'}
                    {o.customer?.phone ? <div className="text-xs text-neutral-500">{o.customer.phone}</div> : null}
                  </td>
                  <td className="p-2">{o.created_at ? new Date(o.created_at).toLocaleString() : '—'}</td>
                </tr>
              ))}
              {recentOrders.length === 0 && (
                <tr>
                  <td className="p-4 text-neutral-500" colSpan={5}>
                    No orders.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="rounded-lg border bg-white p-4 space-y-2">
        <h2 className="font-semibold">Status audit</h2>
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
              {audits.map((a) => (
                <tr key={a.id} className="border-t">
                  <td className="p-2">{a.created_at ? new Date(a.created_at).toLocaleString() : '—'}</td>
                  <td className="p-2">{a.from_status}</td>
                  <td className="p-2">{a.to_status}</td>
                  <td className="p-2 font-mono text-xs">{a.actor_id ?? '—'}</td>
                  <td className="p-2">{a.note ?? '—'}</td>
                </tr>
              ))}
              {audits.length === 0 && (
                <tr>
                  <td className="p-4 text-neutral-500" colSpan={5}>
                    No audit events.
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
