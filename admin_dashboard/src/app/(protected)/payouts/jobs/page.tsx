import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getAdminContext } from '@/lib/auth/guards';
import { listPayoutJobs } from '@/lib/admin/payouts';

const STATUSES = ['', 'queued', 'sent', 'confirmed', 'failed', 'canceled'] as const;
const PAYOUT_KINDS = ['', 'qicard', 'asiapay', 'zaincash'] as const;

export default async function Page({
  searchParams,
}: {
  searchParams?: { q?: string; status?: string; payout_kind?: string; offset?: string };
}) {
  const ctx = await getAdminContext();
  if (!ctx.can('payouts.read')) {
    redirect('/forbidden?permission=payouts.read');
  }

  const q = (searchParams?.q ?? '').trim();
  const status = (searchParams?.status ?? '').trim();
  const payoutKind = (searchParams?.payout_kind ?? '').trim();
  const offset = Math.max(0, Number(searchParams?.offset ?? 0) || 0);

  const res = await listPayoutJobs(ctx.supabase, { q, status, payout_kind: payoutKind, offset, limit: 25 });

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-xl font-semibold">Payout Jobs</h1>
        <form className="flex flex-wrap items-center gap-2" action="/payouts/jobs" method="get">
          <input
            name="q"
            defaultValue={q}
            placeholder="Search job/withdraw UUID, provider ref, user"
            className="rounded-md border px-3 py-2 text-sm bg-white"
          />
          <select name="status" defaultValue={status} className="rounded-md border px-3 py-2 text-sm bg-white">
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s ? s : 'all statuses'}
              </option>
            ))}
          </select>
          <select
            name="payout_kind"
            defaultValue={payoutKind}
            className="rounded-md border px-3 py-2 text-sm bg-white"
          >
            {PAYOUT_KINDS.map((k) => (
              <option key={k} value={k}>
                {k ? k : 'all payout kinds'}
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
              <th className="text-left px-4 py-2 font-medium">Job</th>
              <th className="text-left px-4 py-2 font-medium">Status</th>
              <th className="text-left px-4 py-2 font-medium">Amount</th>
              <th className="text-left px-4 py-2 font-medium">Kind</th>
              <th className="text-left px-4 py-2 font-medium">Withdrawal</th>
              <th className="text-left px-4 py-2 font-medium">User</th>
              <th className="text-left px-4 py-2 font-medium">Attempts</th>
              <th className="text-left px-4 py-2 font-medium">Next attempt</th>
              <th className="text-left px-4 py-2 font-medium">Provider ref</th>
              <th className="text-left px-4 py-2 font-medium">Created</th>
            </tr>
          </thead>
          <tbody>
            {res.jobs.map((j) => (
              <tr key={j.id} className="border-b last:border-b-0 align-top">
                <td className="px-4 py-2">
                  <Link className="underline hover:no-underline" href={`/payouts/jobs/${j.id}`}>
                    {j.id.slice(0, 8)}…
                  </Link>
                  {j.last_error ? <div className="text-xs text-red-700 break-words">{j.last_error}</div> : null}
                </td>
                <td className="px-4 py-2 whitespace-nowrap">{j.status}</td>
                <td className="px-4 py-2 whitespace-nowrap">{Number(j.amount_iqd ?? 0).toLocaleString()} IQD</td>
                <td className="px-4 py-2 whitespace-nowrap">{j.payout_kind}</td>
                <td className="px-4 py-2">
                  <Link className="underline hover:no-underline" href={`/withdrawals/${j.withdraw_request_id}`}>
                    {j.withdraw_request_id?.slice(0, 8)}…
                  </Link>
                </td>
                <td className="px-4 py-2">
                  <div>{j.user?.display_name ?? '—'}</div>
                  {j.user?.phone ? <div className="text-xs text-neutral-500">{j.user.phone}</div> : null}
                </td>
                <td className="px-4 py-2 whitespace-nowrap">
                  {(j.attempt_count ?? 0)}/{j.max_attempts ?? '—'}
                </td>
                <td className="px-4 py-2 whitespace-nowrap">
                  {j.next_attempt_at ? new Date(j.next_attempt_at).toLocaleString() : '—'}
                </td>
                <td className="px-4 py-2 break-all">{j.provider_ref ?? '—'}</td>
                <td className="px-4 py-2 whitespace-nowrap">{j.created_at ? new Date(j.created_at).toLocaleString() : '—'}</td>
              </tr>
            ))}
            {res.jobs.length === 0 && (
              <tr>
                <td className="px-4 py-6 text-sm text-neutral-500" colSpan={10}>
                  No payout jobs.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between text-xs text-neutral-500">
        <div>
          Showing {res.page.returned} jobs (offset {res.page.offset})
          {typeof res.page.total === 'number' ? ` / total ${res.page.total}` : ''}
        </div>
        <div className="flex gap-2">
          <a
            className="rounded-md border bg-white px-2 py-1 hover:bg-neutral-50"
            href={`/payouts/jobs?q=${encodeURIComponent(q)}&status=${encodeURIComponent(status)}&payout_kind=${encodeURIComponent(payoutKind)}&offset=${Math.max(0, offset - 25)}`}
          >
            Prev
          </a>
          <a
            className="rounded-md border bg-white px-2 py-1 hover:bg-neutral-50"
            href={`/payouts/jobs?q=${encodeURIComponent(q)}&status=${encodeURIComponent(status)}&payout_kind=${encodeURIComponent(payoutKind)}&offset=${offset + 25}`}
          >
            Next
          </a>
        </div>
      </div>
    </div>
  );
}
