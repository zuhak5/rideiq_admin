import Link from 'next/link';
import { getAdminContext } from '@/lib/auth/guards';
import { getWithdrawalDetail } from '@/lib/admin/withdrawals';
import { approveWithdrawalAction, rejectWithdrawalAction, markWithdrawalPaidAction, createPayoutJobAction } from './actions';

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const { supabase, can } = await getAdminContext();
  if (!can('withdrawals.read')) {
    return (
      <div className="p-4">
        <div className="rounded-md border bg-white p-4 text-sm">You do not have permission to view withdrawal details.</div>
      </div>
    );
  }

  const res = await getWithdrawalDetail(supabase, id);
  const w = res.withdraw;
  const u = res.user;

  const canApprove = can('withdrawals.approve');
  const canReject = can('withdrawals.reject');
  const canMarkPaid = can('withdrawals.mark_paid');
  const canRunPayout = can('payouts.run');

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Withdrawal</h1>
        <Link href="/withdrawals" className="rounded-md border bg-white px-2 py-1 text-sm hover:bg-neutral-50">
          Back
        </Link>
      </div>

      <div className="rounded-lg border bg-white p-4 grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-1">
          <div className="text-xs text-neutral-500">Request ID</div>
          <div className="font-mono text-sm">{w.id}</div>
        </div>

        <div className="space-y-1">
          <div className="text-xs text-neutral-500">Status</div>
          <div className="text-sm">{w.status}</div>
        </div>

        <div className="space-y-1">
          <div className="text-xs text-neutral-500">Amount (IQD)</div>
          <div className="text-sm">{Number(w.amount_iqd ?? 0).toLocaleString()}</div>
        </div>

        <div className="space-y-1">
          <div className="text-xs text-neutral-500">Payout Kind</div>
          <div className="text-sm">{w.payout_kind}</div>
        </div>

        <div className="space-y-1">
          <div className="text-xs text-neutral-500">User</div>
          <div className="text-sm">{u?.display_name ?? '—'}</div>
          <div className="text-xs text-neutral-500">{u?.phone ?? u?.phone_e164 ?? '—'}</div>
          <div className="text-xs text-neutral-400 font-mono">{w.user_id}</div>
        </div>

        <div className="space-y-1">
          <div className="text-xs text-neutral-500">Payout Reference</div>
          <div className="text-sm">{w.payout_reference ?? '—'}</div>
        </div>

        <div className="space-y-1 md:col-span-2">
          <div className="text-xs text-neutral-500">Destination</div>
          <pre className="text-xs bg-neutral-50 border rounded-md p-2 overflow-x-auto">{JSON.stringify(w.destination, null, 2)}</pre>
        </div>

        <div className="space-y-1">
          <div className="text-xs text-neutral-500">Created</div>
          <div className="text-sm">{w.created_at ? new Date(w.created_at).toLocaleString() : '—'}</div>
        </div>

        <div className="space-y-1">
          <div className="text-xs text-neutral-500">Approved</div>
          <div className="text-sm">{w.approved_at ? new Date(w.approved_at).toLocaleString() : '—'}</div>
        </div>

        <div className="space-y-1">
          <div className="text-xs text-neutral-500">Paid</div>
          <div className="text-sm">{w.paid_at ? new Date(w.paid_at).toLocaleString() : '—'}</div>
        </div>

        <div className="space-y-1">
          <div className="text-xs text-neutral-500">Rejected</div>
          <div className="text-sm">{w.rejected_at ? new Date(w.rejected_at).toLocaleString() : '—'}</div>
        </div>
      </div>

      <div className="rounded-lg border bg-white p-4 space-y-4">
        <h2 className="font-semibold">Actions</h2>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <form action={approveWithdrawalAction} className="rounded-md border p-3 space-y-2">
            <div className="font-medium">Approve</div>
            <input type="hidden" name="request_id" value={w.id} />
            <textarea
              name="note"
              placeholder="Optional note"
              className="w-full rounded-md border px-2 py-1 text-sm"
              rows={2}
              defaultValue=""
              disabled={!canApprove}
            />
            <button
              className={`rounded-md border px-2 py-1 text-sm bg-white hover:bg-neutral-50 ${!canApprove ? 'opacity-50 pointer-events-none' : ''}`}
            >
              Approve
            </button>
            {!canApprove && <div className="text-xs text-neutral-500">Missing withdrawals.approve</div>}
          </form>

          <form action={rejectWithdrawalAction} className="rounded-md border p-3 space-y-2">
            <div className="font-medium">Reject</div>
            <input type="hidden" name="request_id" value={w.id} />
            <textarea
              name="note"
              placeholder="Reason (optional)"
              className="w-full rounded-md border px-2 py-1 text-sm"
              rows={2}
              defaultValue=""
              disabled={!canReject}
            />
            <button
              className={`rounded-md border px-2 py-1 text-sm bg-white hover:bg-neutral-50 ${!canReject ? 'opacity-50 pointer-events-none' : ''}`}
            >
              Reject
            </button>
            {!canReject && <div className="text-xs text-neutral-500">Missing withdrawals.reject</div>}
          </form>

          <form action={markWithdrawalPaidAction} className="rounded-md border p-3 space-y-2">
            <div className="font-medium">Mark Paid</div>
            <input type="hidden" name="request_id" value={w.id} />
            <input
              name="payout_reference"
              placeholder="Provider reference (optional)"
              className="w-full rounded-md border px-2 py-1 text-sm"
              defaultValue={w.payout_reference ?? ''}
              disabled={!canMarkPaid}
            />
            <textarea
              name="note"
              placeholder="Optional note"
              className="w-full rounded-md border px-2 py-1 text-sm"
              rows={2}
              defaultValue=""
              disabled={!canMarkPaid}
            />
            <button
              className={`rounded-md border px-2 py-1 text-sm bg-white hover:bg-neutral-50 ${!canMarkPaid ? 'opacity-50 pointer-events-none' : ''}`}
            >
              Mark Paid
            </button>
            {!canMarkPaid && <div className="text-xs text-neutral-500">Missing withdrawals.mark_paid</div>}
          </form>

          <form action={createPayoutJobAction} className="rounded-md border p-3 space-y-2">
            <div className="font-medium">Create Payout Job</div>
            <input type="hidden" name="withdraw_request_id" value={w.id} />
            <div className="text-xs text-neutral-500">
              Creates a queued payout job for the configured provider pipeline (idempotent).
            </div>
            <button
              className={`rounded-md border px-2 py-1 text-sm bg-white hover:bg-neutral-50 ${!canRunPayout ? 'opacity-50 pointer-events-none' : ''}`}
            >
              Queue payout job
            </button>
            {!canRunPayout && <div className="text-xs text-neutral-500">Missing payouts.run</div>}
          </form>
        </div>
      </div>

      <div className="rounded-lg border bg-white p-4 space-y-2">
        <h2 className="font-semibold">Payout Jobs</h2>
        <div className="rounded-md border overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-neutral-50">
              <tr className="text-left">
                <th className="p-2">Job</th>
                <th className="p-2">Status</th>
                <th className="p-2">Provider Ref</th>
                <th className="p-2">Attempts</th>
                <th className="p-2">Next Attempt</th>
                <th className="p-2">Created</th>
              </tr>
            </thead>
            <tbody>
              {res.jobs.map((j: any) => (
                <tr key={j.id} className="border-t">
                  <td className="p-2 font-mono">
                    <Link href={`/payouts/jobs/${j.id}`} className="text-blue-700 hover:underline">
                      {j.id}
                    </Link>
                  </td>
                  <td className="p-2">{j.status}</td>
                  <td className="p-2">{j.provider_ref ?? '—'}</td>
                  <td className="p-2">{j.attempt_count ?? 0}</td>
                  <td className="p-2">{j.next_attempt_at ? new Date(j.next_attempt_at).toLocaleString() : '—'}</td>
                  <td className="p-2">{j.created_at ? new Date(j.created_at).toLocaleString() : '—'}</td>
                </tr>
              ))}
              {res.jobs.length === 0 && (
                <tr>
                  <td className="p-4 text-neutral-500" colSpan={6}>
                    No payout jobs.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="rounded-lg border bg-white p-4 space-y-2">
        <h2 className="font-semibold">Wallet Holds</h2>
        <div className="rounded-md border overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-neutral-50">
              <tr className="text-left">
                <th className="p-2">Hold</th>
                <th className="p-2">Kind</th>
                <th className="p-2">Status</th>
                <th className="p-2">Amount</th>
                <th className="p-2">Created</th>
                <th className="p-2">Released</th>
              </tr>
            </thead>
            <tbody>
              {res.holds.map((h: any) => (
                <tr key={h.id} className="border-t">
                  <td className="p-2 font-mono">{h.id}</td>
                  <td className="p-2">{h.kind}</td>
                  <td className="p-2">{h.status}</td>
                  <td className="p-2">{Number(h.amount_iqd ?? 0).toLocaleString()}</td>
                  <td className="p-2">{h.created_at ? new Date(h.created_at).toLocaleString() : '—'}</td>
                  <td className="p-2">{h.released_at ? new Date(h.released_at).toLocaleString() : '—'}</td>
                </tr>
              ))}
              {res.holds.length === 0 && (
                <tr>
                  <td className="p-4 text-neutral-500" colSpan={6}>
                    No holds.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="rounded-lg border bg-white p-4 space-y-2">
        <h2 className="font-semibold">Payout Attempts</h2>
        <div className="rounded-md border overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-neutral-50">
              <tr className="text-left">
                <th className="p-2">Attempt</th>
                <th className="p-2">Job</th>
                <th className="p-2">Status</th>
                <th className="p-2">Error</th>
                <th className="p-2">Created</th>
              </tr>
            </thead>
            <tbody>
              {res.attempts.map((a: any) => (
                <tr key={a.id} className="border-t">
                  <td className="p-2 font-mono">{a.id}</td>
                  <td className="p-2 font-mono">
                    <Link href={`/payouts/jobs/${a.job_id}`} className="text-blue-700 hover:underline">
                      {a.job_id}
                    </Link>
                  </td>
                  <td className="p-2">{a.status}</td>
                  <td className="p-2">{a.error_message ?? '—'}</td>
                  <td className="p-2">{a.created_at ? new Date(a.created_at).toLocaleString() : '—'}</td>
                </tr>
              ))}
              {res.attempts.length === 0 && (
                <tr>
                  <td className="p-4 text-neutral-500" colSpan={5}>
                    No attempts.
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
