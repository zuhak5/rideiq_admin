import Link from 'next/link';
import { getAdminContext } from '@/lib/auth/guards';
import { listWithdrawals } from '@/lib/admin/withdrawals';

const STATUSES = ['', 'requested', 'approved', 'rejected', 'paid', 'cancelled'] as const;
const PAYOUT_KINDS = ['', 'qicard', 'asiapay', 'zaincash'] as const;

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;

  const q = sp.q ?? '';
  const status = sp.status ?? '';
  const payoutKind = sp.payout_kind ?? '';
  const offset = Number(sp.offset ?? 0) || 0;

  const { supabase, can } = await getAdminContext();
  if (!can('withdrawals.read')) {
    return (
      <div className="p-4">
        <div className="rounded-md border bg-white p-4 text-sm">You do not have permission to view withdrawals.</div>
      </div>
    );
  }

  const res = await listWithdrawals(supabase, { q, status, payout_kind: payoutKind, limit: 25, offset });

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Withdrawals</h1>
        <form className="flex items-center gap-2" action="/withdrawals" method="get">
          <input type="hidden" name="offset" value="0" />
          <input
            name="q"
            defaultValue={q}
            placeholder="Search id / user / reference / note"
            className="rounded-md border px-2 py-1 text-sm bg-white w-72"
          />
          <select name="status" defaultValue={status} className="rounded-md border px-2 py-1 text-sm bg-white">
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s || 'All statuses'}
              </option>
            ))}
          </select>
          <select name="payout_kind" defaultValue={payoutKind} className="rounded-md border px-2 py-1 text-sm bg-white">
            {PAYOUT_KINDS.map((k) => (
              <option key={k} value={k}>
                {k || 'All payout kinds'}
              </option>
            ))}
          </select>
          <button className="rounded-md border bg-white px-2 py-1 text-sm hover:bg-neutral-50">Filter</button>
          <div className="text-xs text-neutral-500 ml-2">Returned {res.page.returned}</div>
        </form>
      </div>

      <div className="rounded-lg border bg-white overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-neutral-50">
            <tr className="text-left">
              <th className="p-2">Request</th>
              <th className="p-2">Status</th>
              <th className="p-2">Amount (IQD)</th>
              <th className="p-2">Kind</th>
              <th className="p-2">User</th>
              <th className="p-2">Created</th>
              <th className="p-2">Latest Job</th>
              <th className="p-2">Payout Ref</th>
            </tr>
          </thead>
          <tbody>
            {res.withdrawals.map((w) => (
              <tr key={w.id} className="border-t">
                <td className="p-2">
                  <Link href={`/withdrawals/${w.id}`} className="text-blue-700 hover:underline">
                    {w.id}
                  </Link>
                </td>
                <td className="p-2">{w.status}</td>
                <td className="p-2">{Number(w.amount_iqd ?? 0).toLocaleString()}</td>
                <td className="p-2">{w.payout_kind}</td>
                <td className="p-2">
                  <div className="flex flex-col">
                    <span>{w.user?.display_name ?? '—'}</span>
                    <span className="text-xs text-neutral-500">{w.user?.phone ?? '—'}</span>
                  </div>
                </td>
                <td className="p-2">{w.created_at ? new Date(w.created_at).toLocaleString() : '—'}</td>
                <td className="p-2">
                  {w.latest_payout_job ? (
                    <div className="flex flex-col">
                      <span>
                        <Link
                          href={`/payouts/jobs/${w.latest_payout_job.id}`}
                          className="text-blue-700 hover:underline"
                        >
                          {w.latest_payout_job.status}
                        </Link>
                      </span>
                      <span className="text-xs text-neutral-500">{w.latest_payout_job.provider_ref ?? '—'}</span>
                    </div>
                  ) : (
                    '—'
                  )}
                </td>
                <td className="p-2">{w.payout_reference ?? '—'}</td>
              </tr>
            ))}
            {res.withdrawals.length === 0 && (
              <tr>
                <td className="p-4 text-neutral-500" colSpan={8}>
                  No withdrawals found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between">
        <div className="text-xs text-neutral-500">
          Showing {res.page.returned} of {res.page.total ?? '—'}
        </div>
        <div className="flex items-center gap-2">
          <Link
            className={`rounded-md border bg-white px-2 py-1 text-sm hover:bg-neutral-50 ${offset <= 0 ? 'pointer-events-none opacity-50' : ''}`}
            href={{ pathname: '/withdrawals', query: { q, status, payout_kind: payoutKind, offset: Math.max(0, offset - 25) } }}
          >
            Prev
          </Link>
          <Link
            className={`rounded-md border bg-white px-2 py-1 text-sm hover:bg-neutral-50 ${res.page.returned < 25 ? 'pointer-events-none opacity-50' : ''}`}
            href={{ pathname: '/withdrawals', query: { q, status, payout_kind: payoutKind, offset: offset + 25 } }}
          >
            Next
          </Link>
        </div>
      </div>
    </div>
  );
}
