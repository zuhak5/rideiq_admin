import Link from 'next/link';
import { getAdminContext } from '@/lib/auth/guards';
import { redirect } from 'next/navigation';
import { listFraudActions, listFraudCases } from '@/lib/admin/fraud';
import { closeFraudCaseAction, resolveFraudActionAction } from './actions';

function hrefWith(base: string, params: Record<string, string | undefined>) {
  const url = new URL(base, 'http://localhost');
  for (const [k, v] of Object.entries(params)) {
    if (!v) continue;
    url.searchParams.set(k, v);
  }
  return url.pathname + (url.searchParams.toString() ? `?${url.searchParams.toString()}` : '');
}

export default async function FraudPage({
  searchParams,
}: {
  searchParams?: { tab?: string; status?: string };
}) {
  const ctx = await getAdminContext();
  if (!ctx.can('fraud.view')) {
    redirect('/forbidden?permission=fraud.view');
  }
  const supabase = ctx.supabase;
  const canManage = ctx.can('fraud.manage');

  const tab = searchParams?.tab === 'actions' ? 'actions' : 'cases';

  const status = ((): string => {
    if (tab === 'cases') {
      return searchParams?.status === 'closed' ? 'closed' : 'open';
    }
    return ['expired', 'resolved'].includes(String(searchParams?.status)) ? String(searchParams?.status) : 'active';
  })();

  const cases = tab === 'cases' ? await listFraudCases(supabase, { status: status as any, limit: 50 }) : [];
  const actions =
    tab === 'actions' ? await listFraudActions(supabase, { status: status as any, limit: 50 }) : [];

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">Fraud</h1>
          <div className="text-xs text-neutral-500">Admin-only access to fraud cases and actions</div>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <Link
          href={hrefWith('/fraud', { tab: 'cases', status: tab === 'cases' ? status : 'open' })}
          className={`rounded-md border px-3 py-1 text-sm ${tab === 'cases' ? 'bg-neutral-900 text-white border-neutral-900' : 'bg-white hover:bg-neutral-50'}`}
        >
          Cases
        </Link>
        <Link
          href={hrefWith('/fraud', { tab: 'actions', status: tab === 'actions' ? status : 'active' })}
          className={`rounded-md border px-3 py-1 text-sm ${tab === 'actions' ? 'bg-neutral-900 text-white border-neutral-900' : 'bg-white hover:bg-neutral-50'}`}
        >
          Actions
        </Link>

        <div className="ml-4 flex items-center gap-2">
          {tab === 'cases' ? (
            <>
              {['open', 'closed'].map((s) => (
                <Link
                  key={s}
                  href={hrefWith('/fraud', { tab: 'cases', status: s })}
                  className={`rounded-md px-2 py-1 text-xs border ${status === s ? 'bg-neutral-100' : 'bg-white hover:bg-neutral-50'}`}
                >
                  {s}
                </Link>
              ))}
            </>
          ) : (
            <>
              {['active', 'expired', 'resolved'].map((s) => (
                <Link
                  key={s}
                  href={hrefWith('/fraud', { tab: 'actions', status: s })}
                  className={`rounded-md px-2 py-1 text-xs border ${status === s ? 'bg-neutral-100' : 'bg-white hover:bg-neutral-50'}`}
                >
                  {s}
                </Link>
              ))}
            </>
          )}
        </div>
      </div>

      {tab === 'cases' ? (
        <div className="rounded-xl border bg-white overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-neutral-50 border-b">
              <tr>
                <th className="text-left px-4 py-2 font-medium">Created</th>
                <th className="text-left px-4 py-2 font-medium">Subject</th>
                <th className="text-left px-4 py-2 font-medium">Risk</th>
                <th className="text-left px-4 py-2 font-medium">Status</th>
                <th className="text-left px-4 py-2 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {cases.map((c) => (
                <tr key={c.id} className="border-b last:border-b-0 align-top">
                  <td className="px-4 py-2 whitespace-nowrap">{new Date(c.created_at).toLocaleString()}</td>
                  <td className="px-4 py-2">
                    <div className="font-medium">{c.subject_kind}</div>
                    <div className="text-xs text-neutral-500 break-all">{c.subject_key}</div>
                  </td>
                  <td className="px-4 py-2">{c.risk_score ?? '—'}</td>
                  <td className="px-4 py-2 whitespace-nowrap">{c.status}</td>
                  <td className="px-4 py-2">
                    {status === 'open' ? (
                      canManage ? (
                        <form action={closeFraudCaseAction} className="flex items-center gap-2">
                          <input type="hidden" name="caseId" value={c.id} />
                          <input
                            name="resolutionReason"
                            placeholder="resolution reason"
                            required
                            minLength={3}
                            maxLength={200}
                            className="rounded-md border px-2 py-1 text-xs"
                          />
                          <label className="flex items-center gap-1 text-xs text-neutral-600">
                            <input type="checkbox" name="confirm" required />
                            confirm
                          </label>
                          <button className="rounded-md border px-2 py-1 text-xs hover:bg-neutral-50">
                            Close
                          </button>
                        </form>
                      ) : (
                        <span className="text-xs text-neutral-500">Insufficient privileges</span>
                      )
                    ) : (
                      <div className="text-xs text-neutral-500">—</div>
                    )}
                  </td>
                </tr>
              ))}
              {cases.length === 0 && (
                <tr>
                  <td className="px-4 py-6 text-sm text-neutral-500" colSpan={5}>
                    No cases.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="rounded-xl border bg-white overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-neutral-50 border-b">
              <tr>
                <th className="text-left px-4 py-2 font-medium">Created</th>
                <th className="text-left px-4 py-2 font-medium">Type</th>
                <th className="text-left px-4 py-2 font-medium">Subject</th>
                <th className="text-left px-4 py-2 font-medium">Status</th>
                <th className="text-left px-4 py-2 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {actions.map((a) => {
                const rowStatus = a.resolved_at
                  ? 'resolved'
                  : a.expired_at
                    ? 'expired'
                    : 'active';

                return (
                  <tr key={a.id} className="border-b last:border-b-0 align-top">
                    <td className="px-4 py-2 whitespace-nowrap">{new Date(a.created_at).toLocaleString()}</td>
                    <td className="px-4 py-2 whitespace-nowrap">
                      <div className="font-medium">{a.action_type}</div>
                      <div className="text-xs text-neutral-500">{a.severity ?? '—'}</div>
                    </td>
                    <td className="px-4 py-2">
                      <div className="font-medium">{a.subject_kind}</div>
                      <div className="text-xs text-neutral-500 break-all">{a.subject_key}</div>
                    </td>
                    <td className="px-4 py-2 whitespace-nowrap">{rowStatus}</td>
                    <td className="px-4 py-2">
                      {rowStatus === 'active' ? (
                        canManage ? (
                          <form action={resolveFraudActionAction} className="flex items-center gap-2">
                            <input type="hidden" name="actionId" value={a.id} />
                            <input
                              name="resolutionReason"
                              placeholder="resolution reason"
                              required
                              minLength={3}
                              maxLength={200}
                              className="rounded-md border px-2 py-1 text-xs"
                            />
                            <label className="flex items-center gap-1 text-xs text-neutral-600">
                              <input type="checkbox" name="confirm" required />
                              confirm
                            </label>
                            <button className="rounded-md border px-2 py-1 text-xs hover:bg-neutral-50">
                              Resolve
                            </button>
                          </form>
                        ) : (
                          <span className="text-xs text-neutral-500">Insufficient privileges</span>
                        )
                      ) : (
                        <div className="text-xs text-neutral-500">—</div>
                      )}
                    </td>
                  </tr>
                );
              })}
              {actions.length === 0 && (
                <tr>
                  <td className="px-4 py-6 text-sm text-neutral-500" colSpan={5}>
                    No actions.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
