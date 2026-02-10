import { redirect } from 'next/navigation';
import { getAdminContext } from '@/lib/auth/guards';
import { listDrivers } from '@/lib/admin/drivers';

const STATUSES = ['', 'offline', 'available', 'on_trip', 'reserved', 'assigned', 'suspended'] as const;

export default async function DriversPage({
  searchParams,
}: {
  searchParams?: { q?: string; status?: string; offset?: string };
}) {
  const ctx = await getAdminContext();
  if (!ctx.can('drivers.read')) {
    redirect('/forbidden?permission=drivers.read');
  }

  const q = (searchParams?.q ?? '').trim();
  const status = (searchParams?.status ?? '').trim();
  const offset = Math.max(0, Number(searchParams?.offset ?? 0) || 0);

  const res = await listDrivers(ctx.supabase, { q, status, offset, limit: 25 });

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-xl font-semibold">Drivers</h1>
        <form className="flex flex-wrap items-center gap-2" action="/drivers" method="get">
          <input
            name="q"
            defaultValue={q}
            placeholder="Search driver UUID"
            className="rounded-md border px-3 py-2 text-sm bg-white"
          />
          <select name="status" defaultValue={status} className="rounded-md border px-3 py-2 text-sm bg-white">
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
              <th className="text-left px-4 py-2 font-medium">Driver</th>
              <th className="text-left px-4 py-2 font-medium">Status</th>
              <th className="text-left px-4 py-2 font-medium">Name</th>
              <th className="text-left px-4 py-2 font-medium">Phone</th>
              <th className="text-left px-4 py-2 font-medium">Trips</th>
              <th className="text-left px-4 py-2 font-medium">Rating</th>
              <th className="text-left px-4 py-2 font-medium">Cash</th>
            </tr>
          </thead>
          <tbody>
            {res.drivers.map((d) => (
              <tr key={d.id} className="border-b last:border-b-0">
                <td className="px-4 py-2">
                  <a className="underline hover:no-underline" href={`/drivers/${d.id}`}>
                    {d.id.slice(0, 8)}…
                  </a>
                </td>
                <td className="px-4 py-2">{d.status}</td>
                <td className="px-4 py-2">{d.profile?.display_name ?? '—'}</td>
                <td className="px-4 py-2">{d.profile?.phone ?? '—'}</td>
                <td className="px-4 py-2">{d.trips_count ?? '—'}</td>
                <td className="px-4 py-2">
                  {d.rating_avg ?? '—'}
                  {typeof d.rating_count === 'number' ? (
                    <span className="text-xs text-neutral-500"> ({d.rating_count})</span>
                  ) : null}
                </td>
                <td className="px-4 py-2">
                  <div className="text-xs">enabled: {String(!!d.cash_enabled)}</div>
                  <div className="text-xs text-neutral-500">limit: {d.cash_exposure_limit_iqd ?? '—'}</div>
                </td>
              </tr>
            ))}
            {res.drivers.length === 0 && (
              <tr>
                <td className="px-4 py-6 text-sm text-neutral-500" colSpan={7}>
                  No drivers.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between text-xs text-neutral-500">
        <div>
          Showing {res.page.returned} drivers (offset {res.page.offset})
          {typeof res.page.total === 'number' ? ` / total ${res.page.total}` : ''}
        </div>
        <div className="flex gap-2">
          <a
            className="rounded-md border bg-white px-2 py-1 hover:bg-neutral-50"
            href={`/drivers?q=${encodeURIComponent(q)}&status=${encodeURIComponent(status)}&offset=${Math.max(0, offset - 25)}`}
          >
            Prev
          </a>
          <a
            className="rounded-md border bg-white px-2 py-1 hover:bg-neutral-50"
            href={`/drivers?q=${encodeURIComponent(q)}&status=${encodeURIComponent(status)}&offset=${offset + 25}`}
          >
            Next
          </a>
        </div>
      </div>
    </div>
  );
}
