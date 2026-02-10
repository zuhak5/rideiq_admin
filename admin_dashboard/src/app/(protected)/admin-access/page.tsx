import { redirect } from 'next/navigation';
import { getAdminContext } from '@/lib/auth/guards';
import { listAdminAccess, listAdminRoles, listRoleChangeRequests } from '@/lib/admin/access';
import { approveRequestAction, setRolesAction } from './actions';

export default async function AdminAccessPage({
  searchParams,
}: {
  searchParams?: { q?: string; offset?: string; msg?: string; error?: string };
}) {
  const ctx = await getAdminContext();
  if (!ctx.can('admin_access.manage')) {
    redirect('/forbidden?permission=admin_access.manage');
  }

  const q = (searchParams?.q ?? '').trim();
  const offset = Math.max(0, Number(searchParams?.offset ?? 0) || 0);
  const flashMsg = (searchParams?.msg ?? '').trim();
  const flashErr = (searchParams?.error ?? '').trim();

  const [roles, access] = await Promise.all([
    listAdminRoles(ctx.supabase),
    listAdminAccess(ctx.supabase, { q, offset, limit: 25 }),
  ]);

  const pending = await listRoleChangeRequests(ctx.supabase, {
    status: 'pending',
    limit: 20,
    offset: 0,
  });

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">Admin Access</h1>
          <div className="text-xs text-neutral-500">
            Manage admin roles and permissions. Changes are audited.
          </div>
        </div>
        <form className="flex gap-2" action="/admin-access" method="get">
          <input
            name="q"
            defaultValue={q}
            placeholder="Search name / phone"
            className="rounded-md border px-3 py-2 text-sm bg-white"
          />
          <button className="rounded-md bg-neutral-900 text-white px-3 py-2 text-sm hover:bg-neutral-800">
            Search
          </button>
        </form>
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

      {pending.rows.length > 0 && (
        <div className="rounded-xl border bg-white p-4 space-y-2">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-medium">Pending super_admin change requests</div>
              <div className="text-xs text-neutral-500">
                Super-admin changes require a second admin to approve and execute.
              </div>
            </div>
            <div className="flex items-center gap-3">
              <a
                href="/admin-access/requests"
                className="text-xs rounded-md border bg-white px-2 py-1 hover:bg-neutral-50"
              >
                View all
              </a>
              <div className="text-xs text-neutral-500">Showing {pending.rows.length}</div>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-neutral-50 border-b">
                <tr>
                  <th className="text-left px-3 py-2 font-medium">Time</th>
                  <th className="text-left px-3 py-2 font-medium">Requester</th>
                  <th className="text-left px-3 py-2 font-medium">Target</th>
                  <th className="text-left px-3 py-2 font-medium">Requested roles</th>
                  <th className="text-left px-3 py-2 font-medium">Note</th>
                  <th className="text-left px-3 py-2 font-medium">Action</th>
                </tr>
              </thead>
              <tbody>
                {pending.rows.map((r) => {
                  const requester = `${r.created_by_name ?? '—'}${r.created_by_phone ? ` (${r.created_by_phone})` : ''}`;
                  const target = `${r.target_name ?? '—'}${r.target_phone ? ` (${r.target_phone})` : ''}`;
                  const canApprove = r.created_by !== ctx.user.id;
                  return (
                    <tr key={r.id} className="border-b last:border-b-0 align-top">
                      <td className="px-3 py-2 whitespace-nowrap">
                        {new Date(r.created_at).toLocaleString()}
                      </td>
                      <td className="px-3 py-2">{requester}</td>
                      <td className="px-3 py-2">{target}</td>
                      <td className="px-3 py-2">
                        <div className="flex flex-wrap gap-1">
                          {r.requested_role_keys.map((k) => (
                            <span key={k} className="text-xs rounded-md border px-2 py-0.5 bg-white">
                              {k}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="px-3 py-2 max-w-[360px] break-words">{r.note ?? '—'}</td>
                      <td className="px-3 py-2">
                        {canApprove ? (
                          <form action={approveRequestAction} className="flex items-center gap-2">
                            <input type="hidden" name="requestId" value={r.id} />
                            <input type="hidden" name="q" value={q} />
                            <input type="hidden" name="offset" value={String(offset)} />
                            <input
                              name="note"
                              placeholder="approval reason"
                              required
                              minLength={3}
                              maxLength={500}
                              className="rounded-md border px-2 py-1 text-xs w-[180px]"
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
                          <span className="text-xs text-neutral-500">Waiting for another admin</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="rounded-xl border bg-white p-4">
        <div className="text-sm font-medium">Available roles</div>
        <div className="mt-2 flex flex-wrap gap-2">
          {roles.map((r) => (
            <span key={r.key} className="text-xs rounded-md border px-2 py-1 bg-neutral-50">
              <span className="font-medium">{r.key}</span>
              {r.description ? <span className="text-neutral-600"> — {r.description}</span> : null}
            </span>
          ))}
        </div>
      </div>

      <div className="rounded-xl border bg-white overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-neutral-50 border-b">
            <tr>
              <th className="text-left px-4 py-2 font-medium">Name</th>
              <th className="text-left px-4 py-2 font-medium">Phone</th>
              <th className="text-left px-4 py-2 font-medium">Roles</th>
              <th className="text-left px-4 py-2 font-medium">Update roles</th>
            </tr>
          </thead>
          <tbody>
            {access.rows.map((u) => (
              <tr key={u.user_id} className="border-b last:border-b-0 align-top">
                <td className="px-4 py-2">{u.display_name ?? '—'}</td>
                <td className="px-4 py-2">{u.phone ?? '—'}</td>
                <td className="px-4 py-2">
                  <div className="flex flex-wrap gap-1">
                    {(u.roles ?? []).length ? (
                      u.roles.map((rk) => (
                        <span key={rk} className="text-xs rounded-md border px-2 py-0.5 bg-white">
                          {rk}
                        </span>
                      ))
                    ) : (
                      <span className="text-xs text-neutral-500">—</span>
                    )}
                  </div>
                </td>
                <td className="px-4 py-2">
                  <form action={setRolesAction} className="flex flex-col gap-2">
                    <input type="hidden" name="userId" value={u.user_id} />
                    <input type="hidden" name="q" value={q} />
                    <input type="hidden" name="offset" value={String(offset)} />

                    <fieldset className="rounded-lg border p-2">
                      <legend className="px-1 text-xs text-neutral-600">Assign roles</legend>
                      <div className="mt-1 grid grid-cols-2 gap-x-3 gap-y-1">
                        {roles.map((r) => (
                          <label key={r.key} className="flex items-start gap-2 text-xs">
                            <input
                              type="checkbox"
                              name="roles"
                              value={r.key}
                              defaultChecked={(u.roles ?? []).includes(r.key)}
                              className="mt-0.5"
                            />
                            <span>
                              <span className="font-medium">{r.key}</span>
                              {r.description ? (
                                <span className="block text-neutral-500">{r.description}</span>
                              ) : null}
                            </span>
                          </label>
                        ))}
                      </div>
                    </fieldset>
                    <div className="flex items-center gap-2">
                      <input
                        name="note"
                        placeholder="reason"
                        required
                        minLength={3}
                        maxLength={500}
                        className="rounded-md border px-2 py-1 text-xs flex-1"
                      />
                      <label className="flex items-center gap-1 text-xs text-neutral-600">
                        <input type="checkbox" name="confirm" required />
                        confirm
                      </label>
                      {u.user_id === ctx.user.id && (
                        <label className="flex items-center gap-1 text-xs text-amber-700">
                          <input type="checkbox" name="confirmSelfDemote" />
                          acknowledge self-demotion
                        </label>
                      )}
                      <button className="rounded-md border px-2 py-1 text-xs hover:bg-neutral-50">
                        Save
                      </button>
                    </div>
                    {u.user_id === ctx.user.id && (
                      <div className="text-xs text-neutral-500">
                        If you remove roles that grant <span className="font-mono">admin_access.manage</span>,
                        you may lose access to this page. Acknowledgement is required in that case.
                      </div>
                    )}
                  </form>
                </td>
              </tr>
            ))}
            {access.rows.length === 0 && (
              <tr>
                <td className="px-4 py-6 text-sm text-neutral-500" colSpan={4}>
                  No admin users.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between text-xs text-neutral-500">
        <div>
          Showing {access.page.returned} rows (offset {access.page.offset})
        </div>
        <div className="flex gap-2">
          <a
            className="rounded-md border bg-white px-2 py-1 hover:bg-neutral-50"
            href={`/admin-access?q=${encodeURIComponent(q)}&offset=${Math.max(0, offset - 25)}`}
          >
            Prev
          </a>
          <a
            className="rounded-md border bg-white px-2 py-1 hover:bg-neutral-50"
            href={`/admin-access?q=${encodeURIComponent(q)}&offset=${offset + 25}`}
          >
            Next
          </a>
        </div>
      </div>
    </div>
  );
}
