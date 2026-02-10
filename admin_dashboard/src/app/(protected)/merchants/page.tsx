import { redirect } from 'next/navigation';
import { getAdminContext } from '@/lib/auth/guards';
import { listMerchants } from '@/lib/admin/merchants';

const STATUSES = ['', 'draft', 'pending', 'approved', 'suspended'] as const;

export default async function MerchantsPage({
  searchParams,
}: {
  searchParams?: { q?: string; status?: string; offset?: string };
}) {
  const ctx = await getAdminContext();
  if (!ctx.can('merchants.read')) {
    redirect('/forbidden?permission=merchants.read');
  }

  const q = (searchParams?.q ?? '').trim();
  const status = (searchParams?.status ?? '').trim();
  const offset = Math.max(0, Number(searchParams?.offset ?? 0) || 0);

  const res = await listMerchants(ctx.supabase, { q, status, offset, limit: 25 });

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-xl font-semibold">Merchants</h1>
        <form className="flex flex-wrap items-center gap-2" action="/merchants" method="get">
          <input
            name="q"
            defaultValue={q}
            placeholder="Search merchant name or owner"
            className="rounded-md border px-3 py-2 text-sm bg-white"
          />
          <select name="status" defaultValue={status} className="rounded-md border px-3 py-2 text-sm bg-white">
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s ? s : 'all statuses'}
              </option>
            ))}
          </select>
          <button className="rounded-md bg-neutral-900 text-white px-3 py-2 text-sm hover:bg-neutral-800">Search</button>
        </form>
      </div>

      <div className="rounded-xl border bg-white overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-neutral-50 border-b">
            <tr>
              <th className="text-left px-4 py-2 font-medium">Merchant</th>
              <th className="text-left px-4 py-2 font-medium">Status</th>
              <th className="text-left px-4 py-2 font-medium">Owner</th>
              <th className="text-left px-4 py-2 font-medium">Orders</th>
              <th className="text-left px-4 py-2 font-medium">Last order</th>
              <th className="text-left px-4 py-2 font-medium">Created</th>
            </tr>
          </thead>
          <tbody>
            {res.merchants.map((m) => (
              <tr key={m.merchant_id} className="border-b last:border-b-0">
                <td className="px-4 py-2">
                  <a className="underline hover:no-underline" href={`/merchants/${m.merchant_id}`}>
                    {m.business_name ?? m.merchant_id.slice(0, 8) + '…'}
                  </a>
                  {m.business_type ? <div className="text-xs text-neutral-500">{m.business_type}</div> : null}
                  <div className="text-xs text-neutral-400 font-mono break-all">{m.merchant_id}</div>
                </td>
                <td className="px-4 py-2">{m.status}</td>
                <td className="px-4 py-2">
                  <div>{m.owner_display_name ?? '—'}</div>
                  {m.owner_phone ? <div className="text-xs text-neutral-500">{m.owner_phone}</div> : null}
                  <div className="text-xs text-neutral-400 font-mono break-all">{m.owner_profile_id}</div>
                </td>
                <td className="px-4 py-2">{Number(m.orders_count ?? 0).toLocaleString()}</td>
                <td className="px-4 py-2">
                  {m.last_order_at ? new Date(m.last_order_at).toLocaleString() : '—'}
                </td>
                <td className="px-4 py-2">{m.created_at ? new Date(m.created_at).toLocaleString() : '—'}</td>
              </tr>
            ))}
            {res.merchants.length === 0 && (
              <tr>
                <td className="px-4 py-6 text-sm text-neutral-500" colSpan={6}>
                  No merchants.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between text-xs text-neutral-500">
        <div>
          Showing {res.page.returned} merchants (offset {res.page.offset})
        </div>
        <div className="flex gap-2">
          <a
            className="rounded-md border bg-white px-2 py-1 hover:bg-neutral-50"
            href={`/merchants?q=${encodeURIComponent(q)}&status=${encodeURIComponent(status)}&offset=${Math.max(0, offset - 25)}`}
          >
            Prev
          </a>
          <a
            className="rounded-md border bg-white px-2 py-1 hover:bg-neutral-50"
            href={`/merchants?q=${encodeURIComponent(q)}&status=${encodeURIComponent(status)}&offset=${offset + 25}`}
          >
            Next
          </a>
        </div>
      </div>
    </div>
  );
}
