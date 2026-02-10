import { redirect } from 'next/navigation';
import { getAdminContext } from '@/lib/auth/guards';
import { listPayments } from '@/lib/admin/payments';

const STATUSES = ['', 'pending', 'succeeded', 'failed', 'canceled', 'refunded'] as const;

export default async function PaymentsPage({
  searchParams,
}: {
  searchParams?: { q?: string; status?: string; provider?: string; offset?: string };
}) {
  const ctx = await getAdminContext();
  if (!ctx.can('payments.read')) {
    redirect('/forbidden?permission=payments.read');
  }

  const q = (searchParams?.q ?? '').trim();
  const status = (searchParams?.status ?? '').trim();
  const provider = (searchParams?.provider ?? '').trim();
  const offset = Math.max(0, Number(searchParams?.offset ?? 0) || 0);

  const res = await listPayments(ctx.supabase, { q, status, provider, offset, limit: 25 });

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-xl font-semibold">Payments</h1>
        <form className="flex flex-wrap items-center gap-2" action="/payments" method="get">
          <input
            name="q"
            defaultValue={q}
            placeholder="Search payment/ride UUID or provider ref"
            className="rounded-md border px-3 py-2 text-sm bg-white"
          />
          <select
            name="status"
            defaultValue={status}
            className="rounded-md border px-3 py-2 text-sm bg-white"
          >
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s ? s : 'all statuses'}
              </option>
            ))}
          </select>
          <input
            name="provider"
            defaultValue={provider}
            placeholder="Provider (optional)"
            className="rounded-md border px-3 py-2 text-sm bg-white"
          />
          <button className="rounded-md bg-neutral-900 text-white px-3 py-2 text-sm hover:bg-neutral-800">
            Search
          </button>
        </form>
      </div>

      <div className="rounded-xl border bg-white overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-neutral-50 border-b">
            <tr>
              <th className="text-left px-4 py-2 font-medium">Payment</th>
              <th className="text-left px-4 py-2 font-medium">Status</th>
              <th className="text-left px-4 py-2 font-medium">Amount</th>
              <th className="text-left px-4 py-2 font-medium">Provider</th>
              <th className="text-left px-4 py-2 font-medium">Ride</th>
              <th className="text-left px-4 py-2 font-medium">Rider</th>
              <th className="text-left px-4 py-2 font-medium">Created</th>
            </tr>
          </thead>
          <tbody>
            {res.payments.map((p) => (
              <tr key={p.id} className="border-b last:border-b-0">
                <td className="px-4 py-2">
                  <a className="underline hover:no-underline" href={`/payments/${p.id}`}>
                    {p.id.slice(0, 8)}…
                  </a>
                  {p.provider_ref ? <div className="text-xs text-neutral-500 break-all">{p.provider_ref}</div> : null}
                </td>
                <td className="px-4 py-2">
                  <div>{p.status}</div>
                  {p.refund_amount_iqd ? (
                    <div className="text-xs text-neutral-500">refunded {p.refund_amount_iqd} IQD</div>
                  ) : null}
                  {p.failure_code ? (
                    <div className="text-xs text-red-700">{p.failure_code}</div>
                  ) : null}
                </td>
                <td className="px-4 py-2">
                  <div>{p.amount_iqd ?? '—'} {p.currency ?? ''}</div>
                  <div className="text-xs text-neutral-500">{p.method ?? '—'}</div>
                </td>
                <td className="px-4 py-2">{p.provider ?? '—'}</td>
                <td className="px-4 py-2">
                  {p.ride_id ? (
                    <a className="underline hover:no-underline" href={`/rides/${p.ride_id}`}>
                      {p.ride_id.slice(0, 8)}…
                    </a>
                  ) : (
                    '—'
                  )}
                  {p.ride?.status ? <div className="text-xs text-neutral-500">{p.ride.status}</div> : null}
                </td>
                <td className="px-4 py-2">
                  {p.ride?.rider?.display_name ?? '—'}
                  {p.ride?.rider?.phone ? <div className="text-xs text-neutral-500">{p.ride.rider.phone}</div> : null}
                </td>
                <td className="px-4 py-2">{p.created_at ? new Date(p.created_at).toLocaleString() : '—'}</td>
              </tr>
            ))}
            {res.payments.length === 0 && (
              <tr>
                <td className="px-4 py-6 text-sm text-neutral-500" colSpan={7}>
                  No payments.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between text-xs text-neutral-500">
        <div>
          Showing {res.page.returned} payments (offset {res.page.offset})
          {typeof res.page.total === 'number' ? ` / total ${res.page.total}` : ''}
        </div>
        <div className="flex gap-2">
          <a
            className="rounded-md border bg-white px-2 py-1 hover:bg-neutral-50"
            href={`/payments?q=${encodeURIComponent(q)}&status=${encodeURIComponent(status)}&provider=${encodeURIComponent(provider)}&offset=${Math.max(0, offset - 25)}`}
          >
            Prev
          </a>
          <a
            className="rounded-md border bg-white px-2 py-1 hover:bg-neutral-50"
            href={`/payments?q=${encodeURIComponent(q)}&status=${encodeURIComponent(status)}&provider=${encodeURIComponent(provider)}&offset=${offset + 25}`}
          >
            Next
          </a>
        </div>
      </div>
    </div>
  );
}
