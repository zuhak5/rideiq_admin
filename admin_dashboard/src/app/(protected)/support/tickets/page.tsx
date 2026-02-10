import Link from 'next/link';
import { getAdminContext } from '@/lib/auth/guards';
import { listSupportTickets } from '@/lib/admin/support';

function asString(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

function buildQuery(params: Record<string, string | number | boolean | undefined | null>): string {
  const qp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue;
    qp.set(k, String(v));
  }
  const s = qp.toString();
  return s ? `?${s}` : '';
}

export default async function SupportTicketsPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const ctx = await getAdminContext();

  if (!ctx.guard.can('support.read')) {
    return <div className="p-6 text-sm text-red-600">Forbidden</div>;
  }

  const q = asString(searchParams.q);
  const status = asString(searchParams.status) || '';
  const priority = asString(searchParams.priority) || '';
  const assigned_to = asString(searchParams.assigned_to) || '';
  const offset = Number(asString(searchParams.offset) || '0') || 0;
  const limit = 50;

  const { tickets, page } = await listSupportTickets(ctx.supabase, {
    q,
    status: status || null,
    priority: priority || null,
    assigned_to: assigned_to || null,
    limit,
    offset,
  });

  const nextOffset = offset + limit;
  const prevOffset = Math.max(0, offset - limit);

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold">Support Tickets</h1>
          <p className="text-sm text-gray-500">Search, triage, and respond to customer support tickets.</p>
        </div>
      </div>

      <form className="rounded border bg-white p-4 space-y-3" method="GET" action="/support/tickets">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
          <div className="md:col-span-2">
            <label className="text-xs text-gray-600">Search</label>
            <input
              name="q"
              defaultValue={q}
              placeholder="Subject, last message, customer name/phone…"
              className="mt-1 w-full rounded border px-3 py-2 text-sm"
            />
          </div>

          <div>
            <label className="text-xs text-gray-600">Status</label>
            <select name="status" defaultValue={status} className="mt-1 w-full rounded border px-3 py-2 text-sm">
              <option value="">Any</option>
              <option value="open">Open</option>
              <option value="pending">Pending</option>
              <option value="resolved">Resolved</option>
              <option value="closed">Closed</option>
            </select>
          </div>

          <div>
            <label className="text-xs text-gray-600">Priority</label>
            <select
              name="priority"
              defaultValue={priority}
              className="mt-1 w-full rounded border px-3 py-2 text-sm"
            >
              <option value="">Any</option>
              <option value="low">Low</option>
              <option value="normal">Normal</option>
              <option value="high">High</option>
            </select>
          </div>
        </div>

        <div className="flex items-center justify-between">
          <div className="text-xs text-gray-500">Returned: {page.returned}</div>
          <div className="flex items-center gap-2">
            <button className="rounded bg-black px-3 py-2 text-sm text-white" type="submit">
              Apply
            </button>
            <Link className="rounded border px-3 py-2 text-sm" href="/support/tickets">
              Reset
            </Link>
          </div>
        </div>
      </form>

      <div className="rounded border bg-white overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs text-gray-600">
              <tr>
                <th className="px-4 py-3 text-left">Last Update</th>
                <th className="px-4 py-3 text-left">Status</th>
                <th className="px-4 py-3 text-left">Priority</th>
                <th className="px-4 py-3 text-left">Subject</th>
                <th className="px-4 py-3 text-left">Customer</th>
                <th className="px-4 py-3 text-left">Assigned</th>
                <th className="px-4 py-3 text-left">Messages</th>
              </tr>
            </thead>
            <tbody>
              {tickets.length === 0 ? (
                <tr>
                  <td className="px-4 py-6 text-center text-gray-500" colSpan={7}>
                    No tickets found.
                  </td>
                </tr>
              ) : (
                tickets.map((t) => (
                  <tr key={t.id} className="border-t hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <div className="text-xs text-gray-500">{new Date(t.last_message_at ?? t.updated_at).toLocaleString()}</div>
                    </td>
                    <td className="px-4 py-3">
                      <span className="rounded border px-2 py-1 text-xs">{t.status}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="rounded border px-2 py-1 text-xs">{t.priority}</span>
                    </td>
                    <td className="px-4 py-3">
                      <Link className="font-medium hover:underline" href={`/support/tickets/${t.id}`}>
                        {t.subject}
                      </Link>
                      <div className="text-xs text-gray-500">{t.category_title ?? t.category_code ?? '—'}</div>
                      {t.last_message ? <div className="text-xs text-gray-600 line-clamp-1 mt-1">{t.last_message}</div> : null}
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-sm">{t.created_by_name ?? '—'}</div>
                      <div className="text-xs text-gray-500">{t.created_by_phone ?? ''}</div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-sm">{t.assigned_to_name ?? 'Unassigned'}</div>
                    </td>
                    <td className="px-4 py-3">
                      <span className="rounded border px-2 py-1 text-xs">{t.messages_count}</span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between border-t p-3 text-sm">
          <Link
            className={`rounded border px-3 py-1 ${offset === 0 ? 'pointer-events-none opacity-50' : ''}`}
            href={`/support/tickets${buildQuery({ q, status, priority, assigned_to, offset: prevOffset })}`}
          >
            Prev
          </Link>
          <div className="text-xs text-gray-500">
            Offset {offset} • Limit {limit}
          </div>
          <Link
            className={`rounded border px-3 py-1 ${page.returned < limit ? 'pointer-events-none opacity-50' : ''}`}
            href={`/support/tickets${buildQuery({ q, status, priority, assigned_to, offset: nextOffset })}`}
          >
            Next
          </Link>
        </div>
      </div>
    </div>
  );
}
