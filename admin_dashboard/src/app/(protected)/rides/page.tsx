import { redirect } from 'next/navigation';
import { getAdminContext } from '@/lib/auth/guards';
import { listRides } from '@/lib/admin/rides';

const STATUSES = ['', 'assigned', 'arrived', 'in_progress', 'completed', 'canceled'] as const;

export default async function RidesPage({
  searchParams,
}: {
  searchParams?: { q?: string; status?: string; offset?: string };
}) {
  const ctx = await getAdminContext();
  if (!ctx.can('rides.read')) {
    redirect('/forbidden?permission=rides.read');
  }

  const q = (searchParams?.q ?? '').trim();
  const status = (searchParams?.status ?? '').trim();
  const offset = Math.max(0, Number(searchParams?.offset ?? 0) || 0);

  const res = await listRides(ctx.supabase, { q, status, offset, limit: 25 });

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-xl font-semibold">Rides</h1>
        <form className="flex flex-wrap items-center gap-2" action="/rides" method="get">
          <input
            name="q"
            defaultValue={q}
            placeholder="Search ride/request UUID"
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
          <button className="rounded-md bg-neutral-900 text-white px-3 py-2 text-sm hover:bg-neutral-800">
            Search
          </button>
        </form>
      </div>

      <div className="rounded-xl border bg-white overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-neutral-50 border-b">
            <tr>
              <th className="text-left px-4 py-2 font-medium">Ride</th>
              <th className="text-left px-4 py-2 font-medium">Status</th>
              <th className="text-left px-4 py-2 font-medium">Rider</th>
              <th className="text-left px-4 py-2 font-medium">Driver</th>
              <th className="text-left px-4 py-2 font-medium">Pickup → Dropoff</th>
              <th className="text-left px-4 py-2 font-medium">Payment</th>
              <th className="text-left px-4 py-2 font-medium">Created</th>
            </tr>
          </thead>
          <tbody>
            {res.rides.map((r) => (
              <tr key={r.id} className="border-b last:border-b-0">
                <td className="px-4 py-2">
                  <a className="underline hover:no-underline" href={`/rides/${r.id}`}>
                    {r.id.slice(0, 8)}…
                  </a>
                </td>
                <td className="px-4 py-2">{r.status}</td>
                <td className="px-4 py-2">
                  {r.rider?.display_name ?? '—'}
                  {r.rider?.phone ? <div className="text-xs text-neutral-500">{r.rider.phone}</div> : null}
                </td>
                <td className="px-4 py-2">
                  {r.driver?.profile?.display_name ?? '—'}
                  {r.driver?.id ? (
                    <div className="text-xs text-neutral-500">
                      <a className="underline hover:no-underline" href={`/drivers/${r.driver.id}`}>
                        driver
                      </a>
                    </div>
                  ) : null}
                </td>
                <td className="px-4 py-2">
                  <div className="line-clamp-1">{r.request?.pickup_address ?? '—'}</div>
                  <div className="text-xs text-neutral-500 line-clamp-1">{r.request?.dropoff_address ?? '—'}</div>
                </td>
                <td className="px-4 py-2">
                  <div className="text-xs">{r.payment_method ?? '—'}</div>
                  <div className="text-xs text-neutral-500">{r.payment_status ?? '—'}</div>
                </td>
                <td className="px-4 py-2">
                  {r.created_at ? new Date(r.created_at).toLocaleString() : '—'}
                </td>
              </tr>
            ))}
            {res.rides.length === 0 && (
              <tr>
                <td className="px-4 py-6 text-sm text-neutral-500" colSpan={7}>
                  No rides.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between text-xs text-neutral-500">
        <div>
          Showing {res.page.returned} rides (offset {res.page.offset})
          {typeof res.page.total === 'number' ? ` / total ${res.page.total}` : ''}
        </div>
        <div className="flex gap-2">
          <a
            className="rounded-md border bg-white px-2 py-1 hover:bg-neutral-50"
            href={`/rides?q=${encodeURIComponent(q)}&status=${encodeURIComponent(status)}&offset=${Math.max(0, offset - 25)}`}
          >
            Prev
          </a>
          <a
            className="rounded-md border bg-white px-2 py-1 hover:bg-neutral-50"
            href={`/rides?q=${encodeURIComponent(q)}&status=${encodeURIComponent(status)}&offset=${offset + 25}`}
          >
            Next
          </a>
        </div>
      </div>
    </div>
  );
}
