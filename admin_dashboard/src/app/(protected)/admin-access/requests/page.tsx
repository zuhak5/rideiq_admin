import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getAdminContext } from '@/lib/auth/guards';
import { listRoleChangeRequests } from '@/lib/admin/access';
import { approveRequestAction, rejectRequestAction } from './actions';

function badge(text: string): { cls: string; label: string } {
  const t = text.toLowerCase();
  if (t === 'executed' || t === 'approved') return { cls: 'border-green-200 bg-green-50 text-green-800', label: text };
  if (t === 'rejected') return { cls: 'border-red-200 bg-red-50 text-red-800', label: text };
  if (t === 'expired') return { cls: 'border-amber-200 bg-amber-50 text-amber-900', label: text };
  return { cls: 'border-neutral-200 bg-white text-neutral-700', label: text };
}

export default async function RoleChangeRequestsPage({
  searchParams,
}: {
  searchParams?: { status?: string; offset?: string; msg?: string; error?: string };
}) {
  const ctx = await getAdminContext();
  if (!ctx.can('admin_access.manage')) {
    redirect('/forbidden?permission=admin_access.manage');
  }

  const status = (searchParams?.status ?? 'pending').trim();
  const offset = Math.max(0, Number(searchParams?.offset ?? 0) || 0);
  const flashMsg = (searchParams?.msg ?? '').trim();
  const flashErr = (searchParams?.error ?? '').trim();

  const data = await listRoleChangeRequests(ctx.supabase, { status, offset, limit: 25, ttlDays: 7 });

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">Role Change Requests</h1>
          <div className="text-xs text-neutral-500">
            Super-admin changes require 2-person approval. Pending requests expire after 7 days.
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/admin-access"
            className="rounded-md border bg-white px-3 py-2 text-sm hover:bg-neutral-50"
          >
            Back
          </Link>
          <form className="flex gap-2" action="/admin-access/requests" method="get">
            <select
              name="status"
              defaultValue={status}
              className="rounded-md border px-3 py-2 text-sm bg-white"
            >
              <option value="pending">pending</option>
              <option value="expired">expired</option>
              <option value="executed">executed</option>
              <option value="rejected">rejected</option>
              <option value="">all</option>
            </select>
            <button className="rounded-md bg-neutral-900 text-white px-3 py-2 text-sm hover:bg-neutral-800">
              Filter
            </button>
          </form>
        </div>
      </div>

      {(flashMsg || flashErr) && (
        <div
          className={
            'rounded-xl border px-4 py-3 text-sm ' +
            (flashErr
              ? 'border-red-200 bg-red-50 text-red-800'
              : 'border-green-200 bg-green-50 text-green-800')
          }
        >
          {flashErr ? flashErr : flashMsg}
        </div>
      )}

      <div className="rounded-xl border bg-white overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-neutral-50 border-b">
            <tr>
              <th className="text-left px-4 py-2 font-medium">Time</th>
              <th className="text-left px-4 py-2 font-medium">Status</th>
              <th className="text-left px-4 py-2 font-medium">Requester</th>
              <th className="text-left px-4 py-2 font-medium">Target</th>
              <th className="text-left px-4 py-2 font-medium">Requested roles</th>
              <th className="text-left px-4 py-2 font-medium">Note</th>
              <th className="text-left px-4 py-2 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((r) => {
              const eff = (r.effective_status ?? r.status ?? 'pending').toLowerCase();
              const requester = `${r.created_by_name ?? '—'}${r.created_by_phone ? ` (${r.created_by_phone})` : ''}`;
              const target = `${r.target_name ?? '—'}${r.target_phone ? ` (${r.target_phone})` : ''}`;
              const canApprove = eff === 'pending' && r.created_by !== ctx.user.id;
              const canReject = eff === 'pending' || eff === 'expired';
              const { cls, label } = badge(eff);
              return (
                <tr key={r.id} className="border-b last:border-b-0 align-top">
                  <td className="px-4 py-2 whitespace-nowrap">{new Date(r.created_at).toLocaleString()}</td>
                  <td className="px-4 py-2">
                    <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs ${cls}`}>
                      {label}
                    </span>
                    {r.is_expired ? (
                      <div className="text-xs text-amber-700 mt-1">Approval is disabled</div>
                    ) : null}
                  </td>
                  <td className="px-4 py-2">{requester}</td>
                  <td className="px-4 py-2">{target}</td>
                  <td className="px-4 py-2">
                    <div className="flex flex-wrap gap-1">
                      {r.requested_role_keys.map((k) => (
                        <span key={k} className="text-xs rounded-md border px-2 py-0.5 bg-white">
                          {k}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="px-4 py-2 max-w-[360px] break-words">{r.note ?? '—'}</td>
                  <td className="px-4 py-2">
                    <div className="flex flex-col gap-2 min-w-[320px]">
                      {canApprove ? (
                        <form action={approveRequestAction} className="flex items-center gap-2">
                          <input type="hidden" name="requestId" value={r.id} />
                          <input type="hidden" name="status" value={status} />
                          <input type="hidden" name="offset" value={String(offset)} />
                          <input
                            name="note"
                            placeholder="approval reason"
                            required
                            minLength={3}
                            maxLength={500}
                            className="rounded-md border px-2 py-1 text-xs flex-1"
                          />
                          <label className="flex items-center gap-1 text-xs text-neutral-600">
                            <input type="checkbox" name="confirm" required />
                            approve
                          </label>
                          <button className="rounded-md border px-2 py-1 text-xs hover:bg-neutral-50">
                            Execute
                          </button>
                        </form>
                      ) : (
                        <div className="text-xs text-neutral-500">
                          {eff === 'pending' ? 'Waiting for another admin' : '—'}
                        </div>
                      )}

                      {canReject ? (
                        <form action={rejectRequestAction} className="flex items-center gap-2">
                          <input type="hidden" name="requestId" value={r.id} />
                          <input type="hidden" name="status" value={status} />
                          <input type="hidden" name="offset" value={String(offset)} />
                          <input
                            name="note"
                            placeholder={r.is_expired ? 'expired - reject reason' : 'reject reason'}
                            required
                            minLength={3}
                            maxLength={500}
                            className="rounded-md border px-2 py-1 text-xs flex-1"
                          />
                          <label className="flex items-center gap-1 text-xs text-neutral-600">
                            <input type="checkbox" name="confirm" required />
                            reject
                          </label>
                          <button className="rounded-md border px-2 py-1 text-xs hover:bg-neutral-50">
                            Reject
                          </button>
                        </form>
                      ) : null}
                    </div>
                  </td>
                </tr>
              );
            })}
            {data.rows.length === 0 && (
              <tr>
                <td className="px-4 py-6 text-sm text-neutral-500" colSpan={7}>
                  No requests.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between text-xs text-neutral-500">
        <div>
          Showing {data.page.returned} rows (offset {data.page.offset})
        </div>
        <div className="flex gap-2">
          <a
            className="rounded-md border bg-white px-2 py-1 hover:bg-neutral-50"
            href={`/admin-access/requests?status=${encodeURIComponent(status)}&offset=${Math.max(0, offset - 25)}`}
          >
            Prev
          </a>
          <a
            className="rounded-md border bg-white px-2 py-1 hover:bg-neutral-50"
            href={`/admin-access/requests?status=${encodeURIComponent(status)}&offset=${offset + 25}`}
          >
            Next
          </a>
        </div>
      </div>
    </div>
  );
}
