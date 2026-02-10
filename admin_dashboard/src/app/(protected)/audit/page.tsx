import { requirePermission } from '@/lib/auth/guards';
import { listAdminAuditLog } from '@/lib/admin/audit';

function arrOfStrings(x: unknown): string[] | null {
  if (!Array.isArray(x)) return null;
  const out = x.filter((v) => typeof v === 'string') as string[];
  return out.length ? out : [];
}

function fmtRoleDelta(details: Record<string, unknown> | null | undefined) {
  const oldRoles = arrOfStrings(details?.old_roles);
  const newRoles = arrOfStrings(details?.new_roles);
  if (!oldRoles || !newRoles) return null;

  const oldSet = new Set(oldRoles);
  const newSet = new Set(newRoles);
  const added = [...newSet].filter((r) => !oldSet.has(r));
  const removed = [...oldSet].filter((r) => !newSet.has(r));

  const source = typeof details?.source === 'string' ? details?.source : null;
  const requestId = typeof details?.request_id === 'string' ? details?.request_id : null;

  return (
    <div className="space-y-1">
      <div className="flex flex-wrap gap-1">
        {added.map((r) => (
          <span key={`+${r}`} className="text-xs rounded-md border px-2 py-0.5 bg-white">
            +{r}
          </span>
        ))}
        {removed.map((r) => (
          <span key={`-${r}`} className="text-xs rounded-md border px-2 py-0.5 bg-white">
            -{r}
          </span>
        ))}
        {added.length === 0 && removed.length === 0 && (
          <span className="text-xs text-neutral-500">(no change)</span>
        )}
      </div>
      {(source || requestId) && (
        <div className="text-xs text-neutral-500">
          {source ? <span>source={String(source)}</span> : null}
          {source && requestId ? <span> · </span> : null}
          {requestId ? <span>request={String(requestId).slice(0, 8)}…</span> : null}
        </div>
      )}
    </div>
  );
}

function fmtUser(u: { display_name: string | null; phone: string | null } | null | undefined) {
  if (!u) return '—';
  const name = u.display_name ?? '—';
  const phone = u.phone ? ` (${u.phone})` : '';
  return `${name}${phone}`;
}

export default async function AuditPage({
  searchParams,
}: {
  searchParams?: { offset?: string; action?: string };
}) {
  const { supabase } = await requirePermission('audit.read');

  const offset = Math.max(0, Number(searchParams?.offset ?? 0) || 0);
  const action = (searchParams?.action ?? '').trim();
  const res = await listAdminAuditLog(supabase, { limit: 50, offset, action });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-xl font-semibold">Audit Log</h1>
        <form className="flex items-center gap-2" action="/audit" method="get">
          <input type="hidden" name="offset" value="0" />
          <select
            name="action"
            defaultValue={action}
            className="rounded-md border px-2 py-1 text-sm bg-white"
          >
            <option value="">All actions</option>
            <optgroup label="Admin access">
              <option value="grant_admin">grant_admin</option>
              <option value="revoke_admin">revoke_admin</option>
              <option value="set_admin_roles">set_admin_roles</option>
              <option value="request_admin_role_change">request_admin_role_change</option>
              <option value="reject_admin_role_change">reject_admin_role_change</option>
            </optgroup>
            <optgroup label="Operations">
              <option value="cancel_ride">cancel_ride</option>
              <option value="transition_driver_status">transition_driver_status</option>
              <option value="convert_ride_intent">convert_ride_intent</option>
            </optgroup>
            <optgroup label="Payments">
              <option value="refund_payment">refund_payment</option>
            </optgroup>
            <optgroup label="Withdrawals">
              <option value="withdraw_approve">withdraw_approve</option>
              <option value="withdraw_reject">withdraw_reject</option>
              <option value="withdraw_mark_paid">withdraw_mark_paid</option>
            </optgroup>
            <optgroup label="Payout jobs">
              <option value="payout_job_create">payout_job_create</option>
              <option value="payout_job_retry">payout_job_retry</option>
              <option value="payout_job_cancel">payout_job_cancel</option>
              <option value="payout_job_force_confirm">payout_job_force_confirm</option>
            </optgroup>
          </select>
          <button className="rounded-md border bg-white px-2 py-1 text-sm hover:bg-neutral-50">
            Filter
          </button>
          <div className="text-xs text-neutral-500 ml-2">Last {res.page.returned} entries</div>
        </form>
      </div>

      <div className="rounded-xl border bg-white overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-neutral-50 border-b">
            <tr>
              <th className="text-left px-4 py-2 font-medium">Time</th>
              <th className="text-left px-4 py-2 font-medium">Actor</th>
              <th className="text-left px-4 py-2 font-medium">Action</th>
              <th className="text-left px-4 py-2 font-medium">Target</th>
              <th className="text-left px-4 py-2 font-medium">Note</th>
              <th className="text-left px-4 py-2 font-medium">Change</th>
            </tr>
          </thead>
          <tbody>
            {res.rows.map((row) => (
              <tr key={row.id} className="border-b last:border-b-0 align-top">
                <td className="px-4 py-2 whitespace-nowrap">
                  {new Date(row.created_at).toLocaleString()}
                </td>
                <td className="px-4 py-2">{fmtUser(row.actor)}</td>
                <td className="px-4 py-2 whitespace-nowrap">{row.action}</td>
                <td className="px-4 py-2">{fmtUser(row.target)}</td>
                <td className="px-4 py-2 max-w-[500px] break-words">{row.note ?? '—'}</td>
                <td className="px-4 py-2">{fmtRoleDelta(row.details)}</td>
              </tr>
            ))}
            {res.rows.length === 0 && (
              <tr>
                <td className="px-4 py-6 text-sm text-neutral-500" colSpan={6}>
                  No audit entries.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between text-xs text-neutral-500">
        <div>Offset {res.page.offset}</div>
        <div className="flex gap-2">
          <a
            className="rounded-md border bg-white px-2 py-1 hover:bg-neutral-50"
            href={`/audit?action=${encodeURIComponent(action)}&offset=${Math.max(0, offset - res.page.limit)}`}
          >
            Prev
          </a>
          <a
            className="rounded-md border bg-white px-2 py-1 hover:bg-neutral-50"
            href={`/audit?action=${encodeURIComponent(action)}&offset=${offset + res.page.limit}`}
          >
            Next
          </a>
        </div>
      </div>
    </div>
  );
}
