import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getAdminContext } from '@/lib/auth/guards';
import { getPayoutJobDetail } from '@/lib/admin/payouts';
import { cancelPayoutJobAction, forceConfirmPayoutJobAction, retryPayoutJobAction } from './actions';

function kv(label: string, value: any) {
  return (
    <div className="flex justify-between gap-4">
      <div className="text-xs text-neutral-500">{label}</div>
      <div className="text-xs text-neutral-900 text-right break-all">{value ?? '—'}</div>
    </div>
  );
}

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const ctx = await getAdminContext();
  if (!ctx.can('payouts.read')) {
    redirect('/forbidden?permission=payouts.read');
  }

  const { job, withdraw, user, attempts } = await getPayoutJobDetail(ctx.supabase, id);

  const canRetry = ctx.can('payouts.retry');
  const canForceConfirm = ctx.can('withdrawals.mark_paid');

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-xl font-semibold">Payout Job</h1>
          <Link className="text-sm underline hover:no-underline" href="/payouts/jobs">
            Back
          </Link>
        </div>
        <div className="text-xs text-neutral-500 break-all">{job?.id}</div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="rounded-xl border bg-white p-4 space-y-2">
          <div className="text-sm font-medium">Job</div>
          {kv('status', job?.status)}
          {kv('payout kind', job?.payout_kind)}
          {kv('amount (IQD)', job?.amount_iqd)}
          {kv('provider_ref', job?.provider_ref)}
          {kv('attempts', `${job?.attempt_count ?? 0}/${job?.max_attempts ?? '—'}`)}
          {kv('next attempt', job?.next_attempt_at ? new Date(job.next_attempt_at).toLocaleString() : null)}
          {kv('last attempt', job?.last_attempt_at ? new Date(job.last_attempt_at).toLocaleString() : null)}
          {kv('sent at', job?.sent_at ? new Date(job.sent_at).toLocaleString() : null)}
          {kv('confirmed at', job?.confirmed_at ? new Date(job.confirmed_at).toLocaleString() : null)}
          {kv('failed at', job?.failed_at ? new Date(job.failed_at).toLocaleString() : null)}
          {kv('canceled at', job?.canceled_at ? new Date(job.canceled_at).toLocaleString() : null)}
          {kv('created', job?.created_at ? new Date(job.created_at).toLocaleString() : null)}
          {kv('updated', job?.updated_at ? new Date(job.updated_at).toLocaleString() : null)}
          {job?.last_error ? <div className="text-xs text-red-700 break-words">{job.last_error}</div> : null}
        </div>

        <div className="rounded-xl border bg-white p-4 space-y-2">
          <div className="text-sm font-medium">Withdrawal</div>
          {kv('request id', withdraw?.id)}
          {kv('status', withdraw?.status)}
          {kv('amount (IQD)', withdraw?.amount_iqd)}
          {kv('payout kind', withdraw?.payout_kind)}
          {kv('payout reference', withdraw?.payout_reference)}
          {kv('created', withdraw?.created_at ? new Date(withdraw.created_at).toLocaleString() : null)}
          {kv('approved', withdraw?.approved_at ? new Date(withdraw.approved_at).toLocaleString() : null)}
          {kv('paid', withdraw?.paid_at ? new Date(withdraw.paid_at).toLocaleString() : null)}
          {kv('rejected', withdraw?.rejected_at ? new Date(withdraw.rejected_at).toLocaleString() : null)}
          {withdraw?.id ? (
            <div className="text-xs">
              <Link className="underline hover:no-underline" href={`/withdrawals/${withdraw.id}`}>
                Open withdrawal
              </Link>
            </div>
          ) : null}
        </div>

        <div className="rounded-xl border bg-white p-4 space-y-2">
          <div className="text-sm font-medium">User</div>
          {kv('name', user?.display_name)}
          {kv('phone', user?.phone ?? user?.phone_e164)}
          {kv('id', user?.id)}
          {job?.created_by ? <div className="pt-2">{kv('created_by', job.created_by)}</div> : null}
        </div>
      </div>

      <div className="rounded-xl border bg-white p-4 space-y-3">
        <div className="text-sm font-medium">Operations</div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
          <form action={retryPayoutJobAction} className="rounded-md border p-3 space-y-2">
            <div className="font-medium text-sm">Retry now</div>
            <input type="hidden" name="job_id" value={job?.id ?? ''} />
            <textarea
              name="note"
              placeholder="Optional note"
              className="w-full rounded-md border px-2 py-1 text-sm"
              rows={2}
              disabled={!canRetry}
            />
            <button
              className={`rounded-md border px-2 py-1 text-sm bg-white hover:bg-neutral-50 ${!canRetry ? 'opacity-50 pointer-events-none' : ''}`}
            >
              Retry
            </button>
            {!canRetry ? <div className="text-xs text-neutral-500">Missing payouts.retry</div> : null}
          </form>

          <form action={cancelPayoutJobAction} className="rounded-md border p-3 space-y-2">
            <div className="font-medium text-sm">Cancel</div>
            <input type="hidden" name="job_id" value={job?.id ?? ''} />
            <textarea
              name="note"
              placeholder="Reason (optional)"
              className="w-full rounded-md border px-2 py-1 text-sm"
              rows={2}
              disabled={!canRetry}
            />
            <button
              className={`rounded-md border px-2 py-1 text-sm bg-white hover:bg-neutral-50 ${!canRetry ? 'opacity-50 pointer-events-none' : ''}`}
            >
              Cancel
            </button>
            {!canRetry ? <div className="text-xs text-neutral-500">Missing payouts.retry</div> : null}
          </form>

          <form action={forceConfirmPayoutJobAction} className="rounded-md border p-3 space-y-2">
            <div className="font-medium text-sm">Force confirm</div>
            <input type="hidden" name="job_id" value={job?.id ?? ''} />
            <input
              name="provider_ref"
              placeholder="Provider ref (recommended)"
              className="w-full rounded-md border px-2 py-1 text-sm"
              defaultValue={job?.provider_ref ?? ''}
              disabled={!canForceConfirm}
            />
            <textarea
              name="note"
              placeholder="Audit note (recommended)"
              className="w-full rounded-md border px-2 py-1 text-sm"
              rows={2}
              disabled={!canForceConfirm}
            />
            <label className="flex items-center gap-2 text-xs text-neutral-600">
              <input type="checkbox" name="confirm" required disabled={!canForceConfirm} />
              confirm force-confirm
            </label>
            <button
              className={`rounded-md border px-2 py-1 text-sm bg-white hover:bg-neutral-50 ${!canForceConfirm ? 'opacity-50 pointer-events-none' : ''}`}
            >
              Force confirm
            </button>
            {!canForceConfirm ? <div className="text-xs text-neutral-500">Missing withdrawals.mark_paid</div> : null}
          </form>
        </div>
        <div className="text-xs text-neutral-500">
          Retry and cancel are rate-limited and audited. Force-confirm is high-impact and requires withdrawals.mark_paid.
        </div>
      </div>

      {job?.request_payload || job?.response_payload ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="rounded-xl border bg-white p-4 space-y-2">
            <div className="text-sm font-medium">Request payload</div>
            <pre className="text-xs bg-neutral-50 border rounded-md p-2 overflow-x-auto">
              {JSON.stringify(job?.request_payload ?? null, null, 2)}
            </pre>
          </div>
          <div className="rounded-xl border bg-white p-4 space-y-2">
            <div className="text-sm font-medium">Response payload</div>
            <pre className="text-xs bg-neutral-50 border rounded-md p-2 overflow-x-auto">
              {JSON.stringify(job?.response_payload ?? null, null, 2)}
            </pre>
          </div>
        </div>
      ) : null}

      <div className="rounded-xl border bg-white p-4 space-y-2">
        <div className="text-sm font-medium">Attempts</div>
        <div className="rounded-md border overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-neutral-50">
              <tr>
                <th className="p-2 text-left">Attempt</th>
                <th className="p-2 text-left">Status</th>
                <th className="p-2 text-left">Provider ref</th>
                <th className="p-2 text-left">Error</th>
                <th className="p-2 text-left">Created</th>
              </tr>
            </thead>
            <tbody>
              {attempts.map((a: any) => (
                <tr key={a.id} className="border-t align-top">
                  <td className="p-2 font-mono">{a.id}</td>
                  <td className="p-2 whitespace-nowrap">{a.status}</td>
                  <td className="p-2 break-all">{a.provider_ref ?? '—'}</td>
                  <td className="p-2 break-words">{a.error_message ?? '—'}</td>
                  <td className="p-2 whitespace-nowrap">{a.created_at ? new Date(a.created_at).toLocaleString() : '—'}</td>
                </tr>
              ))}
              {attempts.length === 0 && (
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
